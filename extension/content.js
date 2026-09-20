/* global browser */

console.info('[Anubis Fast] content script loaded', {
  url: window.location.href,
  readyState: document.readyState,
});

function showSolverStatus(solver, difficulty) {
  const names = {
    native: 'Native',
    wasm: 'Web Assembly',
    spoof: 'User-Agent spoof',
    javascript: 'JavaScript',
  };
  const label = names[solver] || solver || 'browser';
  const message = `FAST ANUBIS solver using ${label} solver at difficulty ${difficulty || '?'}... Please stand by.`;
  const image = document.querySelector('#image');
  if (image) {
    image.src = browser.runtime.getURL('icon.svg');
    image.alt = 'Anubis Fast solver';
  }
  const title = document.querySelector('#title');
  if (title) title.textContent = 'FAST ANUBIS';
  const status = document.querySelector('#status');
  if (status) {
    status.textContent = message;
    status.style.display = 'block';
  }
  const scriptError = document.querySelector('#anubis-script-error');
  if (scriptError) {
    scriptError.textContent = message;
    scriptError.style.display = 'block';
  }
  const noScriptMessage = document.querySelector('noscript p');
  if (noScriptMessage) noScriptMessage.textContent = message;
  console.info('[Anubis Fast] challenge display updated', { solver: label, difficulty, message });
}

browser.runtime.onMessage.addListener((message) => {
  if (message?.type === 'solver-status') showSolverStatus(message.solver, message.difficulty);
});

function handleChallenge() {
  if (window.__anubisFastHandled || !detectAnubis()) return;
  window.__anubisFastHandled = true;
  const challenge = getChallenge();
  showSolverStatus('native', challenge?.challenge?.difficulty || challenge?.rules?.difficulty);
  const request = {
    type: 'challenge',
    provider: 'anubis',
    url: new URL(window.location.href).searchParams.get('redir') || window.location.href,
    challenge,
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

    if (response.browserNavigationUrl) {
      console.info('[Anubis Fast] browser solver completed; background is navigating to pass endpoint');
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
