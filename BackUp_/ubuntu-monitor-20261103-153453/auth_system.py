"""SQLite accounts and revocable six-hour JWT cookie sessions for ManageFile."""
import functools
from contextlib import contextmanager
import hmac
import ipaddress
import os
import ntpath
import posixpath
import re
from pathlib import Path
import secrets
import sqlite3
import threading
import time
from urllib.parse import urlsplit

import jwt
from flask import g, jsonify, redirect, render_template, request, url_for
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.middleware.proxy_fix import ProxyFix


class AuthSystem:
    COOKIE = 'managefile_token'
    FORM_COOKIE = 'managefile_form'
    TTL = 6 * 60 * 60

    def __init__(self, app, socketio):
        self.app, self.socketio = app, socketio
        # nginx terminates HTTPS and connects over HTTP on loopback. Trust only
        # its scheme header, never forwarded hosts or arbitrary remote clients.
        direct_app = app.wsgi_app
        proxy_app = ProxyFix(direct_app, x_for=0, x_proto=1, x_host=0, x_port=0, x_prefix=0)

        def local_proxy(environ, start_response):
            handler = proxy_app if environ.get('REMOTE_ADDR') in {'127.0.0.1', '::1'} else direct_app
            return handler(environ, start_response)

        app.wsgi_app = local_proxy
        self.folder = Path(app.config.get('AUTH_DATA_DIR', Path(app.instance_path) / 'auth')).resolve()
        self.folder.mkdir(parents=True, exist_ok=True)
        secret_file = self.folder / 'jwt-secret'
        try:
            with secret_file.open('x', encoding='ascii') as stream:
                stream.write(secrets.token_hex(64))
            if os.name != 'nt':
                secret_file.chmod(0o600)
        except FileExistsError:
            pass
        self.key = secret_file.read_text(encoding='ascii').strip()
        if len(self.key) < 64:
            raise RuntimeError('JWT secret is invalid; restore the original secret file.')
        self.forms = URLSafeTimedSerializer(self.key, salt='managefile-login-form')
        self.database = self.folder / 'accounts.sqlite3'
        with self.db() as conn:
            conn.executescript('''
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY, username TEXT NOT NULL COLLATE NOCASE UNIQUE,
                    password_hash TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1);
                CREATE TABLE IF NOT EXISTS sessions (
                    jti TEXT PRIMARY KEY, user_id INTEGER NOT NULL,
                    user_version INTEGER NOT NULL, expires_at INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS login_failures (
                    ip TEXT NOT NULL, attempted_at INTEGER NOT NULL);
                CREATE INDEX IF NOT EXISTS failures_by_ip ON login_failures(ip, attempted_at);
                CREATE TABLE IF NOT EXISTS bookmarks (
                    id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL,
                    name TEXT NOT NULL, path TEXT NOT NULL, path_key TEXT NOT NULL,
                    UNIQUE(user_id, path_key));
            ''')
        self.sockets = {}
        self.socket_lock = threading.Lock()
        app.before_request(self.authorize)
        app.after_request(self.response_headers)
        app.context_processor(self.template_context)
        app.add_url_rule('/login', 'auth_login', self.login, methods=['GET', 'POST'])
        app.add_url_rule('/setup', 'auth_setup', self.setup, methods=['GET', 'POST'])
        app.add_url_rule('/logout', 'auth_logout', self.logout, methods=['POST'])
        app.add_url_rule('/api/session', 'auth_session', lambda: jsonify(authenticated=True), methods=['GET'])
        app.add_url_rule('/account', 'auth_account', self.account, methods=['GET', 'POST'])
        app.add_url_rule('/api/bookmarks', 'bookmarks', self.bookmarks, methods=['GET', 'POST'])
        app.add_url_rule('/api/bookmarks/<int:bookmark_id>', 'bookmark_delete', self.bookmark_delete, methods=['DELETE'])
        app.add_url_rule('/api/bookmarks/import', 'bookmarks_import', self.bookmarks_import, methods=['POST'])

    @staticmethod
    def validate_bookmark(data):
        if not isinstance(data, dict) or not isinstance(data.get('name'), str) or not isinstance(data.get('path'), str):
            raise ValueError('A bookmark name and folder path are required.')
        name, path = data['name'].strip(), data['path'].strip()
        if not 1 <= len(name) <= 100 or not 1 <= len(path) <= 4096 or any(ord(c) < 32 for c in name + path):
            raise ValueError('Use a name of 1–100 characters and a valid folder path.')
        if re.match(r'^[A-Za-z]:[/\\]', path) or path.startswith(('\\\\', '//')):
            key = ntpath.normpath(path).replace('\\', '/').casefold()
        elif path.startswith('/'):
            key = posixpath.normpath(path)
        else:
            raise ValueError('Use an absolute folder path, such as C:\\Files or /home/user.')
        return name, path, key

    def bookmark_rows(self, conn):
        return [dict(row) for row in conn.execute('SELECT id,name,path FROM bookmarks WHERE user_id=? ORDER BY id', (g.auth['sub'],))]

    def bookmarks(self):
        if request.method == 'GET':
            with self.db() as conn:
                return jsonify(bookmarks=self.bookmark_rows(conn))
        if (request.content_length or 0) > 16384:
            return jsonify(error='Bookmark request is too large.'), 413
        try:
            name, path, key = self.validate_bookmark(request.get_json(silent=True))
        except ValueError as error:
            return jsonify(error=str(error)), 400
        with self.db() as conn:
            conn.execute('''INSERT INTO bookmarks(user_id,name,path,path_key) VALUES(?,?,?,?)
                ON CONFLICT(user_id,path_key) DO UPDATE SET name=excluded.name,path=excluded.path''',
                (g.auth['sub'], name, path, key))
            return jsonify(bookmarks=self.bookmark_rows(conn))

    def bookmark_delete(self, bookmark_id):
        with self.db() as conn:
            result = conn.execute('DELETE FROM bookmarks WHERE id=? AND user_id=?', (bookmark_id, g.auth['sub']))
            if result.rowcount == 0:
                return jsonify(error='Bookmark not found.'), 404
            return jsonify(bookmarks=self.bookmark_rows(conn))

    def bookmarks_import(self):
        if (request.content_length or 0) > 262144:
            return jsonify(error='Bookmark import is too large.'), 413
        data = request.get_json(silent=True)
        items = data.get('bookmarks') if isinstance(data, dict) else None
        if not isinstance(items, list) or len(items) > 500:
            return jsonify(error='Import up to 500 bookmarks at a time.'), 400
        try:
            validated = [self.validate_bookmark(item) for item in items]
        except ValueError as error:
            return jsonify(error=str(error)), 400
        with self.db() as conn:
            # Imports are idempotent and preserve names already saved on the server.
            conn.executemany('''INSERT INTO bookmarks(user_id,name,path,path_key) VALUES(?,?,?,?)
                ON CONFLICT(user_id,path_key) DO NOTHING''',
                [(g.auth['sub'], name, path, key) for name, path, key in validated])
            return jsonify(bookmarks=self.bookmark_rows(conn))

    @contextmanager
    def db(self):
        conn = sqlite3.connect(self.database, timeout=10)
        conn.row_factory = sqlite3.Row
        try:
            with conn:
                yield conn
        finally:
            conn.close()

    def initialized(self):
        with self.db() as conn:
            return conn.execute('SELECT 1 FROM users LIMIT 1').fetchone() is not None

    def claims(self):
        token = request.cookies.get(self.COOKIE, '')
        if not token:
            return None
        try:
            payload = jwt.decode(token, self.key, algorithms=['HS256'],
                                 issuer='managefile', audience='managefile-browser',
                                 options={'require': ['sub', 'jti', 'iat', 'exp', 'csrf']})
            with self.db() as conn:
                user = conn.execute('''SELECT u.id, u.username FROM users u JOIN sessions s
                    ON s.user_id=u.id WHERE s.jti=? AND s.user_id=?
                    AND s.user_version=u.version AND s.expires_at>?''',
                    (payload['jti'], payload['sub'], int(time.time()))).fetchone()
            if not user:
                return None
            payload['username'] = user['username']
            return payload
        except (jwt.InvalidTokenError, ValueError, TypeError):
            return None

    def template_context(self):
        claims = getattr(g, 'auth', None)
        return {'auth_user': claims['username'] if claims else None,
                'auth_csrf': claims['csrf'] if claims else '',
                'auth_expires': claims['exp'] if claims else 0}

    @staticmethod
    def safe_next(value):
        # Never redirect to another site, including backslash URL variants.
        return value if value and value.startswith('/') and not value.startswith('//') and '\\' not in value and not any(ord(c) < 32 for c in value) else '/'

    def authorize(self):
        if request.endpoint in {'auth_login', 'auth_setup', 'auth_account'} and (request.content_length or 0) > 16384:
            return jsonify(error='Account form is too large'), 413
        g.auth = self.claims()
        if request.endpoint in {'static', 'auth_login', 'auth_setup'}:
            return None
        if not g.auth:
            if request.endpoint == 'auth_logout' and request.method == 'POST':
                return self.logout_response()
            if request.endpoint in {'index', 'auth_account', 'terminal_page'} and request.method == 'GET':
                destination = 'auth_login' if self.initialized() else 'auth_setup'
                return redirect(url_for(destination, next=self.safe_next(request.full_path.rstrip('?'))))
            return jsonify(error='Authentication required', code='AUTH_REQUIRED'), 401
        if request.method not in {'GET', 'HEAD', 'OPTIONS'}:
            submitted = request.headers.get('X-CSRF-Token') or request.form.get('csrf_token', '')
            if not hmac.compare_digest(str(submitted), g.auth['csrf']):
                return jsonify(error='Invalid CSRF token'), 403
            origin = request.headers.get('Origin')
            if origin and origin != request.host_url.rstrip('/'):
                return jsonify(error='Cross-origin request rejected'), 403
        return None

    def response_headers(self, response):
        if request.endpoint != 'static':
            response.headers['Cache-Control'] = 'no-store'
            response.headers['X-Frame-Options'] = 'DENY'
            response.headers['Referrer-Policy'] = 'same-origin'
            response.headers['X-Content-Type-Options'] = 'nosniff'
        return response

    def form_token_valid(self):
        token = request.form.get('csrf_token', '')
        if not token or not hmac.compare_digest(token, request.cookies.get(self.FORM_COOKIE, '')):
            return False
        try:
            self.forms.loads(token, max_age=1200)
            return True
        except (BadSignature, SignatureExpired):
            return False

    def form_page(self, mode, error=None, status=200, **context):
        token = self.forms.dumps(secrets.token_urlsafe(24))
        response = self.app.make_response((render_template('auth.html', mode=mode, error=error,
            form_token=token, next_path=self.safe_next(request.values.get('next')), **context), status))
        response.set_cookie(self.FORM_COOKIE, token, max_age=1200, httponly=True,
                            secure=request.is_secure, samesite='Strict')
        return response

    @staticmethod
    def validate_credentials(username, password):
        if not 3 <= len(username) <= 64 or any(ord(c) < 32 for c in username):
            return 'Username must contain 3–64 characters.'
        if not 8 <= len(password) <= 128:
            return 'Password must contain 8–128 characters.'
        return None

    def issue(self, user, destination='/'):
        now = int(time.time())
        payload = {'sub': str(user['id']), 'jti': secrets.token_urlsafe(32),
                   'iat': now, 'exp': now + self.TTL, 'csrf': secrets.token_urlsafe(32),
                   'iss': 'managefile', 'aud': 'managefile-browser'}
        with self.db() as conn:
            conn.execute('DELETE FROM sessions WHERE expires_at<=?', (now,))
            conn.execute('INSERT INTO sessions VALUES (?,?,?,?)',
                         (payload['jti'], user['id'], user['version'], payload['exp']))
        response = redirect(self.safe_next(destination))
        response.set_cookie(self.COOKIE, jwt.encode(payload, self.key, algorithm='HS256'),
                            max_age=self.TTL, httponly=True, secure=request.is_secure, samesite='Strict')
        response.delete_cookie(self.FORM_COOKIE)
        return response

    def setup(self):
        if self.initialized():
            return redirect(url_for('auth_login'))
        try:
            local = ipaddress.ip_address(request.remote_addr).is_loopback
        except (ValueError, TypeError):
            local = False
        if not local:
            return self.form_page('local_setup', status=403)
        if request.method == 'GET':
            return self.form_page('setup')
        if not self.form_token_valid():
            return self.form_page('setup', 'The form expired. Please try again.', 403)
        username, password = request.form.get('username', '').strip(), request.form.get('password', '')
        error = self.validate_credentials(username, password)
        if password != request.form.get('confirm_password'):
            error = 'Passwords do not match.'
        if error:
            return self.form_page('setup', error, 400)
        password_hash = generate_password_hash(password)
        with self.db() as conn:
            conn.execute('BEGIN IMMEDIATE')
            if conn.execute('SELECT 1 FROM users LIMIT 1').fetchone():
                return redirect(url_for('auth_login'))
            cursor = conn.execute('INSERT INTO users(username,password_hash) VALUES (?,?)', (username, password_hash))
            user = conn.execute('SELECT * FROM users WHERE id=?', (cursor.lastrowid,)).fetchone()
        return self.issue(user, request.form.get('next'))

    def login(self):
        if not self.initialized():
            return redirect(url_for('auth_setup'))
        if g.auth:
            return redirect(self.safe_next(request.args.get('next')))
        if request.method == 'GET':
            return self.form_page('login')
        if not self.form_token_valid():
            return self.form_page('login', 'The form expired. Please try again.', 403)
        ip, now = request.remote_addr or '', int(time.time())
        with self.db() as conn:
            conn.execute('DELETE FROM login_failures WHERE attempted_at<?', (now - 300,))
            failures = conn.execute('SELECT COUNT(*) FROM login_failures WHERE ip=?', (ip,)).fetchone()[0]
            if failures >= 10:
                return self.form_page('login', 'Too many attempts. Try again in 5 minutes.', 429)
            user = conn.execute('SELECT * FROM users WHERE username=?', (request.form.get('username', '').strip(),)).fetchone()
        password = request.form.get('password', '')
        # A fixed-cost hash check also runs for unknown usernames.
        valid = check_password_hash(user['password_hash'] if user else self.dummy_hash, password[:129])
        if not user or not valid or len(password) > 128:
            with self.db() as conn:
                conn.execute('INSERT INTO login_failures VALUES (?,?)', (ip, now))
            return self.form_page('login', 'Invalid username or password.', 401)
        with self.db() as conn:
            conn.execute('DELETE FROM login_failures WHERE ip=?', (ip,))
        return self.issue(user, request.form.get('next'))

    @functools.cached_property
    def dummy_hash(self):
        return generate_password_hash(secrets.token_urlsafe(32))

    def revoke_sockets(self, jtis):
        terminal = self.app.extensions.get('terminal_manager')
        if terminal is not None:
            terminal.cancel_sessions(jtis)
        with self.socket_lock:
            sids = [sid for sid, jti in self.sockets.items() if jti in jtis]
        for sid in sids:
            self.socketio.server.disconnect(sid, namespace='/')

    def logout(self):
        jti = g.auth['jti']
        with self.db() as conn:
            conn.execute('DELETE FROM sessions WHERE jti=?', (jti,))
        self.revoke_sockets({jti})
        return self.logout_response()

    def logout_response(self):
        if request.accept_mimetypes.best == 'application/json':
            response = jsonify(ok=True, redirect=url_for('auth_login'))
        else:
            response = redirect(url_for('auth_login'), code=303)
        response.delete_cookie(self.COOKIE, httponly=True, secure=request.is_secure, samesite='Strict')
        response.delete_cookie(self.FORM_COOKIE, httponly=True, secure=request.is_secure, samesite='Strict')
        return response

    def account(self):
        if request.method == 'GET':
            return render_template('auth.html', mode='account', error=None)
        username, password = request.form.get('username', '').strip(), request.form.get('password', '')
        error = self.validate_credentials(username, password)
        if password != request.form.get('confirm_password'):
            error = 'Passwords do not match.'
        with self.db() as conn:
            user = conn.execute('SELECT * FROM users WHERE id=?', (g.auth['sub'],)).fetchone()
        if not check_password_hash(user['password_hash'], request.form.get('current_password', '')):
            error = 'Current password is incorrect.'
        if error:
            return render_template('auth.html', mode='account', error=error), 400
        try:
            with self.db() as conn:
                conn.execute('UPDATE users SET username=?,password_hash=?,version=version+1 WHERE id=?',
                             (username, generate_password_hash(password), user['id']))
                jtis = {row['jti'] for row in conn.execute('SELECT jti FROM sessions WHERE user_id=?', (user['id'],))}
                conn.execute('DELETE FROM sessions WHERE user_id=?', (user['id'],))
                user = conn.execute('SELECT * FROM users WHERE id=?', (user['id'],)).fetchone()
        except sqlite3.IntegrityError:
            return render_template('auth.html', mode='account', error='Username is already in use.'), 400
        self.revoke_sockets(jtis)
        return self.issue(user)

    def socket_connect(self, func):
        @functools.wraps(func)
        def wrapped(*args, **kwargs):
            claims = self.claims()
            if not claims:
                return False
            sid = request.sid
            with self.socket_lock:
                self.sockets[sid] = claims['jti']
            def expire():
                self.socketio.sleep(max(0, claims['exp'] - time.time()))
                with self.socket_lock:
                    still_connected = self.sockets.get(sid) == claims['jti']
                if still_connected:
                    self.socketio.server.disconnect(sid, namespace='/')
            self.socketio.start_background_task(expire)
            return func(*args, **kwargs)
        return wrapped

    def socket_required(self, func):
        @functools.wraps(func)
        def wrapped(*args, **kwargs):
            if not self.claims():
                self.socketio.server.disconnect(request.sid, namespace='/')
                return None
            return func(*args, **kwargs)
        return wrapped

    def socket_disconnected(self, sid):
        with self.socket_lock:
            self.sockets.pop(sid, None)
