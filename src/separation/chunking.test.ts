import { describe, expect, it } from "vitest";
import {
  float32ToInt16,
  floatToInt16,
  int16ToFloat32,
  OverlapAddAccumulator,
  planChunks,
  referenceOverlapAdd,
  transitionWindow,
  type ChunkPlan,
} from "./chunking.ts";
import {
  N_CHANNELS,
  N_STEMS,
  OVERLAP_SAMPLES,
  SEGMENT_SAMPLES,
  STRIDE_SAMPLES,
} from "./constants.ts";

describe("constants", () => {
  it("derive from the canonical segment", () => {
    expect(SEGMENT_SAMPLES).toBe(343980);
    expect(OVERLAP_SAMPLES).toBe(Math.floor(343980 / 4));
    expect(STRIDE_SAMPLES).toBe(SEGMENT_SAMPLES - OVERLAP_SAMPLES);
  });
});

describe("planChunks", () => {
  it("gives one padded chunk for a short track", () => {
    const plans = planChunks(10_000);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toEqual({ index: 0, start: 0, copyLength: 10_000 });
  });

  it("covers an exact single segment with one chunk", () => {
    const plans = planChunks(STRIDE_SAMPLES);
    expect(plans).toHaveLength(1);
    expect(plans[0].copyLength).toBe(STRIDE_SAMPLES);
  });

  it("strides at 75% of the segment", () => {
    const total = STRIDE_SAMPLES * 3 + 500;
    const plans = planChunks(total);
    expect(plans).toHaveLength(4);
    plans.forEach((p, i) => expect(p.start).toBe(i * STRIDE_SAMPLES));
    // Every sample is covered and no chunk reads past the end.
    const last = plans[plans.length - 1];
    expect(last.start + last.copyLength).toBe(total);
    for (const p of plans) {
      expect(p.copyLength).toBeGreaterThan(0);
      expect(p.copyLength).toBeLessThanOrEqual(SEGMENT_SAMPLES);
    }
  });

  it("adjacent chunks overlap by exactly the overlap length", () => {
    const plans = planChunks(STRIDE_SAMPLES * 2 + 1000);
    const end0 = plans[0].start + SEGMENT_SAMPLES;
    expect(end0 - plans[1].start).toBe(OVERLAP_SAMPLES);
  });
});

describe("transitionWindow", () => {
  it("suppresses the head ramp on the first chunk and tail on the last", () => {
    const first = transitionWindow(true, false, 100, 10);
    expect(first[0]).toBe(1);
    expect(first[99]).toBeLessThan(0.2);
    const last = transitionWindow(false, true, 100, 10);
    expect(last[0]).toBeLessThan(0.2);
    expect(last[99]).toBe(1);
  });

  it("is flat in the middle and ramps both ends of interior chunks", () => {
    const w = transitionWindow(false, false, 100, 10);
    expect(w[50]).toBe(1);
    expect(w[0]).toBeCloseTo(1 / 11, 6);
    expect(w[99]).toBeCloseTo(1 / 11, 6);
  });

  it("adjacent ramps sum to a constant across the join", () => {
    // Tail of chunk i overlaps head of chunk i+1 sample for sample:
    // global sample k of the overlap sees tail[SEG - OVERLAP + k] and
    // head[k]; their weights must sum to the same total everywhere so the
    // normalised crossfade is smooth.
    const overlap = 10;
    const seg = 100;
    const a = transitionWindow(false, false, seg, overlap);
    const b = transitionWindow(false, false, seg, overlap);
    const sums: number[] = [];
    for (let k = 0; k < overlap; k++) {
      sums.push(a[seg - overlap + k] + b[k]);
    }
    for (const s of sums) expect(s).toBeCloseTo(sums[0], 6);
  });
});

describe("16-bit PCM round-trip", () => {
  it("clamps out-of-range floats", () => {
    expect(floatToInt16(2)).toBe(0x7fff);
    expect(floatToInt16(-2)).toBe(-0x8000);
  });

  it("round-trips within one quantisation step", () => {
    const src = new Float32Array(1000);
    for (let i = 0; i < src.length; i++) src[i] = Math.sin(i / 7) * 0.9;
    const back = int16ToFloat32(float32ToInt16(src));
    for (let i = 0; i < src.length; i++) {
      expect(Math.abs(back[i] - src[i])).toBeLessThanOrEqual(1 / 32767);
    }
  });

  it("preserves full-scale extremes exactly", () => {
    const back = int16ToFloat32(float32ToInt16(new Float32Array([1, -1, 0])));
    expect(back[0]).toBe(1);
    expect(back[1]).toBe(-1);
    expect(back[2]).toBe(0);
  });
});

describe("OverlapAddAccumulator", () => {
  function randomChunks(totalSamples: number) {
    const plans = planChunks(totalSamples);
    let seed = 12345;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647 - 0.5;
    };
    return plans.map((plan: ChunkPlan) => {
      const stems = new Float32Array(N_STEMS * N_CHANNELS * SEGMENT_SAMPLES);
      for (let i = 0; i < stems.length; i += 11) stems[i] = rnd();
      for (let i = 0; i < stems.length; i++) if (stems[i] === 0) stems[i] = rnd() * 0.5;
      return {
        plan,
        stems,
        window: transitionWindow(plan.index === 0, plan.index === plans.length - 1),
      };
    });
  }

  it("matches the reference overlap-add exactly on a multi-chunk track", () => {
    const total = STRIDE_SAMPLES * 2 + 40_000; // 3 chunks, ragged tail
    const chunks = randomChunks(total);
    const acc = new OverlapAddAccumulator(total);
    for (const c of chunks) acc.addChunk(c.plan, c.stems, c.window);
    const reference = referenceOverlapAdd(total, chunks);
    for (let row = 0; row < N_STEMS * N_CHANNELS; row++) {
      expect(acc.output[row].length).toBe(total);
      let maxDiff = 0;
      for (let i = 0; i < total; i++) {
        maxDiff = Math.max(maxDiff, Math.abs(acc.output[row][i] - reference[row][i]));
      }
      // Identical maths, different accumulation order: allow one LSB.
      expect(maxDiff).toBeLessThanOrEqual(1);
    }
  });

  it("restores the original length for a single short chunk", () => {
    const total = 50_000;
    const chunks = randomChunks(total);
    expect(chunks).toHaveLength(1);
    const acc = new OverlapAddAccumulator(total);
    acc.addChunk(chunks[0].plan, chunks[0].stems, chunks[0].window);
    expect(acc.output[0].length).toBe(total);
    expect(acc.finalisedSamples).toBe(total);
  });

  it("passes a constant signal through the crossfade unchanged", () => {
    const total = STRIDE_SAMPLES + OVERLAP_SAMPLES + 5_000;
    const plans = planChunks(total);
    const chunks = plans.map((plan) => ({
      plan,
      stems: new Float32Array(N_STEMS * N_CHANNELS * SEGMENT_SAMPLES).fill(0.5),
      window: transitionWindow(plan.index === 0, plan.index === plans.length - 1),
    }));
    const acc = new OverlapAddAccumulator(total);
    for (const c of chunks) acc.addChunk(c.plan, c.stems, c.window);
    const expected = floatToInt16(0.5);
    for (let i = 0; i < total; i += 997) {
      expect(Math.abs(acc.output[0][i] - expected)).toBeLessThanOrEqual(1);
    }
  });

  it("rejects out-of-order chunks", () => {
    const total = STRIDE_SAMPLES * 2;
    const chunks = randomChunks(total);
    const acc = new OverlapAddAccumulator(total);
    expect(() => acc.addChunk(chunks[1].plan, chunks[1].stems, chunks[1].window)).toThrow(
      /out of order/,
    );
  });
});
