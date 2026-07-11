import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The cached model response is synthesised (its body is consumed by the
// hash check), and it is served by the service worker to a COEP-isolated
// page for a cross-origin R2 URL, so its CORP header MUST be
// cross-origin. A same-origin value made the browser reject the model
// outright in production; these tests pin the header and the in-place
// repair of entries cached by the broken build.

const MODEL_BYTES = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes.buffer as ArrayBuffer,
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Minimal in-memory Cache Storage. */
function fakeCaches() {
  const store = new Map<string, Response>();
  const cache = {
    match: async (url: string) => store.get(url)?.clone(),
    put: async (url: string, response: Response) => {
      store.set(url, response);
    },
  };
  return { caches: { open: async () => cache }, store };
}

describe("ModelStore caching headers", () => {
  let store: Map<string, Response>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv("VITE_MODEL_SHA256", await sha256Hex(MODEL_BYTES));
    const fake = fakeCaches();
    store = fake.store;
    vi.stubGlobal("caches", fake.caches);
    fetchMock = vi.fn(
      async () =>
        new Response(MODEL_BYTES.slice(), {
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Length": String(MODEL_BYTES.length),
          },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("caches a fresh download with CORP cross-origin", async () => {
    const { ModelStore } = await import("./modelStore.ts");
    const { MODEL_URL } = await import("../separation/constants.ts");
    const modelStore = new ModelStore();
    await expect(modelStore.ensure()).resolves.toBe(true);
    const cached = store.get(MODEL_URL);
    expect(cached).toBeDefined();
    expect(cached!.headers.get("Cross-Origin-Resource-Policy")).toBe(
      "cross-origin",
    );
    // And the download itself was an explicit CORS-mode request.
    expect(fetchMock).toHaveBeenCalledWith(MODEL_URL, { mode: "cors" });
  });

  it("repairs an entry cached by the broken build without re-downloading", async () => {
    const { ModelStore } = await import("./modelStore.ts");
    const { MODEL_URL } = await import("../separation/constants.ts");
    store.set(
      MODEL_URL,
      new Response(MODEL_BYTES.slice(), {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Length": String(MODEL_BYTES.length),
          "Cross-Origin-Resource-Policy": "same-origin",
        },
      }),
    );
    const modelStore = new ModelStore();
    await expect(modelStore.ensure()).resolves.toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    const repaired = store.get(MODEL_URL);
    expect(repaired!.headers.get("Cross-Origin-Resource-Policy")).toBe(
      "cross-origin",
    );
    expect(await repaired!.arrayBuffer()).toEqual(
      MODEL_BYTES.buffer as ArrayBuffer,
    );
  });

  it("rejects a corrupt download and leaves nothing cached", async () => {
    vi.stubEnv("VITE_MODEL_SHA256", "0".repeat(64));
    vi.resetModules();
    const { ModelStore } = await import("./modelStore.ts");
    const { MODEL_URL } = await import("../separation/constants.ts");
    const modelStore = new ModelStore();
    await expect(modelStore.ensure()).resolves.toBe(false);
    expect(modelStore.getState().phase).toBe("error");
    expect(modelStore.getState().error).toMatch(/integrity/);
    expect(store.get(MODEL_URL)).toBeUndefined();
  });
});
