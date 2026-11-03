import os
from pathlib import Path
import threading
import time
import unittest
from unittest.mock import patch

import test_auth as auth_fixtures
from terminal_system import TerminalManager


class TerminalTests(unittest.TestCase):
    def setUp(self):
        self.fixture = auth_fixtures.AuthTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.manager = TerminalManager(self.fixture.app)
        self.fixture.setup_account()
        self.client = self.fixture.client
        self.cwd = self.fixture.temp.name
        # Exercise real shell execution without requesting elevation in tests.
        self.admin = patch('terminal_system.is_windows_admin', return_value=True)
        self.admin.start()
        self.addCleanup(self.admin.stop)

    def headers(self):
        return {'X-CSRF-Token': self.fixture.payload()['csrf']}

    def run_command(self, command, cwd=None):
        return self.client.post('/api/terminal/run', json={'command':command, 'cwd':cwd or self.cwd}, headers=self.headers())

    def test_login_csrf_and_admin_required(self):
        guest = self.fixture.app.test_client()
        self.assertEqual(guest.get('/api/terminal/status').status_code, 401)
        self.assertEqual(guest.post('/api/terminal/run', json={}).status_code, 401)
        self.assertEqual(self.client.post('/api/terminal/run', json={}).status_code, 403)
        if self.manager.windows:
            with patch('terminal_system.is_windows_admin', return_value=False):
                self.assertFalse(self.client.get('/api/terminal/status').json['ready'])
                self.assertEqual(self.run_command('Get-Location').status_code, 403)

    def test_terminal_tab_requires_login_and_keeps_initial_folder(self):
        guest = self.fixture.app.test_client()
        response = guest.get('/terminal', query_string={'path':self.cwd})
        self.assertEqual(response.status_code, 302)
        self.assertIn('/login', response.location)
        response = self.client.get('/terminal', query_string={'path':self.cwd})
        self.assertEqual(response.status_code, 200)
        self.assertIn(b'data-terminal-page="true"', response.data)
        self.assertIn(self.cwd.encode(), response.data)
        self.assertIn(b'auth-csrf', response.data)

    def test_real_shell_output_and_directory_with_unicode_and_quotes(self):
        folder = Path(self.cwd) / "Owner's folder ทดสอบ"
        folder.mkdir()
        if self.manager.windows:
            command = "Write-Output 'terminal-check'; Set-Location -LiteralPath " + self.manager.ps_quote(folder)
        else:
            import shlex
            command = 'echo terminal-check; cd ' + shlex.quote(str(folder))
        response = self.run_command(command)
        self.assertEqual(response.status_code, 200, response.json)
        self.assertIn('terminal-check', response.json['output'])
        self.assertEqual(response.json['exit_code'], 0)
        self.assertEqual(Path(response.json['cwd']), folder)

    def test_validation_and_nonzero_exit(self):
        self.assertEqual(self.run_command('').status_code, 400)
        self.assertEqual(self.run_command('echo check', 'not-an-absolute-folder').status_code, 400)
        command = 'cmd.exe /c exit 7' if self.manager.windows else 'exit 7'
        self.assertEqual(self.run_command(command).json['exit_code'], 7)

    def test_output_is_bounded(self):
        self.manager.OUTPUT_LIMIT = 1000
        command = '1..1500 | ForEach-Object { "line-$_" }' if self.manager.windows else 'for i in {1..1500}; do echo line-$i; done'
        data = self.run_command(command).json
        self.assertTrue(data['truncated'], data)
        self.assertLessEqual(len(data['output'].encode()), 1000)
        self.assertIn('line-1500', data['output'])

    def test_timeout_terminates_command(self):
        self.manager.TIMEOUT = 0.5
        command = 'Start-Sleep -Seconds 15' if self.manager.windows else 'sleep 15'
        before = time.monotonic()
        data = self.run_command(command).json
        self.assertTrue(data['timed_out'], data)
        self.assertLess(time.monotonic() - before, 7)
        self.assertFalse(self.manager.active)

    def start_long_command(self):
        jti = self.fixture.payload()['jti']
        command = 'Start-Sleep -Seconds 15' if self.manager.windows else 'sleep 15'
        result = {}
        def run():
            result.update(self.manager.run(jti, command, self.cwd, time.time() + 60))
        worker = threading.Thread(target=run)
        worker.start()
        for _ in range(250):
            with self.manager.lock:
                running = self.manager.active.get(jti, {}).get('process') is not None
            if running:
                break
            time.sleep(0.02)
        self.assertTrue(running)
        return worker, result

    def test_stop_and_single_command_per_session(self):
        worker, result = self.start_long_command()
        self.assertEqual(self.run_command('echo another').status_code, 409)
        self.assertEqual(self.client.post('/api/terminal/stop', headers=self.headers()).status_code, 200)
        worker.join(timeout=7)
        self.assertFalse(worker.is_alive())
        self.assertTrue(result['stopped'])

    def test_logout_stops_active_terminal(self):
        worker, result = self.start_long_command()
        self.client.post('/logout', data={'csrf_token':self.fixture.payload()['csrf']})
        worker.join(timeout=7)
        self.assertFalse(worker.is_alive())
        self.assertTrue(result['stopped'])

    def test_bash_adapter_does_not_elevate(self):
        self.manager.windows = False
        with patch.object(self.manager, 'shell_path', return_value='/bin/bash'):
            arguments = self.manager.build_command('ls -la', '/tmp/cwd.txt')
        self.assertEqual(arguments[:4], ['/bin/bash', '--noprofile', '--norc', '-c'])
        self.assertIn('ls -la', arguments[4])
        self.assertNotIn('sudo', arguments)


if __name__ == '__main__':
    unittest.main(verbosity=2)
