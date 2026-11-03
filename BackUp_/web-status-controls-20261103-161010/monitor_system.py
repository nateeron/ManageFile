"""Authenticated read-only Ubuntu diagnostics. Never accepts shell commands."""
import os
import platform
import re
import shutil
import subprocess
import tempfile
import threading
import time
from pathlib import Path

from flask import jsonify, render_template


class UbuntuMonitor:
    LIMIT = 48000
    COMMANDS = {
        'ports': (['ss', '-tulpn'], True),
        'service': (['systemctl', 'show', 'nginx', '--no-pager', '--property=ActiveState,SubState,UnitFileState,MainPID,ActiveEnterTimestamp,FragmentPath'], False),
        'status': (['systemctl', 'status', 'nginx', '--no-pager', '-l'], False),
        'config-test': (['nginx', '-t'], True),
        'nginx-log': (['journalctl', '-u', 'nginx', '-n', '50', '--no-pager'], True),
        'access-log': (['tail', '-n', '50', '/var/log/nginx/access.log'], True),
        'error-log': (['tail', '-n', '50', '/var/log/nginx/error.log'], True),
        'config': (['nginx', '-T'], True),
        'ssl': (['certbot', 'certificates', '--non-interactive'], True),
        'disks': (['df', '-h', '-l'], False),
        'partitions': (['lsblk', '-o', 'NAME,SIZE,TYPE,FSTYPE,MOUNTPOINTS'], False),
        'var-size': (['du', '-h', '--max-depth=1', '/var'], True),
        'process-cpu': (['ps', '-eo', 'pid,user,pcpu,pmem,comm', '--sort=-pcpu'], False),
        'process-ram': (['ps', '-eo', 'pid,user,pcpu,pmem,comm', '--sort=-pmem'], False),
    }

    def __init__(self, app):
        self.linux = platform.system() == 'Linux'
        self.lock = threading.Lock()
        self.previous_cpu = None
        self.cache = {}
        app.add_url_rule('/monitor', 'monitor_page', lambda: render_template('monitor.html'))
        app.add_url_rule('/api/monitor', 'monitor_snapshot', self.snapshot)
        app.add_url_rule('/api/monitor/<section>', 'monitor_detail', self.detail)

    def command(self, section):
        args, privileged = self.COMMANDS[section]
        executable = shutil.which(args[0])
        if not executable and args[0] == 'nginx' and Path('/usr/sbin/nginx').is_file():
            executable = '/usr/sbin/nginx'
        if not executable:
            return {'ok': False, 'output': 'Command is not installed: ' + args[0]}
        args = [executable] + args[1:]
        if privileged and os.geteuid() != 0:
            sudo = shutil.which('sudo')
            if sudo:
                args = [sudo, '-n', '--'] + args
        try:
            # Disk-backed bounded reading avoids collecting a large nginx config
            # or process listing in memory. Commands have no shell or user args.
            with tempfile.TemporaryFile() as stream:
                process = subprocess.run(args, stdin=subprocess.DEVNULL, stdout=stream, stderr=subprocess.STDOUT,
                    timeout=20 if section == 'var-size' else 5,
                    env={**os.environ, 'LC_ALL':'C', 'SYSTEMD_COLORS':'0', 'SYSTEMD_PAGER':''})
                stream.seek(0)
                if section == 'config':
                    lines = []
                    for raw in stream:
                        line = raw.decode('utf-8', errors='replace').strip()
                        if re.match(r'^(# configuration file|listen\s|server_name\s|root\s|alias\s|ssl_certificate(?:_key)?\s|proxy_pass\s|fastcgi_pass\s|nginx:)', line):
                            lines.append(line[:2000])
                        if sum(map(len, lines)) >= self.LIMIT:
                            lines.append('[Output truncated]')
                            break
                    output = '\n'.join(lines)
                elif section.startswith('process-'):
                    output = ''.join(stream.readline().decode('utf-8', errors='replace') for _ in range(11))
                else:
                    raw = stream.read(self.LIMIT + 1)
                    output = raw[:self.LIMIT].decode('utf-8', errors='replace')
                    if len(raw) > self.LIMIT:
                        output += '\n[Output truncated]'
            return {'ok':process.returncode == 0, 'output':output.strip() or '(No output)', 'exit_code':process.returncode}
        except subprocess.TimeoutExpired:
            return {'ok':False, 'output':'Check timed out. Try again later.'}
        except OSError as error:
            return {'ok':False, 'output':str(error)}

    def cached(self, key, ttl):
        now = time.monotonic()
        saved = self.cache.get(key)
        if saved and now - saved[0] < ttl:
            return saved[1]
        value = self.command(key)
        self.cache[key] = (time.monotonic(), value)
        return value

    def metrics(self):
        fields = Path('/proc/stat').read_text().splitlines()[0].split()[1:9]
        values = list(map(int, fields))
        total, idle = sum(values), values[3] + values[4]
        cpu = None
        if self.previous_cpu:
            old_total, old_idle = self.previous_cpu
            if total > old_total:
                cpu = round(max(0, min(100, 100 * (1 - (idle-old_idle)/(total-old_total)))), 1)
        self.previous_cpu = (total, idle)
        memory = {}
        for line in Path('/proc/meminfo').read_text().splitlines():
            key, value = line.split(':', 1)
            memory[key] = int(value.split()[0]) * 1024
        total_ram = memory['MemTotal']
        available = memory.get('MemAvailable', memory.get('MemFree', 0))
        disk = shutil.disk_usage('/')
        return {'cpu':cpu, 'cores':os.cpu_count(), 'load':list(os.getloadavg()),
            'uptime':float(Path('/proc/uptime').read_text().split()[0]),
            'ram_total':total_ram, 'ram_available':available,
            'ram_percent':round((total_ram-available)/total_ram*100, 1),
            'swap_total':memory.get('SwapTotal', 0), 'swap_free':memory.get('SwapFree', 0),
            'disk_total':disk.total, 'disk_free':disk.free, 'disk_percent':round(disk.used/disk.total*100, 1)}

    def snapshot(self):
        if not self.linux:
            return jsonify(supported=False, message='Ubuntu Monitor requires the app to run on Ubuntu/Linux.', host=platform.node())
        with self.lock:
            saved = self.cache.get('snapshot')
            if saved and time.monotonic() - saved[0] < 2:
                return jsonify(saved[1])
            try:
                metrics = self.metrics()
            except (OSError, ValueError, KeyError) as error:
                return jsonify(error='Cannot read system metrics: ' + str(error)), 503
            value = {'supported':True, 'host':platform.node(), 'time':time.time(), 'metrics':metrics,
                'service':self.cached('service', 15), 'ports':self.cached('ports', 15)}
            self.cache['snapshot'] = (time.monotonic(), value)
            return jsonify(value)

    def detail(self, section):
        if section not in self.COMMANDS:
            return jsonify(error='Unknown monitor section'), 404
        if not self.linux:
            return jsonify(error='This check requires Ubuntu/Linux.'), 400
        with self.lock:
            return jsonify(self.cached(section, 5))
