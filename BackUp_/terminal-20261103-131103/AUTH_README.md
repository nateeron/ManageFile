# ManageFile authentication

Run `python -m pip install -r requirements.txt`, then restart `python app.py`.
On the server computer, open `http://127.0.0.1:1298/setup` to create the first
username and password (minimum 8 characters). Setup closes after the first account.
Other computers can then sign in using the server's usual address.

Accounts and revocable JWT sessions are stored in `instance/auth/accounts.sqlite3`.
Passwords use Werkzeug's scrypt hash. JWTs use HS256 and a generated persistent
secret in `instance/auth/jwt-secret`. Back up these two files together; keep them
out of source control. `MANAGEFILE_AUTH_DIR` can override their directory.

Sessions expire exactly six hours after sign-in; activity does not extend them.
Sign out revokes the session immediately. Account settings let the signed-in
user change their username and password after confirming their current password;
this revokes all previous sessions, including Socket.IO connections.

JWT cookies are HttpOnly and SameSite=Strict, and Secure when served over HTTPS.
Use HTTPS when accessing the application over an untrusted network.
Unsafe HTTP requests require the matching CSRF token. API clients must retain
the login cookie and send the page's `auth-csrf` token in `X-CSRF-Token`.
The application's fetch and jQuery requests do this automatically.

This is a single trusted account for the existing full-filesystem file manager;
it does not introduce per-folder permissions or public registration.
