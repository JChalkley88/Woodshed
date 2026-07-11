import { describe, expect, it } from "vitest";
import { computePeaks } from "./engine.ts";
import {
  anySoloEngaged,
  clamp,
  dbToFaderPos,
  dbToGain,
  FADER_FLOOR_DB,
  faderPosToDb,
  formatDb,
  formatTime,
  isStemSilenced,
  meterBallistics,
  normaliseLoop,
  rms,
  samplesToSeconds,
  secondsToSamples,
  speedPercentToRate,
  stretchedDuration,
  wrapLoopPosition,
  type SoloMuteFlags,
} from "./maths.ts";

describe("solo group", () => {
  const strip = (muted: boolean, soloed: boolean): SoloMuteFlags => ({
    muted,
    soloed,
  });

  it("with no solos engaged, only explicit mutes silence", () => {
    expect(isStemSilenced(strip(false, false), false)).toBe(false);
    expect(isStemSilenced(strip(true, false), false)).toBe(true);
  });

  it("engaging solo silences every non-soloed stem", () => {
    const group = [strip(false, true), strip(false, false), strip(false, false), strip(false, false)];
    const anySolo = anySoloEngaged(group);
    expect(anySolo).toBe(true);
    expect(isStemSilenced(group[0], anySolo)).toBe(false);
    expect(isStemSilenced(group[1], anySolo)).toBe(true);
    expect(isStemSilenced(group[2], anySolo)).toBe(true);
  });

  it("solos are additive: every soloed stem is audible", () => {
    const group = [strip(false, true), strip(false, true), strip(false, false), strip(false, false)];
    const anySolo = anySoloEngaged(group);
    expect(isStemSilenced(group[0], anySolo)).toBe(false);
    expect(isStemSilenced(group[1], anySolo)).toBe(false);
    expect(isStemSilenced(group[2], anySolo)).toBe(true);
  });

  it("an explicitly muted stem stays silent even while soloed", () => {
    const group = [strip(true, true), strip(false, false)];
    const anySolo = anySoloEngaged(group);
    expect(isStemSilenced(group[0], anySolo)).toBe(true);
    expect(isStemSilenced(group[1], anySolo)).toBe(true);
  });

  it("releasing all solos restores the prior mute state", () => {
    // Mute flags are never rewritten by solo changes, so dropping the solo
    // flag alone must bring back exactly the pre-solo audibility.
    const before = [strip(true, false), strip(false, false)];
    const during = [strip(true, false), strip(false, true)];
    const anyDuring = anySoloEngaged(during);
    expect(isStemSilenced(during[0], anyDuring)).toBe(true);
    const after = during.map((s) => ({ ...s, soloed: false }));
    const anyAfter = anySoloEngaged(after);
    after.forEach((s, i) =>
      expect(isStemSilenced(s, anyAfter)).toBe(
        isStemSilenced(before[i], false),
      ),
    );
  });
});

describe("clamp", () => {
  it("passes through in-range values", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });
  it("clamps both ends", () => {
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });
});

describe("dbToGain", () => {
  it("unity at 0dB", () => {
    expect(dbToGain(0)).toBe(1);
  });
  it("halves roughly every -6dB", () => {
    expect(dbToGain(-6)).toBeCloseTo(0.501, 2);
  });
  it("+10dB boosts", () => {
    expect(dbToGain(10)).toBeCloseTo(3.162, 2);
  });
  it("silence at and below the floor", () => {
    expect(dbToGain(-Infinity)).toBe(0);
    expect(dbToGain(FADER_FLOOR_DB)).toBe(0);
  });
});

describe("fader taper", () => {
  it("top of throw is +10dB", () => {
    expect(faderPosToDb(1)).toBe(10);
  });
  it("bottom of throw is the floor", () => {
    expect(faderPosToDb(0)).toBe(FADER_FLOOR_DB);
  });
  it("unity sits at its scale mark (2/7 down)", () => {
    expect(faderPosToDb(1 - 2 / 7)).toBeCloseTo(0, 6);
    expect(dbToFaderPos(0)).toBeCloseTo(1 - 2 / 7, 6);
  });
  it("round-trips across the range", () => {
    for (const db of [10, 7.5, 0, -3, -15, -30, -55, FADER_FLOOR_DB]) {
      expect(faderPosToDb(dbToFaderPos(db))).toBeCloseTo(db, 4);
    }
  });
  it("clamps out-of-range positions", () => {
    expect(faderPosToDb(1.5)).toBe(10);
    expect(faderPosToDb(-0.5)).toBe(FADER_FLOOR_DB);
  });
});

describe("stretch ratios", () => {
  it("maps percent to rate", () => {
    expect(speedPercentToRate(100)).toBe(1);
    expect(speedPercentToRate(75)).toBe(0.75);
    expect(speedPercentToRate(50)).toBe(0.5);
    expect(speedPercentToRate(120)).toBe(1.2);
  });
  it("clamps to the fader range", () => {
    expect(speedPercentToRate(30)).toBe(0.5);
    expect(speedPercentToRate(200)).toBe(1.2);
  });
  it("computes stretched duration", () => {
    expect(stretchedDuration(60, 50)).toBe(120);
    expect(stretchedDuration(60, 120)).toBeCloseTo(50, 6);
  });
});

describe("sample conversions", () => {
  it("converts samples to seconds and back", () => {
    expect(samplesToSeconds(44100, 44100)).toBe(1);
    expect(samplesToSeconds(343980, 44100)).toBeCloseTo(7.8, 5);
    expect(secondsToSamples(7.8, 44100)).toBe(343980);
  });
  it("rounds fractional samples", () => {
    expect(secondsToSamples(0.5000001, 44100)).toBe(22050);
  });
});

describe("normaliseLoop", () => {
  it("orders reversed points", () => {
    expect(normaliseLoop(20, 10, 60)).toEqual({ start: 10, end: 20 });
  });
  it("clamps to track bounds", () => {
    expect(normaliseLoop(-5, 90, 60)).toEqual({ start: 0, end: 60 });
  });
  it("rejects degenerate loops", () => {
    expect(normaliseLoop(10, 10.05, 60)).toBeNull();
    expect(normaliseLoop(10, 10, 60)).toBeNull();
  });
  it("rejects invalid input", () => {
    expect(normaliseLoop(NaN, 10, 60)).toBeNull();
    expect(normaliseLoop(0, 10, 0)).toBeNull();
  });
});

describe("wrapLoopPosition", () => {
  const loop = { start: 10, end: 20 };
  it("leaves positions inside the loop alone", () => {
    expect(wrapLoopPosition(15, loop)).toBe(15);
  });
  it("wraps past the end by the overshoot", () => {
    expect(wrapLoopPosition(20, loop)).toBe(10);
    expect(wrapLoopPosition(23, loop)).toBe(13);
  });
  it("wraps multiples of the span", () => {
    expect(wrapLoopPosition(45, loop)).toBe(15);
  });
  it("leaves positions before the loop alone", () => {
    expect(wrapLoopPosition(5, loop)).toBe(5);
  });
});

describe("meterBallistics", () => {
  it("attacks fast", () => {
    expect(meterBallistics(0, 1)).toBeCloseTo(0.25, 6);
  });
  it("releases slowly", () => {
    expect(meterBallistics(1, 0)).toBeCloseTo(0.92, 6);
  });
  it("settles at the target", () => {
    let level = 0;
    for (let i = 0; i < 200; i++) level = meterBallistics(level, 0.5);
    expect(level).toBeCloseTo(0.5, 3);
  });
});

describe("rms", () => {
  it("is zero for silence", () => {
    expect(rms(new Float32Array(128))).toBe(0);
  });
  it("is 1/sqrt(2) for a full-scale square-ish alternation", () => {
    const buf = new Float32Array(128).fill(1);
    expect(rms(buf)).toBeCloseTo(1, 6);
  });
  it("handles empty input", () => {
    expect(rms(new Float32Array(0))).toBe(0);
  });
});

describe("formatTime", () => {
  it("formats MM:SS.d", () => {
    expect(formatTime(0)).toBe("00:00.0");
    expect(formatTime(102.64)).toBe("01:42.6");
    expect(formatTime(259)).toBe("04:19.0");
  });
  it("never goes negative", () => {
    expect(formatTime(-3)).toBe("00:00.0");
  });
});

describe("formatDb", () => {
  it("signs positive values", () => {
    expect(formatDb(5)).toBe("+5");
  });
  it("renders the floor as infinity", () => {
    expect(formatDb(-Infinity)).toBe("-∞");
    expect(formatDb(FADER_FLOOR_DB)).toBe("-∞");
  });
});

describe("computePeaks", () => {
  it("finds the max abs per bucket across channels", () => {
    const left = new Float32Array(100);
    const right = new Float32Array(100);
    left[10] = 0.5;
    right[60] = -0.9;
    const peaks = computePeaks([left, right], 10);
    expect(peaks[1]).toBeCloseTo(0.5, 6);
    expect(peaks[6]).toBeCloseTo(0.9, 6);
    expect(peaks[0]).toBe(0);
  });
  it("handles empty input", () => {
    expect(computePeaks([], 8)).toHaveLength(8);
  });
});
