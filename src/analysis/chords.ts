// Pure chord-detection DSP: decimation, FFT, chromagram, chord templates,
// and Viterbi smoothing. No Web Audio, no worker plumbing, no third-party
// DSP dependency (essentia.js is AGPL and therefore banned); everything
// here is hand-rolled and unit-testable in Node.

/** Analysis runs at a quarter of the engine rate: chroma needs nothing
 *  above ~2kHz and the FFT gets 4x cheaper. */
export const ANALYSIS_SAMPLE_RATE = 11025;
export const DECIMATION = 4;
/** ~0.37s window at 11025Hz: long enough to resolve low fundamentals,
 *  short enough to track chord changes. */
export const FFT_SIZE = 4096;
/** 50% hop: ~0.19s per frame. */
export const HOP_SIZE = 2048;
/** Chroma folds bins between these frequencies; below C2 the bins smear
 *  across pitch classes, above ~2kHz it is mostly timbre. */
export const F_MIN = 65;
export const F_MAX = 2000;

/** Flats throughout, matching the spec's example spellings (Bb). */
export const PITCH_NAMES = [
  "C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B",
] as const;

export interface ChordQuality {
  suffix: string;
  intervals: number[];
}

/** Maj, min, and dominant-7 to start (build plan Night 4). */
export const CHORD_QUALITIES: ChordQuality[] = [
  { suffix: "", intervals: [0, 4, 7] },
  { suffix: "m", intervals: [0, 3, 7] },
  { suffix: "7", intervals: [0, 4, 7, 10] },
];

/** The no-chord state label. */
export const N_LABEL = "N";

export interface ChordSegment {
  /** Seconds in source time. */
  start: number;
  end: number;
  /** As written: "C", "Dm", "G7", "Bb"... or N_LABEL for silence. */
  label: string;
}

/* ---------------- Decimation ---------------- */

/** Mean-of-`factor` decimator. The averaging is a crude low-pass; the
 *  residual aliasing lands mostly above the chroma band and is harmless
 *  for pitch-class energy. */
export function decimate(input: Float32Array, factor: number): Float32Array {
  const out = new Float32Array(Math.floor(input.length / factor));
  for (let i = 0; i < out.length; i++) {
    let sum = 0;
    const base = i * factor;
    for (let k = 0; k < factor; k++) sum += input[base + k];
    out[i] = sum / factor;
  }
  return out;
}

/* ---------------- FFT ---------------- */

/** In-place iterative radix-2 complex FFT (Cooley-Tukey). Lengths must be
 *  powers of two. */
export function fftInPlace(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  if ((n & (n - 1)) !== 0) throw new Error("FFT length must be a power of two");
  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const uRe = re[i + k];
        const uIm = im[i + k];
        const vRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm;
        const vIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe;
        re[i + k] = uRe + vRe;
        im[i + k] = uIm + vIm;
        re[i + k + len / 2] = uRe - vRe;
        im[i + k + len / 2] = uIm - vIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

const hannCache = new Map<number, Float32Array>();
export function hannWindow(size: number): Float32Array {
  let w = hannCache.get(size);
  if (!w) {
    w = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
    }
    hannCache.set(size, w);
  }
  return w;
}

/* ---------------- Chromagram ---------------- */

/** Pitch class (0 = C) for a frequency in Hz. */
export function pitchClassOf(freqHz: number): number {
  const midi = Math.round(12 * Math.log2(freqHz / 440) + 69);
  return ((midi % 12) + 12) % 12;
}

/** 12-bin chroma for one windowed frame of time-domain samples, plus the
 *  frame's total in-band energy (used for the no-chord state). */
export function chromaFrame(
  frame: Float32Array,
  sampleRate: number,
): { chroma: Float32Array; energy: number } {
  const n = frame.length;
  const w = hannWindow(n);
  const re = new Float32Array(n);
  const im = new Float32Array(n);
  for (let i = 0; i < n; i++) re[i] = frame[i] * w[i];
  fftInPlace(re, im);

  const chroma = new Float32Array(12);
  let energy = 0;
  const binHz = sampleRate / n;
  const kMin = Math.max(1, Math.ceil(F_MIN / binHz));
  const kMax = Math.min(n / 2 - 1, Math.floor(F_MAX / binHz));
  for (let k = kMin; k <= kMax; k++) {
    const mag = Math.hypot(re[k], im[k]);
    energy += mag;
    chroma[pitchClassOf(k * binHz)] += mag;
  }
  // L2-normalise so template cosine similarity is scale-free.
  let norm = 0;
  for (let c = 0; c < 12; c++) norm += chroma[c] * chroma[c];
  norm = Math.sqrt(norm);
  if (norm > 1e-9) for (let c = 0; c < 12; c++) chroma[c] /= norm;
  return { chroma, energy };
}

/* ---------------- Chord templates ---------------- */

export interface ChordState {
  label: string;
  /** L2-normalised 12-bin template; null for the no-chord state. */
  template: Float32Array | null;
}

/** 36 chord states (12 roots x 3 qualities) plus the no-chord state. */
export function buildChordStates(): ChordState[] {
  const states: ChordState[] = [];
  for (let root = 0; root < 12; root++) {
    for (const q of CHORD_QUALITIES) {
      const t = new Float32Array(12);
      for (const interval of q.intervals) t[(root + interval) % 12] = 1;
      // Give the root a little extra weight; it disambiguates relative
      // major/minor pairs that share two of three tones.
      t[root] = 1.35;
      let norm = 0;
      for (let c = 0; c < 12; c++) norm += t[c] * t[c];
      norm = Math.sqrt(norm);
      for (let c = 0; c < 12; c++) t[c] /= norm;
      states.push({ label: `${PITCH_NAMES[root]}${q.suffix}`, template: t });
    }
  }
  states.push({ label: N_LABEL, template: null });
  return states;
}

/** Cosine similarity of an L2-normalised chroma frame against every state.
 *  The no-chord state scores a constant floor, boosted when the frame has
 *  next to no in-band energy. */
export function scoreFrame(
  chroma: Float32Array,
  energy: number,
  states: ChordState[],
  silenceEnergy: number,
): Float64Array {
  const scores = new Float64Array(states.length);
  for (let s = 0; s < states.length; s++) {
    const t = states[s].template;
    if (t === null) {
      scores[s] = energy < silenceEnergy ? 0.95 : 0.35;
      continue;
    }
    let dot = 0;
    for (let c = 0; c < 12; c++) dot += chroma[c] * t[c];
    scores[s] = Math.max(0, dot);
  }
  return scores;
}

/* ---------------- Viterbi smoothing ---------------- */

/** Most-likely state path with a sticky self-transition, so the output
 *  cannot flicker chord-to-chord on single noisy frames. Emissions are the
 *  cosine scores; everything runs in the log domain. */
export function viterbiPath(
  frameScores: Float64Array[],
  nStates: number,
  pStay = 0.8,
): Int32Array {
  const T = frameScores.length;
  const path = new Int32Array(T);
  if (T === 0) return path;
  const logStay = Math.log(pStay);
  const logSwitch = Math.log((1 - pStay) / (nStates - 1));
  const EPS = 1e-6;

  let prev = new Float64Array(nStates);
  const back = Array.from({ length: T }, () => new Int32Array(nStates));
  for (let s = 0; s < nStates; s++) prev[s] = Math.log(frameScores[0][s] + EPS);

  for (let t = 1; t < T; t++) {
    const cur = new Float64Array(nStates);
    // The only per-state candidates that matter with a uniform switch
    // probability are "stay" and "switch from the best previous state".
    let bestPrev = 0;
    for (let s = 1; s < nStates; s++) if (prev[s] > prev[bestPrev]) bestPrev = s;
    for (let s = 0; s < nStates; s++) {
      const stay = prev[s] + logStay;
      const jump = prev[bestPrev] + logSwitch;
      if (stay >= jump || bestPrev === s) {
        cur[s] = stay;
        back[t][s] = s;
      } else {
        cur[s] = jump;
        back[t][s] = bestPrev;
      }
      cur[s] += Math.log(frameScores[t][s] + EPS);
    }
    prev = cur;
  }

  let best = 0;
  for (let s = 1; s < nStates; s++) if (prev[s] > prev[best]) best = s;
  path[T - 1] = best;
  for (let t = T - 1; t > 0; t--) path[t - 1] = back[t][path[t]];
  return path;
}

/* ---------------- Segments ---------------- */

/** Collapses a per-frame state path into labelled time segments. Frame t
 *  covers [t*hop, (t+1)*hop) of the decimated signal, offset by half the
 *  window so segment boundaries sit near the musical change rather than
 *  the analysis window's leading edge. */
export function pathToSegments(
  path: Int32Array,
  states: ChordState[],
  sampleRate = ANALYSIS_SAMPLE_RATE,
  hop = HOP_SIZE,
): ChordSegment[] {
  const segments: ChordSegment[] = [];
  const frameSeconds = hop / sampleRate;
  for (let t = 0; t < path.length; t++) {
    const label = states[path[t]].label;
    const last = segments[segments.length - 1];
    if (last && last.label === label) {
      last.end = (t + 1) * frameSeconds;
    } else {
      segments.push({ start: t * frameSeconds, end: (t + 1) * frameSeconds, label });
    }
  }
  return segments;
}

/* ---------------- Whole-signal driver ---------------- */

export interface FrameChroma {
  chroma: Float32Array;
  energy: number;
}

/** Scores, smooths, and segments a full sequence of chroma frames. The
 *  silence threshold is a fraction of the median frame energy, so quiet
 *  passages become the no-chord state rather than a guessed triad. */
export function segmentsFromChromas(chromas: FrameChroma[]): ChordSegment[] {
  if (chromas.length === 0) return [];
  const states = buildChordStates();
  const energies = chromas.map((c) => c.energy).sort((a, b) => a - b);
  const silenceEnergy = (energies[Math.floor(energies.length / 2)] ?? 0) * 0.1;
  const frameScores = chromas.map(({ chroma, energy }) => {
    const scores = scoreFrame(chroma, energy, states, silenceEnergy);
    // Sharpen emissions: cosine scores of related chords sit close
    // together (an F frame scores ~0.78 on Am, which shares two tones), so
    // without this the sticky transition prior flattens a real progression
    // into one chord. Cubing triples the log-domain margin per frame; a
    // two-second chord then comfortably out-scores one switch penalty
    // while single-frame blips still smooth away.
    for (let s = 0; s < scores.length; s++) scores[s] = scores[s] ** 3;
    return scores;
  });
  const path = viterbiPath(frameScores, states.length);
  return pathToSegments(path, states);
}

export interface DetectOptions {
  /** Called after each frame; return true to abort (returns []). */
  onFrame?: (done: number, total: number) => boolean;
}

/** Full pipeline for a mono 44.1kHz signal. The worker drives frames
 *  incrementally for cancellation; this sync driver is for tests and
 *  accuracy measurement. */
export function detectChords(
  mono44k: Float32Array,
  options: DetectOptions = {},
): ChordSegment[] {
  const mono = decimate(mono44k, DECIMATION);
  const total = Math.max(0, Math.floor((mono.length - FFT_SIZE) / HOP_SIZE) + 1);
  const chromas: FrameChroma[] = [];
  for (let t = 0; t < total; t++) {
    chromas.push(chromaFrame(mono.subarray(t * HOP_SIZE, t * HOP_SIZE + FFT_SIZE), ANALYSIS_SAMPLE_RATE));
    if (options.onFrame?.(t + 1, total)) return [];
  }
  return segmentsFromChromas(chromas);
}
