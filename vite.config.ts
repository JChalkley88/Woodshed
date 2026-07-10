// Based on models/vite-ort-config-reference.txt, with two amendments per the
// Night 1 brief: ONNX sessions are created with ["webgpu", "wasm"] execution
// providers (see src/spike/spike.worker.ts), and the onnxruntime-web .wasm
// files are bundled locally rather than fetched from a CDN, so the product
// works fully offline.
//
// Production note: Cloudflare Pages needs the same COOP/COEP headers via a
// `_headers` file (see public/_headers).
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const require = createRequire(import.meta.url);
const ortDist = dirname(require.resolve("onnxruntime-web"));

// The plain build serves the WASM execution provider; the .jsep build is the
// WebGPU-enabled one. ORT picks the right file itself when given a directory
// prefix as `env.wasm.wasmPaths` ("/ort/" in the worker code).
const ORT_RUNTIME_FILES = [
  "ort-wasm-simd-threaded.mjs",
  "ort-wasm-simd-threaded.wasm",
  "ort-wasm-simd-threaded.jsep.mjs",
  "ort-wasm-simd-threaded.jsep.wasm",
];

/** Copies the ORT runtime into public/ort so it is served in dev and bundled
 *  into dist on build. public/ort is gitignored; node_modules is the source
 *  of truth. */
function ortRuntimeLocal(): Plugin {
  return {
    name: "woodshed:ort-runtime-local",
    buildStart() {
      const outDir = join(__dirname, "public", "ort");
      mkdirSync(outDir, { recursive: true });
      for (const file of ORT_RUNTIME_FILES) {
        const src = join(ortDist, file);
        if (existsSync(src)) copyFileSync(src, join(outDir, file));
      }
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
