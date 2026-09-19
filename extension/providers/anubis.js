function detectAnubis() {
  return Boolean(
    document.querySelector('[data-anubis-challenge], #anubis_challenge') ||
    document.documentElement.innerHTML.includes('Anubis') &&
      location.pathname.includes('/.within.website/')
  );
}
