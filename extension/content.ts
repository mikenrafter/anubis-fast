interface SolverStatusMessage {
  type: 'solver-status';
  solver: string;
  difficulty?: number;
}

interface ContentChallengeMessage {
  type: 'challenge';
  provider: 'anubis';
  url: string;
  challenge?: AnubisChallenge;
  userAgent: string;
  pageCookie: string;
}

interface SolverResponse {
  ok?: boolean;
  error?: string;
  browserNavigationUrl?: string;
  cookies?: unknown[];
}

interface Window {
  __anubisFastHandled?: boolean;
}

function showSolverStatus(solver: string, difficulty?: number): void {
  const names: Record<string, string> = {
    native: 'Native',
    wasm: 'Web Assembly',
    spoof: 'User-Agent spoof',
    javascript: 'JavaScript',
  };
  const label = names[solver] || solver || 'browser';
  const message = `FAST ANUBIS solver using ${label} solver at difficulty ${difficulty || '?'}... Please stand by.`;
  const image = document.querySelector<HTMLImageElement>('#image');
  if (image) {
    image.src = browser.runtime.getURL('icon.svg');
    image.alt = 'Anubis Fast solver';
  }
  const title = document.querySelector<HTMLElement>('#title');
  if (title) title.textContent = 'FAST ANUBIS';
  const status = document.querySelector<HTMLElement>('#status');
  if (status) {
    status.textContent = message;
    status.style.display = 'block';
  }
  const scriptError = document.querySelector<HTMLElement>('#anubis-script-error');
  if (scriptError) {
    scriptError.textContent = message;
    scriptError.style.display = 'block';
  }
  const noScriptMessage = document.querySelector<HTMLElement>('noscript p');
  if (noScriptMessage) noScriptMessage.textContent = message;
  console.info('[Anubis Fast] challenge display updated', { solver: label, difficulty, message });
}

browser.runtime.onMessage.addListener((message: SolverStatusMessage) => {
  if (message?.type === 'solver-status') showSolverStatus(message.solver, message.difficulty);
});

function handleChallenge(): void {
  if (window.__anubisFastHandled || !detectAnubis()) return;
  window.__anubisFastHandled = true;
  const challenge = getChallenge();
  showSolverStatus('native', challenge?.challenge?.difficulty || challenge?.rules?.difficulty);
  const request: ContentChallengeMessage = {
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
  browser.runtime.sendMessage(request).then((response: SolverResponse | undefined) => {
    console.info('[Anubis Fast] native response received', {
      ok: response?.ok,
      error: response?.error,
      hasBody: Boolean(response && 'body_base64' in response),
      cookieCount: response?.cookies?.length || 0,
    });
    if (!response || !response.ok) {
      window.__anubisFastHandled = false;
      return;
    }
    if (response.browserNavigationUrl) return;
    if (response.cookies?.length) return;
    console.error('[Anubis Fast] native solve returned no cookies; refusing to reload');
    window.__anubisFastHandled = false;
  }).catch((error: unknown) => {
    console.error('[Anubis Fast] native solve request failed', error);
    window.__anubisFastHandled = false;
  });
}

handleChallenge();
const observer = new MutationObserver(handleChallenge);
observer.observe(document, { childList: true, subtree: true });
setTimeout(() => observer.disconnect(), 30_000);
