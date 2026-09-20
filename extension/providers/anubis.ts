interface AnubisChallenge {
  challenge?: AnubisChallengeFields;
  rules?: { algorithm?: string; difficulty?: number };
  id?: string;
  method?: string;
  randomData?: string;
  difficulty?: number;
  basePrefix?: string;
}

interface AnubisChallengeFields {
  id?: string;
  method?: string;
  randomData?: string;
  difficulty?: number;
}

function detectAnubis(): boolean {
  return Boolean(
    document.querySelector('[data-anubis-challenge], #anubis_challenge') ||
    (document.documentElement?.innerHTML.includes('Anubis') &&
      location.pathname.includes('/.within.website/')),
  );
}

function getChallenge(): AnubisChallenge | undefined {
  const script = document.querySelector('#anubis_challenge');
  if (!script?.textContent) return undefined;
  try {
    const challenge = JSON.parse(script.textContent) as AnubisChallenge;
    const metadata = document.querySelector('#anubis_base_prefix');
    if (metadata?.textContent) challenge.basePrefix = JSON.parse(metadata.textContent) as string;
    return challenge;
  } catch (error) {
    console.warn('[Anubis Fast] unable to parse Anubis challenge JSON', error);
    return undefined;
  }
}
