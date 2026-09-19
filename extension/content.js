/* global browser */

console.info('[Anubis Fast] content script loaded', {
  url: window.location.href,
  readyState: document.readyState,
});

function handleChallenge() {
  if (window.__anubisFastHandled || !detectAnubis()) return;
  window.__anubisFastHandled = true;
  const request = {
    type: 'challenge',
    provider: 'anubis',
    url: new URL(window.location.href).searchParams.get('redir') || window.location.href,
    challenge: getChallenge(),
    userAgent: navigator.userAgent,
    pageCookie: document.cookie,
  };
  console.info('[Anubis Fast] challenge detected; requesting native solve', {
    ...request,
    challenge: request.challenge ? 'present' : 'missing',
    pageCookieLength: request.pageCookie.length,
  });
  browser.runtime.sendMessage(request).then((response) => {
    console.info('[Anubis Fast] native response received', {
      ok: response?.ok,
      status: response?.status,
      error: response?.error,
      hasBody: Boolean(response?.body_base64),
      cookieCount: response?.cookies?.length || 0,
    });
    if (!response || !response.ok) {
      window.__anubisFastHandled = false;
      return;
    }

    if (response.cookies?.length) {
      console.info('[Anubis Fast] auth cookie installed; background is navigating to target', request.url);
      return;
    }

    console.error('[Anubis Fast] native solve returned no cookies; refusing to reload', {
      hasCookiesField: Array.isArray(response.cookies),
      hasBody: Boolean(response.body_base64),
    });
    window.__anubisFastHandled = false;
  }).catch((error) => {
    console.error('[Anubis Fast] native solve request failed', error);
    window.__anubisFastHandled = false;
  });
}

handleChallenge();
const observer = new MutationObserver(handleChallenge);
observer.observe(document, { childList: true, subtree: true });
setTimeout(() => observer.disconnect(), 30_000);
