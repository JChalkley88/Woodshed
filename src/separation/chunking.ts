// Pure chunking and reconstruction maths for chunked demucs inference.
// No Web Audio, no ORT: everything here is unit-testable in Node.
import {
  HTDEMUCS_OUTPUT_INDEX,
  N_CHANNELS,
  N_STEMS,
  OVERLAP_SAMPLES,
  SEGMENT_SAMPLES,
  STEM_NAMES,
  STRIDE_SAMPLES,
  type StemName,
} from "./constants.ts";

/** Assigns the pipeline's stem-major output rows (stem s channel c at row
 *  s * N_CHANNELS + c, in htdemucs output order) to named stems. This is
 *  the one place model output meets stem names; consumers address the
 *  result by name only. */
export function namedStemRows<T>(rows: T[]): Record<StemName, [T, T]> {
  if (rows.length !== N_STEMS * N_CHANNELS) {
    throw new Error(
      `expected ${N_STEMS * N_CHANNELS} stem rows, got ${rows.length}`,
    );
  }
  const named = {} as Record<StemName, [T, T]>;
  for (const name of STEM_NAMES) {
    const s = HTDEMUCS_OUTPUT_INDEX[name];
    named[name] = [rows[s * N_CHANNELS], rows[s * N_CHANNELS + 1]];
  }
  return named;
}

export interface ChunkPlan {
  index: number;
  /** First source sample covered by this chunk. */
  start: number;
  /** Number of real samples in this chunk (the rest is zero padding). */
  copyLength: number;
}

/** Plans the chunk sequence covering `totalSamples`: fixed-size segments at
 *  75% stride. Even a track shorter than one segment gets one (padded)
 *  chunk. */
export function planChunks(totalSamples: number): ChunkPlan[] {
  const count = Math.max(1, Math.ceil(totalSamples / STRIDE_SAMPLES));
  const chunks: ChunkPlan[] = [];
  for (let i = 0; i < count; i++) {
    const start = i * STRIDE_SAMPLES;
    if (start >= totalSamples && i > 0) break;
    chunks.push({
      index: i,
      start,
      copyLength: Math.min(SEGMENT_SAMPLES, totalSamples - start),
    });
  }
  return chunks;
}

/** Triangular transition window (demucs convention): linear ramps across
 *  the overlap at both ends, flat 1 in the middle. The head ramp is
 *  suppressed for the first chunk and the tail ramp for the last, so track
 *  edges get full weight. */
export function transitionWindow(
  isFirst: boolean,
  isLast: boolean,
  segment = SEGMENT_SAMPLES,
  overlap = OVERLAP_SAMPLES,
): Float32Array {
  const w = new Float32Array(segment).fill(1);
  for (let i = 0; i < overlap; i++) {
    const v = (i + 1) / (overlap + 1);
    if (!isFirst) w[i] = v;
    if (!isLast) w[segment - 1 - i] = Math.min(w[segment - 1 - i], v);
  }
  return w;
}

/* ---------------- Incremental overlap-add ----------------
   Consecutive chunks share exactly OVERLAP_SAMPLES. Once chunk i has been
   added, every sample before chunk i+1's start is final, so it can be
   quantised to 16-bit immediately and the float working set stays at one
   overlap region per stem-channel rather than the whole song. */

export class OverlapAddAccumulator {
  readonly totalSamples: number;
  /** Finalised 16-bit output, one array per stem-channel row
   *  (stem-major: stem s channel c is row s * N_CHANNELS + c). */
  readonly output: Int16Array<ArrayBuffer>[];
  private carry: Float32Array[];
  private carryWeight: Float32Array;
  private nextStart = 0;
  private finalisedTo = 0;

  constructor(totalSamples: number) {
    this.totalSamples = totalSamples;
    this.output = Array.from(
      { length: N_STEMS * N_CHANNELS },
      () => new Int16Array(totalSamples),
    );
    this.carry = Array.from(
      { length: N_STEMS * N_CHANNELS },
      () => new Float32Array(OVERLAP_SAMPLES),
    );
    this.carryWeight = new Float32Array(OVERLAP_SAMPLES);
  }

  /** Adds one chunk's model output (layout [1, 4, 2, SEGMENT_SAMPLES],
   *  flattened) at the given plan position, weighted by `window`, and
   *  finalises every sample that can no longer change. Chunks must arrive
   *  in order. Only adjacent chunks overlap (OVERLAP < STRIDE), so each
   *  carry sample has exactly one pending contributor. */
  addChunk(plan: ChunkPlan, stems: Float32Array, window: Float32Array): void {
    if (plan.start !== this.nextStart) {
      throw new Error(
        `chunk out of order: expected start ${this.nextStart}, got ${plan.start}`,
      );
    }
    const { start, copyLength } = plan;
    const isLast = start + STRIDE_SAMPLES >= this.totalSamples;
    // Samples in [start, finalEnd) can no longer change; the tail
    // [finalEnd, start + copyLength) becomes the next chunk's carry.
    const finalEnd = isLast
      ? Math.min(start + copyLength, this.totalSamples)
      : start + STRIDE_SAMPLES;

    const rows = N_STEMS * N_CHANNELS;
    const nextCarry = isLast
      ? this.carry
      : Array.from({ length: rows }, () => new Float32Array(OVERLAP_SAMPLES));

    for (let row = 0; row < rows; row++) {
      const src = stems.subarray(
        row * SEGMENT_SAMPLES,
        row * SEGMENT_SAMPLES + SEGMENT_SAMPLES,
      );
      const out = this.output[row];
      const prevCarry = this.carry[row];
      for (let i = 0; i < copyLength; i++) {
        const global = start + i;
        if (global >= this.totalSamples) break;
        let value = src[i] * window[i];
        let weight = window[i];
        if (start > 0 && i < OVERLAP_SAMPLES) {
          value += prevCarry[i];
          weight += this.carryWeight[i];
        }
        if (global < finalEnd) {
          out[global] = floatToInt16(weight > 1e-8 ? value / weight : value);
        } else {
          nextCarry[row][global - finalEnd] = value;
        }
      }
    }
    // Weight carry is identical across rows; compute it once.
    if (!isLast) {
      const newWeight = new Float32Array(OVERLAP_SAMPLES);
      for (let i = 0; i < OVERLAP_SAMPLES; i++) {
        const local = finalEnd + i - start;
        if (local < copyLength && finalEnd + i < this.totalSamples) {
          newWeight[i] = window[local];
        }
      }
      this.carryWeight = newWeight;
      this.carry = nextCarry;
    }
    this.finalisedTo = Math.min(finalEnd, this.totalSamples);
    this.nextStart = start + STRIDE_SAMPLES;
  }

  get finalisedSamples(): number {
    return this.finalisedTo;
  }
}

/* ---------------- 16-bit PCM conversions ---------------- */

export function floatToInt16(v: number): number {
  const clamped = Math.max(-1, Math.min(1, v));
  return Math.round(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff);
}

export function float32ToInt16(f32: Float32Array): Int16Array<ArrayBuffer> {
  const out = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) out[i] = floatToInt16(f32[i]);
  return out;
}

export function int16ToFloat32(i16: Int16Array): Float32Array {
  const out = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) {
    const v = i16[i];
    out[i] = v < 0 ? v / 0x8000 : v / 0x7fff;
  }
  return out;
}

/** Reference (non-incremental) overlap-add used to validate the
 *  accumulator in tests: accumulate everything in Float32, then normalise
 *  and quantise. */
export function referenceOverlapAdd(
  totalSamples: number,
  chunks: { plan: ChunkPlan; stems: Float32Array; window: Float32Array }[],
): Int16Array<ArrayBuffer>[] {
  const rows = N_STEMS * N_CHANNELS;
  const acc = Array.from({ length: rows }, () => new Float32Array(totalSamples));
  const weight = new Float32Array(totalSamples);
  for (const { plan, stems, window } of chunks) {
    for (let row = 0; row < rows; row++) {
      const src = stems.subarray(row * SEGMENT_SAMPLES);
      for (let i = 0; i < plan.copyLength; i++) {
        const global = plan.start + i;
        if (global >= totalSamples) break;
        acc[row][global] += src[i] * window[i];
        if (row === 0) weight[global] += window[i];
      }
    }
  }
  return acc.map((row) => {
    const out = new Int16Array(totalSamples);
    for (let i = 0; i < totalSamples; i++) {
      out[i] = floatToInt16(weight[i] > 1e-8 ? row[i] / weight[i] : row[i]);
    }
    return out;
  });
}
