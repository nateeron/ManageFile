/* JWT stays in an HttpOnly cookie; unsafe same-origin requests carry CSRF. */
(() => {
  const csrf = () => document.querySelector('meta[name="auth-csrf"]')?.content || '';
  const sameOrigin = value => {
    try { return new URL(value || location.href, location.href).origin === location.origin; }
    catch { return false; }
  };
  const signIn = () => location.replace('/login?next=' + encodeURIComponent(location.pathname + location.search));
  const unsafe = method => !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
  const originalFetch = window.fetch;
  window.fetch = async function(input, options = {}) {
    const url = input instanceof Request ? input.url : String(input);
    if (!sameOrigin(url)) return originalFetch.call(this, input, options);
    const method = options.method || (input instanceof Request ? input.method : 'GET');
    const headers = new Headers(options.headers || (input instanceof Request ? input.headers : undefined));
    if (unsafe(method)) headers.set('X-CSRF-Token', csrf());
    const response = await originalFetch.call(this, input, {...options, headers});
    if (response.status === 401) signIn();
    return response;
  };
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this.managefileCSRF = sameOrigin(url) && unsafe(method);
    this.managefileSameOrigin = sameOrigin(url);
    return originalOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function(body) {
    if (this.managefileCSRF) this.setRequestHeader('X-CSRF-Token', csrf());
    this.addEventListener('load', () => { if (this.managefileSameOrigin && this.status === 401) signIn(); }, {once:true});
    return originalSend.call(this, body);
  };
  document.addEventListener('DOMContentLoaded', () => {
    const expires = Number(document.querySelector('meta[name="auth-expires"]')?.content);
    if (expires) setTimeout(signIn, Math.max(0, expires * 1000 - Date.now()));
    if (!expires) return;
    let checking = false;
    const checkSession = async () => {
      if (checking || document.visibilityState === 'hidden') return;
      checking = true;
      try {
        const response = await originalFetch.call(window, '/api/session', {cache:'no-store', credentials:'same-origin'});
        if (response.status === 401) signIn();
      } catch { /* Retry when this tab becomes active again. */ }
      finally { checking = false; }
    };
    window.addEventListener('pageshow', event => {
      if (event.persisted) {
        document.documentElement.style.visibility = 'hidden';
        location.reload();
      } else checkSession();
    });
    window.addEventListener('focus', checkSession);
    document.addEventListener('visibilitychange', checkSession);
    window.addEventListener('storage', event => {
      if (event.key === 'managefile.signed-out') location.replace('/login');
    });
    document.querySelectorAll('form[action="/logout"]').forEach(form => {
      form.addEventListener('submit', async event => {
        event.preventDefault();
        const button = form.querySelector('[type="submit"]');
        if (button.disabled) return;
        button.disabled = true;
        const previousError = form.querySelector('[role="alert"]');
        previousError?.remove();
        try {
          const response = await window.fetch('/logout', {
            method:'POST', body:new FormData(form), headers:{Accept:'application/json'}, cache:'no-store'
          });
          const result = await response.json();
          if (!response.ok || !result.ok) throw new Error(result.error || 'Sign out failed. Please retry.');
          try { localStorage.setItem('managefile.signed-out', String(Date.now())); } catch { /* Storage may be disabled. */ }
          location.replace('/login');
        } catch (error) {
          const message = document.createElement('p');
          message.setAttribute('role', 'alert');
          message.textContent = error.message;
          form.appendChild(message);
          button.disabled = false;
        }
      });
    });
  });
})();
