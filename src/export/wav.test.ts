import { describe, expect, it } from "vitest";
import { crc32, encodeWav, encodeZip } from "./wav.ts";

const ascii = (view: DataView, offset: number, length: number) =>
  Array.from({ length }, (_, i) =>
    String.fromCharCode(view.getUint8(offset + i)),
  ).join("");

describe("encodeWav", () => {
  const left = new Int16Array([0, 1000, -1000, 32767, -32768]);
  const right = new Int16Array([5, -5, 0, 100, -100]);

  it("writes a correct 16-bit header and interleaved data", () => {
    const buf = encodeWav(left, right, 44100, 16);
    const v = new DataView(buf);
    expect(ascii(v, 0, 4)).toBe("RIFF");
    expect(ascii(v, 8, 4)).toBe("WAVE");
    expect(v.getUint16(20, true)).toBe(1); // PCM
    expect(v.getUint16(22, true)).toBe(2); // stereo
    expect(v.getUint32(24, true)).toBe(44100);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(left.length * 4);
    expect(buf.byteLength).toBe(44 + left.length * 4);
    // Interleaving: L0 R0 L1 R1...
    expect(v.getInt16(44, true)).toBe(0);
    expect(v.getInt16(46, true)).toBe(5);
    expect(v.getInt16(48, true)).toBe(1000);
    expect(v.getInt16(50, true)).toBe(-5);
  });

  it("writes 24-bit samples as 16-bit shifted up 8 bits", () => {
    const buf = encodeWav(left, right, 44100, 24);
    const v = new DataView(buf);
    expect(v.getUint16(34, true)).toBe(24);
    expect(v.getUint32(28, true)).toBe(44100 * 6); // byte rate
    expect(buf.byteLength).toBe(44 + left.length * 6);
    // Sample L1 = 1000 -> 256000 little-endian 3 bytes at offset 44+6.
    const b0 = v.getUint8(50);
    const b1 = v.getUint8(51);
    const b2 = v.getUint8(52);
    const value = (b0 | (b1 << 8) | (b2 << 16)) << 8 >> 8; // sign-extend
    expect(value).toBe(1000 << 8);
  });

  it("round-trips negative 24-bit samples", () => {
    const buf = encodeWav(new Int16Array([-32768]), new Int16Array([0]), 44100, 24);
    const v = new DataView(buf);
    const value = (v.getUint8(44) | (v.getUint8(45) << 8) | (v.getUint8(46) << 16)) << 8 >> 8;
    expect(value).toBe(-32768 << 8);
  });

  it("rejects mismatched channel lengths", () => {
    expect(() => encodeWav(new Int16Array(3), new Int16Array(4), 44100, 16)).toThrow();
  });
});

describe("crc32", () => {
  it("matches the reference value for a known vector", () => {
    // CRC-32 of ASCII "123456789" is 0xCBF43926.
    const data = new Uint8Array([...("123456789" as string)].map((c) => c.charCodeAt(0)));
    expect(crc32(data)).toBe(0xcbf43926);
  });
});

describe("encodeZip", () => {
  it("produces a well-formed stored archive", () => {
    const a = new TextEncoder().encode("hello").buffer as ArrayBuffer;
    const b = new TextEncoder().encode("world!").buffer as ArrayBuffer;
    const zip = encodeZip([
      { name: "a.txt", data: a },
      { name: "b.txt", data: b },
    ]);
    const v = new DataView(zip);
    // Local header signatures at expected offsets.
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    const firstEntry = 30 + 5 + 5; // header + name + data
    expect(v.getUint32(firstEntry, true)).toBe(0x04034b50);
    // End-of-central-directory record with 2 entries.
    const eocd = zip.byteLength - 22;
    expect(v.getUint32(eocd, true)).toBe(0x06054b50);
    expect(v.getUint16(eocd + 10, true)).toBe(2);
    // Central directory sits where the EOCD says it does.
    const centralStart = v.getUint32(eocd + 16, true);
    expect(v.getUint32(centralStart, true)).toBe(0x02014b50);
    // CRC recorded in the first local header matches the data.
    expect(v.getUint32(14, true)).toBe(crc32(new Uint8Array(a)));
  });
});
