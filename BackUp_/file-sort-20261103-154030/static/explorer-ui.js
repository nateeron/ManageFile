/* Presentation enhancements; file operations remain in the existing scripts. */
document.addEventListener('DOMContentLoaded', () => {
  const path = document.getElementById('system_path').value;
  const bookmarkKey = 'managefile.bookmarks.v1';
  const bookmarkList = document.getElementById('bookmarkList');
  const shortcutDialog = document.getElementById('shortcutDialog');
  const shortcutName = document.getElementById('shortcutName');
  const shortcutPath = document.getElementById('shortcutPath');
  const shortcutError = document.getElementById('shortcutError');
  const bookmarkHint = document.getElementById('bookmarkHint');
  let bookmarks = [];
  let migrationWarning = '';
  const pathKey = value => {
    const normalized = value.trim().replace(/\\/g, '/').replace(/\/+$/, '') || '/';
    return /^[a-z]:|^\/\//i.test(normalized) ? normalized.toLowerCase() : normalized;
  };
  const readLegacyBookmarks = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(bookmarkKey) || '[]');
      return Array.isArray(saved) ? saved.filter(item => item && typeof item.name === 'string' && typeof item.path === 'string' && item.name.trim() && item.path.trim()) : [];
    } catch { return []; }
  };
  const bookmarkRequest = async (url = '/api/bookmarks', method = 'GET', body) => {
    const response = await fetch(url, {method, ...(body === undefined ? {} : {headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)})});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to save bookmarks.');
    return data.bookmarks;
  };
  const reloadBookmarks = async () => {
    try {
      bookmarks = await bookmarkRequest();
      renderBookmarks();
      bookmarkHint.textContent = migrationWarning || 'Saved to your account';
    } catch (error) { bookmarkHint.textContent = error.message; }
  };
  const renderBookmarks = () => {
    bookmarkList.replaceChildren();
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
      remove.addEventListener('click', async () => {
        remove.disabled = true;
        try {
          bookmarks = await bookmarkRequest('/api/bookmarks/' + bookmark.id, 'DELETE');
          renderBookmarks();
          bookmarkHint.textContent = 'Saved to your account';
        } catch (error) { bookmarkHint.textContent = error.message; remove.disabled = false; }
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
  document.getElementById('shortcutForm').addEventListener('submit', async event => {
    event.preventDefault();
    const name = shortcutName.value.trim(), folderPath = shortcutPath.value.trim();
    if (!name || !folderPath) {
      shortcutError.textContent = 'Enter a name and folder path.';
      shortcutError.hidden = false;
      return;
    }
    const submit = event.currentTarget.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      bookmarks = await bookmarkRequest('/api/bookmarks', 'POST', {name, path:folderPath});
      renderBookmarks();
      bookmarkHint.textContent = 'Saved to your account';
      shortcutDialog.close();
      document.getElementById('createShortcut').focus();
    } catch (error) {
      shortcutError.textContent = error.message;
      shortcutError.hidden = false;
    } finally { submit.disabled = false; }
  });
  // Import browser-only bookmarks once; retain them locally if any request fails.
  const importLegacyBookmarks = async () => {
    const legacy = readLegacyBookmarks();
    if (!legacy.length) return;
    try {
      for (let index = 0; index < legacy.length; index += 10) {
        await bookmarkRequest('/api/bookmarks/import', 'POST', {bookmarks:legacy.slice(index, index + 10)});
      }
      try { localStorage.removeItem(bookmarkKey); } catch { /* Server copy is already saved. */ }
    } catch (error) { migrationWarning = 'Import failed; old bookmarks kept in this browser. ' + error.message; bookmarkHint.textContent = migrationWarning; }
  };
  importLegacyBookmarks().then(reloadBookmarks);
  window.addEventListener('focus', reloadBookmarks);
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

  // A floating editor: move from its title bar, resize from the bottom corner.
  const editorOverlay = document.getElementById('textEditorDialog');
  const editorWindow = editorOverlay.querySelector('.text-editor-content');
  const editorHeader = editorWindow.querySelector('.text-editor-header');
  let editorDrag = null;
  const moveEditor = (left, top) => {
    const bounds = editorWindow.getBoundingClientRect();
    editorWindow.style.left = Math.max(8, Math.min(left, innerWidth - bounds.width - 8)) + 'px';
    editorWindow.style.top = Math.max(8, Math.min(top, innerHeight - bounds.height - 8)) + 'px';
  };
  const centerEditor = () => {
    const bounds = editorWindow.getBoundingClientRect();
    moveEditor((innerWidth - bounds.width) / 2, (innerHeight - bounds.height) / 2);
  };
  document.getElementById('centerTextEditor').addEventListener('click', centerEditor);
  editorHeader.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.target.closest('button')) return;
    const bounds = editorWindow.getBoundingClientRect();
    editorDrag = {id:event.pointerId, x:event.clientX - bounds.left, y:event.clientY - bounds.top};
    editorHeader.setPointerCapture(event.pointerId);
    editorHeader.classList.add('dragging');
    event.preventDefault();
  });
  editorHeader.addEventListener('pointermove', event => {
    if (editorDrag?.id === event.pointerId) moveEditor(event.clientX - editorDrag.x, event.clientY - editorDrag.y);
  });
  const stopEditorDrag = event => {
    if (editorDrag?.id !== event.pointerId) return;
    editorDrag = null;
    editorHeader.classList.remove('dragging');
    if (editorHeader.hasPointerCapture(event.pointerId)) editorHeader.releasePointerCapture(event.pointerId);
  };
  editorHeader.addEventListener('pointerup', stopEditorDrag);
  editorHeader.addEventListener('pointercancel', stopEditorDrag);
  editorHeader.addEventListener('lostpointercapture', stopEditorDrag);
  editorHeader.addEventListener('keydown', event => {
    if (event.target !== editorHeader || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const bounds = editorWindow.getBoundingClientRect(), step = event.shiftKey ? 30 : 10;
    moveEditor(bounds.left + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0), bounds.top + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0));
  });
  new ResizeObserver(() => {
    if (!editorWindow.getClientRects().length) return;
    const bounds = editorWindow.getBoundingClientRect();
    moveEditor(bounds.left, bounds.top);
    if (typeof codeEditor !== 'undefined' && codeEditor) codeEditor.refresh();
  }).observe(editorWindow);
  window.addEventListener('resize', () => {
    if (editorWindow.getClientRects().length) {
      const bounds = editorWindow.getBoundingClientRect();
      moveEditor(bounds.left, bounds.top);
    }
  });
});
