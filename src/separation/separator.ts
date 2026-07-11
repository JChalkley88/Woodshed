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
  getSongState,
  getStems,
  listCachedSongs,
  putPartial,
  putSongState,
  putStems,
  type CachedSongSummary,
  type SongStateRecord,
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
export function isMockWorkerMode(): boolean {
  return new URLSearchParams(window.location.search).has("mockSeparation");
}

/** The worker stopped sending messages entirely: a hung session.run (GPU
 *  device loss) or a hung session create. A hung run can never be awaited,
 *  so the only safe recovery is terminating the worker process and
 *  resuming from persisted partials. */
class WorkerHungError extends Error {
  constructor(afterMs: number) {
    super(
      `the separation worker went silent for ${Math.round(afterMs / 1000)}s`,
    );
    this.name = "WorkerHungError";
  }
}

/** Inactivity floor. Generous by design: it must comfortably exceed a
 *  cold session create (up to ~120s on modest hardware) and the slowest
 *  observed CPU chunk (~35s); it stretches further once real chunk times
 *  are known. A spurious fire is safe (terminate, respawn, resume from
 *  partials) but costs a session re-create, so err high. Overridable via
 *  ?sepWatchdogMs= for tests. */
const WATCHDOG_FLOOR_MS = 240_000;

export class Separator {
  private state: SeparationState = initialState;
  private listeners = new Set<Listener>();
  private worker: Worker | null = null;
  private activeKey: string | null = null;
  /** The in-flight separation. Re-entrant separate() calls (a double
   *  click, resume racing a cancel acknowledgement) join this promise
   *  instead of starting a competing run; the worker serialises as a
   *  second line of defence. */
  private inFlight: Promise<SeparationOutcome | null> | null = null;
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
            name:
              mockMode === "wasm"
                ? "mock-wasm"
                : mockMode === "stall"
                  ? "mock-stall"
                  : "mock-webgpu",
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

  /** Cache-only lookup: hashes the content and returns previously
   *  separated stems, or null on a miss. Runs no worker and creates no
   *  session, so it is safe to call as a side effect of loading a song;
   *  actual separation only ever runs from the SEPARATE control. */
  async loadCached(
    channels: [Float32Array, Float32Array],
    fileName: string,
  ): Promise<SeparationOutcome | null> {
    this.set({ ...initialState, phase: "hashing", fileName });
    const key = await contentKey([channels[0], channels[1]]);
    this.activeKey = key;
    const cached = await getStems(key);
    if (!cached) {
      this.set({ phase: "idle" });
      return null;
    }
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

  /** Separates the given stereo 44.1kHz channels, consulting the cache and
   *  any resume partials first. Resolves null when cancelled. Idempotent
   *  while running: a second call joins the in-flight separation. */
  separate(
    channels: [Float32Array, Float32Array],
    fileName: string,
  ): Promise<SeparationOutcome | null> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.runSeparation(channels, fileName).finally(() => {
      // Whatever happened (done, cancelled, error), the next attempt must
      // start clean; the phase carries the outcome for the UI.
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async runSeparation(
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

    let partials = await getPartials(key);
    this.set({ phase: "warming", resumedChunks: partials.size });
    window.addEventListener("beforeunload", this.beforeUnload);

    try {
      let outcome: SeparationOutcome | null;
      // A hung worker (silent past the watchdog) is terminated and the run
      // resumes once from the chunks persisted so far; a second hang on
      // the same song is a real fault and surfaces as an error.
      for (let attempt = 0; ; attempt++) {
        try {
          outcome = await this.runWorker(channels, fileName, key, partials);
          break;
        } catch (err) {
          if (!(err instanceof WorkerHungError) || attempt >= 1) throw err;
          partials = await getPartials(key);
          this.set({ phase: "warming", resumedChunks: partials.size });
        }
      }
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

  private watchdogFloorMs(): number {
    const override = new URLSearchParams(window.location.search).get(
      "sepWatchdogMs",
    );
    const parsed = override ? Number(override) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : WATCHDOG_FLOOR_MS;
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

      // Inactivity watchdog: every worker message proves liveness. If the
      // worker goes silent past the deadline (hung session.run from GPU
      // device loss, or a hung create), terminate the whole worker: a
      // hung run can never be awaited, so recovery inside the worker
      // would race the session, which is exactly the "Session already
      // started" failure. The deadline stretches with measured chunk
      // times so slow hardware never trips it.
      const floorMs = this.watchdogFloorMs();
      let deadlineMs = floorMs;
      let watchdog: ReturnType<typeof setTimeout> | undefined;
      const stopWatchdog = () => clearTimeout(watchdog);
      const poke = () => {
        clearTimeout(watchdog);
        watchdog = setTimeout(() => {
          this.worker?.terminate();
          this.worker = null;
          // Let in-flight partial writes land so the resume skips every
          // chunk that actually completed.
          void Promise.all(pendingWrites).then(() =>
            reject(new WorkerHungError(deadlineMs)),
          );
        }, deadlineMs);
      };
      poke();

      worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const msg = e.data;
        poke();
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
            if (msg.avgChunkMs !== null) {
              deadlineMs = Math.max(floorMs, msg.avgChunkMs * 8);
            }
            this.set({
              phase: "separating",
              done: msg.done,
              total: msg.total,
              etaSeconds: msg.etaSeconds,
            });
            break;
          case "done":
            stopWatchdog();
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
            stopWatchdog();
            void Promise.all(pendingWrites).then(() => resolve(null));
            break;
          case "error":
            stopWatchdog();
            reject(new Error(msg.message));
            break;
        }
      };
      worker.onerror = (e) => {
        stopWatchdog();
        reject(new Error(`separation worker: ${e.message}`));
      };
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

  /** Stem rows for export, read fresh from the cache so nothing large
   *  stays resident between exports. Null when the song is not cached. */
  async getCachedRows(
    key: string,
  ): Promise<{ rows: Int16Array[]; totalSamples: number } | null> {
    const cached = await getStems(key);
    if (!cached) return null;
    return {
      rows: cached.rows.map((r) => new Int16Array(r)),
      totalSamples: cached.totalSamples,
    };
  }

  /* -------- Per-song practice state (scribbles, loops, mixer) -------- */
  getSongState = (key: string): Promise<SongStateRecord | undefined> =>
    getSongState(key);
  putSongState = (record: SongStateRecord): Promise<void> =>
    putSongState(record);

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
