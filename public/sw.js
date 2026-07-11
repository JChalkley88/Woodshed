// Woodshed service worker: cached-once, works-forever.
//
// Two caches:
//   woodshed-static-v1 — app shell, hashed assets, ORT runtime, fonts.
//                        Populated at install (shell), at runtime on
//                        fetch, and by the page after load (it caches its
//                        own already-loaded resources so offline works
//                        from the very first visit).
//   woodshed-model-v1  — the 166MB separation model, written by the
//                        page's download manager after a SHA-256 check.
//                        The separation worker loads the model by URL
//                        (the ORT recipe forbids passing bytes), and this
//                        worker answers that fetch from the cache.
const STATIC_CACHE = "woodshed-static-v1";
const MODEL_CACHE = "woodshed-model-v1";
const KNOWN_CACHES = [STATIC_CACHE, MODEL_CACHE];

const SHELL = ["/", "/studio", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => !KNOWN_CACHES.includes(name))
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // The separation model (any origin): cache-only when present; the page
  // manages the download and integrity check itself.
  if (url.pathname.endsWith(".onnx")) {
    event.respondWith(
      caches
        .open(MODEL_CACHE)
        .then((cache) => cache.match(request.url))
        .then((hit) => hit ?? fetch(request)),
    );
    return;
  }

  // The ONNX Runtime binaries and loaders (served from R2 in production,
  // so cross-origin): cache-first, populate on first fetch. This keeps
  // the cached-once, works-forever promise even though the runtime no
  // longer ships in the app bundle (Pages' 25 MiB per-file limit).
  if (/\/ort-[^/]*\.(wasm|mjs)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(request, { ignoreVary: true }).then(
        (hit) =>
          hit ??
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              void caches
                .open(STATIC_CACHE)
                .then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  // Navigations: network-first so deploys land, cached shell offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          void caches
            .open(STATIC_CACHE)
            .then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() =>
          caches
            // ignoreSearch: /studio?mockSeparation=1 must hit the cached
            // /studio shell (the SPA reads its own query string).
            // ignoreVary: the static server adds Vary headers that would
            // otherwise stop cached entries matching offline.
            .match(request, { ignoreSearch: true, ignoreVary: true })
            .then((hit) => hit ?? caches.match("/", { ignoreVary: true }))
            .then((hit) => hit ?? Response.error()),
        ),
    );
    return;
  }

  // Static assets (hashed bundles, /ort runtime, fonts): cache-first,
  // populate on miss. Hashed names make staleness impossible; the stable
  // names (/ort, fonts) only change with a dependency bump, which also
  // bumps the cache version above.
  event.respondWith(
    caches.match(request, { ignoreVary: true }).then(
      (hit) =>
        hit ??
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches
              .open(STATIC_CACHE)
              .then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
