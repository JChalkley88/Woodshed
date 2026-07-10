// The working ORT session recipe from the Night 1 daylight gate (STATE.md,
// "Daylight gate results"). Non-negotiable parts: create with numThreads=1
// and graph optimisation DISABLED, model loaded by URL never bytes (any
// other combination hangs forever or throws std::bad_alloc on 1.27.0);
// raise numThreads after creation for WASM inference (the thread pool
// initialises lazily). Extracted from the Night 1 spike worker.
import * as ort from "onnxruntime-web";

ort.env.wasm.wasmPaths = "/ort/";

export type ExecutionProvider = "webgpu" | "wasm";

export interface DemucsSession {
  session: ort.InferenceSession;
  /** Which EP actually ran (webgpu attempted first when available). */
  ep: ExecutionProvider;
  createMs: number;
}

const CREATE_TIMEOUT_MS = 120_000;

async function createWithEp(
  modelUrl: string,
  ep: ExecutionProvider,
): Promise<ort.InferenceSession> {
  ort.env.wasm.numThreads = 1;
  return Promise.race([
    ort.InferenceSession.create(modelUrl, {
      executionProviders: [ep],
      graphOptimizationLevel: "disabled",
    }),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`session creation timeout (${ep})`)),
        CREATE_TIMEOUT_MS,
      ),
    ),
  ]);
}

/** Creates the demucs session: WebGPU first when the adapter exists, WASM
 *  otherwise or on WebGPU failure, so the EP that actually runs is always
 *  known (the brief requires recording it and messaging the fallback). */
export async function createDemucsSession(
  modelUrl: string,
  onProgress?: (message: string) => void,
): Promise<DemucsSession> {
  const t0 = performance.now();
  if (navigator.gpu && (await navigator.gpu.requestAdapter().catch(() => null))) {
    try {
      onProgress?.("creating session on WebGPU...");
      const session = await createWithEp(modelUrl, "webgpu");
      return { session, ep: "webgpu", createMs: Math.round(performance.now() - t0) };
    } catch (err) {
      onProgress?.(
        `WebGPU session failed (${err instanceof Error ? err.message : err}); falling back to WASM`,
      );
    }
  } else {
    onProgress?.("no WebGPU adapter; using WASM");
  }
  const tWasm = performance.now();
  const session = await createWithEp(modelUrl, "wasm");
  // Thread-raise recipe: safe only after creation.
  ort.env.wasm.numThreads = Math.min(4, navigator.hardwareConcurrency ?? 1);
  return { session, ep: "wasm", createMs: Math.round(performance.now() - tWasm) };
}

/** Runs one canonical segment through the session. `chunk` is
 *  [1, 2, SEGMENT_SAMPLES] flattened; returns the [1, 4, 2, SEGMENT_SAMPLES]
 *  output flattened. */
export async function runSegment(
  demucs: DemucsSession,
  chunk: Float32Array,
  segmentSamples: number,
): Promise<Float32Array> {
  const { session } = demucs;
  const tensor = new ort.Tensor("float32", chunk, [1, 2, segmentSamples]);
  const result = await session.run({ [session.inputNames[0]]: tensor });
  const output = result[session.outputNames[0]];
  const data = output.data as Float32Array;
  // Copy out and release the ORT-owned tensor immediately (memory
  // discipline: never hold more than the working set).
  const copy = data.slice();
  output.dispose();
  return copy;
}
