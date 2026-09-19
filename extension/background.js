/* global browser */
let host;
const pending = new Map();

function challengeFields(payload) {
  const nested = payload?.challenge || payload || {};
  const rules = payload?.rules || {};
  return {
    id: nested.id || payload?.id,
    method: nested.method || payload?.method || rules.algorithm,
    randomData: nested.randomData || payload?.randomData,
    difficulty: nested.difficulty || payload?.difficulty || rules.difficulty,
    basePrefix: payload?.basePrefix || '',
  };
}

function solveWithWasm(randomData, difficulty) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(browser.runtime.getURL('solvers/wasm-worker.js'));
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error('WASM solver timed out'));
    }, 120_000);
    worker.onmessage = (event) => {
      if (event.data?.type === 'error') {
        clearTimeout(timer);
        worker.terminate();
        reject(new Error(event.data.error));
        return;
      }
      clearTimeout(timer);
      worker.terminate();
      resolve(event.data);
    };
    worker.onerror = (error) => {
      clearTimeout(timer);
      worker.terminate();
      reject(error);
    };
    worker.postMessage([randomData, difficulty]);
  });
}

async function solveInBrowser(message, tabId) {
  const fields = challengeFields(message.challenge);
  if (fields.method !== 'fast' || !fields.id || !fields.randomData || !fields.difficulty) {
    throw new Error('browser solver only supports complete Anubis fast challenges');
  }
  const started = performance.now();
  let solution;
  try {
    solution = await solveWithWasm(fields.randomData, fields.difficulty);
  } catch (error) {
    console.warn('[Anubis Fast] WASM solver unavailable; using JavaScript solver', error);
    solution = await solveJavaScript(fields.randomData, fields.difficulty);
  }
  const elapsedTime = Math.max(1, Math.round(performance.now() - started));
  const endpoint = new URL(message.url);
  endpoint.pathname = `${fields.basePrefix.replace(/\/$/, '')}/.within.website/x/cmd/anubis/api/pass-challenge`;
  endpoint.search = new URLSearchParams({
    id: fields.id,
    response: solution.digest,
    nonce: String(solution.nonce),
    redir: message.url,
    elapsedTime: String(elapsedTime),
  }).toString();
  console.info('[Anubis Fast] browser solver completed', {
    backend: solution.backend,
    difficulty: fields.difficulty,
    elapsedTime,
  });
  await browser.tabs.update(tabId, { url: endpoint.toString() });
  return { ok: true, status: 200, browserNavigationUrl: endpoint.toString(), backend: solution.backend };
}

console.info('[Anubis Fast] background script loaded', {
  extensionId: browser.runtime.id,
});
browser.browserAction.setBadgeText({ text: 'ON' });
browser.browserAction.setBadgeBackgroundColor({ color: '#2772c4' });
browser.notifications.create({
  type: 'basic',
  title: 'Anubis Fast loaded',
  message: `Extension reloaded at ${new Date().toLocaleTimeString()}`,
  iconUrl: browser.runtime.getURL('icon.svg'),
});

function connectHost() {
  if (host) return host;
  console.info('[Anubis Fast] connecting to native host', 'anubis_fast');
  host = browser.runtime.connectNative('anubis_fast');
  host.onMessage.addListener((message) => {
    console.info('[Anubis Fast] native message received', {
      type: message?.type,
      id: message?.id,
      ok: message?.ok,
      status: message?.status,
      cookieCount: message?.cookies?.length || 0,
      hasCookiesField: Array.isArray(message?.cookies),
      error: message?.error,
      protocol: message?.protocol,
      hostPath: message?.host_path,
      anubisFetch: message?.anubis_fetch,
    });
    if (message?.type === 'ready') {
      console.info('[Anubis Fast] native host ready', {
        protocol: message.protocol,
        hostPath: message.host_path,
        anubisFetch: message.anubis_fetch,
      });
      return;
    }
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    const response = { ...message, url: entry.url, cookieStoreId: entry.cookieStoreId };
    installCookies(response).then(async () => {
      if (response.cookies?.length && entry.tabId !== undefined) {
        console.info('[Anubis Fast] cookies installed; navigating tab', {
          tabId: entry.tabId,
          url: entry.url,
        });
        await browser.tabs.update(entry.tabId, { url: entry.url });
      }
      entry.resolve(response);
    }).catch((error) => {
      console.error('[Anubis Fast] unable to install native cookies', error);
      entry.resolve({ ...response, ok: false, error: String(error) });
    });
  });

  host.onDisconnect.addListener(() => {
    const error = browser.runtime.lastError?.message || 'native host disconnected';
    console.error('[Anubis Fast] native host disconnected', error);
    host = undefined;
    for (const entry of pending.values()) {
      solveInBrowser(entry.request, entry.tabId).then(entry.resolve).catch((fallbackError) => {
        entry.resolve({ ok: false, error: `${error}; browser fallback: ${fallbackError}` });
      });
    }
    pending.clear();
  });
  return host;
}

async function installCookies(message) {
  if (!message?.ok || !Array.isArray(message.cookies) || message.cookies.length === 0) return;
  const url = message.url;
  const cookieOptions = message.cookieStoreId ? { storeId: message.cookieStoreId } : {};
  const installed = await Promise.all(message.cookies.map((cookie) => browser.cookies.set({
    url,
    ...cookieOptions,
    name: cookie.name,
    value: cookie.value,
    path: cookie.path || '/',
    ...(cookie.domain ? { domain: cookie.domain } : {}),
    ...(cookie.secure !== undefined ? { secure: cookie.secure } : {}),
    ...(cookie.httpOnly !== undefined ? { httpOnly: cookie.httpOnly } : {}),
    ...(cookie.sameSite ? { sameSite: cookie.sameSite } : {}),
  })));
  const visible = await browser.cookies.getAll({ url, ...cookieOptions });
  console.info('[Anubis Fast] installed native cookies', {
    requested: message.cookies.length,
    installed: installed.filter(Boolean).length,
    visible: visible.length,
    names: visible.map(({ name }) => name),
    cookieStoreId: message.cookieStoreId,
    url,
  });
}

browser.runtime.onMessage.addListener(async (message, sender) => {
  if (message?.type !== 'challenge') return undefined;
  console.info('[Anubis Fast] challenge request received', {
    provider: message.provider,
    url: message.url,
  });
  const id = crypto.randomUUID();
  const cookieStoreId = sender.tab?.cookieStoreId;
  const cookieOptions = cookieStoreId ? { storeId: cookieStoreId } : {};
  const cookies = await browser.cookies.getAll({ url: message.url, ...cookieOptions });
  const browserCookie = cookies.map(({ name, value }) => `${name}=${value}`).join('; ');
  const cookie = [browserCookie, message.pageCookie].filter(Boolean).join('; ');
  console.info('[Anubis Fast] collected cookies', {
    count: cookies.length,
    headerLength: cookie.length,
    pageCookieLength: message.pageCookie?.length || 0,
    cookieStoreId,
  });
  return new Promise((resolve) => {
    pending.set(id, {
      resolve,
      url: message.url,
      tabId: sender.tab?.id,
      cookieStoreId,
      request: message,
    });
    try {
      connectHost().postMessage({
        id,
        type: 'fetch',
      provider: message.provider,
      url: message.url,
        cookie,
        challenge: message.challenge ? JSON.stringify(message.challenge) : undefined,
        user_agent: message.userAgent,
      });
      console.info('[Anubis Fast] request sent to native host', { id });
    } catch (error) {
      pending.delete(id);
      console.error('[Anubis Fast] unable to send native request', error);
      resolve({ ok: false, error: String(error) });
    }
  });
});
