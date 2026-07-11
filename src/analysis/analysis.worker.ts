/// <reference lib="webworker" />
// Dedicated chord-analysis worker (separate from the separation worker).
// Pure compute: the orchestrator owns IndexedDB. Frames are processed in
// small batches with a cancel check between batches, so a cancel lands
// within tens of milliseconds.
import {
  ANALYSIS_SAMPLE_RATE,
  chromaFrame,
  decimate,
  DECIMATION,
  FFT_SIZE,
  HOP_SIZE,
  segmentsFromChromas,
  type ChordSegment,
  type FrameChroma,
} from "./chords.ts";

export type AnalysisRequest =
  | {
      type: "analyse";
      /** Mono 44.1kHz mix of the song. */
      mono: Float32Array;
    }
  | { type: "cancel" };

export type AnalysisResponse =
  | { type: "progress"; done: number; total: number }
  | { type: "done"; segments: ChordSegment[]; elapsedMs: number }
  | { type: "cancelled" }
  | { type: "error"; message: string };

const BATCH_FRAMES = 32;

let cancelRequested = false;

function post(msg: AnalysisResponse) {
  self.postMessage(msg);
}

const yieldToQueue = () => new Promise((r) => setTimeout(r, 0));

self.onmessage = async (e: MessageEvent<AnalysisRequest>) => {
  const msg = e.data;
  if (msg.type === "cancel") {
    cancelRequested = true;
    return;
  }
  cancelRequested = false;
  const started = performance.now();
  try {
    const mono = decimate(msg.mono, DECIMATION);
    const total = Math.max(
      0,
      Math.floor((mono.length - FFT_SIZE) / HOP_SIZE) + 1,
    );
    if (total === 0) {
      post({ type: "done", segments: [], elapsedMs: 0 });
      return;
    }

    const chromas: FrameChroma[] = [];
    for (let t = 0; t < total; t++) {
      chromas.push(
        chromaFrame(
          mono.subarray(t * HOP_SIZE, t * HOP_SIZE + FFT_SIZE),
          ANALYSIS_SAMPLE_RATE,
        ),
      );
      if ((t + 1) % BATCH_FRAMES === 0 || t + 1 === total) {
        post({ type: "progress", done: t + 1, total });
        await yieldToQueue(); // let a cancel message land
        if (cancelRequested) {
          post({ type: "cancelled" });
          return;
        }
      }
    }

    post({
      type: "done",
      segments: segmentsFromChromas(chromas),
      elapsedMs: Math.round(performance.now() - started),
    });
  } catch (err) {
    post({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
