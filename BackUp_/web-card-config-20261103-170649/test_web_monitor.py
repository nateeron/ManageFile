"""Website controls are tested with mocked commands; no real services are changed."""
import threading
import subprocess
import unittest
from unittest.mock import patch
import test_auth as fixtures
from monitor_system import UbuntuMonitor
from web_monitor import parse_sites, parse_certificates

CONFIG = '''nginx: configuration file /etc/nginx/nginx.conf test is successful
# configuration file /etc/nginx/nginx.conf:
events {} http { include /etc/nginx/sites-enabled/*; }
# configuration file /etc/nginx/sites-enabled/example:
server { listen 80; server_name example.test www.example.test; return 301 https://$host$request_uri; }
server { listen 443 ssl; server_name example.test www.example.test;
 ssl_certificate /etc/letsencrypt/live/example.test/fullchain.pem;
 ssl_certificate_key /etc/letsencrypt/live/example.test/privkey.pem;
 location / { proxy_pass http://127.0.0.1:8000; proxy_set_header Authorization secret; }
}
# configuration file /etc/nginx/sites-enabled/second:
server {listen [::]:443 ssl; server_name second.test; root "/var/www/with space";}
'''
CERTS = '''Found the following certs:
  Certificate Name: example.test
    Domains: example.test www.example.test
    Expiry Date: 2027-01-10 12:00:00+00:00 (VALID: 60 days)
    Certificate Path: /etc/letsencrypt/live/example.test/fullchain.pem
    Private Key Path: /etc/letsencrypt/live/example.test/privkey.pem
'''

class WebTests(unittest.TestCase):
    setUp=fixtures.AuthTests.setUp
    form=fixtures.AuthTests.form
    setup_account=fixtures.AuthTests.setup_account
    payload=fixtures.AuthTests.payload

    def prepare(self):
        self.monitor=UbuntuMonitor(self.app)
        self.web=self.monitor.web
        self.monitor.linux=True
        self.setup_account()
        self.site=parse_sites(CONFIG)[0]
        self.site.update(service='example.service',state='active',certificate=parse_certificates(CERTS)[0])
        self.inventory={'sites':[self.site], 'services':['example.service','second.service','nginx.service'],'errors':[]}
        self.stub=patch.object(self.web,'inventory',return_value=self.inventory)
        self.stub.start();self.addCleanup(self.stub.stop)
        return '/api/monitor/websites/'+self.site['id']

    def post(self,url,data,csrf=True):
        return self.client.post(url,json=data,headers={'X-CSRF-Token':self.payload()['csrf']} if csrf else {})

    def test_nginx_sites_group_http_https_without_leaking_config(self):
        sites=parse_sites(CONFIG)
        self.assertEqual(len(sites),2)
        site=sites[0]
        self.assertEqual(site['domains'],['example.test','www.example.test'])
        self.assertEqual(site['listen'],['443 ssl','80'])
        self.assertEqual(site['config'],'/etc/nginx/sites-enabled/example')
        self.assertEqual(site['targets'],['proxy_pass http://127.0.0.1:8000'])
        self.assertNotIn('secret',str(sites))
        self.assertNotIn('privkey',str(sites))
        self.assertEqual(sites[1]['targets'],['root /var/www/with space'])
        cert=parse_certificates(CERTS)[0]
        self.assertEqual(cert['name'],'example.test')
        self.assertTrue(cert['managed'])
        self.assertTrue(cert['expires'].startswith('2027-01-10'))

    def test_controls_require_auth_csrf_known_site_and_installed_binding(self):
        base=self.prepare()
        self.assertEqual(self.app.test_client().post(base+'/action',json={}).status_code,401)
        self.assertEqual(self.post(base+'/action',{'action':'stop'},csrf=False).status_code,403)
        self.assertEqual(self.post(base+'/service',{'service':'nginx.service'}).status_code,400)
        self.assertEqual(self.post(base+'/service',{'service':'bad; touch /tmp/x.service'}).status_code,400)
        self.assertEqual(self.post(base+'/service',{'service':'not-installed.service'}).status_code,400)
        self.assertEqual(self.post(base+'/service',{'service':'second.service'}).status_code,200)
        import sqlite3
        with sqlite3.connect(self.web.database) as conn:
            self.assertEqual(conn.execute('SELECT service FROM web_services').fetchone()[0],'second.service')
        self.assertEqual(self.post(base+'/action',{'action':'restart','confirm':'wrong-domain'}).status_code,400)
        self.assertEqual(self.post(base+'/action',{'action':'shell','confirm':'example.test'}).status_code,400)
        self.assertEqual(self.post(base+'/action',{'action':'restart','confirm':'example.test','target':'second.service'}).status_code,409)

    def test_inventory_reads_bound_service_and_matching_certbot_certificate(self):
        self.prepare()
        self.stub.stop()
        import sqlite3
        with sqlite3.connect(self.web.database) as conn:
            conn.execute('INSERT INTO web_services VALUES(?,?)',(self.site['id'],'example.service'))
        def run(args,**kwargs):
            if args==['nginx','-T']: output=CONFIG
            elif args[0]=='certbot': output=CERTS
            elif args[1]=='list-unit-files': output='example.service enabled\nsecond.service disabled\nnginx.service enabled'
            else: output='Id=example.service\nActiveState=active\nSubState=running\nMainPID=123'
            return {'ok':True,'output':output}
        with patch.object(self.web,'run',side_effect=run):
            result=self.web.inventory()
        self.assertEqual(result['sites'][0]['service'],'example.service')
        self.assertEqual(result['sites'][0]['state'],'active')
        self.assertEqual(result['sites'][0]['certificate']['name'],'example.test')
        self.assertNotIn('secret',str(result))
        self.assertNotIn('privkey',str(result))

    def test_renew_checks_config_and_targets_one_certificate(self):
        self.prepare()
        calls=[]
        def run(args,**kwargs):calls.append(args);return {'ok':True,'output':'ok'}
        self.web.jobs['test']={'owner':'1','created':0}
        self.web.operation_lock.acquire()
        with patch.object(self.web,'run',side_effect=run):self.web.perform('test',self.site,'renew')
        self.assertEqual(calls,[['nginx','-t'],['certbot','renew','--cert-name=example.test','--non-interactive','--no-random-sleep-on-renew'],['nginx','-t'],['systemctl','reload','nginx']])
        self.assertEqual(self.web.jobs['test']['status'],'done')
        self.assertFalse(self.web.operation_lock.locked())

    def test_bad_config_blocks_restart_and_failed_renew_does_not_reload(self):
        self.prepare()
        self.web.jobs['test']={}
        self.web.operation_lock.acquire()
        with patch.object(self.web,'run',return_value={'ok':False,'output':'bad config'}) as run:
            self.web.perform('test',self.site,'restart')
        self.assertEqual(run.call_count,1)
        self.assertEqual(self.web.jobs['test']['status'],'failed')
        self.web.operation_lock.acquire()
        with patch.object(self.web,'run',side_effect=[{'ok':True,'output':'ok'},{'ok':False,'output':'renewal failed'}]) as run:
            self.web.perform('test',self.site,'renew')
        self.assertEqual(run.call_count,2)
        self.assertEqual(self.web.jobs['test']['status'],'failed')

    def test_async_service_action_never_controls_other_services(self):
        base=self.prepare()
        completed=threading.Event()
        calls=[]
        def run(args,**kwargs):
            calls.append(args)
            if args[:2]==['systemctl','show']:return {'ok':True,'output':'ActiveState=active\nMainPID=123'}
            return {'ok':True,'output':'ok'}
        original=self.web.perform
        def perform(*args):
            try:original(*args)
            finally:completed.set()
        with patch.object(self.web,'run',side_effect=run),patch.object(self.web,'perform',side_effect=perform):
            response=self.post(base+'/action',{'action':'restart','confirm':'example.test','target':'example.service'})
            self.assertEqual(response.status_code,202)
            self.assertTrue(completed.wait(3))
            job=self.client.get('/api/monitor/web-jobs/'+response.json['job'])
            self.assertEqual(job.json['status'],'done')
        self.assertIn(['systemctl','restart','example.service'],calls)
        self.assertFalse(any('second.service' in args or 'nginx' in args and 'restart' in args for args in calls))
        self.assertEqual(self.client.get('/api/monitor/web-jobs/unknown').status_code,404)

    def test_runner_uses_noninteractive_argv_and_kills_timed_out_process_group(self):
        self.prepare()
        from unittest.mock import Mock
        process=Mock(pid=12345)
        process.wait.side_effect=[subprocess.TimeoutExpired('certbot',180),0]
        with patch('web_monitor.shutil.which',side_effect=lambda name:'/usr/bin/'+name),patch('web_monitor.os.geteuid',return_value=1000,create=True),patch('web_monitor.subprocess.Popen',return_value=process) as popen,patch('web_monitor.os.killpg',create=True) as kill,patch('web_monitor.signal.SIGKILL',9,create=True):
            result=self.web.run(['certbot','renew','--cert-name=example.test','--non-interactive'],timeout=180)
        self.assertFalse(result['ok'])
        self.assertIn('timed out',result['output'])
        self.assertEqual(popen.call_args[0][0][:3],['/usr/bin/sudo','-n','--'])
        self.assertTrue(popen.call_args[1]['start_new_session'])
        self.assertNotIn('shell',popen.call_args[1])
        kill.assert_called_once()

if __name__=='__main__':unittest.main()
