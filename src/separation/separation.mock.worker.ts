/// <reference lib="webworker" />
// Scripted stand-in for the separation worker, used by Playwright flows
// (?mockSeparation=1, ?mockSeparation=wasm to exercise the fallback
// messaging, or ?mockSeparation=stall to hang after three chunks on a
// fresh run so the orchestrator's inactivity watchdog can be tested).
// Same message protocol, deterministic output, no ORT: stems are scaled
// copies of the input so the engine gets real playable audio.
import { float32ToInt16 } from "./chunking.ts";
import { N_CHANNELS, N_STEMS } from "./constants.ts";
import type { WorkerRequest, WorkerResponse } from "./separation.worker.ts";

const FAKE_CHUNKS = 8;
const CHUNK_MS = 250;
const STEM_SCALE = [0.7, 0.55, 0.4, 0.25];

let cancelRequested = false;

function post(msg: WorkerResponse, transfer: Transferable[] = []) {
  self.postMessage(msg, transfer);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function ep(): string {
  return self.name === "mock-wasm" ? "wasm" : "webgpu";
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  if (msg.type === "cancel") {
    cancelRequested = true;
    return;
  }
  if (msg.type === "warmup") {
    post({ type: "warming", message: "mock warmup" });
    await sleep(300);
    post({ type: "warm", ep: ep(), createMs: 300 });
    return;
  }
  if (msg.type === "separate") {
    cancelRequested = false;
    const started = performance.now();
    post({ type: "warming", message: "mock warmup" });
    await sleep(300);
    post({ type: "warm", ep: ep(), createMs: 300 });

    const skipped = new Set(msg.partials.map((p) => p.index));
    const times: number[] = [];
    for (let i = 0; i < FAKE_CHUNKS; i++) {
      if (cancelRequested) {
        post({ type: "cancelled", completedChunks: i });
        return;
      }
      // Stall mode: a fresh run (no partials, so not a watchdog resume)
      // goes silent after three completed chunks, simulating a hung
      // session.run. The worker stays alive; only the orchestrator's
      // inactivity watchdog can recover from here.
      if (self.name === "mock-stall" && skipped.size === 0 && i === 3) {
        return;
      }
      if (!skipped.has(i)) {
        await sleep(CHUNK_MS);
        times.push(CHUNK_MS);
        post(
          { type: "chunk", index: i, data: new ArrayBuffer(8), ms: CHUNK_MS },
          [],
        );
      }
      const remaining = [...Array(FAKE_CHUNKS - i - 1).keys()]
        .map((k) => k + i + 1)
        .filter((k) => !skipped.has(k)).length;
      post({
        type: "progress",
        done: i + 1,
        total: FAKE_CHUNKS,
        avgChunkMs: times.length ? CHUNK_MS : null,
        etaSeconds: times.length
          ? Math.round((remaining * CHUNK_MS) / 1000)
          : null,
      });
    }

    const totalSamples = msg.channels[0].length;
    const rows: ArrayBuffer[] = [];
    const stemRms: number[] = [];
    for (let s = 0; s < N_STEMS; s++) {
      let sum = 0;
      let count = 0;
      for (let c = 0; c < N_CHANNELS; c++) {
        const scaled = new Float32Array(totalSamples);
        const src = msg.channels[c];
        for (let i = 0; i < totalSamples; i++) scaled[i] = src[i] * STEM_SCALE[s];
        rows.push(float32ToInt16(scaled).buffer);
        for (let i = 0; i < totalSamples; i += 97) {
          sum += scaled[i] * scaled[i];
          count++;
        }
      }
      stemRms.push(Math.sqrt(sum / Math.max(1, count)));
    }
    post(
      {
        type: "done",
        rows,
        totalSamples,
        stemRms,
        reconstructionError: 0,
        ep: ep(),
        elapsedMs: Math.round(performance.now() - started),
      },
      rows,
    );
  }
};
