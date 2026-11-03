"""Nginx website inventory, explicit systemd bindings and bounded async controls."""
import fnmatch
import hashlib
import math
import os
from pathlib import Path
import re
import secrets
import signal
import shlex
import shutil
import sqlite3
import subprocess
import tempfile
import threading
import time
from datetime import datetime, timezone
from flask import g, jsonify, request


def nginx_nodes(text):
    lexer = shlex.shlex(text, posix=True, punctuation_chars='{};')
    lexer.whitespace_split = True
    tokens = []
    for token in lexer:
        tokens.extend(list(token) if token and all(c in '{};' for c in token) else [token])
    position = 0
    def parse(depth=0):
        nonlocal position
        if depth > 80:
            raise ValueError('Nginx config nesting is too deep')
        nodes, words = [], []
        while position < len(tokens):
            token = tokens[position]; position += 1
            if token == '}':
                return nodes
            if token == ';':
                if words: nodes.append((words[0], words[1:], []))
                words = []
            elif token == '{':
                children = parse(depth+1)
                if words: nodes.append((words[0], words[1:], children))
                words = []
            else:
                words.append(token)
        return nodes
    return parse()


def parse_sites(dump):
    sections = re.split(r'^# configuration file (.+):\s*$', dump, flags=re.M)
    files = {sections[i]:nginx_nodes(sections[i+1]) for i in range(1, len(sections)-1, 2)}
    def expanded(nodes, visited=()):
        result = []
        for name, args, children in nodes:
            if name == 'include' and args:
                pattern = args[0] if args[0].startswith('/') else '/etc/nginx/' + args[0]
                for filename, included in files.items():
                    if fnmatch.fnmatchcase(filename, pattern) and filename not in visited:
                        result.extend(expanded(included, visited+(filename,)))
            else:
                result.append((name,args,children))
        return result
    sites = {}
    def visit(nodes, filename, inherited_cert=None):
        nodes = expanded(nodes, (filename,))
        defaults = next((args[0] for name,args,_ in nodes if name == 'ssl_certificate' and args), inherited_cert)
        for name, args, children in nodes:
            if name == 'server' and children:
                directives = expanded(children, (filename,))
                names = [value for key,values,_ in directives if key=='server_name' for value in values] or ['(default)']
                listens = [' '.join(values) for key,values,_ in directives if key=='listen'] or ['80']
                key = hashlib.sha256((filename+'\n'+' '.join(names)).encode()).hexdigest()[:24]
                site = sites.setdefault(key, {'id':key,'domains':names,'config':filename,'listen':[], 'targets':[], 'certificate_path':None})
                site['listen'] = sorted(set(site['listen'] + listens))
                def collect(entries):
                    for directive, values, nested in expanded(entries, (filename,)):
                        if directive in {'proxy_pass','fastcgi_pass','root','alias'} and values:
                            target = directive + ' ' + ' '.join(values)
                            if target not in site['targets']: site['targets'].append(target)
                        if directive == 'ssl_certificate' and values:
                            site['certificate_path'] = values[0]
                        if nested: collect(nested)
                collect(directives)
                if not site['certificate_path'] and any('ssl' in value or ':443' in value or value.startswith('443') for value in listens):
                    site['certificate_path'] = defaults
            elif children:
                visit(children, filename, defaults)
    # Parse each source independently, so includes aren't counted as duplicate sites.
    for filename, nodes in files.items():
        visit(nodes, filename)
    # Included server blocks can appear through nginx.conf too. Prefer their real source.
    concrete = {(tuple(s['domains']),tuple(s['listen'])) for s in sites.values() if s['config'] != '/etc/nginx/nginx.conf'}
    return sorted([s for s in sites.values() if s['config'] != '/etc/nginx/nginx.conf' or (tuple(s['domains']),tuple(s['listen'])) not in concrete], key=lambda site:site['domains'][0])


def parse_certificates(text):
    certificates = []
    for block in re.split(r'(?m)^\s*Certificate Name:\s*',text)[1:]:
        name = block.splitlines()[0].strip()
        path = re.search(r'(?m)^\s*Certificate Path:\s*(.+)',block)
        expiry = re.search(r'(?m)^\s*Expiry Date:\s*(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:[+-]\d{2}:?\d{2})?)',block)
        domains = re.search(r'(?m)^\s*Domains:\s*(.+)',block)
        item = {'name':name,'managed':True,'path':path[1].strip() if path else None,'domains':domains[1].split() if domains else [],'expires':None,'days':None}
        if expiry:
            try:
                date = datetime.fromisoformat(expiry[1])
                if date.tzinfo is None: date = date.replace(tzinfo=timezone.utc)
                item['expires'] = date.isoformat()
                item['days'] = math.floor((date-datetime.now(timezone.utc)).total_seconds()/86400)
            except ValueError: pass
        certificates.append(item)
    return certificates


class WebMonitor:
    def __init__(self, app, monitor):
        self.monitor = monitor
        folder = Path(app.config.get('AUTH_DATA_DIR', Path(app.instance_path)/'auth'))
        folder.mkdir(parents=True,exist_ok=True)
        self.database = folder/'web-monitor.sqlite3'
        with sqlite3.connect(self.database) as conn:
            conn.execute('CREATE TABLE IF NOT EXISTS web_services (site_id TEXT PRIMARY KEY, service TEXT NOT NULL)')
        self.lock = threading.Lock()
        self.operation_lock = threading.Lock()
        self.inventory_cache = None
        self.jobs = {}
        app.add_url_rule('/api/monitor/websites','monitor_websites',self.list_sites)
        app.add_url_rule('/api/monitor/websites/<site_id>/service','monitor_web_bind',self.bind,methods=['POST'])
        app.add_url_rule('/api/monitor/websites/<site_id>/action','monitor_web_action',self.action,methods=['POST'])
        app.add_url_rule('/api/monitor/web-jobs/<job_id>','monitor_web_job',self.job)

    def run(self, args, timeout=8, limit=64000, privileged=True):
        executable = shutil.which(args[0])
        if not executable and args[0]=='nginx' and Path('/usr/sbin/nginx').is_file(): executable='/usr/sbin/nginx'
        if not executable: return {'ok':False,'output':'Command is not installed: '+args[0]}
        command = [executable]+args[1:]
        if privileged and os.geteuid()!=0:
            sudo=shutil.which('sudo')
            if sudo: command=[sudo,'-n','--']+command
        try:
            with tempfile.TemporaryFile() as output:
                process=subprocess.Popen(command,stdin=subprocess.DEVNULL,stdout=output,stderr=subprocess.STDOUT,start_new_session=True,
                    env={**os.environ,'LC_ALL':'C','SYSTEMD_COLORS':'0','SYSTEMD_PAGER':''})
                try:
                    exit_code=process.wait(timeout=timeout)
                except subprocess.TimeoutExpired:
                    try: os.killpg(process.pid,signal.SIGKILL)
                    except ProcessLookupError: pass
                    process.wait()
                    raise
                output.seek(0); raw=output.read(limit+1)
                if len(raw)>limit:
                    return {'ok':False,'output':'Output is too large; narrow the server configuration.'}
                return {'ok':exit_code==0,'output':raw.decode('utf-8',errors='replace').strip(),'exit_code':exit_code}
        except subprocess.TimeoutExpired:
            return {'ok':False,'output':'Operation timed out. Check the current service/certificate state before retrying.'}
        except OSError as error:
            return {'ok':False,'output':str(error)}

    @staticmethod
    def valid_service(value):
        return isinstance(value,str) and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.@:-]{0,180}\.service',value) is not None

    def inventory(self, force=False):
        with self.lock:
            if not force and self.inventory_cache and time.monotonic()-self.inventory_cache[0]<15:
                return self.inventory_cache[1]
            config=self.run(['nginx','-T'],limit=1048576)
            certs=self.run(['certbot','certificates','--non-interactive'],timeout=15)
            units=self.run(['systemctl','list-unit-files','--type=service','--no-legend','--no-pager'],privileged=False)
            services=sorted(set(line.split()[0] for line in units['output'].splitlines() if line.split() and self.valid_service(line.split()[0]))) if units['ok'] else []
            errors=[]
            if not config['ok']:
                # A failed dump may contain config contents. Never return it.
                errors.append('Cannot read Nginx configuration. Check nginx -t and the app service permissions.')
            if not certs['ok']: errors.append('Certbot: '+certs['output'][:1200])
            if not units['ok']: errors.append('systemd: '+units['output'][:1200])
            try: sites=parse_sites(config['output']) if config['ok'] else []
            except ValueError:
                sites=[]; errors.append('Cannot parse this Nginx configuration.')
            certificates=parse_certificates(certs['output']) if certs['ok'] else []
            with sqlite3.connect(self.database) as conn:
                mappings=dict(conn.execute('SELECT site_id,service FROM web_services'))
            states={}
            mapped=sorted(set(mappings.get(s['id']) for s in sites)-{None,''})
            if mapped:
                status=self.run(['systemctl','show','--no-pager','--property=Id,ActiveState,SubState,MainPID']+mapped,privileged=False)
                if status['ok']:
                    for block in status['output'].split('\n\n'):
                        fields=dict(line.split('=',1) for line in block.splitlines() if '=' in line)
                        if fields.get('Id'): states[fields['Id']]=fields
            for site in sites:
                service=mappings.get(site['id'])
                site['service']=service
                fields=states.get(service,{})
                site['state']=fields.get('ActiveState','unmapped' if not service else 'unknown')
                site['substate']=fields.get('SubState','')
                site['pid']=fields.get('MainPID','0')
                site['certificate']=next((c for c in certificates if c['path'] and c['path']==site['certificate_path']),None)
                certificate_path=site['certificate_path']
                if not site['certificate'] and certificate_path and certificate_path.startswith('/') and '$' not in certificate_path:
                    public_cert=self.run(['openssl','x509','-in',certificate_path,'-noout','-enddate'])
                    if public_cert['ok']:
                        expiry=re.search(r'(?m)^notAfter=(.+)$',public_cert['output'])
                        if expiry:
                            try:
                                date=datetime.strptime(expiry[1].strip(),'%b %d %H:%M:%S %Y %Z').replace(tzinfo=timezone.utc)
                                site['certificate']={'name':None,'managed':False,'path':certificate_path,'domains':[],
                                    'expires':date.isoformat(),'days':math.floor((date-datetime.now(timezone.utc)).total_seconds()/86400)}
                            except ValueError: pass
            value={'sites':sites[:200],'services':services,'errors':errors,'time':time.time()}
            self.inventory_cache=(time.monotonic(),value)
            return value

    def list_sites(self):
        if not self.monitor.linux: return jsonify(sites=[],services=[],errors=['Web Status requires Ubuntu/Linux.'])
        return jsonify(self.inventory())

    def site(self, site_id):
        return next((s for s in self.inventory()['sites'] if s['id']==site_id),None)

    def bind(self, site_id):
        if not self.monitor.linux: return jsonify(error='Ubuntu/Linux required'),400
        if (request.content_length or 0)>2048: return jsonify(error='Request too large'),413
        data=request.get_json(silent=True) or {}
        service=data.get('service') if isinstance(data,dict) else None
        inventory=self.inventory()
        if not any(s['id']==site_id for s in inventory['sites']): return jsonify(error='Website not found'),404
        if service == 'nginx.service': return jsonify(error='Nginx is shared by all websites. Select the website backend service.'),400
        if service and (not self.valid_service(service) or service not in inventory['services']):
            return jsonify(error='Select an installed systemd service'),400
        if not isinstance(service,str): return jsonify(error='Service name is required'),400
        with sqlite3.connect(self.database) as conn:
            conn.execute('INSERT INTO web_services VALUES(?,?) ON CONFLICT(site_id) DO UPDATE SET service=excluded.service',(site_id,service))
        with self.lock: self.inventory_cache=None
        return jsonify(ok=True)

    def action(self, site_id):
        if not self.monitor.linux: return jsonify(error='Ubuntu/Linux required'),400
        if (request.content_length or 0)>2048: return jsonify(error='Request too large'),413
        data=request.get_json(silent=True)
        if not isinstance(data,dict): return jsonify(error='Invalid action'),400
        action=data.get('action')
        if action not in {'start','stop','restart','renew'}: return jsonify(error='Unknown action'),400
        site=self.site(site_id)
        if not site: return jsonify(error='Website not found'),404
        if data.get('confirm')!=site['domains'][0]: return jsonify(error='Confirm the selected website'),400
        if action!='renew' and not self.valid_service(site['service']): return jsonify(error='Link a systemd service first'),400
        if action!='renew' and site['service']=='nginx.service': return jsonify(error='Shared Nginx cannot be controlled as a website service'),400
        cert=site.get('certificate')
        if action=='renew' and (not cert or not cert.get('managed') or not re.fullmatch(r'[A-Za-z0-9_.-]{1,200}',cert['name'])):
            return jsonify(error='No matching Certbot certificate found'),400
        expected=cert['name'] if action=='renew' else site['service']
        if data.get('target')!=expected: return jsonify(error='Website binding changed. Refresh and confirm the current target.'),409
        if not self.operation_lock.acquire(blocking=False): return jsonify(error='Another website operation is running'),409
        job_id=secrets.token_hex(16)
        with self.lock:
            self.jobs={key:value for key,value in self.jobs.items() if time.time()-value['created']<1800}
            self.jobs[job_id]={'created':time.time(),'owner':g.auth['sub'],'status':'running','output':'Operation started','action':action}
        worker=threading.Thread(target=self.perform,args=(job_id,site,action),daemon=True)
        try: worker.start()
        except Exception:
            self.operation_lock.release()
            raise
        return jsonify(job=job_id),202

    def perform(self, job_id, site, action):
        results=[]
        success=False
        try:
            if action in {'start','restart','renew'}:
                check=self.run(['nginx','-t'])
                results.append(check['output'])
                if not check['ok']: return
            if action=='renew':
                result=self.run(['certbot','renew','--cert-name='+site['certificate']['name'],'--non-interactive','--no-random-sleep-on-renew'],timeout=180)
                results.append(result['output'])
                if not result['ok']: return
                check=self.run(['nginx','-t']); results.append(check['output'])
                if not check['ok']: return
                result=self.run(['systemctl','reload','nginx'],timeout=20)
                results.append(result['output'] or 'Nginx reloaded')
            else:
                result=self.run(['systemctl',action,site['service']],timeout=30)
                results.append(result['output'] or ('systemctl '+action+' '+site['service']))
                if result['ok']:
                    state=self.run(['systemctl','show',site['service'],'--no-pager','--property=ActiveState,SubState,MainPID'],privileged=False)
                    results.append(state['output'])
                    expected='inactive' if action=='stop' else 'active'
                    if not state['ok'] or 'ActiveState='+expected not in state['output']:
                        results.append('Service did not reach the expected state. Check its journal.')
                        return
            success=result['ok']
        except Exception:
            results.append('Operation failed. Check the service journal.')
        finally:
            with self.lock:
                self.jobs[job_id].update(status='done' if success else 'failed',output='\n'.join(results)[-64000:])
                self.inventory_cache=None
            with self.monitor.lock: self.monitor.cache.clear()
            self.operation_lock.release()

    def job(self, job_id):
        with self.lock:
            job=self.jobs.get(job_id)
            if not job or job['owner']!=g.auth['sub']: return jsonify(error='Job not found'),404
            return jsonify(status=job['status'],output=job['output'],action=job['action'])
