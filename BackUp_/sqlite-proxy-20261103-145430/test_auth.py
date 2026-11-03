"""Authentication regression checks; all accounts/files are temporary fixtures."""
import re
import tempfile
import time
import unittest
from pathlib import Path

import jwt
from flask import Flask, jsonify
from flask_socketio import SocketIO

from auth_system import AuthSystem


class AuthTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.app = Flask(__name__, template_folder=str(Path(__file__).parent / 'templates'))
        self.app.config.update(TESTING=True, AUTH_DATA_DIR=self.temp.name)
        self.socketio = SocketIO(self.app, async_mode='threading')
        self.auth = AuthSystem(self.app, self.socketio)
        self.app.add_url_rule('/', 'index', lambda: jsonify(ok=True))
        self.app.add_url_rule('/write', 'write', lambda: jsonify(ok=True), methods=['POST'])
        @self.socketio.on('connect')
        @self.auth.socket_connect
        def connect():
            pass
        @self.socketio.on('disconnect')
        def disconnect(*args):
            from flask import request
            self.auth.socket_disconnected(request.sid)
        @self.socketio.on('ping_private')
        @self.auth.socket_required
        def ping_private(data):
            return 'ok'
        self.client = self.app.test_client()

    def form(self, client, route, data, **kwargs):
        response = client.get(route, **kwargs)
        match = re.search(rb'name="csrf_token" value="([^"]+)"', response.data)
        self.assertIsNotNone(match, response.data)
        return client.post(route, data={**data, 'csrf_token': match[1].decode()}, **kwargs)

    def setup_account(self):
        result = self.form(self.client, '/setup', {'username': 'admin', 'password': 'ExamplePass123!', 'confirm_password': 'ExamplePass123!'})
        self.assertEqual(result.status_code, 302)
        return result

    def payload(self, client=None):
        return jwt.decode((client or self.client).get_cookie(self.auth.COOKIE).value,
                          self.auth.key, algorithms=['HS256'], audience='managefile-browser', issuer='managefile')

    def test_initial_setup_is_local_once_and_password_is_hashed(self):
        remote = self.client.get('/setup', environ_overrides={'REMOTE_ADDR': '192.168.1.20'})
        self.assertEqual(remote.status_code, 403)
        self.assertNotIn(b'name="password"', remote.data)
        self.assertEqual(self.client.post('/setup', data={'username':'admin'}).status_code, 403)
        self.setup_account()
        with self.auth.db() as conn:
            saved = conn.execute('SELECT * FROM users').fetchone()
        self.assertTrue(saved['password_hash'].startswith('scrypt:'))
        self.assertNotIn('ExamplePass', saved['password_hash'])
        self.assertEqual(self.client.get('/setup').status_code, 302)

    def test_http_jwt_csrf_cookie_lifetime_and_logout(self):
        self.assertEqual(self.client.get('/').status_code, 302)
        self.assertEqual(self.client.post('/write').status_code, 401)
        response = self.setup_account()
        cookie = next(value for value in response.headers.getlist('Set-Cookie') if value.startswith(self.auth.COOKIE + '='))
        self.assertIn('HttpOnly', cookie)
        self.assertIn('SameSite=Strict', cookie)
        self.assertIn('Max-Age=21600', cookie)
        payload = self.payload()
        self.assertEqual(payload['exp'] - payload['iat'], 21600)
        self.assertEqual(self.client.get('/').status_code, 200)
        self.assertEqual(self.client.post('/write').status_code, 403)
        self.assertEqual(self.client.post('/write', headers={'X-CSRF-Token': payload['csrf']}).status_code, 200)
        self.assertEqual(self.client.post('/write', headers={'X-CSRF-Token': payload['csrf'], 'Origin':'https://other.test'}).status_code, 403)
        self.assertEqual(self.client.post('/logout', data={'csrf_token':payload['csrf']}).status_code, 302)
        self.assertEqual(self.client.get('/').status_code, 302)

    def test_expired_tampered_and_revoked_jwt_rejected(self):
        self.setup_account()
        original = self.client.get_cookie(self.auth.COOKIE).value
        payload = self.payload()
        for changes in ({'exp': int(time.time()) - 1}, {'jti':'revoked'}, {'aud':'wrong'}):
            token = jwt.encode({**payload, **changes}, self.auth.key, algorithm='HS256')
            self.client.set_cookie(self.auth.COOKIE, token)
            self.assertEqual(self.client.post('/write', headers={'X-CSRF-Token':payload['csrf']}).status_code, 401)
        self.client.set_cookie(self.auth.COOKIE, original[:-5] + 'abcde')
        self.assertEqual(self.client.post('/write').status_code, 401)

    def test_login_rate_limit_safe_redirect_and_https_cookie(self):
        self.setup_account()
        guest = self.app.test_client()
        good = {'username':'admin', 'password':'ExamplePass123!', 'next':'https://other.test'}
        response = self.form(guest, '/login', good, base_url='https://localhost')
        self.assertEqual(response.location, '/')
        self.assertIn('Secure', response.headers.getlist('Set-Cookie')[0])
        guest = self.app.test_client()
        for _ in range(10):
            self.assertEqual(self.form(guest, '/login', {'username':'admin', 'password':'incorrect'}).status_code, 401)
        self.assertEqual(self.form(guest, '/login', good).status_code, 429)

    def test_account_change_revokes_sessions_and_socket_connections(self):
        self.assertFalse(self.socketio.test_client(self.app).is_connected())
        self.setup_account()
        old_cookie = self.client.get_cookie(self.auth.COOKIE).value
        sock = self.socketio.test_client(self.app, flask_test_client=self.client)
        self.assertTrue(sock.is_connected())
        self.assertEqual(sock.emit('ping_private', {}, callback=True), 'ok')
        result = self.client.post('/account', data={'csrf_token':self.payload()['csrf'],
            'username':'updated', 'current_password':'ExamplePass123!',
            'password':'NewExamplePass123!', 'confirm_password':'NewExamplePass123!'})
        self.assertEqual(result.status_code, 302)
        self.assertFalse(sock.is_connected())
        old_client = self.app.test_client()
        old_client.set_cookie(self.auth.COOKIE, old_cookie)
        self.assertEqual(old_client.get('/').status_code, 302)
        account = self.client.get('/account')
        self.assertEqual(account.status_code, 200)
        self.assertIn(b'value="updated"', account.data)
        guest = self.app.test_client()
        self.assertEqual(self.form(guest, '/login', {'username':'updated','password':'NewExamplePass123!'}).status_code, 302)

    def test_socket_disconnects_at_expiration(self):
        self.auth.TTL = 2
        self.setup_account()
        sock = self.socketio.test_client(self.app, flask_test_client=self.client)
        self.assertTrue(sock.is_connected())
        time.sleep(2.1)
        self.assertFalse(sock.is_connected())


if __name__ == '__main__':
    unittest.main(verbosity=2)
