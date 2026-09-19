/* global browser */
let host;
const pending = new Map();

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
      id: message?.id,
      ok: message?.ok,
      status: message?.status,
      cookieCount: message?.cookies?.length || 0,
      hasCookiesField: Array.isArray(message?.cookies),
      error: message?.error,
    });
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    const response = { ...message, url: entry.url };
    installCookies(response).then(() => entry.resolve(response)).catch((error) => {
      console.error('[Anubis Fast] unable to install native cookies', error);
      entry.resolve({ ...response, ok: false, error: String(error) });
    });
  });

  host.onDisconnect.addListener(() => {
    const error = browser.runtime.lastError?.message || 'native host disconnected';
    console.error('[Anubis Fast] native host disconnected', error);
    host = undefined;
    for (const entry of pending.values()) entry.resolve({ ok: false, error });
    pending.clear();
  });
  return host;
}

async function installCookies(message) {
  if (!message?.ok || !Array.isArray(message.cookies) || message.cookies.length === 0) return;
  const url = message.url;
  await Promise.all(message.cookies.map((cookie) => browser.cookies.set({
    url,
    name: cookie.name,
    value: cookie.value,
    path: cookie.path || '/',
    ...(cookie.domain ? { domain: cookie.domain } : {}),
    ...(cookie.secure !== undefined ? { secure: cookie.secure } : {}),
    ...(cookie.httpOnly !== undefined ? { httpOnly: cookie.httpOnly } : {}),
    ...(cookie.sameSite ? { sameSite: cookie.sameSite } : {}),
  })));
  console.info('[Anubis Fast] installed native cookies', {
    count: message.cookies.length,
    url,
  });
}

browser.runtime.onMessage.addListener(async (message) => {
  if (message?.type !== 'challenge') return undefined;
  console.info('[Anubis Fast] challenge request received', {
    provider: message.provider,
    url: message.url,
  });
  const id = crypto.randomUUID();
  const cookies = await browser.cookies.getAll({ url: message.url });
  const cookie = cookies.map(({ name, value }) => `${name}=${value}`).join('; ');
  console.info('[Anubis Fast] collected cookies', {
    count: cookies.length,
    headerLength: cookie.length,
  });
  return new Promise((resolve) => {
    pending.set(id, { resolve, url: message.url });
    try {
      connectHost().postMessage({
        id,
        type: 'fetch',
        provider: message.provider,
        url: message.url,
        cookie,
      });
      console.info('[Anubis Fast] request sent to native host', { id });
    } catch (error) {
      pending.delete(id);
      console.error('[Anubis Fast] unable to send native request', error);
      resolve({ ok: false, error: String(error) });
    }
  });
});
