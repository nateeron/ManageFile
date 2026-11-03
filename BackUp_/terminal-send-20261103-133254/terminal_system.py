"""Authenticated, bounded, non-interactive PowerShell/Bash command execution."""
import base64
import ctypes
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
import time

from flask import g, jsonify, request, render_template


def is_windows_admin():
    return os.name == 'nt' and bool(ctypes.windll.shell32.IsUserAnAdmin())


class WindowsProcessGroup:
    """Keep all command children inside a kill-on-close Windows Job Object."""
    def __init__(self, process):
        from ctypes import wintypes
        class BasicLimits(ctypes.Structure):
            _fields_ = [('ProcessTime', ctypes.c_int64), ('JobTime', ctypes.c_int64),
                        ('Flags', wintypes.DWORD), ('MinWorkingSet', ctypes.c_size_t),
                        ('MaxWorkingSet', ctypes.c_size_t), ('ActiveProcesses', wintypes.DWORD),
                        ('Affinity', ctypes.c_size_t), ('Priority', wintypes.DWORD), ('Scheduling', wintypes.DWORD)]
        class IOCounters(ctypes.Structure):
            _fields_ = [(name, ctypes.c_uint64) for name in ('ReadOps', 'WriteOps', 'OtherOps', 'ReadBytes', 'WriteBytes', 'OtherBytes')]
        class ExtendedLimits(ctypes.Structure):
            _fields_ = [('Basic', BasicLimits), ('IO', IOCounters), ('ProcessMemory', ctypes.c_size_t),
                        ('JobMemory', ctypes.c_size_t), ('PeakProcessMemory', ctypes.c_size_t), ('PeakJobMemory', ctypes.c_size_t)]
        self.kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        self.kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
        self.kernel.CreateJobObjectW.restype = wintypes.HANDLE
        self.kernel.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
        self.kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
        self.kernel.TerminateJobObject.argtypes = [wintypes.HANDLE, wintypes.UINT]
        self.kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        self.kernel.OpenProcess.restype = wintypes.HANDLE
        self.kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        self.handle = self.kernel.CreateJobObjectW(None, None)
        process_handle = None
        try:
            if not self.handle:
                raise ctypes.WinError(ctypes.get_last_error())
            limits = ExtendedLimits()
            limits.Basic.Flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            if not self.kernel.SetInformationJobObject(self.handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
                raise ctypes.WinError(ctypes.get_last_error())
            process_handle = self.kernel.OpenProcess(0x0101, False, process.pid)
            if not process_handle or not self.kernel.AssignProcessToJobObject(self.handle, process_handle):
                raise ctypes.WinError(ctypes.get_last_error())
        except OSError:
            self.close()
            raise
        finally:
            if process_handle:
                self.kernel.CloseHandle(process_handle)

    def terminate(self):
        if self.handle:
            self.kernel.TerminateJobObject(self.handle, 1)

    def close(self):
        if self.handle:
            self.kernel.CloseHandle(self.handle)
            self.handle = None


class TerminalError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


class TerminalManager:
    OUTPUT_LIMIT = 65536
    TIMEOUT = 60

    def __init__(self, app):
        self.windows = os.name == 'nt'
        self.active = {}
        self.lock = threading.Lock()
        app.extensions['terminal_manager'] = self
        app.add_url_rule('/terminal', 'terminal_page', self.page)
        app.add_url_rule('/api/terminal/status', 'terminal_status', self.status)
        app.add_url_rule('/api/terminal/run', 'terminal_run', self.run_request, methods=['POST'])
        app.add_url_rule('/api/terminal/stop', 'terminal_stop', self.stop_request, methods=['POST'])

    def page(self):
        return render_template('terminal.html', terminal_path=request.args.get('path') or os.path.expanduser('~'))

    def shell_path(self):
        if self.windows:
            shell = Path(os.environ.get('SystemRoot', 'C:/Windows')) / 'System32/WindowsPowerShell/v1.0/powershell.exe'
            return str(shell) if shell.is_file() else shutil.which('powershell.exe')
        return shutil.which('bash')

    def status(self):
        available = bool(self.shell_path())
        elevated = is_windows_admin() if self.windows else False
        with self.lock:
            running = g.auth['jti'] in self.active
        return jsonify(platform='windows' if self.windows else 'unix',
                       shell='PowerShell (Administrator)' if self.windows else 'Bash',
                       ready=available and (elevated or not self.windows),
                       elevated=elevated, running=running, timeout=self.TIMEOUT,
                       message=('Run start-admin.ps1 on the server and approve Windows UAC before using this terminal.'
                                if self.windows and not elevated else 'Shell executable not found.' if not available else 'Ready'))

    @staticmethod
    def ps_quote(value):
        return "'" + str(value).replace("'", "''") + "'"

    def build_command(self, command, cwd_file):
        if not self.windows:
            script = 'trap \'status=$?; pwd -P > "$MANAGEFILE_TERMINAL_CWD"; exit "$status"\' EXIT\n' + command
            return [self.shell_path(), '--noprofile', '--norc', '-c', script]
        script = '''[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
$ErrorActionPreference = 'Continue'
$global:LASTEXITCODE = 0
$code = 0
try {
    & {
''' + command + '''
    } *>&1 | Out-Default
    if (-not $?) { $code = 1 }
    if ($LASTEXITCODE -ne 0) { $code = $LASTEXITCODE }
} catch {
    $_ | Out-String | Write-Output
    $code = 1
} finally {
    (Get-Location).Path | Set-Content -LiteralPath ''' + self.ps_quote(cwd_file) + ''' -Encoding UTF8
}
exit $code
'''
        encoded = base64.b64encode(script.encode('utf-16-le')).decode('ascii')
        return [self.shell_path(), '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded]

    def kill(self, job):
        job['stopped'].set()
        process = job.get('process')
        if process is None:
            return
        if self.windows:
            if job.get('group'):
                job['group'].terminate()
            elif process.poll() is None:
                subprocess.run(['taskkill.exe', '/PID', str(process.pid), '/T', '/F'],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                               creationflags=subprocess.CREATE_NO_WINDOW, timeout=5, check=False)
        else:
            import signal
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass

    def cancel_sessions(self, jtis):
        with self.lock:
            jobs = [job for jti, job in self.active.items() if jti in jtis]
        for job in jobs:
            try:
                self.kill(job)
            except (OSError, subprocess.TimeoutExpired):
                pass

    def stop_request(self):
        self.cancel_sessions({g.auth['jti']})
        return jsonify(ok=True)

    def run_request(self):
        if (request.content_length or 0) > 32768:
            return jsonify(error='Command request is too large.'), 413
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            return jsonify(error='A JSON command is required.'), 400
        try:
            result = self.run(g.auth['jti'], data.get('command'), data.get('cwd'), g.auth['exp'])
            return jsonify(result)
        except TerminalError as error:
            return jsonify(error=str(error)), error.status

    def run(self, session_id, command, cwd, expires):
        if not isinstance(command, str) or not command.strip() or len(command) > 16000 or '\0' in command:
            raise TerminalError('Enter a command of up to 16,000 characters.')
        if self.windows and not is_windows_admin():
            raise TerminalError('Administrator mode is required. Start ManageFile using start-admin.ps1 and approve UAC on the server.', 403)
        if not self.shell_path():
            raise TerminalError('The required shell executable was not found.', 503)
        if not isinstance(cwd, str) or '\0' in cwd or not os.path.isabs(cwd) or not os.path.isdir(cwd):
            raise TerminalError('Working directory must be an existing absolute folder path.')
        remaining = expires - time.time()
        if remaining <= 0:
            raise TerminalError('Your login session has expired.', 401)
        job = {'process': None, 'group': None, 'stopped': threading.Event(), 'output': bytearray(),
               'output_lock': threading.Lock(), 'truncated': False}
        with self.lock:
            if session_id in self.active:
                raise TerminalError('A command is already running in this login session.', 409)
            self.active[session_id] = job
        process = None
        timed_out = False
        started = time.monotonic()
        try:
            with tempfile.TemporaryDirectory(prefix='managefile-terminal-') as temporary:
                cwd_file = Path(temporary) / 'cwd.txt'
                environment = os.environ.copy()
                environment['MANAGEFILE_TERMINAL_CWD'] = str(cwd_file)
                options = {'creationflags': subprocess.CREATE_NO_WINDOW} if self.windows else {'start_new_session': True}
                process = subprocess.Popen(self.build_command(command, cwd_file), cwd=cwd,
                    env=environment, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT, **options)
                with self.lock:
                    job['process'] = process
                    if self.windows:
                        job['group'] = WindowsProcessGroup(process)
                if job['stopped'].is_set():
                    self.kill(job)

                def read_output():
                    try:
                        while True:
                            block = process.stdout.read1(8192)
                            if not block:
                                break
                            with job['output_lock']:
                                job['output'].extend(block)
                                if len(job['output']) > self.OUTPUT_LIMIT:
                                    del job['output'][:-self.OUTPUT_LIMIT]
                                    job['truncated'] = True
                    except (OSError, ValueError):
                        pass
                reader = threading.Thread(target=read_output, daemon=True)
                reader.start()
                try:
                    process.wait(timeout=max(0, min(self.TIMEOUT - (time.monotonic() - started), expires - time.time())))
                except subprocess.TimeoutExpired:
                    timed_out = True
                    self.kill(job)
                    process.wait(timeout=5)
                # Each command is isolated: close background descendants as well.
                if self.windows:
                    job['group'].close()
                else:
                    import signal
                    try:
                        os.killpg(process.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                reader.join(timeout=2)
                if not reader.is_alive():
                    process.stdout.close()
                with job['output_lock']:
                    output = bytes(job['output']).decode('utf-8-sig', errors='replace')
                next_cwd = cwd
                if cwd_file.is_file():
                    candidate = cwd_file.read_text(encoding='utf-8-sig', errors='replace').strip()
                    if os.path.isabs(candidate) and os.path.isdir(candidate):
                        next_cwd = candidate
                return {'output': output, 'cwd': next_cwd, 'exit_code': process.returncode,
                        'timed_out': timed_out, 'stopped': job['stopped'].is_set() and not timed_out,
                        'truncated': job['truncated'], 'duration': round(time.monotonic() - started, 2)}
        except (OSError, subprocess.SubprocessError) as error:
            if process is not None and process.poll() is None:
                self.kill(job)
            raise TerminalError('Unable to run command: ' + str(error), 500) from error
        finally:
            if job.get('group'):
                job['group'].close()
            with self.lock:
                if self.active.get(session_id) is job:
                    self.active.pop(session_id)
