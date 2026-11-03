"""Monitor tests use synthetic Linux data and temporary authentication fixtures."""
import subprocess
import unittest
from unittest.mock import patch
from collections import namedtuple
import test_auth as fixtures
from monitor_system import UbuntuMonitor


class MonitorTests(unittest.TestCase):
    setUp = fixtures.AuthTests.setUp
    form = fixtures.AuthTests.form
    setup_account = fixtures.AuthTests.setup_account
    payload = fixtures.AuthTests.payload

    def test_access_and_windows_message(self):
        monitor = UbuntuMonitor(self.app)
        self.assertEqual(self.client.get('/api/monitor').status_code, 401)
        self.assertIn('/setup', self.client.get('/monitor').location)
        self.setup_account()
        page = self.client.get('/monitor')
        self.assertEqual(page.status_code, 200)
        self.assertIn(b'monitor.js', page.data)
        monitor.linux = False
        self.assertFalse(self.client.get('/api/monitor').json['supported'])
        self.assertEqual(self.client.get('/api/monitor/ssl').status_code, 400)
        self.assertEqual(self.client.get('/api/monitor/arbitrary-command').status_code, 404)


    def test_metrics_delta_and_available_memory(self):
        monitor = UbuntuMonitor(self.app)
        def read(path, *args, **kwargs):
            if path.as_posix() == '/proc/stat':
                return 'cpu 100 0 50 800 50 0 0 0 0 0\n'
            if path.as_posix() == '/proc/meminfo':
                return 'MemTotal: 1000 kB\nMemAvailable: 700 kB\nMemFree: 100 kB\nSwapTotal: 100 kB\nSwapFree: 50 kB\n'
            return '90000 50000'
        Disk = namedtuple('Disk','total used free')
        with patch('monitor_system.Path.read_text', autospec=True, side_effect=read), patch('monitor_system.shutil.disk_usage', return_value=Disk(1000,400,600)), patch('monitor_system.os.getloadavg', return_value=(1,2,3), create=True):
            first = monitor.metrics()
            self.assertIsNone(first['cpu'])
            monitor.previous_cpu = (900, 800)
            second = monitor.metrics()
            self.assertEqual(second['cpu'], 50)
            self.assertEqual(second['ram_available'], 700*1024)
            self.assertEqual(second['ram_percent'], 30)
            self.assertEqual(second['disk_percent'], 40)


    def test_config_filters_secrets_and_privilege_is_noninteractive(self):
        monitor = UbuntuMonitor(self.app)
        calls = []
        def run(args, **kwargs):
            calls.append((args,kwargs))
            kwargs['stdout'].write(b'# configuration file /etc/nginx/nginx.conf:\nserver_name example.test;\nssl_certificate_key /secret/privkey.pem;\nproxy_set_header Authorization secret-value;\n-----BEGIN PRIVATE KEY-----\nsecret-data\nproxy_pass http://127.0.0.1:2289;\n')
            return subprocess.CompletedProcess(args,0)
        with patch('monitor_system.shutil.which', side_effect=lambda name:'/usr/bin/'+name), patch('monitor_system.os.geteuid',return_value=1000,create=True), patch('monitor_system.subprocess.run',side_effect=run):
            result = monitor.command('config')
        self.assertTrue(result['ok'])
        self.assertIn('proxy_pass',result['output'])
        self.assertIn('/secret/privkey.pem',result['output'])
        self.assertNotIn('secret-value',result['output'])
        self.assertNotIn('secret-data',result['output'])
        self.assertNotIn('BEGIN PRIVATE',result['output'])
        self.assertEqual(calls[0][0][:3],['/usr/bin/sudo','-n','--'])
        self.assertNotIn('shell',calls[0][1])
        self.assertEqual(calls[0][1]['timeout'],5)


    def test_timeout_missing_tools_and_cache(self):
        monitor = UbuntuMonitor(self.app)
        with patch('monitor_system.shutil.which',return_value=None):
            self.assertFalse(monitor.command('ssl')['ok'])
        with patch('monitor_system.shutil.which',return_value='/bin/du'), patch('monitor_system.os.geteuid',return_value=0,create=True), patch('monitor_system.subprocess.run',side_effect=subprocess.TimeoutExpired('du',20)):
            self.assertIn('timed out',monitor.command('var-size')['output'])
        with patch.object(monitor,'command',return_value={'ok':True,'output':'cached'}) as run:
            self.assertEqual(monitor.cached('ports',15),monitor.cached('ports',15))
            self.assertEqual(run.call_count,1)


if __name__ == "__main__":
    unittest.main()
