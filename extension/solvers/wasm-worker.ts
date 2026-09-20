interface WasmSolutionMessage {
  type?: 'error';
  error?: string;
  nonce?: number;
  digest?: string;
  backend?: 'wasm';
}

declare function importScripts(...urls: string[]): void;
declare class Go {
  importObject: WebAssembly.Imports;
  run(instance: WebAssembly.Instance): Promise<void>;
}

const workerScope = globalThis as unknown as DedicatedWorkerGlobalScope & {
  anubisSolve?: (randomData: string, difficulty: number) => string;
};

let readyResolve: (() => void) | undefined;
const ready = new Promise<void>((resolve) => { readyResolve = resolve; });

importScripts('wasm_exec.js');

(async (): Promise<void> => {
  const go = new Go();
  const response = await fetch('anubis-solver.wasm');
  const bytes = await response.arrayBuffer();
  const { instance } = await WebAssembly.instantiate(bytes, go.importObject);
  void go.run(instance);
  const waitForExport = (): void => {
    if (typeof workerScope.anubisSolve === 'function') readyResolve?.();
    else setTimeout(waitForExport, 0);
  };
  waitForExport();
})().catch((error: unknown) => {
  workerScope.postMessage({ type: 'error', error: String(error) } satisfies WasmSolutionMessage);
});

workerScope.onmessage = async (event: MessageEvent<[string, number]>): Promise<void> => {
  try {
    await ready;
    const [randomData, difficulty] = event.data;
    const result = workerScope.anubisSolve?.(randomData, difficulty);
    if (!result) throw new Error('WASM solver export is unavailable');
    const [nonce, digest] = result.split(':');
    workerScope.postMessage({ nonce: Number(nonce), digest, backend: 'wasm' } satisfies WasmSolutionMessage);
  } catch (error: unknown) {
    workerScope.postMessage({ type: 'error', error: String(error) } satisfies WasmSolutionMessage);
  }
};
