"""Nginx website inventory, explicit systemd bindings and bounded async controls."""
import fnmatch
import hashlib
import ipaddress
import json
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
from urllib.parse import urlsplit
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
                site = sites.setdefault(key, {'id':key,'domains':names,'config':filename,'listen':[], 'targets':[],
                    'directives':{'root':[],'alias':[],'proxy_pass':[],'fastcgi_pass':[]}, 'certificate_path':None})
                site['listen'] = sorted(set(site['listen'] + listens))
                def collect(entries):
                    for directive, values, nested in expanded(entries, (filename,)):
                        if directive in {'proxy_pass','fastcgi_pass','root','alias'} and values:
                            target = directive + ' ' + ' '.join(values)
                            if target not in site['targets']: site['targets'].append(target)
                            value = ' '.join(values)
                            if value not in site['directives'][directive]: site['directives'][directive].append(value)
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


def upstream_groups(dump):
    groups={}
    def visit(nodes):
        for name,args,children in nodes:
            if name=='upstream' and args:
                members=[values[0] for key,values,_ in children if key=='server' and values]
                groups[args[0]]=sorted(set(groups.get(args[0],[])+members))
            elif children: visit(children)
    for section in re.split(r'^# configuration file .+:\s*$',dump,flags=re.M):
        visit(nginx_nodes(section))
    return groups


def backend_endpoints(site, groups, local_addresses):
    endpoints=set()
    def add(value, depth=0):
        if depth>8 or '$' in value: return
        if value.startswith('unix:'):
            endpoints.add(('unix',value[5:].split(':/',1)[0])); return
        parsed=urlsplit(value if '://' in value else '//'+value)
        try: host=parsed.hostname; port=parsed.port
        except ValueError: return
        if not host: return
        if host in groups:
            for member in groups[host]: add(member,depth+1)
            return
        if host=='unix':
            path=parsed.path.split(':/',1)[0]
            if path.startswith('/'): endpoints.add(('unix',path))
            return
        port=port or (443 if parsed.scheme=='https' else 80 if parsed.scheme=='http' else None)
        if not port: return
        if host=='localhost': endpoints.add(('tcp','localhost',port)); return
        try:
            address=ipaddress.ip_address(host)
            if address.is_loopback or address.is_unspecified or str(address) in local_addresses:
                endpoints.add(('tcp',str(address),port))
        except ValueError: pass
    for target in site['targets']:
        directive,_,value=target.partition(' ')
        if directive in {'proxy_pass','fastcgi_pass'}: add(value)
    return sorted(endpoints)


def listener_pids(endpoints, tcp_output, unix_output):
    found=set()
    matched=False
    for endpoint in endpoints:
        output=unix_output if endpoint[0]=='unix' else tcp_output
        for line in output.splitlines():
            fields=line.split()
            if endpoint[0]=='unix':
                matches=endpoint[1] in fields
            else:
                matches=False
                if len(fields)>3:
                    address,_,port=fields[3].rpartition(':')
                    address=address.strip('[]')
                    matches=port==str(endpoint[2]) and (address in {'*','0.0.0.0','::',endpoint[1]} or endpoint[1]=='localhost' and address in {'127.0.0.1','::1'})
            if matches:
                matched=True
                found.update(int(pid) for pid in re.findall(r'\bpid=(\d+)',line))
    return found,matched


def configured_endpoints(fields, local_addresses):
    command=fields.get('ExecStart','')
    values=[]
    for match in re.finditer(r'(?:--(?:port|bind|listen|uds)|-b)(?:=|\s+)([^\s;]+)',command):
        value=match[1].strip('\"\'')
        if value.isdigit(): value='127.0.0.1:'+value
        if value.startswith('/'): value='unix:'+value
        values.append('proxy_pass '+value)
    for port in re.findall(r'(?:^|[\s\"\'])(?:PORT|MANAGEFILE_PORT|UVICORN_PORT)=(\d+)\b',fields.get('Environment','')):
        values.append('proxy_pass 127.0.0.1:'+port)
    return backend_endpoints({'targets':values},{},local_addresses)


class WebMonitor:
    def __init__(self, app, monitor):
        self.monitor = monitor
        folder = Path(app.config.get('AUTH_DATA_DIR', Path(app.instance_path)/'auth'))
        folder.mkdir(parents=True,exist_ok=True)
        self.database = folder/'web-monitor.sqlite3'
        with sqlite3.connect(self.database) as conn:
            conn.execute('CREATE TABLE IF NOT EXISTS web_services (site_id TEXT PRIMARY KEY, service TEXT NOT NULL)')
            conn.execute('CREATE TABLE IF NOT EXISTS auto_web_services (site_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, service TEXT NOT NULL)')
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

    @classmethod
    def site_service(cls, value):
        return cls.valid_service(value) and value not in {'nginx.service','docker.service','containerd.service','podman.service'} and not value.startswith(('user@','systemd-'))

    def unit_for_pid(self, pid):
        try:
            text=Path('/proc/{}/cgroup'.format(int(pid))).read_text()
        except OSError: return None
        # A worker inherits the same service cgroup as its parent/main process.
        for line in text.splitlines():
            if '/system.slice/' not in line: continue
            units=re.findall(r'(?:^|/)([^/]+\.service)(?=/|$)',line)
            if units and self.site_service(units[-1]): return units[-1]
        return None

    def service_states(self, services):
        services={service for service in services if not service.endswith('@.service')}
        if not services: return {}
        result=self.run(['systemctl','show','--no-pager','--property=Id,ActiveState,SubState,MainPID,ExecStart,Environment']+sorted(services),limit=2097152,privileged=False)
        states={}
        for block in result['output'].split('\n\n'):
            fields=dict(line.split('=',1) for line in block.splitlines() if '=' in line)
            if self.valid_service(fields.get('Id')) and fields.get('ActiveState'): states[fields['Id']]=fields
        return states

    def discover_services(self, sites, dump, services, states):
        if not any(any(t.startswith(('proxy_pass ','fastcgi_pass ')) for t in site['targets']) for site in sites):
            for site in sites: site.update(service=None,service_source='static',service_note='Static website served directly by Nginx; no separate backend service.')
            return states
        addresses={'127.0.0.1','::1'}
        network=self.run(['ip','-j','address','show'],privileged=False)
        if network['ok']:
            try:
                for interface in json.loads(network['output']):
                    addresses.update(item['local'] for item in interface.get('addr_info',[]) if 'local' in item)
            except (ValueError,TypeError,KeyError): pass
        tcp=self.run(['ss','-H','-ltnp'])
        unix=self.run(['ss','-H','-lxnp'])
        groups=upstream_groups(dump)
        with sqlite3.connect(self.database) as conn:
            remembered={row[0]:(row[1],row[2]) for row in conn.execute('SELECT site_id,fingerprint,service FROM auto_web_services')}
        pid_units={}
        detected=set()
        for site in sites:
            endpoints=backend_endpoints(site,groups,addresses)
            fingerprint=hashlib.sha256(json.dumps(endpoints,sort_keys=True).encode()).hexdigest()
            site.update(service=None,service_source='unresolved',service_note='No local systemd service could be identified.')
            if not endpoints:
                site['service_note']='Static website served by Nginx.' if not any(t.startswith(('proxy_pass ','fastcgi_pass ')) for t in site['targets']) else 'Remote or dynamic upstream; no local service to control.'
                continue
            pids,has_listener=listener_pids(endpoints,tcp['output'] if tcp['ok'] else '',unix['output'] if unix['ok'] else '')
            for pid in pids:
                if pid not in pid_units: pid_units[pid]=self.unit_for_pid(pid)
            owners={pid_units[pid] for pid in pids if pid_units[pid]}
            unresolved=any(not pid_units[pid] for pid in pids)
            fully_matched=all(bool(listener_pids([endpoint],tcp['output'] if tcp['ok'] else '',unix['output'] if unix['ok'] else '')[0]) for endpoint in endpoints)
            if len(owners)==1 and not unresolved and fully_matched:
                service=next(iter(owners))
                site.update(service=service,service_source='auto-live',service_note='Auto: upstream port/socket → process → systemd service.')
                detected.add(service)
                if remembered.get(site['id'])!=(fingerprint,service):
                    with sqlite3.connect(self.database) as conn:
                        conn.execute('INSERT INTO auto_web_services VALUES(?,?,?) ON CONFLICT(site_id) DO UPDATE SET fingerprint=excluded.fingerprint,service=excluded.service',(site['id'],fingerprint,service))
                continue
            if has_listener or owners:
                site['service_note']='Multiple services or an unidentified process share the upstream. Controls are unavailable.'
                continue
            # Only reuse a verified binding for an inactive service. This keeps
            # Start available after Stop without guessing a different live owner.
            saved=remembered.get(site['id'])
            if saved and saved[0]==fingerprint and self.site_service(saved[1]) and states.get(saved[1],{}).get('ActiveState') in {'inactive','failed'}:
                site.update(service=saved[1],service_source='auto-saved',service_note='Auto: previously verified upstream; service is currently stopped.')
                continue
            candidates=set()
            for service,fields in states.items():
                if not self.site_service(service): continue
                configured=configured_endpoints(fields,addresses)
                def matches(a,b):
                    if a[0]!=b[0]: return False
                    if a[0]=='unix': return a[1]==b[1]
                    return a[2]==b[2] and (a[1]==b[1] or b[1] in {'0.0.0.0','::'} or a[1]=='localhost' and b[1] in {'127.0.0.1','::1'})
                if configured and all(any(matches(a,b) for b in configured) for a in endpoints): candidates.add(service)
            if len(candidates)==1:
                site.update(service=next(iter(candidates)),service_source='auto-config',service_note='Auto: unique upstream port/socket in systemd ExecStart or port environment setting.')
            elif len(candidates)>1:
                site['service_note']='More than one service is configured for this upstream. Controls are unavailable.'
        extra=detected-set(states)
        if extra: states.update(self.service_states(extra))
        return states

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
                remembered_services={row[0] for row in conn.execute('SELECT service FROM auto_web_services') if self.site_service(row[0])}
            states=self.service_states(set(services)|remembered_services)
            if config['ok']: states=self.discover_services(sites,config['output'],services,states)
            for site in sites:
                service=site.get('service')
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

    def site(self, site_id, force=False):
        return next((s for s in self.inventory(force=force)['sites'] if s['id']==site_id),None)

    def bind(self, site_id):
        return jsonify(error='Services are detected automatically. Refresh the Monitor page.'),410

    def action(self, site_id):
        if not self.monitor.linux: return jsonify(error='Ubuntu/Linux required'),400
        if (request.content_length or 0)>2048: return jsonify(error='Request too large'),413
        data=request.get_json(silent=True)
        if not isinstance(data,dict): return jsonify(error='Invalid action'),400
        action=data.get('action')
        if action not in {'start','stop','restart','renew'}: return jsonify(error='Unknown action'),400
        site=self.site(site_id,force=True)
        if not site: return jsonify(error='Website not found'),404
        if data.get('confirm')!=site['domains'][0]: return jsonify(error='Confirm the selected website'),400
        if action!='renew' and not self.site_service(site['service']): return jsonify(error='No unambiguous local website service detected'),400
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
