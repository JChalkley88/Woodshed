// Main-thread separation orchestrator: content hashing, cache lookup,
// worker lifecycle, resume-partial persistence, cancel, and progress state
// for the desk LCDs. The worker does pure compute; all IndexedDB access
// happens here.
import {
  cacheSizeBytes,
  clearPartials,
  contentKey,
  deleteStems,
  getPartials,
  getStems,
  listCachedSongs,
  putPartial,
  putStems,
  type CachedSongSummary,
} from "./cache.ts";
import { SAMPLE_RATE } from "./constants.ts";
import type { WorkerRequest, WorkerResponse } from "./separation.worker.ts";

export type SeparationPhase =
  | "idle"
  | "hashing"
  | "warming"
  | "separating"
  | "cancelled"
  | "done"
  | "error";

export interface SeparationState {
  phase: SeparationPhase;
  fileName: string | null;
  done: number;
  total: number;
  etaSeconds: number | null;
  /** Which EP actually ran; null until the session is warm. */
  ep: string | null;
  /** True when WebGPU was unavailable or failed and WASM took over. */
  wasmFallback: boolean;
  error: string | null;
  fromCache: boolean;
  elapsedMs: number | null;
  /** Chunks recovered from a previous cancelled/crashed run. */
  resumedChunks: number;
}

export interface SeparationOutcome {
  key: string;
  rows: Int16Array[];
  totalSamples: number;
  stemRms: number[];
  reconstructionError: number | null;
  ep: string;
  fromCache: boolean;
  elapsedMs: number | null;
}

const initialState: SeparationState = {
  phase: "idle",
  fileName: null,
  done: 0,
  total: 0,
  etaSeconds: null,
  ep: null,
  wasmFallback: false,
  error: null,
  fromCache: false,
  elapsedMs: null,
  resumedChunks: 0,
};

type Listener = () => void;

/** True when Playwright drives the flow against the scripted mock worker. */
function isMockWorkerMode(): boolean {
  return new URLSearchParams(window.location.search).has("mockSeparation");
}

export class Separator {
  private state: SeparationState = initialState;
  private listeners = new Set<Listener>();
  private worker: Worker | null = null;
  private activeKey: string | null = null;
  private beforeUnload = (e: BeforeUnloadEvent) => {
    e.preventDefault();
  };

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): SeparationState => this.state;

  private set(partial: Partial<SeparationState>) {
    this.state = { ...this.state, ...partial };
    for (const l of this.listeners) l();
  }

  /** The worker (and its warm session) survives songs and cancellations. */
  private ensureWorker(): Worker {
    if (!this.worker) {
      const mockMode = new URLSearchParams(window.location.search).get(
        "mockSeparation",
      );
      this.worker = isMockWorkerMode()
        ? new Worker(new URL("./separation.mock.worker.ts", import.meta.url), {
            type: "module",
            name: mockMode === "wasm" ? "mock-wasm" : "mock-webgpu",
          })
        : new Worker(new URL("./separation.worker.ts", import.meta.url), {
            type: "module",
          });
    }
    return this.worker;
  }

  /** Warm the session ahead of need (first load of a session). */
  warmup(): void {
    const worker = this.ensureWorker();
    worker.postMessage({ type: "warmup" } satisfies WorkerRequest);
  }

  /** Separates the given stereo 44.1kHz channels, consulting the cache and
   *  any resume partials first. Resolves null when cancelled. */
  async separate(
    channels: [Float32Array, Float32Array],
    fileName: string,
  ): Promise<SeparationOutcome | null> {
    this.set({
      ...initialState,
      phase: "hashing",
      fileName,
    });
    const key = await contentKey([channels[0], channels[1]]);
    this.activeKey = key;

    const cached = await getStems(key);
    if (cached) {
      this.set({ phase: "done", fromCache: true, elapsedMs: 0 });
      return {
        key,
        rows: cached.rows.map((r) => new Int16Array(r)),
        totalSamples: cached.totalSamples,
        stemRms: cached.stemRms,
        reconstructionError: null,
        ep: cached.ep,
        fromCache: true,
        elapsedMs: 0,
      };
    }

    const partials = await getPartials(key);
    this.set({ phase: "warming", resumedChunks: partials.size });
    window.addEventListener("beforeunload", this.beforeUnload);

    try {
      const outcome = await this.runWorker(channels, fileName, key, partials);
      if (outcome) {
        await putStems({
          key,
          name: fileName,
          duration: outcome.totalSamples / SAMPLE_RATE,
          totalSamples: outcome.totalSamples,
          stemRms: outcome.stemRms,
          ep: outcome.ep,
          createdAt: Date.now(),
          rows: outcome.rows.map((r) => r.buffer as ArrayBuffer),
        });
        await clearPartials(key);
        this.set({ phase: "done" });
        // The rows were consumed by the cache write; hand out fresh views.
        return outcome;
      }
      this.set({ phase: "cancelled" });
      return null;
    } catch (err) {
      this.set({
        phase: "error",
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    } finally {
      window.removeEventListener("beforeunload", this.beforeUnload);
    }
  }

  private runWorker(
    channels: [Float32Array, Float32Array],
    fileName: string,
    key: string,
    partials: Map<number, ArrayBuffer>,
  ): Promise<SeparationOutcome | null> {
    const worker = this.ensureWorker();
    return new Promise((resolve, reject) => {
      const pendingWrites: Promise<void>[] = [];
      worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const msg = e.data;
        switch (msg.type) {
          case "warming":
            this.set({ phase: "warming" });
            break;
          case "warm":
            this.set({
              ep: msg.ep,
              wasmFallback: msg.ep === "wasm",
              phase: "separating",
            });
            break;
          case "chunk":
            // Persist incrementally so a crash or cancel resumes here.
            pendingWrites.push(
              putPartial(key, msg.index, msg.data).catch(() => {}),
            );
            break;
          case "progress":
            this.set({
              phase: "separating",
              done: msg.done,
              total: msg.total,
              etaSeconds: msg.etaSeconds,
            });
            break;
          case "done":
            void Promise.all(pendingWrites).then(() => {
              this.set({ elapsedMs: msg.elapsedMs });
              resolve({
                key,
                rows: msg.rows.map((r) => new Int16Array(r)),
                totalSamples: msg.totalSamples,
                stemRms: msg.stemRms,
                reconstructionError: msg.reconstructionError,
                ep: msg.ep,
                fromCache: false,
                elapsedMs: msg.elapsedMs,
              });
            });
            break;
          case "cancelled":
            void Promise.all(pendingWrites).then(() => resolve(null));
            break;
          case "error":
            reject(new Error(msg.message));
            break;
        }
      };
      worker.onerror = (e) => reject(new Error(`separation worker: ${e.message}`));
      // Copies are transferred so the caller keeps its channel data (a
      // cancelled run must be resumable with the same input).
      const copies: [Float32Array, Float32Array] = [
        channels[0].slice(),
        channels[1].slice(),
      ];
      worker.postMessage(
        {
          type: "separate",
          channels: copies,
          fileName,
          partials: [...partials.entries()].map(([index, data]) => ({
            index,
            data,
          })),
        } satisfies WorkerRequest,
        [copies[0].buffer, copies[1].buffer],
      );
    });
  }

  /** Abort between chunks; completed chunks stay persisted for resume and
   *  the warm session survives. */
  cancel(): void {
    if (this.state.phase !== "separating" && this.state.phase !== "warming")
      return;
    this.worker?.postMessage({ type: "cancel" } satisfies WorkerRequest);
  }

  /* -------- Cache surface for the settings rack -------- */
  listCachedSongs = (): Promise<CachedSongSummary[]> => listCachedSongs();
  cacheSizeBytes = (): Promise<number> => cacheSizeBytes();
  purgeSong = async (key: string): Promise<void> => {
    await deleteStems(key);
    await clearPartials(key);
  };
  get currentKey(): string | null {
    return this.activeKey;
  }
}

export const separator = new Separator();
