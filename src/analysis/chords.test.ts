import { describe, expect, it } from "vitest";
import {
  ANALYSIS_SAMPLE_RATE,
  buildChordStates,
  chromaFrame,
  decimate,
  detectChords,
  fftInPlace,
  N_LABEL,
  pathToSegments,
  pitchClassOf,
  viterbiPath,
  type ChordSegment,
} from "./chords.ts";

const SR = 44100;

function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Synthesises a chord: each note gets four harmonics at 1/h amplitude,
 *  a crude but timbre-like spectrum. */
function chordSignal(midis: number[], seconds: number): Float32Array {
  const out = new Float32Array(Math.round(seconds * SR));
  for (const midi of midis) {
    const f0 = midiToHz(midi);
    for (let h = 1; h <= 4; h++) {
      const f = f0 * h;
      if (f > SR / 2) break;
      const amp = 0.2 / h / midis.length;
      const w = (2 * Math.PI * f) / SR;
      for (let i = 0; i < out.length; i++) out[i] += amp * Math.sin(w * i);
    }
  }
  return out;
}

function concat(parts: Float32Array[]): Float32Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Float32Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** Fraction of 0.19s analysis frames whose detected label matches the
 *  known progression, ignoring one frame either side of each boundary
 *  (the window genuinely straddles two chords there). */
function frameAccuracy(
  segments: ChordSegment[],
  truth: { label: string; seconds: number }[],
): number {
  const hop = 2048 / ANALYSIS_SAMPLE_RATE;
  let correct = 0;
  let counted = 0;
  const boundaries: number[] = [];
  let acc = 0;
  for (const t of truth.slice(0, -1)) {
    acc += t.seconds;
    boundaries.push(acc);
  }
  const totalSeconds = truth.reduce((n, t) => n + t.seconds, 0);
  for (let t = 0; (t + 1) * hop <= totalSeconds; t++) {
    const mid = (t + 0.5) * hop;
    if (boundaries.some((b) => Math.abs(mid - b) < hop * 1.5)) continue;
    let cursor = 0;
    let expected = truth[truth.length - 1].label;
    for (const part of truth) {
      cursor += part.seconds;
      if (mid < cursor) {
        expected = part.label;
        break;
      }
    }
    const seg = segments.find((s) => mid >= s.start && mid < s.end);
    counted++;
    if (seg && seg.label === expected) correct++;
  }
  return counted === 0 ? 0 : correct / counted;
}

describe("fftInPlace", () => {
  it("puts a pure tone's energy in the right bin", () => {
    const n = 1024;
    const bin = 37;
    const re = new Float32Array(n);
    const im = new Float32Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.cos((2 * Math.PI * bin * i) / n);
    fftInPlace(re, im);
    const mags = Array.from({ length: n / 2 }, (_, k) => Math.hypot(re[k], im[k]));
    expect(mags.indexOf(Math.max(...mags))).toBe(bin);
  });

  it("rejects non-power-of-two lengths", () => {
    expect(() => fftInPlace(new Float32Array(100), new Float32Array(100))).toThrow();
  });
});

describe("pitchClassOf", () => {
  it("maps reference frequencies to their classes", () => {
    expect(pitchClassOf(440)).toBe(9); // A
    expect(pitchClassOf(261.63)).toBe(0); // C
    expect(pitchClassOf(466.16)).toBe(10); // Bb
  });
});

describe("decimate", () => {
  it("averages groups of `factor` samples", () => {
    const out = decimate(new Float32Array([1, 1, 3, 3, 5, 5, 7, 7]), 4);
    expect(Array.from(out)).toEqual([2, 6]);
  });
});

describe("chromaFrame", () => {
  it("concentrates a triad's energy in its pitch classes", () => {
    const sig = chordSignal([48, 52, 55], 1); // C3 E3 G3
    const mono = decimate(sig, 4);
    const { chroma } = chromaFrame(mono.subarray(0, 4096), ANALYSIS_SAMPLE_RATE);
    const ranked = [...chroma.keys()].sort((a, b) => chroma[b] - chroma[a]);
    expect(ranked.slice(0, 3).sort((x, y) => x - y)).toEqual([0, 4, 7]);
  });
});

describe("viterbiPath", () => {
  it("smooths over a single-frame blip", () => {
    // State 0 strongly preferred except one frame that prefers state 1.
    const frames = Array.from({ length: 9 }, (_, t) => {
      const s = new Float64Array(3).fill(0.05);
      s[t === 4 ? 1 : 0] = 0.9;
      return s;
    });
    const path = viterbiPath(frames, 3);
    expect(Array.from(path)).toEqual(Array(9).fill(0));
  });

  it("follows a genuine sustained change", () => {
    const frames = Array.from({ length: 20 }, (_, t) => {
      const s = new Float64Array(3).fill(0.05);
      s[t < 10 ? 0 : 2] = 0.9;
      return s;
    });
    const path = viterbiPath(frames, 3);
    expect(path[0]).toBe(0);
    expect(path[19]).toBe(2);
  });
});

describe("pathToSegments", () => {
  it("merges consecutive frames of one label", () => {
    const states = buildChordStates();
    const path = new Int32Array([0, 0, 0, 3, 3]);
    const segs = pathToSegments(path, states);
    expect(segs).toHaveLength(2);
    expect(segs[0].label).toBe("C");
    expect(segs[1].label).toBe("Db");
    expect(segs[0].end).toBeCloseTo(segs[1].start, 6);
  });
});

describe("detectChords end to end", () => {
  it("names single chords correctly", () => {
    const cases: [number[], string][] = [
      [[48, 52, 55], "C"],
      [[57, 60, 64], "Am"],
      [[55, 59, 62, 65], "G7"],
      [[46, 50, 53], "Bb"],
    ];
    for (const [midis, expected] of cases) {
      const segs = detectChords(chordSignal(midis, 2));
      const main = segs
        .filter((s) => s.label !== N_LABEL)
        .sort((a, b) => b.end - b.start - (a.end - a.start))[0];
      expect(main?.label, `midis ${midis.join(",")}`).toBe(expected);
    }
  });

  it("returns N for silence", () => {
    const segs = detectChords(new Float32Array(SR * 2));
    expect(segs.every((s) => s.label === N_LABEL)).toBe(true);
  });

  it("tracks a I-vi-IV-V7 progression with credible frame accuracy", () => {
    const truth = [
      { label: "C", seconds: 2 },
      { label: "Am", seconds: 2 },
      { label: "F", seconds: 2 },
      { label: "G7", seconds: 2 },
    ];
    const signal = concat([
      chordSignal([48, 52, 55], 2),
      chordSignal([45, 48, 52], 2),
      chordSignal([41, 45, 48], 2),
      chordSignal([43, 47, 50, 53], 2),
    ]);
    const segs = detectChords(signal);
    const acc = frameAccuracy(segs, truth);
    // Beta bar: credible, not perfect (brief). Synthetic-signal accuracy
    // is logged in STATE.md; regressions below 0.8 mean the DSP broke.
    expect(acc).toBeGreaterThan(0.8);
  });

  it("cancels via the onFrame callback", () => {
    const segs = detectChords(chordSignal([48, 52, 55], 2), {
      onFrame: (done) => done >= 3,
    });
    expect(segs).toEqual([]);
  });
});
