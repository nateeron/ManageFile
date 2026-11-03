document.addEventListener('DOMContentLoaded', () => {
  const panel = document.getElementById('terminalPanel');
  const launcher = document.getElementById('openTerminal');
  const command = document.getElementById('terminalCommand');
  const cwd = document.getElementById('terminalCwd');
  const output = document.getElementById('terminalOutput');
  const run = document.getElementById('terminalRun');
  const stop = document.getElementById('terminalStop');
  const hint = document.getElementById('terminalHint');
  const form = document.getElementById('terminalForm');
  const menu = document.getElementById('terminalContextMenu');
  const currentPath = () => document.getElementById('system_path').value;
  const history = [];
  let historyIndex = 0, busy = false, ready = false, menuPath = '';
  const print = text => {
    output.textContent = (output.textContent + text).slice(-120000);
    output.scrollTop = output.scrollHeight;
  };
  const syncControls = () => {
    run.disabled = busy || !ready;
    stop.disabled = !busy;
    cwd.disabled = busy;
    document.getElementById('terminalUseCurrent').disabled = busy;
    run.textContent = busy ? 'Running…' : 'Run';
  };
  const status = async () => {
    try {
      const response = await fetch('/api/terminal/status');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to connect to terminal.');
      ready = data.ready;
      document.getElementById('terminalShell').textContent = data.shell;
      command.placeholder = data.platform === 'windows' ? 'Get-ChildItem' : 'ls -la';
      hint.textContent = data.ready ? `Ready · Commands stop after ${data.timeout} seconds. Working folder is preserved; shell variables reset for each command.` : data.message;
      if (data.running && !busy) hint.textContent = 'A command is running in another panel of this login session. Wait for it to finish before running another.';
      syncControls();
    } catch (error) {
      ready = false;
      hint.textContent = error.message;
      syncControls();
    }
  };
  const open = folder => {
    panel.hidden = false;
    launcher.setAttribute('aria-expanded', 'true');
    if (!busy) cwd.value = folder || cwd.value || currentPath();
    status();
    command.focus();
  };
  const close = () => { panel.hidden = true; launcher.setAttribute('aria-expanded', 'false'); launcher.focus(); };
  launcher.addEventListener('click', () => panel.hidden ? open() : close());
  document.getElementById('closeTerminal').addEventListener('click', close);
  document.getElementById('terminalUseCurrent').addEventListener('click', () => { cwd.value = currentPath(); status(); });
  document.getElementById('terminalClear').addEventListener('click', () => { output.textContent = ''; });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const text = command.value.trim();
    if (!text || busy || !ready) return;
    busy = true;
    syncControls();
    if (output.textContent === 'Run a command to see its output here.') output.textContent = '';
    print(`\n${cwd.value} > ${text}\n`);
    history.push(text);
    historyIndex = history.length;
    command.value = '';
    try {
      const response = await fetch('/api/terminal/run', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({command:text, cwd:cwd.value})});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Command failed.');
      // Render shell output as text, never as HTML.
      print((data.output || '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, ''));
      if (data.truncated) print('\n[Earlier output omitted; showing the last 64 KB.]\n');
      if (data.timed_out) print('\n[Command timed out and was stopped.]\n');
      else if (data.stopped) print('\n[Command stopped.]\n');
      print(`\n[Exit ${data.exit_code} · ${data.duration}s]\n`);
      cwd.value = data.cwd;
    } catch (error) { print(`\n[Error] ${error.message}\n`); }
    finally { busy = false; syncControls(); if (!panel.hidden) command.focus(); }
  });
  stop.addEventListener('click', async () => {
    stop.disabled = true;
    try {
      const response = await fetch('/api/terminal/stop', {method:'POST'});
      if (!response.ok) throw new Error('Unable to stop command.');
    } catch (error) { print(`\n[Error] ${error.message}\n`); if (busy) stop.disabled = false; }
  });
  command.addEventListener('keydown', event => {
    if (event.ctrlKey && event.key === 'Enter') { event.preventDefault(); form.requestSubmit(); }
    if (!command.value.includes('\n') && ['ArrowUp', 'ArrowDown'].includes(event.key) && history.length) {
      event.preventDefault();
      historyIndex = Math.max(0, Math.min(history.length, historyIndex + (event.key === 'ArrowUp' ? -1 : 1)));
      command.value = history[historyIndex] || '';
    }
  });
  panel.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
  document.getElementById('dropZone').addEventListener('contextmenu', event => {
    event.preventDefault();
    menuPath = currentPath();
    const row = event.target.closest('tr[data-item-name]');
    const link = event.target.closest('a.folder-link');
    const folder = row?.dataset.isFolder === 'true' ? row.dataset.itemName : link?.querySelector('.item_folder') ? link.querySelector('.txt')?.textContent.trim() : null;
    if (folder) menuPath = menuPath.replace(/[\\/]+$/, '') + (menuPath.includes('\\') ? '\\' : '/') + folder;
    menu.hidden = false;
    menu.style.left = Math.min(event.clientX, Math.max(0, innerWidth - 220)) + 'px';
    menu.style.top = Math.min(event.clientY, Math.max(0, innerHeight - 48)) + 'px';
    document.getElementById('terminalHere').focus();
  });
  document.getElementById('terminalHere').addEventListener('click', () => { menu.hidden = true; open(menuPath); });
  document.addEventListener('click', event => { if (!menu.contains(event.target)) menu.hidden = true; });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') menu.hidden = true; });
});
