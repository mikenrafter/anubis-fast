// First-party browser fallback matching Anubis' fast verifier exactly:
// hex(sha256(randomData + decimal nonce)) must begin with difficulty zeroes.
async function solveJavaScript(randomData, difficulty) {
  const encoder = new TextEncoder();
  const prefix = '0'.repeat(difficulty);
  for (let nonce = 0; ; nonce++) {
    const bytes = await crypto.subtle.digest(
      'SHA-256',
      encoder.encode(`${randomData}${nonce}`),
    );
    const digest = Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, '0')).join('');
    if (digest.startsWith(prefix)) return { nonce, digest, backend: 'javascript' };
    if ((nonce & 0x3ff) === 0) await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
