(() => {
  const byId = id => document.getElementById(id);
  const element = (tag, text, className) => {const node=document.createElement(tag); if (text !== undefined) node.textContent=text; if (className) node.className=className; return node;};
  let refreshing=false, operating=false, lastData=null, lastSignature='';
  const request = async (url, body) => {
    const response=await fetch(url, {cache:'no-store', ...(body ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)} : {})});
    const data=await response.json(); if (!response.ok) throw new Error(data.error || 'Request failed'); return data;
  };
  const warning = message => {byId('webError').textContent=message; byId('webError').hidden=!message;};
  const detailRow = (list,label,value) => {list.append(element('dt',label),element('dd',value || '—'));};
  const showJob = (title, output) => {byId('webJob').hidden=false; byId('webJobTitle').textContent=title; byId('webJobOutput').textContent=output;};
  const freeze = disabled => {document.querySelectorAll('#webCards button, #webCards select').forEach(node=>{node.disabled=disabled || node.dataset.unavailable==='true';});};
  const render = data => {
    lastData=data;
    const signature=JSON.stringify([data.sites,data.services]);
    warning((data.errors || []).join('\n'));
    // Preserve focus and an in-progress service choice during background refresh.
    if (signature===lastSignature || (document.activeElement?.tagName==='SELECT' && byId('webCards').contains(document.activeElement))) return;
    lastSignature=signature;
    byId('webCards').replaceChildren();
    if (!data.sites.length) {byId('webCards').append(element('p','ไม่พบเว็บไซต์ที่อ่านได้จาก Nginx','muted')); return;}
    data.sites.forEach(site => {
      const card=element('article',undefined,'panel web-card');
      const heading=element('div',undefined,'section-title');
      heading.append(element('h3',site.domains.join(' / ')),element('span',site.state,'web-state '+(site.state==='active'?'up':site.state==='inactive' || site.state==='failed'?'down':'unknown')));
      card.append(heading);
      const details=element('dl');
      detailRow(details,'Listen',site.listen.join(', '));
      detailRow(details,'ปลายทาง',site.targets.join('\n'));
      detailRow(details,'Config',site.config);
      detailRow(details,'Service',site.service ? site.service+' · '+site.substate+' · PID '+site.pid : 'ยังไม่ได้ผูก Service');
      const cert=site.certificate;
      detailRow(details,'SSL certificate',site.certificate_path);
      detailRow(details,'หมดอายุ',cert?.expires ? new Date(cert.expires).toLocaleString('en-GB') : site.certificate_path ? 'อ่านวันหมดอายุใบรับรองไม่ได้' : 'ไม่ได้ตั้งค่า SSL');
      if (cert?.days !== null && cert?.days !== undefined) detailRow(details,'ระยะเวลา',cert.days<0?'หมดอายุแล้ว':cert.days+' วัน');
      if (cert?.name) detailRow(details,'Certbot name',cert.name);
      card.append(details);
      if (cert && cert.days !== null && cert.days<=30) card.append(element('p',cert.days<0?'ใบรับรองหมดอายุแล้ว':'ใบรับรองใกล้หมดอายุ','web-warning'));
      const binding=element('div',undefined,'web-binding');
      const label=element('label','Service ของเว็บไซต์');
      const select=element('select'); select.id='service-'+site.id; label.htmlFor=select.id;
      const empty=element('option','เลือก Service…'); empty.value=''; select.append(empty);
      data.services.filter(service=>service!=='nginx.service').forEach(service => {const option=element('option',service);option.value=service;select.append(option);});
      select.value=site.service || '';
      const save=element('button','บันทึก Service'); save.type='button';
      save.addEventListener('click',async()=>{
        if (operating) return;
        if (select.value && !confirm('ผูก '+site.domains[0]+' กับ '+select.value+'?\nปุ่มควบคุมจะใช้ Service นี้ กรุณาตรวจชื่อให้ตรงกับเว็บไซต์')) return;
        operating=true;freeze(true);
        try {await request('/api/monitor/websites/'+site.id+'/service',{service:select.value});lastSignature='';await load();}
        catch(error){warning(error.message);}
        finally{operating=false;freeze(false);}
      });
      binding.append(label,select,save);card.append(binding);
      const actions=element('div',undefined,'web-actions');
      [['start','Start'],['stop','Stop'],['restart','Restart'],['renew','ต่ออายุ SSL']].forEach(([action,label])=>{
        const button=element('button',label,action==='stop'?'danger':'');button.type='button';
        const unavailable=action==='renew'?!cert?.managed:!site.service || site.service==='nginx.service';
        button.dataset.unavailable=String(unavailable);button.disabled=operating || unavailable;
        if (unavailable) button.title=action==='renew'?'ไม่พบใบรับรองที่ Certbot จัดการ':'ผูก Service ของเว็บไซต์ก่อน';
        button.addEventListener('click',()=>operate(site,action,label));actions.append(button);
      });
      card.append(actions,element('p','สถานะ ActiveState มาจาก systemd ยังไม่ได้ทดสอบ HTTP ของเว็บไซต์','muted'));
      byId('webCards').append(card);
    });
    if (operating) freeze(true);
  };
  const load = async () => {
    if (refreshing || document.hidden) return;
    refreshing=true;byId('webRefresh').disabled=true;
    try {render(await request('/api/monitor/websites'));} catch(error){warning(error.message);}
    finally{refreshing=false;byId('webRefresh').disabled=false;}
  };
  const operate = async (site,action,label) => {
    if (operating) return;
    const shared=lastData.sites.filter(other=>action==='renew'?other.certificate?.name===site.certificate?.name:other.service===site.service).map(other=>other.domains.join(', '));
    const explanation=action==='renew'?'Certbot จะต่ออายุเมื่อถึงกำหนด แล้วตรวจ Config และ reload Nginx':'Service: '+site.service+'\nหากเป็น Service ของ ManageFile หน้า Monitor อาจหลุดและต้องเปิดใหม่; การ Stop จะต้อง Start ผ่าน SSH';
    if (!confirm(label+' · '+site.domains[0]+'?\n'+explanation+'\nเว็บไซต์ที่ใช้ร่วมกัน: '+shared.join(' / '))) return;
    operating=true;freeze(true);showJob(label+' · '+site.domains[0],'กำลังเริ่มทำงาน…');
    try {
      const result=await request('/api/monitor/websites/'+site.id+'/action',{action,confirm:site.domains[0],target:action==='renew'?site.certificate.name:site.service});
      const deadline=Date.now()+240000;
      while(Date.now()<deadline){
        await new Promise(resolve=>setTimeout(resolve,1500));
        const job=await request('/api/monitor/web-jobs/'+result.job);
        showJob(label+' · '+(job.status==='running'?'กำลังทำงาน':job.status==='done'?'สำเร็จ':'ไม่สำเร็จ'),job.output);
        if(job.status!=='running'){lastSignature='';await load();return;}
      }
      showJob(label,'ยังไม่ได้รับผลลัพธ์ กรุณาตรวจสถานะ Service / Certbot ก่อนลองใหม่');
    } catch(error){showJob(label,'ยังยืนยันผลการทำงานไม่ได้: '+error.message+'\nหาก Service ถูก Stop หรือ Restart ให้เปิดหน้าใหม่หลัง Service พร้อม หรือตรวจผ่าน SSH');}
    finally{operating=false;freeze(false);}
  };
  byId('webRefresh').addEventListener('click',()=>{lastSignature='';load();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!operating)load();});
  setInterval(()=>{if(!operating)load();},15000);load();
})();
