// Service-worker registration and first-visit precache. Registered in
// production builds (and under ?sw=1 for testing against a preview
// build); dev stays uncontrolled so HMR is never fought by a cache.

const STATIC_CACHE = "woodshed-static-v1";

function shouldRegister(): boolean {
  if (!("serviceWorker" in navigator)) return false;
  if (new URLSearchParams(window.location.search).has("sw")) return true;
  return import.meta.env.PROD;
}

/** The SW cannot see resources fetched before it controlled the page, so
 *  after registration the page caches its own already-loaded same-origin
 *  resources (bundles, css, fonts). This makes offline work from the very
 *  first visit, not the second. */
async function precacheCurrentResources(): Promise<void> {
  const cache = await caches.open(STATIC_CACHE);
  const urls = new Set<string>([window.location.pathname]);
  for (const entry of performance.getEntriesByType("resource")) {
    const url = new URL(entry.name, window.location.href);
    if (url.origin === window.location.origin && !url.pathname.endsWith(".onnx")) {
      urls.add(url.pathname);
    }
  }
  await Promise.allSettled(
    [...urls].map(async (url) => {
      if (!(await cache.match(url))) {
        const response = await fetch(url);
        if (response.ok) await cache.put(url, response);
      }
    }),
  );
}

export function registerPwa(): void {
  if (!shouldRegister()) return;
  window.addEventListener("load", () => {
    void navigator.serviceWorker
      .register("/sw.js")
      .then(() => navigator.serviceWorker.ready)
      .then(() => precacheCurrentResources())
      .catch(() => {
        // Registration failure is never user-facing: the app simply
        // behaves as an ordinary web page.
      });
  });
}
