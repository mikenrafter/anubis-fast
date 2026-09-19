function detectAnubis() {
  return Boolean(
    document.querySelector('[data-anubis-challenge], #anubis_challenge') ||
    document.documentElement?.innerHTML.includes('Anubis') &&
      location.pathname.includes('/.within.website/')
  );
}

function getChallenge() {
  const script = document.querySelector('#anubis_challenge');
  if (!script?.textContent) return undefined;
  try {
    return JSON.parse(script.textContent);
  } catch (error) {
    console.warn('[Anubis Fast] unable to parse Anubis challenge JSON', error);
    return undefined;
  }
}
