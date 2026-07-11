// Based on models/vite-ort-config-reference.txt, with two amendments per the
// Night 1 brief: ONNX sessions are created with ["webgpu", "wasm"] execution
// providers (see src/spike/spike.worker.ts), and the onnxruntime-web runtime
// is never fetched from a third-party CDN. In dev it is served from
// node_modules; in production from our own R2 bucket (Pages' 25 MiB
// per-file limit rules out shipping it in dist), where the service worker
// caches it after first fetch for offline use.
//
// Production note: Cloudflare Pages needs the same COOP/COEP headers via a
// `_headers` file (see public/_headers).
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const require = createRequire(import.meta.url);
const ortDist = dirname(require.resolve("onnxruntime-web"));

// The plain build serves the WASM execution provider; the .jsep build is the
// WebGPU-enabled one. ORT picks the right file itself when given a directory
// prefix as `env.wasm.wasmPaths` ("/ort/" in the worker code). Matched by
// pattern rather than allowlist because the file set differs across ORT
// versions (1.18 vs 1.27).
const ORT_RUNTIME_PATTERN = /^ort-.*\.(mjs|wasm)$/;

/** Makes the ORT runtime available at /ort. In dev the files are served
 *  straight from node_modules by middleware (Vite refuses to serve
 *  public-dir files as JS module imports, and ORT dynamically imports its
 *  .mjs loader).
 *
 *  Production does NOT ship the runtime in dist: Cloudflare Pages rejects
 *  any file over 25 MiB and the jsep WASM is 26.8 MiB. Instead
 *  ort.env.wasm.wasmPaths points at R2 (ORT_BASE_URL in
 *  src/separation/constants.ts; upload set built by
 *  scripts/prepare-ort-upload.mjs), and generateBundle strips the WASM
 *  asset Vite emits from onnxruntime-web's internal `new URL(...)`
 *  reference, which the runtime never fetches once wasmPaths is set. */
function ortRuntimeLocal(): Plugin {
  return {
    name: "woodshed:ort-runtime-local",
    generateBundle(_options, bundle) {
      for (const name of Object.keys(bundle)) {
        if (/ort-.*\.wasm$/.test(name)) delete bundle[name];
      }
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? "").split("?")[0];
        if (!url.startsWith("/ort/")) return next();
        const name = url.slice("/ort/".length);
        const file = join(ortDist, name);
        if (!ORT_RUNTIME_PATTERN.test(name) || !existsSync(file)) {
          res.statusCode = 404;
          return res.end("not found");
        }
        res.setHeader(
          "Content-Type",
          name.endsWith(".wasm") ? "application/wasm" : "text/javascript",
        );
        res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
        const fs = require("node:fs") as typeof import("node:fs");
        res.setHeader("Content-Length", fs.statSync(file).size);
        fs.createReadStream(file).pipe(res);
      });
    },
  };
}

/** Serves the gitignored /models directory in dev so the separation spike can
 *  fetch the .onnx files same-origin (COEP-safe). Dev only; production models
 *  come from R2 (Night 2 onwards). */
function serveModels(): Plugin {
  return {
    name: "woodshed:serve-models",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? "";
        if (!url.startsWith("/models/")) return next();
        const file = join(__dirname, decodeURIComponent(url.split("?")[0]));
        if (!file.startsWith(join(__dirname, "models")) || !existsSync(file)) {
          res.statusCode = 404;
          return res.end("not found");
        }
        res.setHeader("Content-Type", "application/octet-stream");
        res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
        const { createReadStream, statSync } = require("node:fs") as typeof import("node:fs");
        res.setHeader("Content-Length", statSync(file).size);
        createReadStream(file).pipe(res);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), ortRuntimeLocal(), serveModels()],
  // 1) Don't try to pre-bundle the WASM-touching ORT entry.
  optimizeDeps: {
    exclude: ["onnxruntime-web"],
  },
  // 2) Required for SharedArrayBuffer (multithreaded WASM EP).
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  preview: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  // 3) Copy the .wasm files into the build so the runtime can fetch them.
  assetsInclude: ["**/*.wasm"],
  build: {
    target: "es2022",
  },
});
