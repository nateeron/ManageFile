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
  });
})();
