import { describe, expect, it } from "vitest";
import { contentKey, stemBytesFor } from "./cache.ts";
import { MODEL_ID } from "./constants.ts";

function tone(seed: number): Float32Array {
  const out = new Float32Array(4096);
  for (let i = 0; i < out.length; i++) out[i] = Math.sin(i / seed);
  return out;
}

describe("contentKey", () => {
  it("is deterministic for identical content", async () => {
    const a = await contentKey([tone(7), tone(11)]);
    const b = await contentKey([tone(7), tone(11)]);
    expect(a).toBe(b);
  });

  it("carries the model identifier so model upgrades never serve stale stems", async () => {
    const key = await contentKey([tone(7), tone(11)]);
    expect(key.endsWith(`:${MODEL_ID}`)).toBe(true);
    const other = await contentKey([tone(7), tone(11)], "some_other_model");
    expect(other).not.toBe(key);
    expect(other.split(":")[0]).toBe(key.split(":")[0]);
  });

  it("differs when the audio content differs", async () => {
    const a = await contentKey([tone(7), tone(11)]);
    const b = await contentKey([tone(7), tone(13)]);
    expect(a).not.toBe(b);
  });

  it("is sensitive to channel order", async () => {
    const a = await contentKey([tone(7), tone(11)]);
    const b = await contentKey([tone(11), tone(7)]);
    expect(a).not.toBe(b);
  });
});

describe("stemBytesFor", () => {
  it("accounts for 4 stereo stems at 16-bit", () => {
    // One second at 44.1kHz: 44100 * 4 stems * 2 channels * 2 bytes.
    expect(stemBytesFor(44100)).toBe(705_600);
  });
});
