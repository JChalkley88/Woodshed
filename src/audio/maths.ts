// Pure engine maths. No Web Audio here so everything is unit-testable.

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** dB to linear gain. -Infinity (and anything at or below the fader floor)
 *  maps to silence. */
export function dbToGain(db: number): number {
  if (db === -Infinity || db <= FADER_FLOOR_DB) return 0;
  return Math.pow(10, db / 20);
}

/* ---------------- Channel fader taper ----------------
   The fader scale (spec 4.2) reads +10 to -infinity with marks spaced evenly
   down the throw, so position-to-dB is piecewise linear between marks, which
   is the audio taper every real console uses. */
export const FADER_DB_MARKS = [10, 5, 0, -5, -10, -20, -40, -Infinity] as const;
/** Value used internally to represent the -infinity mark. */
export const FADER_FLOOR_DB = -72;

const marks = FADER_DB_MARKS.map((m) => (m === -Infinity ? FADER_FLOOR_DB : m));

/** Fader position (1 = top of throw, 0 = bottom) to dB. */
export function faderPosToDb(pos: number): number {
  const p = clamp(pos, 0, 1);
  const scaled = (1 - p) * (marks.length - 1);
  const i = Math.min(Math.floor(scaled), marks.length - 2);
  const frac = scaled - i;
  return marks[i] + (marks[i + 1] - marks[i]) * frac;
}

/** dB to fader position (1 = top). Inverse of faderPosToDb. */
export function dbToFaderPos(db: number): number {
  const d = clamp(db, FADER_FLOOR_DB, marks[0]);
  for (let i = 0; i < marks.length - 1; i++) {
    const hi = marks[i];
    const lo = marks[i + 1];
    if (d <= hi && d >= lo) {
      const frac = (hi - d) / (hi - lo);
      return 1 - (i + frac) / (marks.length - 1);
    }
  }
  return 0;
}

/* ---------------- Time-stretch ---------------- */
export const SPEED_MIN = 50;
export const SPEED_MAX = 120;

/* ---------------- Pitch shift ---------------- */
export const PITCH_MIN = -6;
export const PITCH_MAX = 6;

/** Pitch shift in whole semitones, clamped to the spec's +/-6 range. */
export function normalisePitch(semitones: number): number {
  return clamp(Math.round(semitones), PITCH_MIN, PITCH_MAX);
}

/** LCD text for the pitch readout: signed semitones. */
export function formatPitch(semitones: number): string {
  return semitones > 0 ? `+${semitones} st` : `${semitones} st`;
}

/** Tempo percentage (50 to 120) to playback rate for the stretch node.
 *  75% -> 0.75. Values outside the fader range are clamped. */
export function speedPercentToRate(percent: number): number {
  return clamp(percent, SPEED_MIN, SPEED_MAX) / 100;
}

/** How long a source of `sourceSeconds` takes to play at `percent` speed. */
export function stretchedDuration(sourceSeconds: number, percent: number): number {
  return sourceSeconds / speedPercentToRate(percent);
}

/* ---------------- Sample conversions ---------------- */
export function samplesToSeconds(samples: number, sampleRate: number): number {
  return samples / sampleRate;
}

export function secondsToSamples(seconds: number, sampleRate: number): number {
  return Math.round(seconds * sampleRate);
}

/* ---------------- Loop boundaries ---------------- */
export const MIN_LOOP_SECONDS = 0.1;

export interface LoopRegion {
  start: number;
  end: number;
}

/** Normalises two loop points against a track duration: orders them, clamps
 *  to [0, duration], and rejects degenerate loops shorter than
 *  MIN_LOOP_SECONDS. Returns null when the pair cannot form a loop. */
export function normaliseLoop(
  a: number,
  b: number,
  duration: number,
): LoopRegion | null {
  if (!Number.isFinite(a) || !Number.isFinite(b) || duration <= 0) return null;
  const start = clamp(Math.min(a, b), 0, duration);
  const end = clamp(Math.max(a, b), 0, duration);
  if (end - start < MIN_LOOP_SECONDS) return null;
  return { start, end };
}

/** Where playback lands when it crosses the loop end. Positions before the
 *  loop are untouched; anything at or past the end wraps into the loop by
 *  the overshoot amount. */
export function wrapLoopPosition(pos: number, loop: LoopRegion): number {
  if (pos < loop.end) return pos;
  const span = loop.end - loop.start;
  return loop.start + ((pos - loop.start) % span);
}

/* ---------------- Solo group ----------------
   Standard console behaviour (spec, Night 3): engaging solo on one or more
   stems silences every non-soloed stem; solos are additive; an explicitly
   muted stem stays silent even while soloed; releasing all solos restores
   the prior mute state (which is why mute flags are never rewritten by
   solo changes, only combined here). */
export interface SoloMuteFlags {
  muted: boolean;
  soloed: boolean;
}

/** True when the strip should be silent given its own flags and whether
 *  any solo is engaged across the group. */
export function isStemSilenced(
  strip: SoloMuteFlags,
  anySoloEngaged: boolean,
): boolean {
  return strip.muted || (anySoloEngaged && !strip.soloed);
}

/** True when at least one strip in the group has solo engaged. */
export function anySoloEngaged(strips: Iterable<SoloMuteFlags>): boolean {
  for (const s of strips) if (s.soloed) return true;
  return false;
}

/* ---------------- Meter ballistics ----------------
   Fast-attack slow-release per spec 4.5 (attack 0.25, release 0.08 per
   frame at ~30fps). */
export function meterBallistics(
  current: number,
  target: number,
  attack = 0.25,
  release = 0.08,
): number {
  const k = target > current ? attack : release;
  return current + (target - current) * k;
}

/** RMS of a float sample block, for meter drive. */
export function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

/* ---------------- Display ---------------- */
/** MM:SS.d, matching the mockup's time LCD. */
export function formatTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = String(Math.floor(s / 60)).padStart(2, "0");
  const rest = (s % 60).toFixed(1).padStart(4, "0");
  return `${m}:${rest}`;
}

/** Fader/scale display for dB values; the floor renders as the infinity mark. */
export function formatDb(db: number): string {
  if (db === -Infinity || db <= FADER_FLOOR_DB) return "-∞";
  const rounded = Math.round(db * 10) / 10;
  return rounded > 0 ? `+${rounded}` : `${rounded}`;
}
