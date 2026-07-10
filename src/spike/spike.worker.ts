/// <reference lib="webworker" />
// Night 1 separation feasibility spike. Loads a Demucs ONNX model and times
// inference on one audio chunk for a requested execution-provider list.
// Session setup, preprocessing, and chunk shapes follow
// woodshed-reference/demo.js (the working demucs-onnx browser demo).
import * as ort from "onnxruntime-web";

// Amendment 2 to the reference config: ORT runtime files are served locally
// from /ort (copied out of node_modules by vite.config.ts), never a CDN, so
// everything works offline.
ort.env.wasm.wasmPaths = "/ort/";
ort.env.wasm.numThreads = Math.min(navigator.hardwareConcurrency ?? 4, 8);

const SAMPLE_RATE = 44100; // demucs ONNX graph is hard-bound to 44.1kHz
// Canonical demucs segment from the reference demo: 7.8s = 343,980 samples.
const REFERENCE_SEGMENT = 343980;
// The brief asks for a 10 second chunk; we try it first and fall back to the
// canonical segment if the graph turns out to be shape-bound.
const TEN_SECONDS = 10 * SAMPLE_RATE;
const N_CHANNELS = 2;
const N_STEMS = 4;
const ITERATIONS = 3;

export interface SpikeRequest {
  label: string;
  modelUrl: string;
  eps: ("webgpu" | "wasm")[];
}

export interface SpikeResult {
  label: string;
  modelUrl: string;
  eps: string[];
  ok: boolean;
  error?: string;
  chunkSamples?: number;
  chunkSeconds?: number;
  usedFallbackSegment?: boolean;
  modelFetchMs?: number;
  sessionCreateMs?: number;
  /** Per-iteration inference wall time; iteration 1 includes shader/pipeline
   *  compilation on WebGPU. */
  inferenceMs?: number[];
  steadyStateMs?: number;
  msPerAudioSecond?: number;
  heapUsedBeforeMB?: number | null;
  heapUsedAfterMB?: number | null;
  sanity?: {
    outputDims: number[];
    finite: boolean;
    stemRms: number[];
    /** Relative L2 error of sum-of-stems vs input mix. */
    reconstructionError: number;
  };
}

interface PerformanceWithMemory extends Performance {
  memory?: { usedJSHeapSize: number };
}

function heapMB(): number | null {
  const mem = (performance as PerformanceWithMemory).memory;
  return mem ? Math.round(mem.usedJSHeapSize / 1048576) : null;
}

/** Deterministic 10s test signal: a small band (bass line, chord tones,
 *  hat-like noise bursts) so all four stems have something to find. */
function makeTestChunk(samples: number): Float32Array {
  const data = new Float32Array(N_CHANNELS * samples);
  for (let c = 0; c < N_CHANNELS; c++) {
    let noiseState = 22222 + c;
    const rnd = () => {
      noiseState = (noiseState * 16807) % 2147483647;
      return noiseState / 2147483647 - 0.5;
    };
    for (let i = 0; i < samples; i++) {
      const t = i / SAMPLE_RATE;
      const beat = t * 2; // 120bpm
      const bass = 0.3 * Math.sin(2 * Math.PI * 55 * t) * (0.5 + 0.5 * Math.sin(2 * Math.PI * beat));
      const chord =
        0.12 * Math.sin(2 * Math.PI * 220 * t) +
        0.1 * Math.sin(2 * Math.PI * 277.18 * t) +
        0.08 * Math.sin(2 * Math.PI * 329.63 * t);
      const hatGate = beat % 1 < 0.08 ? 1 : 0;
      const hat = 0.15 * rnd() * hatGate;
      const melody = 0.1 * Math.sin(2 * Math.PI * (440 + 40 * Math.sin(2 * Math.PI * 0.25 * t)) * t);
      data[c * samples + i] = bass + chord + hat + melody;
    }
  }
  return data;
}

async function runOnce(
  session: ort.InferenceSession,
  chunk: Float32Array,
  samples: number,
): Promise<{ ms: number; output: ort.Tensor }> {
  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  const tensor = new ort.Tensor("float32", chunk, [1, N_CHANNELS, samples]);
  const t0 = performance.now();
  const result = await session.run({ [inputName]: tensor });
  const ms = performance.now() - t0;
  return { ms, output: result[outputName] };
}

function sanityCheck(
  output: ort.Tensor,
  input: Float32Array,
  samples: number,
): NonNullable<SpikeResult["sanity"]> {
  const dims = [...output.dims];
  const data = output.data as Float32Array;
  let finite = true;
  for (let i = 0; i < data.length; i += 997) {
    if (!Number.isFinite(data[i])) {
      finite = false;
      break;
    }
  }
  const stemRms: number[] = [];
  const perStem = N_CHANNELS * samples;
  for (let s = 0; s < N_STEMS; s++) {
    let sum = 0;
    const base = s * perStem;
    for (let i = 0; i < perStem; i += 13) sum += data[base + i] * data[base + i];
    stemRms.push(Math.sqrt(sum / Math.ceil(perStem / 13)));
  }
  // Demucs is trained so the stems sum back to the mix.
  let errSum = 0;
  let refSum = 0;
  for (let i = 0; i < N_CHANNELS * samples; i += 7) {
    let stemSum = 0;
    for (let s = 0; s < N_STEMS; s++) stemSum += data[s * perStem + i];
    const diff = stemSum - input[i];
    errSum += diff * diff;
    refSum += input[i] * input[i];
  }
  return {
    outputDims: dims,
    finite,
    stemRms: stemRms.map((v) => Math.round(v * 1e5) / 1e5),
    reconstructionError:
      refSum > 0 ? Math.round(Math.sqrt(errSum / refSum) * 1e4) / 1e4 : NaN,
  };
}

async function runSpike(req: SpikeRequest): Promise<SpikeResult> {
  const result: SpikeResult = {
    label: req.label,
    modelUrl: req.modelUrl,
    eps: req.eps,
    ok: false,
  };
  try {
    result.heapUsedBeforeMB = heapMB();
    post("progress", `${req.label}: fetching model...`);
    const tFetch = performance.now();
    const modelBytes = new Uint8Array(
      await (await fetch(req.modelUrl)).arrayBuffer(),
    );
    result.modelFetchMs = Math.round(performance.now() - tFetch);

    post("progress", `${req.label}: creating session (${req.eps.join(",")})...`);
    const tCreate = performance.now();
    const session = await ort.InferenceSession.create(modelBytes, {
      executionProviders: req.eps,
      graphOptimizationLevel: "all",
    });
    result.sessionCreateMs = Math.round(performance.now() - tCreate);

    let samples = TEN_SECONDS;
    let chunk = makeTestChunk(samples);
    result.inferenceMs = [];
    let lastOutput: ort.Tensor | null = null;
    for (let i = 0; i < ITERATIONS; i++) {
      post("progress", `${req.label}: inference ${i + 1}/${ITERATIONS} (${(samples / SAMPLE_RATE).toFixed(1)}s chunk)...`);
      try {
        const { ms, output } = await runOnce(session, chunk, samples);
        result.inferenceMs.push(Math.round(ms));
        lastOutput = output;
      } catch (err) {
        if (i === 0 && samples !== REFERENCE_SEGMENT) {
          // Graph may be bound to the canonical segment length; retry.
          post("progress", `${req.label}: 10s chunk rejected, retrying with 7.8s canonical segment`);
          samples = REFERENCE_SEGMENT;
          chunk = makeTestChunk(samples);
          result.usedFallbackSegment = true;
          i = -1; // restart iterations
          result.inferenceMs = [];
          continue;
        }
        throw err;
      }
    }
    result.chunkSamples = samples;
    result.chunkSeconds = Math.round((samples / SAMPLE_RATE) * 100) / 100;
    const steady = result.inferenceMs.slice(1);
    result.steadyStateMs = Math.round(
      steady.reduce((a, b) => a + b, 0) / steady.length,
    );
    result.msPerAudioSecond = Math.round(
      result.steadyStateMs / (samples / SAMPLE_RATE),
    );
    if (lastOutput) result.sanity = sanityCheck(lastOutput, chunk, samples);
    result.heapUsedAfterMB = heapMB();
    await session.release();
    result.ok = true;
  } catch (err) {
    result.error = err instanceof Error ? `${err.message}` : String(err);
  }
  return result;
}

function post(type: string, payload: unknown) {
  self.postMessage({ type, payload });
}

self.onmessage = async (e: MessageEvent<SpikeRequest>) => {
  const result = await runSpike(e.data);
  post("result", result);
};
