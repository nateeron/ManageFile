/* Presentation enhancements; file operations remain in the existing scripts. */
document.addEventListener('DOMContentLoaded', () => {
  const path = document.getElementById('system_path').value;
  const bookmarkKey = 'managefile.bookmarks.v1';
  const bookmarkList = document.getElementById('bookmarkList');
  const shortcutDialog = document.getElementById('shortcutDialog');
  const shortcutName = document.getElementById('shortcutName');
  const shortcutPath = document.getElementById('shortcutPath');
  const shortcutError = document.getElementById('shortcutError');
  const pathKey = value => {
    const normalized = value.trim().replace(/\\/g, '/').replace(/\/+$/, '') || '/';
    return /^[a-z]:|^\/\//i.test(normalized) ? normalized.toLowerCase() : normalized;
  };
  const readBookmarks = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(bookmarkKey) || '[]');
      return Array.isArray(saved) ? saved.filter(item => item && typeof item.name === 'string' && typeof item.path === 'string' && item.name.trim() && item.path.trim()) : [];
    } catch { return []; }
  };
  const writeBookmarks = bookmarks => {
    try { localStorage.setItem(bookmarkKey, JSON.stringify(bookmarks)); return true; }
    catch { return false; }
  };
  const renderBookmarks = () => {
    bookmarkList.replaceChildren();
    const bookmarks = readBookmarks();
    bookmarks.forEach(bookmark => {
      const row = document.createElement('div');
      row.className = 'bookmark-row';
      const link = document.createElement('a');
      link.className = 'bookmark-link';
      link.href = '/?path=' + encodeURIComponent(bookmark.path);
      link.title = bookmark.path;
      if (pathKey(bookmark.path) === pathKey(path)) {
        row.classList.add('active');
        link.setAttribute('aria-current', 'location');
      }
      const icon = document.createElement('span');
      icon.className = 'bookmark-icon';
      icon.textContent = '☆';
      icon.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span');
      label.className = 'bookmark-name';
      label.textContent = bookmark.name;
      link.append(icon, label);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'bookmark-remove';
      remove.textContent = '×';
      remove.title = 'Remove bookmark';
      remove.setAttribute('aria-label', 'Remove bookmark ' + bookmark.name);
      remove.addEventListener('click', () => {
        if (writeBookmarks(readBookmarks().filter(item => pathKey(item.path) !== pathKey(bookmark.path)))) renderBookmarks();
        else alert('Unable to save bookmarks. Please allow browser storage.');
      });
      row.append(link, remove);
      bookmarkList.append(row);
    });
    if (!bookmarks.length) {
      const empty = document.createElement('p');
      empty.className = 'bookmark-empty';
      empty.textContent = 'No bookmarks yet';
      bookmarkList.append(empty);
    }
  };
  const openShortcut = () => {
    let target = path;
    if (typeof selectedItems !== 'undefined' && selectedItems.length === 1 && !selectedfile.length) target = path.replace(/[\\/]+$/, '') + '/' + selectedItems[0];
    shortcutPath.value = target;
    shortcutName.value = target.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || target;
    shortcutError.hidden = true;
    shortcutDialog.showModal();
    shortcutName.focus();
    shortcutName.select();
  };
  document.getElementById('createShortcut').addEventListener('click', openShortcut);
  document.getElementById('createShortcutOption').addEventListener('click', openShortcut);
  document.getElementById('closeShortcut').addEventListener('click', () => shortcutDialog.close());
  document.getElementById('cancelShortcut').addEventListener('click', () => shortcutDialog.close());
  document.getElementById('shortcutForm').addEventListener('submit', event => {
    event.preventDefault();
    const name = shortcutName.value.trim(), folderPath = shortcutPath.value.trim();
    if (!name || !folderPath) {
      shortcutError.textContent = 'Enter a name and folder path.';
      shortcutError.hidden = false;
      return;
    }
    const bookmarks = readBookmarks();
    const existing = bookmarks.findIndex(item => pathKey(item.path) === pathKey(folderPath));
    const bookmark = {name, path:folderPath};
    if (existing >= 0) bookmarks[existing] = bookmark;
    else bookmarks.push(bookmark);
    if (!writeBookmarks(bookmarks)) {
      shortcutError.textContent = 'Unable to save bookmarks. Please allow browser storage.';
      shortcutError.hidden = false;
      return;
    }
    renderBookmarks();
    shortcutDialog.close();
    document.getElementById('createShortcut').focus();
  });
  window.addEventListener('storage', event => { if (event.key === bookmarkKey || event.key === null) renderBookmarks(); });
  renderBookmarks();
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
