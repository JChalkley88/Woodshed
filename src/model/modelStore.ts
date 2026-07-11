// First-download manager for the separation model: streams the 166MB file
// with progress, verifies its SHA-256, and stores it in Cache Storage so
// the separation worker's own fetch of MODEL_URL (ORT must load by URL,
// never bytes; Night 1 recipe) is served locally by the service worker
// from then on, online or off.
//
// Cache Storage is used here rather than IndexedDB because the service
// worker answers fetch events from it directly; this is the PWA-legitimate
// storage the brief anticipates.
import {
  MODEL_BYTES,
  MODEL_SHA256,
  MODEL_URL,
} from "../separation/constants.ts";

export const MODEL_CACHE_NAME = "woodshed-model-v1";

export type ModelPhase = "unknown" | "absent" | "downloading" | "ready" | "error";

export interface ModelState {
  phase: ModelPhase;
  /** Bytes received so far while downloading. */
  received: number;
  totalBytes: number;
  error: string | null;
}

type Listener = () => void;

function toHex(digest: ArrayBuffer): string {
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export class ModelStore {
  private state: ModelState = {
    phase: "unknown",
    received: 0,
    totalBytes: MODEL_BYTES,
    error: null,
  };
  private listeners = new Set<Listener>();
  private ensurePromise: Promise<boolean> | null = null;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): ModelState => this.state;

  private set(partial: Partial<ModelState>) {
    this.state = { ...this.state, ...partial };
    for (const l of this.listeners) l();
  }

  /** True when the model is already in Cache Storage. Cheap; safe on
   *  load for status display. */
  async probe(): Promise<boolean> {
    if (!("caches" in self)) {
      this.set({ phase: "absent" });
      return false;
    }
    const cache = await caches.open(MODEL_CACHE_NAME);
    const hit = await cache.match(MODEL_URL);
    this.set({ phase: hit ? "ready" : "absent" });
    return Boolean(hit);
  }

  /** Ensures the model is cached locally, downloading with progress and a
   *  hash check on first use. Resolves true when the model is ready.
   *  Concurrent callers share one download. */
  ensure(): Promise<boolean> {
    if (!this.ensurePromise) {
      this.ensurePromise = this.download().catch((err) => {
        this.set({
          phase: "error",
          error: err instanceof Error ? err.message : String(err),
        });
        return false;
      });
      // A failed attempt must be retryable on the next press.
      void this.ensurePromise.then((ok) => {
        if (!ok) this.ensurePromise = null;
      });
    }
    return this.ensurePromise;
  }

  private async download(): Promise<boolean> {
    if (!("caches" in self)) {
      // No Cache Storage (very old browser): ORT will stream the URL
      // directly; separation still works online, just not offline.
      this.set({ phase: "ready" });
      return true;
    }
    const cache = await caches.open(MODEL_CACHE_NAME);
    if (await cache.match(MODEL_URL)) {
      this.set({ phase: "ready" });
      return true;
    }

    this.set({ phase: "downloading", received: 0, error: null });
    const response = await fetch(MODEL_URL);
    if (!response.ok || !response.body) {
      throw new Error(`model download failed (HTTP ${response.status})`);
    }
    const totalBytes =
      Number(response.headers.get("Content-Length")) || MODEL_BYTES;
    this.set({ totalBytes });

    // Stream into one pre-sized buffer so peak memory is the file itself.
    const bytes = new Uint8Array(totalBytes);
    let received = 0;
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (received + value.length > bytes.length) {
        throw new Error("model download larger than expected; refusing it");
      }
      bytes.set(value, received);
      received += value.length;
      this.set({ received });
    }
    if (received !== totalBytes) {
      throw new Error(
        `model download incomplete (${received} of ${totalBytes} bytes)`,
      );
    }

    const digest = toHex(await crypto.subtle.digest("SHA-256", bytes));
    if (digest !== MODEL_SHA256) {
      throw new Error(
        "model integrity check failed; the download was corrupt. Try again.",
      );
    }

    await cache.put(
      MODEL_URL,
      new Response(bytes, {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Length": String(totalBytes),
          "Cross-Origin-Resource-Policy": "same-origin",
        },
      }),
    );
    this.set({ phase: "ready", received: totalBytes });
    return true;
  }
}

export const modelStore = new ModelStore();
