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

export const MODEL_URL = "/models/htdemucs_fp16_preopt.onnx";
/** Cache key component; bump when the model file changes. */
export const MODEL_ID = "htdemucs_fp16_preopt_v1";
