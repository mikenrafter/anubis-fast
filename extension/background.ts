type SolverMode = 'native' | 'wasm' | 'spoof' | 'javascript';

interface ChallengePayload {
  challenge?: { id?: string; method?: string; randomData?: string; difficulty?: number };
  rules?: { algorithm?: string; difficulty?: number };
  id?: string;
  method?: string;
  randomData?: string;
  difficulty?: number;
  basePrefix?: string;
}

interface BackgroundChallengeMessage {
  type: 'challenge';
  provider: string;
  url: string;
  challenge?: ChallengePayload;
  pageCookie?: string;
  userAgent?: string;
}

interface NativeCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: browser.cookies.SameSiteStatus;
}

interface NativeResponse {
  id?: string;
  type?: string;
  ok?: boolean;
  status?: number;
  error?: string;
  cookies?: NativeCookie[];
  cookieStoreId?: string;
  url?: string;
  [key: string]: unknown;
}

interface BrowserSolveResponse {
  ok: boolean;
  status: number;
  backend: string;
  browserNavigationUrl: string;
  userAgent?: string;
}

interface WasmSolution {
  nonce: number;
  digest: string;
  backend: 'wasm';
}

interface PendingRequest {
  resolve: (response: NativeResponse | BrowserSolveResponse) => void;
  url: string;
  tabId?: number;
  cookieStoreId?: string;
  request: BackgroundChallengeMessage;
}

interface SpoofRequest {
  url: string;
  userAgent: string;
  resolve: (response: BrowserSolveResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

let host: browser.runtime.Port | undefined;
const pending = new Map<string, PendingRequest>();
let solverMode: SolverMode = 'native';
const solverModes: SolverMode[] = ['native', 'wasm', 'spoof', 'javascript'];
const spoofRequests = new Map<number, SpoofRequest>();
const browserFallbacks = new Map<string, 'javascript'>();

function generateSpoofedUserAgent(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const length = Math.round(Math.random() * 16) + 16;
  let userAgent = '';
  for (let index = 0; index < length; index += 1) {
    userAgent += Math.random() > 0.8 ? ' ' : alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  if (userAgent.toLowerCase().includes('bot')) return generateSpoofedUserAgent();
  return userAgent;
}

function setSolverBadge(): void {
  const text = solverMode === 'native' ? 'N' : solverMode === 'wasm' ? 'W' : solverMode === 'spoof' ? 'UA' : 'JS';
  browser.browserAction.setBadgeText({ text });
  browser.browserAction.setBadgeBackgroundColor({
    color: solverMode === 'native' ? '#2772c4' : solverMode === 'wasm' ? '#8a3ffc' : solverMode === 'spoof' ? '#0f766e' : '#d97706',
  });
}

browser.storage.local.get('solverMode').then((stored) => {
  const mode = stored.solverMode as SolverMode | undefined;
  if (mode && solverModes.includes(mode)) solverMode = mode;
  setSolverBadge();
  console.info('[Anubis Fast] solver mode', solverMode);
});

browser.browserAction.onClicked.addListener(async () => {
  solverMode = solverModes[(solverModes.indexOf(solverMode) + 1) % solverModes.length]!;
  await browser.storage.local.set({ solverMode });
  setSolverBadge();
  console.info('[Anubis Fast] solver mode changed', solverMode);
});

function challengeFields(payload: ChallengePayload | undefined): {
  id?: string;
  method?: string;
  randomData?: string;
  difficulty?: number;
  basePrefix: string;
} {
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

function solveWithWasm(randomData: string, difficulty: number): Promise<WasmSolution> {
  return new Promise((resolve, reject) => {
    console.info('[Anubis Fast] WASM worker started', { difficulty, randomDataLength: randomData.length });
    const worker = new Worker(browser.runtime.getURL('solvers/wasm-worker.js'));
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error('WASM solver timed out'));
    }, 120_000);
    worker.onmessage = (event: MessageEvent<{ type?: string; error?: string } & Partial<WasmSolution>>) => {
      if (event.data?.type === 'error') {
        clearTimeout(timer);
        worker.terminate();
        reject(new Error(event.data.error));
        return;
      }
      clearTimeout(timer);
      worker.terminate();
      resolve(event.data as WasmSolution);
    };
    worker.onerror = (error: ErrorEvent) => {
      clearTimeout(timer);
      worker.terminate();
      reject(error.error || new Error(error.message));
    };
    worker.postMessage([randomData, difficulty]);
  });
}

function solveWithUserAgentSpoof(url: string, tabId: number | undefined): Promise<BrowserSolveResponse> {
  if (tabId === undefined) return Promise.reject(new Error('UA spoof requires a browser tab'));
  return new Promise((resolve, reject) => {
    const request: SpoofRequest = {
      url,
      userAgent: generateSpoofedUserAgent(),
      resolve,
      reject,
      timer: setTimeout(() => {
        spoofRequests.delete(tabId);
        reject(new Error('UA spoof navigation timed out'));
      }, 15_000),
    };
    spoofRequests.set(tabId, request);
    console.info('[Anubis Fast] trying one-shot User-Agent spoof', { tabId, url });
    browser.tabs.update(tabId, { url }).catch((error: unknown) => {
      clearTimeout(request.timer);
      spoofRequests.delete(tabId);
      reject(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

browser.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    if (details.type !== 'main_frame') return undefined;
    const request = spoofRequests.get(details.tabId);
    if (!request || request.url !== details.url) return undefined;
    spoofRequests.delete(details.tabId);
    clearTimeout(request.timer);
    const userAgentHeader = details.requestHeaders?.find((header) => header.name.toLowerCase() === 'user-agent');
    if (userAgentHeader) userAgentHeader.value = request.userAgent;
    else details.requestHeaders?.push({ name: 'User-Agent', value: request.userAgent });
    request.resolve({ ok: true, status: 200, backend: 'user-agent-spoof', userAgent: request.userAgent, browserNavigationUrl: request.url });
    return { requestHeaders: details.requestHeaders };
  },
  { urls: ['https://*/*'], types: ['main_frame'] },
  ['blocking', 'requestHeaders'],
);

function fallbackKey(tabId: number | undefined, url: string): string {
  return `${tabId}:${url}`;
}

function markJavaScriptFallback(key: string): void {
  browserFallbacks.set(key, 'javascript');
  setTimeout(() => {
    if (browserFallbacks.get(key) === 'javascript') browserFallbacks.delete(key);
  }, 30_000);
}

async function solveInBrowser(message: BackgroundChallengeMessage, tabId: number | undefined): Promise<BrowserSolveResponse> {
  const fields = challengeFields(message.challenge);
  if (fields.method !== 'fast' || !fields.id || !fields.randomData || fields.difficulty === undefined) {
    throw new Error('browser solver only supports complete Anubis fast challenges');
  }
  const started = performance.now();
  let solution: JavaScriptSolution | WasmSolution;
  const key = fallbackKey(tabId, message.url);
  const javascriptFallbackPending = browserFallbacks.get(key) === 'javascript';
  console.info('[Anubis Fast] browser solver started', { requestedBackend: solverMode, method: fields.method, difficulty: fields.difficulty, randomDataLength: fields.randomData.length });
  if (solverMode === 'javascript' || javascriptFallbackPending) {
    browserFallbacks.delete(key);
    solution = await solveJavaScript(fields.randomData, fields.difficulty);
  } else if (solverMode === 'spoof') {
    markJavaScriptFallback(key);
    try {
      return await solveWithUserAgentSpoof(message.url, tabId);
    } catch (error) {
      console.warn('[Anubis Fast] User-Agent spoof could not start; using JavaScript solver', error);
      browserFallbacks.delete(key);
      solution = await solveJavaScript(fields.randomData, fields.difficulty);
    }
  } else {
    try {
      solution = await solveWithWasm(fields.randomData, fields.difficulty);
    } catch (error) {
      console.warn('[Anubis Fast] WASM solver unavailable; trying User-Agent spoof', error);
      try {
        markJavaScriptFallback(key);
        return await solveWithUserAgentSpoof(message.url, tabId);
      } catch (spoofError) {
        console.warn('[Anubis Fast] User-Agent spoof did not clear the challenge; using JavaScript solver', spoofError);
        solution = await solveJavaScript(fields.randomData, fields.difficulty);
      }
    }
  }
  const elapsedTime = Math.max(1, Math.round(performance.now() - started));
  const endpoint = new URL(message.url);
  endpoint.pathname = `${fields.basePrefix.replace(/\/$/, '')}/.within.website/x/cmd/anubis/api/pass-challenge`;
  endpoint.search = new URLSearchParams({ id: fields.id, response: solution.digest, nonce: String(solution.nonce), redir: message.url, elapsedTime: String(elapsedTime) }).toString();
  console.info('[Anubis Fast] browser solver completed', { backend: solution.backend, difficulty: fields.difficulty, elapsedTime, nonce: solution.nonce });
  await browser.tabs.update(tabId as number, { url: endpoint.toString() });
  return { ok: true, status: 200, browserNavigationUrl: endpoint.toString(), backend: solution.backend };
}

console.info('[Anubis Fast] background script loaded', { extensionId: browser.runtime.id });
setSolverBadge();
browser.notifications.create({ type: 'basic', title: 'Anubis Fast loaded', message: `Extension reloaded at ${new Date().toLocaleTimeString()}`, iconUrl: browser.runtime.getURL('icon.svg') });

function connectHost(): browser.runtime.Port {
  if (host) return host;
  console.info('[Anubis Fast] connecting to native host', 'anubis_fast');
  host = browser.runtime.connectNative('anubis_fast');
  host.onMessage.addListener((rawMessage: object) => {
    const message = rawMessage as NativeResponse;
    console.info('[Anubis Fast] native message received', { type: message?.type, id: message?.id, ok: message?.ok, status: message?.status, cookieCount: message?.cookies?.length || 0, hasCookiesField: Array.isArray(message?.cookies), error: message?.error, protocol: message?.protocol, hostPath: message?.host_path, anubisFetch: message?.anubis_fetch });
    if (message?.type === 'ready') return;
    if (!message.id) return;
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    const response: NativeResponse = { ...message, url: entry.url, cookieStoreId: entry.cookieStoreId };
    installCookies(response).then(async () => {
      if (response.cookies?.length && entry.tabId !== undefined) await browser.tabs.update(entry.tabId, { url: entry.url });
      entry.resolve(response);
    }).catch((error: unknown) => entry.resolve({ ...response, ok: false, error: String(error) }));
  });
  host.onDisconnect.addListener(() => {
    const error = browser.runtime.lastError?.message || 'native host disconnected';
    console.error('[Anubis Fast] native host disconnected', error);
    host = undefined;
    for (const entry of pending.values()) {
      solveInBrowser(entry.request, entry.tabId).then((response) => entry.resolve(response)).catch((fallbackError: unknown) => entry.resolve({ ok: false, error: `${error}; browser fallback: ${fallbackError}` }));
    }
    pending.clear();
  });
  return host;
}

async function installCookies(message: NativeResponse): Promise<void> {
  if (!message.ok || !message.cookies?.length || !message.url) return;
  const cookieOptions = message.cookieStoreId ? { storeId: message.cookieStoreId } : {};
  const installed = await Promise.all(message.cookies.map((cookie) => browser.cookies.set({ url: message.url as string, ...cookieOptions, name: cookie.name, value: cookie.value, path: cookie.path || '/', ...(cookie.domain ? { domain: cookie.domain } : {}), ...(cookie.secure !== undefined ? { secure: cookie.secure } : {}), ...(cookie.httpOnly !== undefined ? { httpOnly: cookie.httpOnly } : {}), ...(cookie.sameSite ? { sameSite: cookie.sameSite } : {}) })));
  const visible = await browser.cookies.getAll({ url: message.url, ...cookieOptions });
  console.info('[Anubis Fast] installed native cookies', { requested: message.cookies.length, installed: installed.filter(Boolean).length, visible: visible.length, names: visible.map(({ name }) => name), cookieStoreId: message.cookieStoreId, url: message.url });
}

browser.runtime.onMessage.addListener(async (message: BackgroundChallengeMessage, sender) => {
  if (message?.type !== 'challenge') return undefined;
  const tabId = sender.tab?.id;
  if (tabId !== undefined) {
    const fields = challengeFields(message.challenge);
    browser.tabs.sendMessage(tabId, { type: 'solver-status', solver: solverMode, difficulty: fields.difficulty }).catch(() => {});
  }
  const id = crypto.randomUUID();
  const cookieStoreId = sender.tab?.cookieStoreId;
  const cookieOptions = cookieStoreId ? { storeId: cookieStoreId } : {};
  const cookies = await browser.cookies.getAll({ url: message.url, ...cookieOptions });
  const browserCookie = cookies.map(({ name, value }) => `${name}=${value}`).join('; ');
  const cookie = [browserCookie, message.pageCookie].filter(Boolean).join('; ');
  if (solverMode !== 'native') {
    try {
      return await solveInBrowser(message, tabId);
    } catch (error: unknown) {
      return { ok: false, error: String(error) };
    }
  }
  return new Promise<NativeResponse | BrowserSolveResponse>((resolve) => {
    pending.set(id, { resolve, url: message.url, tabId, cookieStoreId, request: message });
    try {
      connectHost().postMessage({ id, type: 'fetch', provider: message.provider, url: message.url, cookie, challenge: message.challenge ? JSON.stringify(message.challenge) : undefined, user_agent: message.userAgent });
    } catch (error: unknown) {
      pending.delete(id);
      resolve({ ok: false, error: String(error) });
    }
  });
});
