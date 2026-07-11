// Main-thread chord-analysis orchestrator, mirroring the separator's
// pattern: cache lookup, worker lifecycle, cancel, progress state for the
// desk. The worker does pure compute; IndexedDB access happens here.
import {
  deleteChords,
  getChords,
  putChords,
} from "../separation/cache.ts";
import type { ChordSegment } from "./chords.ts";
import type { AnalysisRequest, AnalysisResponse } from "./analysis.worker.ts";

export type AnalysisPhase =
  | "idle"
  | "analysing"
  | "done"
  | "cancelled"
  | "error";

export interface AnalyserState {
  phase: AnalysisPhase;
  done: number;
  total: number;
  error: string | null;
  /** Segments for the currently loaded song, null before analysis. */
  segments: ChordSegment[] | null;
  fromCache: boolean;
  elapsedMs: number | null;
}

const initialState: AnalyserState = {
  phase: "idle",
  done: 0,
  total: 0,
  error: null,
  segments: null,
  fromCache: false,
  elapsedMs: null,
};

type Listener = () => void;

export class ChordAnalyser {
  private state: AnalyserState = initialState;
  private listeners = new Set<Listener>();
  private worker: Worker | null = null;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): AnalyserState => this.state;

  private set(partial: Partial<AnalyserState>) {
    this.state = { ...this.state, ...partial };
    for (const l of this.listeners) l();
  }

  /** Clears segments when a different song loads. */
  reset(): void {
    this.set({ ...initialState });
  }

  /** Cached segments for a song key, or null. Cheap; safe on load. */
  async loadCached(key: string): Promise<ChordSegment[] | null> {
    const cached = await getChords(key);
    if (!cached) return null;
    this.set({
      phase: "done",
      segments: cached.segments,
      fromCache: true,
      elapsedMs: 0,
    });
    return cached.segments;
  }

  /** Analyses a mono 44.1kHz mix. Runs only on user action; resolves null
   *  on cancel. The Float32Array is transferred, so pass a copy. */
  analyse(mono: Float32Array, key: string): Promise<ChordSegment[] | null> {
    if (!this.worker) {
      this.worker = new Worker(
        new URL("./analysis.worker.ts", import.meta.url),
        { type: "module" },
      );
    }
    const worker = this.worker;
    this.set({ ...initialState, phase: "analysing" });
    return new Promise((resolve) => {
      worker.onmessage = (e: MessageEvent<AnalysisResponse>) => {
        const msg = e.data;
        switch (msg.type) {
          case "progress":
            this.set({ done: msg.done, total: msg.total });
            break;
          case "done":
            void putChords({
              key,
              segments: msg.segments,
              createdAt: Date.now(),
            }).finally(() => {
              this.set({
                phase: "done",
                segments: msg.segments,
                elapsedMs: msg.elapsedMs,
              });
              resolve(msg.segments);
            });
            break;
          case "cancelled":
            this.set({ phase: "cancelled" });
            resolve(null);
            break;
          case "error":
            this.set({ phase: "error", error: msg.message });
            resolve(null);
            break;
        }
      };
      worker.onerror = (e) => {
        this.set({ phase: "error", error: e.message });
        resolve(null);
      };
      worker.postMessage(
        { type: "analyse", mono } satisfies AnalysisRequest,
        [mono.buffer],
      );
    });
  }

  cancel(): void {
    if (this.state.phase !== "analysing") return;
    this.worker?.postMessage({ type: "cancel" } satisfies AnalysisRequest);
  }

  purge = (key: string): Promise<void> => deleteChords(key);
}

export const analyser = new ChordAnalyser();
