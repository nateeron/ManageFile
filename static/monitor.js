(() => {
  const byId = id => document.getElementById(id);
  const text = (id, value) => { byId(id).textContent = value; };
  const bytes = value => {const gb = value / 1073741824; return gb >= 1 ? gb.toFixed(1) + ' GiB' : (value/1048576).toFixed(0) + ' MiB';};
  let timer, running = false, ports = '';
  const renderPorts = () => {
    const lines = ports.split('\n'), search = byId('portSearch').value.toLowerCase();
    const filtered = lines.filter((line, index) => index === 0 || ((!byId('webOnly').checked || /:(80|443)(?:\s|$)/.test(line)) && line.toLowerCase().includes(search)));
    text('ports', filtered.join('\n') + (filtered.length === 1 ? '\nไม่พบรายการที่ตรงกัน' : ''));
  };
  const refresh = async () => {
    if (running || document.hidden) return;
    running = true; byId('refresh').disabled = true;
    try {
      const response = await fetch('/api/monitor', {cache:'no-store'});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'โหลดข้อมูลไม่สำเร็จ');
      if (!data.supported) {
        text('error', data.message); byId('error').hidden = false;
        text('host', data.host + ' · Ubuntu/Linux only'); text('live', 'UNAVAILABLE');
        text('ports', data.message); text('load', 'ไม่รองรับระบบปฏิบัติการนี้');
        text('updated', 'เปิดหน้านี้จากแอปที่ติดตั้งบน Ubuntu เพื่อดูข้อมูลเซิร์ฟเวอร์');
        document.querySelectorAll('[data-section]').forEach(button => {button.disabled = true;});
        clearInterval(timer); return;
      }
      byId('error').hidden = true;
      const m = data.metrics;
      text('host', data.host + ' · Ubuntu / Linux');
      text('cpu', m.cpu === null ? 'กำลังวัด…' : m.cpu + '%'); byId('cpuBar').value = m.cpu || 0;
      text('load', m.cores + ' cores · Load ' + m.load.map(n => n.toFixed(2)).join(' / '));
      text('ram', m.ram_percent + '%'); byId('ramBar').value = m.ram_percent;
      text('ramNote', 'Available ' + bytes(m.ram_available) + ' / ' + bytes(m.ram_total) + ' · Swap ' + bytes(m.swap_total - m.swap_free));
      text('disk', m.disk_percent + '%'); byId('diskBar').value = m.disk_percent;
      text('diskNote', 'Free ' + bytes(m.disk_free) + ' / ' + bytes(m.disk_total));
      const service = Object.fromEntries(data.service.output.split('\n').filter(line => line.includes('=')).map(line => {const i=line.indexOf('='); return [line.slice(0,i),line.slice(i+1)];}));
      text('nginx', service.ActiveState || 'Unavailable'); text('boot', 'Boot: ' + (service.UnitFileState || '—') + ' · PID ' + (service.MainPID || '—'));
      text('uptime', 'Uptime: ' + Math.floor(m.uptime/86400) + 'd ' + Math.floor(m.uptime%86400/3600) + 'h ' + Math.floor(m.uptime%3600/60) + 'm');
      ports = data.ports.output; renderPorts();
      text('updated', 'อัปเดต ' + new Date(data.time*1000).toLocaleTimeString() + ' · Ports / Nginx cache ไม่เกิน 15 วินาที');
      text('live', Number(byId('interval').value) ? 'LIVE' : 'PAUSED');
    } catch (error) {text('error', error.message); byId('error').hidden = false; text('live', 'OFFLINE');}
    finally {running = false; byId('refresh').disabled = false;}
  };
  byId('refresh').addEventListener('click', refresh);
  byId('interval').addEventListener('change', () => {clearInterval(timer); const interval = Number(byId('interval').value); if (interval) timer = setInterval(refresh, interval); text('live', interval ? 'LIVE' : 'PAUSED'); refresh();});
  byId('webOnly').addEventListener('change', renderPorts); byId('portSearch').addEventListener('input', renderPorts);
  document.addEventListener('visibilitychange', () => {if (!document.hidden) refresh();});
  document.querySelectorAll('[data-section]').forEach(button => button.addEventListener('click', async () => {
    const buttons = document.querySelectorAll('[data-section]'); buttons.forEach(item => {item.disabled = true; item.classList.toggle('active', item === button);});
    text('detailTitle', button.textContent); text('detail', 'กำลังตรวจสอบ…'); text('detailTime', ''); byId('copy').disabled = true;
    try {
      const response = await fetch('/api/monitor/' + button.dataset.section, {cache:'no-store'});
      const data = await response.json();
      text('detail', data.output || data.error || 'No output'); byId('copy').disabled = false;
      text('detailTime', (response.ok && data.ok ? 'สำเร็จ' : 'ตรวจไม่สำเร็จ / สิทธิ์ไม่เพียงพอ') + ' · ' + new Date().toLocaleTimeString());
    } catch (error) {text('detail', error.message);}
    finally {buttons.forEach(item => {item.disabled = false;});}
  }));
  byId('copy').addEventListener('click', async () => {try {await navigator.clipboard.writeText(byId('detail').textContent); text('detailTime','คัดลอกแล้ว');} catch {text('detailTime','คัดลอกอัตโนมัติไม่ได้ กรุณาเลือกข้อความในผลการตรวจสอบ');}});
  timer = setInterval(refresh, 5000); refresh();
})();
