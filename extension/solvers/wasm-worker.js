let readyResolve;
const ready = new Promise((resolve) => { readyResolve = resolve; });

importScripts('wasm_exec.js');

(async () => {
  const go = new Go();
  const response = await fetch('anubis-solver.wasm');
  const bytes = await response.arrayBuffer();
  const { instance } = await WebAssembly.instantiate(bytes, go.importObject);
  go.run(instance);
  const waitForExport = () => {
    if (typeof globalThis.anubisSolve === 'function') readyResolve();
    else setTimeout(waitForExport, 0);
  };
  waitForExport();
})().catch((error) => {
  self.postMessage({ type: 'error', error: String(error) });
});

self.onmessage = async (event) => {
  try {
    await ready;
    const [randomData, difficulty] = event.data;
    const result = globalThis.anubisSolve(randomData, difficulty);
    const [nonce, digest] = String(result).split(':');
    self.postMessage({ nonce: Number(nonce), digest, backend: 'wasm' });
  } catch (error) {
    self.postMessage({ type: 'error', error: String(error) });
  }
};
