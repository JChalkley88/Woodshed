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
    const hit = await cache.match(MODEL_URL);
    if (hit) {
      // Repair entries cached by earlier builds with CORP same-origin,
      // which a COEP-isolated page rejects for the cross-origin R2 URL.
      // Rewriting headers in place spares those users a 166MB
      // re-download.
      if (
        hit.headers.get("Cross-Origin-Resource-Policy") !== "cross-origin"
      ) {
        await cache.put(
          MODEL_URL,
          new Response(await hit.arrayBuffer(), {
            headers: {
              "Content-Type": "application/octet-stream",
              "Content-Length": hit.headers.get("Content-Length") ?? "",
              "Cross-Origin-Resource-Policy": "cross-origin",
            },
          }),
        );
      }
      this.set({ phase: "ready" });
      return true;
    }

    this.set({ phase: "downloading", received: 0, error: null });
    // Explicit CORS mode: the model lives on R2 cross-origin in
    // production, and a CORS-fetched body is what a COEP-isolated page is
    // allowed to read (the bucket's CORS policy permits the app origin).
    const response = await fetch(MODEL_URL, { mode: "cors" });
    if (!response.ok || !response.body) {
      throw new Error(`model download failed (HTTP ${response.status})`);
    }
    // An SPA host answers unknown paths with index.html at status 200; a
    // misconfigured model URL must say so instead of failing later with a
    // baffling size or hash error.
    if ((response.headers.get("Content-Type") ?? "").includes("text/html")) {
      throw new Error(
        `the model URL returned a web page, not a model (${MODEL_URL}). The build's VITE_MODEL_URL is wrong or missing.`,
      );
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

    // The cached response is synthesised (the original body was consumed
    // by the hash check), so its headers are ours to get right. It is
    // served by the service worker for the separation worker's fetch of
    // the cross-origin R2 URL under COEP isolation, so CORP must say
    // cross-origin: the previous same-origin value (a leftover from when
    // the model URL was same-origin dev middleware) made the browser
    // reject the response outright. Harmless in dev, where the URL is
    // same-origin and CORP is not consulted.
    await cache.put(
      MODEL_URL,
      new Response(bytes, {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Length": String(totalBytes),
          "Cross-Origin-Resource-Policy": "cross-origin",
        },
      }),
    );
    this.set({ phase: "ready", received: totalBytes });
    return true;
  }
}

export const modelStore = new ModelStore();
