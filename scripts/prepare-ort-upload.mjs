// Stages the ONNX Runtime files for the R2 bucket, copied from the exact
// onnxruntime-web build installed in node_modules so the .wasm and its
// .mjs loader can never skew from the version the app bundles. Run:
//   node scripts/prepare-ort-upload.mjs
// then upload everything under r2-upload/ to the bucket, preserving the
// ort/<version>/ prefix. ORT_BASE_URL in src/separation/constants.ts must
// point at the same prefix.
import { copyFileSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const ortDist = dirname(require.resolve("onnxruntime-web"));
const { version } = JSON.parse(
  readFileSync(join(ortDist, "..", "package.json"), "utf8"),
);

// The variants our runtime configuration actually loads (wasmPaths prefix,
// ORT picks by capability): the jsep build for the WebGPU EP and the
// plain simd-threaded build for the WASM EP. Each .wasm needs its
// matching .mjs loader from the same build.
const FILES = [
  "ort-wasm-simd-threaded.jsep.mjs",
  "ort-wasm-simd-threaded.jsep.wasm",
  "ort-wasm-simd-threaded.mjs",
  "ort-wasm-simd-threaded.wasm",
];

const outDir = join(process.cwd(), "r2-upload", "ort", version);
mkdirSync(outDir, { recursive: true });
for (const file of FILES) {
  copyFileSync(join(ortDist, file), join(outDir, file));
  const size = statSync(join(outDir, file)).size;
  console.log(`ort/${version}/${file}  (${(size / 1048576).toFixed(1)} MB)`);
}
console.log(`\nStaged in r2-upload/. onnxruntime-web version: ${version}`);
