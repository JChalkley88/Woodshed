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

/** The shipped separation model: the 166MB fp16 baseline (settled Night 5
 *  decision; smaller download and R2 egress win over the 345MB pre-opt
 *  file, whose faster create remains documented as a fallback).
 *
 *  LAUNCH TODO: set VITE_MODEL_URL to the public R2 URL, e.g.
 *  https://models.<domain>/htdemucs_fp16weights.onnx. The dev default is
 *  served by the vite models middleware. */
export const MODEL_URL: string =
  (import.meta.env?.VITE_MODEL_URL as string | undefined) ??
  "/models/htdemucs_fp16weights.onnx";
/** SHA-256 of the model file, verified on first download. Recompute if
 *  the file ever changes (PowerShell: Get-FileHash -Algorithm SHA256). */
export const MODEL_SHA256: string =
  (import.meta.env?.VITE_MODEL_SHA256 as string | undefined) ??
  "d05c269d0178d2a72ad484b10b11dd370193fc923201c3b27a99f848745db70a";
/** Byte size of the model, for progress display when the server omits
 *  Content-Length. */
export const MODEL_BYTES = 165_612_636;
/** Cache key component; bump when the model file changes. */
export const MODEL_ID = "htdemucs_fp16_v1";
