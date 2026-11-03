/* Presentation enhancements; file operations remain in the existing scripts. */
document.addEventListener('DOMContentLoaded', () => {
  const path = document.getElementById('system_path').value;
  document.getElementById('refreshFiles').addEventListener('click', () => location.reload());
  const parentButton = document.getElementById('parentFolder');
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  const boundary = normalized.lastIndexOf('/');
  parentButton.disabled = boundary < 0 || normalized === '';
  parentButton.addEventListener('click', () => {
    let parent = normalized.slice(0, boundary) || '/';
    if (/^[a-z]:$/i.test(parent)) parent += '/';
    location.href = '/?path=' + encodeURIComponent(parent);
  });
  const folderInput = document.getElementById('folderInput');
  document.getElementById('chooseFolder').addEventListener('click', () => folderInput.click());
  folderInput.addEventListener('change', () => {
    if (folderInput.files.length) uploadFiles(folderInput.files);
  });
  const zone = document.getElementById('dropZone');
  zone.querySelectorAll(':scope > a.folder-link').forEach(link => {
    const name = link.querySelector('.txt')?.textContent.trim() || '';
    link.title = name;
    link.tabIndex = 0;
    link.setAttribute('role', 'button');
    link.setAttribute('aria-label', name);
    link.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        link.dispatchEvent(new MouseEvent('dblclick', {bubbles:true}));
      }
      if (event.key === ' ') {
        event.preventDefault();
        wail_select = true;
        link.click();
      }
    });
  });
  const updateStatus = () => {
    const selected = typeof selectedItems !== 'undefined' ? selectedItems.length + selectedfile.length : 0;
    const total = zone.querySelectorAll(':scope > a.folder-link').length;
    const text = selected ? `${selected} of ${total} items selected` : `${total} items`;
    const status = document.getElementById('selectionStatus');
    if (status.textContent !== text) status.textContent = text;
    document.querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-pressed', String(button.classList.contains('active'))));
  };
  new MutationObserver(updateStatus).observe(zone, {subtree:true, attributes:true, attributeFilter:['class'], childList:true});
  updateStatus();
  // Make the legacy close controls usable with the keyboard, too.
  document.querySelectorAll('.popup .close').forEach(close => {
    close.tabIndex = 0;
    close.setAttribute('role', 'button');
    close.setAttribute('aria-label', 'Close dialog');
    close.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); close.click(); }
    });
  });
  document.querySelectorAll('.popup').forEach(popup => {
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-modal', 'true');
    const heading = popup.querySelector('h3');
    if (heading) { heading.id ||= popup.id + 'Heading'; popup.setAttribute('aria-labelledby', heading.id); }
    const observer = new MutationObserver(() => {
      if (popup.style.display === 'flex') popup.querySelector('input, button, [tabindex]')?.focus();
    });
    observer.observe(popup, {attributes:true, attributeFilter:['style']});
    popup.addEventListener('keydown', event => {
      if (event.key === 'Escape') popup.querySelector('.close')?.click();
      if (event.key === 'Tab') {
        const controls = [...popup.querySelectorAll('button,input,select,[tabindex="0"]')].filter(el => el.getClientRects().length && !el.disabled);
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    });
  });
});
