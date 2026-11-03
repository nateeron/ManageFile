import unittest
from werkzeug.security import generate_password_hash
import test_auth as auth_fixtures


class BookmarkTests(unittest.TestCase):
    def setUp(self):
        self.fixture = auth_fixtures.AuthTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.fixture.setup_account()
        self.client = self.fixture.client
        self.auth = self.fixture.auth

    def mutate(self, path='/api/bookmarks', method='POST', data=None, client=None):
        client = client or self.client
        return client.open(path, method=method, json=data,
                           headers={'X-CSRF-Token':self.fixture.payload(client)['csrf']})

    def test_login_csrf_and_shared_database_across_clients(self):
        guest = self.fixture.app.test_client()
        self.assertEqual(guest.get('/api/bookmarks').status_code, 401)
        self.assertEqual(guest.post('/api/bookmarks', json={}).status_code, 401)
        self.assertEqual(self.client.post('/api/bookmarks', json={}).status_code, 403)
        response = self.mutate(data={'name':"Folder's preview", 'path':r'C:\Files'})
        self.assertEqual(response.status_code, 200)
        with self.auth.db() as conn:
            row = conn.execute('SELECT * FROM bookmarks').fetchone()
        self.assertEqual(row['name'], "Folder's preview")
        self.assertEqual(row['user_id'], int(self.fixture.payload()['sub']))
        self.fixture.form(guest, '/login', {'username':'admin','password':'ExamplePass123!'})
        self.assertEqual(guest.get('/api/bookmarks').json, response.json)

    def test_create_update_deduplicate_and_delete(self):
        first = self.mutate(data={'name':'First', 'path':'C:/Files/'}).json['bookmarks'][0]
        response = self.mutate(data={'name':'Updated', 'path':'c:/files'}).json['bookmarks']
        self.assertEqual(len(response), 1)
        self.assertEqual(response[0]['id'], first['id'])
        self.assertEqual(response[0]['name'], 'Updated')
        self.assertEqual(self.mutate('/api/bookmarks/' + str(first['id']), 'DELETE').json['bookmarks'], [])
        self.assertEqual(self.client.get('/api/bookmarks').json['bookmarks'], [])
        self.mutate(data={'name':'Upper', 'path':'/home/User'})
        self.mutate(data={'name':'Lower', 'path':'/home/user'})
        self.assertEqual(len(self.client.get('/api/bookmarks').json['bookmarks']), 2)

    def test_import_is_atomic_and_does_not_overwrite_server_names(self):
        self.mutate(data={'name':'Server name', 'path':r'G:\Work'})
        old = [{'name':'Old name', 'path':'g:/work/'}, {'name':'New', 'path':'/home/new'}]
        for _ in range(2):
            response = self.mutate('/api/bookmarks/import', data={'bookmarks':old})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(len(response.json['bookmarks']), 2)
            self.assertEqual(response.json['bookmarks'][0]['name'], 'Server name')
        response = self.mutate('/api/bookmarks/import', data={'bookmarks':[{'name':'Valid','path':'/would-be-new'}, {'name':'Invalid','path':'relative'}]})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(len(self.client.get('/api/bookmarks').json['bookmarks']), 2)

    def test_account_isolation(self):
        original = self.mutate(data={'name':'Private', 'path':r'C:\Files'}).json['bookmarks'][0]
        with self.auth.db() as conn:
            conn.execute('INSERT INTO users(username,password_hash) VALUES (?,?)', ('second',generate_password_hash('SecondExample123!')))
        other = self.fixture.app.test_client()
        self.fixture.form(other, '/login', {'username':'second','password':'SecondExample123!'})
        self.assertEqual(other.get('/api/bookmarks').json['bookmarks'], [])
        self.assertEqual(self.mutate('/api/bookmarks/' + str(original['id']), 'DELETE', client=other).status_code, 404)
        self.mutate(data={'name':'Second user', 'path':r'C:\Files'}, client=other)
        self.assertEqual(self.client.get('/api/bookmarks').json['bookmarks'][0]['name'], 'Private')
        self.assertEqual(other.get('/api/bookmarks').json['bookmarks'][0]['name'], 'Second user')

    def test_invalid_payloads_leave_database_unchanged(self):
        for data in (None, [], {}, {'name':'', 'path':'C:/'}, {'name':'Bad','path':'relative'}, {'name':'x'*101,'path':'/tmp'}, {'name':'Bad','path':'/tmp\0'}):
            self.assertEqual(self.mutate(data=data).status_code, 400)
        self.assertEqual(self.client.get('/api/bookmarks').json['bookmarks'], [])


if __name__ == '__main__':
    unittest.main(verbosity=2)
