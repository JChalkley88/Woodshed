// Separation constants. The htdemucs ONNX graph is hard-bound to 44.1kHz
// stereo and the canonical 343,980-sample (7.8s) segment; every piece of
// chunking maths derives from these.
export const SAMPLE_RATE = 44100;
export const SEGMENT_SAMPLES = 343980;
export const N_CHANNELS = 2;
export const N_STEMS = 4;
/** 25% overlap between consecutive segments (demucs convention). */
export const OVERLAP_SAMPLES = Math.floor(SEGMENT_SAMPLES / 4);
export const STRIDE_SAMPLES = SEGMENT_SAMPLES - OVERLAP_SAMPLES;

/** Output row order of the htdemucs graph (see woodshed-reference/demo.js). */
export const STEM_NAMES = ["drums", "bass", "other", "vocals"] as const;
export type StemName = (typeof STEM_NAMES)[number];

/** Named lookup into the htdemucs output tensor. This is the single source
 *  of truth for which output index belongs to which stem; everything
 *  downstream addresses stems by name, never by raw index. htdemucs output
 *  order is fixed: 0 drums, 1 bass, 2 other, 3 vocals. */
export const HTDEMUCS_OUTPUT_INDEX: Record<StemName, number> = {
  drums: 0,
  bass: 1,
  other: 2,
  vocals: 3,
};

/** Desk display order and identity colour tokens (design spec section 1). */
export const STEM_DISPLAY: {
  name: StemName;
  label: string;
  short: string;
  colourToken: string;
}[] = [
  { name: "vocals", label: "Vocals", short: "vox", colourToken: "--stem-vocals" },
  { name: "drums", label: "Drums", short: "kit", colourToken: "--stem-drums" },
  { name: "bass", label: "Bass", short: "bass", colourToken: "--stem-bass" },
  { name: "other", label: "Other", short: "gtr + keys", colourToken: "--stem-other" },
];

/** The R2 public bucket serving the model and the ORT runtime. */
export const R2_PUBLIC_BASE =
  "https://pub-11c2ac1884664d0e9b5505f469580557.r2.dev";

/** The shipped separation model: the 166MB fp16 baseline (settled Night 5
 *  decision; smaller download and R2 egress win over the 345MB pre-opt
 *  file, whose faster create remains documented as a fallback).
 *
 *  Resolution: VITE_MODEL_URL when set at BUILD time (Vite inlines it);
 *  otherwise the vite models middleware in dev and the known R2 URL in
 *  production. A production build must never fall back to a same-origin
 *  /models path: Pages would answer it with index.html (SPA fallback,
 *  status 200) and separation would fail with a confusing size mismatch,
 *  which is exactly what happened when a deployed build missed the env
 *  var. Note for Pages: dashboard variables reach dashboard-driven CI
 *  builds only; a locally built dist deployed by direct upload sees only
 *  the local shell's environment. */
export const MODEL_URL: string = import.meta.env.VITE_MODEL_URL
  ? (import.meta.env.VITE_MODEL_URL as string)
  : import.meta.env.DEV
    ? "/models/htdemucs_fp16weights.onnx"
    : `${R2_PUBLIC_BASE}/htdemucs_fp16weights.onnx`;

if (!import.meta.env.VITE_MODEL_URL && !import.meta.env.DEV) {
  // Not fatal (the default above is the real bucket), but a launch build
  // should pin its model URL explicitly.
  console.warn(
    `Woodshed: VITE_MODEL_URL was not set at build time; using the default R2 URL ${MODEL_URL}. Set it in the BUILD environment to silence this.`,
  );
}

/** SHA-256 of the model file, verified on first download. Recompute if
 *  the file ever changes (PowerShell: Get-FileHash -Algorithm SHA256). */
export const MODEL_SHA256: string =
  (import.meta.env.VITE_MODEL_SHA256 as string | undefined) ??
  "d05c269d0178d2a72ad484b10b11dd370193fc923201c3b27a99f848745db70a";
/** Byte size of the model, for progress display when the server omits
 *  Content-Length. */
export const MODEL_BYTES = 165_612_636;
/** Cache key component; bump when the model file changes. */
export const MODEL_ID = "htdemucs_fp16_v1";

/** Where the ONNX Runtime WASM binaries and their .mjs loaders are
 *  fetched from (ort.env.wasm.wasmPaths). Cloudflare Pages rejects any
 *  file over 25 MiB and the jsep WASM is 26.8 MiB, so production serves
 *  the runtime from R2 under a version-pinned prefix; the files there
 *  MUST come from the exact onnxruntime-web build in package.json (run
 *  scripts/prepare-ort-upload.mjs, upload, done). Dev serves the same
 *  files straight from node_modules via the vite middleware, so the pair
 *  can never skew in development. The service worker caches these after
 *  first fetch, preserving offline use after first load. */
export const ORT_VERSION = "1.27.0";
export const ORT_BASE_URL: string = import.meta.env.VITE_ORT_BASE_URL
  ? (import.meta.env.VITE_ORT_BASE_URL as string)
  : import.meta.env.DEV
    ? "/ort/"
    : `${R2_PUBLIC_BASE}/ort/${ORT_VERSION}/`;
