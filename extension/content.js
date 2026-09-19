/* global browser */

if (!window.__anubisFastHandled && detectAnubis()) {
  window.__anubisFastHandled = true;
  browser.runtime.sendMessage({
    type: 'challenge',
    provider: 'anubis',
    url: new URL(window.location.href).searchParams.get('redir') || window.location.href,
  }).then((response) => {
    if (!response || !response.ok || !response.body) return;
    const decoded = atob(response.body);
    const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
    const html = new TextDecoder().decode(bytes);
    document.open();
    document.write(html);
    document.close();
  }).catch(() => {
    window.__anubisFastHandled = false;
  });
}
