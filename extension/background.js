/* global browser */
const host = browser.runtime.connectNative('anubis_fast');
const pending = new Map();

host.onMessage.addListener((message) => {
  const resolve = pending.get(message.id);
  if (!resolve) return;
  pending.delete(message.id);
  resolve(message);
});

host.onDisconnect.addListener(() => {
  for (const resolve of pending.values()) resolve({ ok: false });
  pending.clear();
});

browser.runtime.onMessage.addListener(async (message) => {
  if (message?.type !== 'challenge') return undefined;
  const id = crypto.randomUUID();
  const cookies = await browser.cookies.getAll({ url: message.url });
  const cookie = cookies.map(({ name, value }) => `${name}=${value}`).join('; ');
  return new Promise((resolve) => {
    pending.set(id, resolve);
    host.postMessage({
      id,
      type: 'fetch',
      provider: message.provider,
      url: message.url,
      cookie,
    });
  });
});
