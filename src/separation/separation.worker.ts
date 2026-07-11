/// <reference lib="webworker" />
// Production separation worker. Pure compute: session lifecycle plus
// chunked inference with incremental overlap-add. Storage (cache, resume
// partials) lives with the orchestrator on the main thread so this worker
// stays deterministic and mockable.
import {
  float32ToInt16,
  int16ToFloat32,
  OverlapAddAccumulator,
  planChunks,
  transitionWindow,
} from "./chunking.ts";
import {
  MODEL_URL,
  N_CHANNELS,
  N_STEMS,
  SEGMENT_SAMPLES,
} from "./constants.ts";
import { SerialQueue } from "./queue.ts";
import {
  createDemucsSession,
  runSegment,
  type DemucsSession,
} from "./session.ts";

export type WorkerRequest =
  | { type: "warmup" }
  | {
      type: "separate";
      /** Stereo 44.1kHz channel data (transferred). */
      channels: [Float32Array, Float32Array];
      /** Quantised outputs of chunks already completed in a previous run. */
      partials: { index: number; data: ArrayBuffer }[];
      fileName: string;
    }
  | { type: "cancel" };

export type WorkerResponse =
  | { type: "warming"; message: string }
  | { type: "warm"; ep: string; createMs: number }
  | {
      type: "chunk";
      index: number;
      /** Quantised model output for resume persistence (transferred). */
      data: ArrayBuffer;
      ms: number;
    }
  | {
      type: "progress";
      done: number;
      total: number;
      avgChunkMs: number | null;
      etaSeconds: number | null;
    }
  | {
      type: "done";
      rows: ArrayBuffer[];
      totalSamples: number;
      stemRms: number[];
      /** Relative L2 error of sum-of-stems vs the input mix (sampled). */
      reconstructionError: number;
      ep: string;
      elapsedMs: number;
    }
  | { type: "cancelled"; completedChunks: number }
  | { type: "error"; message: string };

let demucsPromise: Promise<DemucsSession> | null = null;
let cancelRequested = false;
/** Everything that touches the session runs through this queue: an ORT
 *  session cannot run two inferences at once ("Session already started"),
 *  and onmessage is async, so without serialisation a second separate
 *  request would interleave with a running loop on the same session. A
 *  request arriving mid-run therefore waits for the current run to finish
 *  or acknowledge its cancel, then starts clean. */
const sessionQueue = new SerialQueue();

function post(msg: WorkerResponse, transfer: Transferable[] = []) {
  self.postMessage(msg, transfer);
}

/** The session is created once per worker and survives songs and
 *  cancellations (brief: keep it alive for subsequent songs in the visit). */
function ensureSession(): Promise<DemucsSession> {
  if (!demucsPromise) {
    demucsPromise = createDemucsSession(MODEL_URL, (message) =>
      post({ type: "warming", message }),
    ).catch((err) => {
      demucsPromise = null; // allow retry on next request
      throw err;
    });
  }
  return demucsPromise;
}

/** Retries a failed chunk once on a fresh session.
 *
 *  Session-lifecycle audit (every create/release/recreate path):
 *  - ensureSession creates; a failed create nulls the promise (settled).
 *  - This function releases and recreates ONLY in its catch block, i.e.
 *    only after the failing run has SETTLED by rejecting. Tearing the
 *    session down under a still-pending run is forbidden: a new
 *    session.run alongside the old pending one is exactly the "Session
 *    already started" failure seen live.
 *  - The hang case (GPU device loss leaves session.run pending forever;
 *    observed on the Intel iGPU) therefore CANNOT be recovered inside
 *    this worker at all, because a hung run never settles and can never
 *    be awaited. The orchestrator owns it: an inactivity watchdog
 *    terminates the whole worker (process-level teardown, nothing left
 *    to race) and resumes from the persisted partials. This replaced the
 *    old in-worker Promise.race timeout, whose recovery raced the
 *    pending run and turned a recoverable stall at a slow chunk into a
 *    fatal error. */
async function runChunkWithRecovery(
  chunkBuf: Float32Array,
  chunkIndex: number,
): Promise<Float32Array> {
  for (let attempt = 0; ; attempt++) {
    const demucs = await ensureSession();
    try {
      return await runSegment(demucs, chunkBuf, SEGMENT_SAMPLES);
    } catch (err) {
      if (attempt >= 1) throw err;
      post({
        type: "warming",
        message: `chunk ${chunkIndex} failed (${err instanceof Error ? err.message : err}); recreating session and retrying`,
      });
      // Safe: the run above rejected, so the session is idle (or dead).
      try {
        await (await demucsPromise)?.session.release();
      } catch {
        // The dead session may refuse to release; discard it regardless.
      }
      demucsPromise = null;
    }
  }
}

async function separate(
  channels: [Float32Array, Float32Array],
  partials: Map<number, ArrayBuffer>,
  started: number,
): Promise<void> {
  const demucs = await ensureSession();
  post({ type: "warm", ep: demucs.ep, createMs: demucs.createMs });

  const totalSamples = channels[0].length;
  const plans = planChunks(totalSamples);
  const accumulator = new OverlapAddAccumulator(totalSamples);
  const chunkBuf = new Float32Array(N_CHANNELS * SEGMENT_SAMPLES);
  const chunkTimes: number[] = [];

  for (const plan of plans) {
    if (cancelRequested) {
      post({ type: "cancelled", completedChunks: plan.index });
      return;
    }
    const window = transitionWindow(
      plan.index === 0,
      plan.index === plans.length - 1,
    );
    const partial = partials.get(plan.index);
    let stems: Float32Array;
    if (partial) {
      stems = int16ToFloat32(new Int16Array(partial));
    } else {
      chunkBuf.fill(0);
      for (let c = 0; c < N_CHANNELS; c++) {
        chunkBuf
          .subarray(c * SEGMENT_SAMPLES, c * SEGMENT_SAMPLES + plan.copyLength)
          .set(channels[c].subarray(plan.start, plan.start + plan.copyLength));
      }
      const t0 = performance.now();
      const raw = await runChunkWithRecovery(chunkBuf, plan.index);
      const ms = performance.now() - t0;
      chunkTimes.push(ms);
      // Quantise once; the accumulator consumes the dequantised values so
      // fresh and resumed runs reconstruct identically, and the quantised
      // copy goes to the orchestrator for resume persistence.
      const quantised = float32ToInt16(raw);
      stems = int16ToFloat32(quantised);
      post(
        { type: "chunk", index: plan.index, data: quantised.buffer, ms },
        [quantised.buffer],
      );
    }
    accumulator.addChunk(plan, stems, window);

    const freshRemaining = plans
      .slice(plan.index + 1)
      .filter((p) => !partials.has(p.index)).length;
    const avg =
      chunkTimes.length > 0
        ? chunkTimes.reduce((a, b) => a + b, 0) / chunkTimes.length
        : null;
    post({
      type: "progress",
      done: plan.index + 1,
      total: plans.length,
      avgChunkMs: avg ? Math.round(avg) : null,
      etaSeconds: avg !== null ? Math.round((freshRemaining * avg) / 1000) : null,
    });
  }

  // Per-stem RMS over the finished output (sampled) for sanity and tests.
  const stemRms: number[] = [];
  for (let s = 0; s < N_STEMS; s++) {
    let sum = 0;
    let count = 0;
    for (let c = 0; c < N_CHANNELS; c++) {
      const row = accumulator.output[s * N_CHANNELS + c];
      for (let i = 0; i < row.length; i += 97) {
        const v = row[i] / 0x8000;
        sum += v * v;
        count++;
      }
    }
    stemRms.push(Math.sqrt(sum / Math.max(1, count)));
  }

  // Demucs is trained so stems sum back to the mix; measure it (sampled).
  let errSum = 0;
  let refSum = 0;
  for (let c = 0; c < N_CHANNELS; c++) {
    for (let i = 0; i < totalSamples; i += 61) {
      let stemSum = 0;
      for (let s = 0; s < N_STEMS; s++) {
        stemSum += accumulator.output[s * N_CHANNELS + c][i] / 0x8000;
      }
      const diff = stemSum - channels[c][i];
      errSum += diff * diff;
      refSum += channels[c][i] * channels[c][i];
    }
  }
  const reconstructionError =
    refSum > 0 ? Math.round(Math.sqrt(errSum / refSum) * 1e4) / 1e4 : 0;

  const rows = accumulator.output.map((r) => r.buffer);
  post(
    {
      type: "done",
      rows,
      totalSamples,
      stemRms,
      reconstructionError,
      // Recovery may have recreated the session (and possibly changed EP).
      ep: (await ensureSession()).ep,
      elapsedMs: Math.round(performance.now() - started),
    },
    rows,
  );
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  if (msg.type === "cancel") {
    // Cancels apply to the run in flight, so this must NOT queue: the
    // flag is read at the next chunk boundary.
    cancelRequested = true;
    return;
  }
  if (msg.type === "warmup") {
    void sessionQueue.run(async () => {
      try {
        const demucs = await ensureSession();
        post({ type: "warm", ep: demucs.ep, createMs: demucs.createMs });
      } catch (err) {
        post({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    });
    return;
  }
  if (msg.type === "separate") {
    // If a run is somehow still in flight (the orchestrator also guards),
    // cancel it so the queued run starts promptly rather than after the
    // whole previous song.
    if (sessionQueue.pending > 0) cancelRequested = true;
    void sessionQueue.run(async () => {
      cancelRequested = false; // reset only once the previous run has ended
      const started = performance.now();
      try {
        await separate(
          msg.channels,
          new Map(msg.partials.map((p) => [p.index, p.data])),
          started,
        );
      } catch (err) {
        post({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    });
  }
};
