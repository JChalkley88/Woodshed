// Stem export encoders: WAV (16-bit and 24-bit PCM) and an uncompressed
// zip container. Both are hand-rolled; PCM does not compress usefully, so
// a STORE-method zip avoids a compression dependency entirely.

/** Interleaves stereo Int16 rows into a WAV file. 16-bit writes samples
 *  as they are; 24-bit shifts them up 8 bits (the stems are 16-bit at
 *  rest, so the extra byte is headroom for editors, not new detail). */
export function encodeWav(
  left: Int16Array,
  right: Int16Array,
  sampleRate: number,
  bitDepth: 16 | 24,
): ArrayBuffer {
  if (left.length !== right.length) {
    throw new Error("channel length mismatch");
  }
  const channels = 2;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = channels * bytesPerSample;
  const dataBytes = left.length * blockAlign;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeAscii(36, "data");
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (let i = 0; i < left.length; i++) {
    for (const sample of [left[i], right[i]]) {
      if (bitDepth === 16) {
        view.setInt16(offset, sample, true);
        offset += 2;
      } else {
        const s24 = sample << 8;
        view.setUint8(offset, s24 & 0xff);
        view.setUint8(offset + 1, (s24 >> 8) & 0xff);
        view.setUint8(offset + 2, (s24 >> 16) & 0xff);
        offset += 3;
      }
    }
  }
  return buffer;
}

/* ---------------- CRC-32 (zip requirement) ---------------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/* ---------------- STORE-method zip ---------------- */

export interface ZipEntry {
  name: string;
  data: ArrayBuffer;
}

/** Minimal zip container, method 0 (stored). Filenames must be ASCII. */
export function encodeZip(entries: ZipEntry[]): ArrayBuffer {
  interface Central {
    name: Uint8Array;
    crc: number;
    size: number;
    offset: number;
  }
  const parts: Uint8Array[] = [];
  const central: Central[] = [];
  let offset = 0;
  const ascii = (text: string) => {
    const out = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0x7f;
    return out;
  };

  for (const entry of entries) {
    const data = new Uint8Array(entry.data);
    const name = ascii(entry.name);
    const crc = crc32(data);
    const header = new Uint8Array(30 + name.length);
    const v = new DataView(header.buffer);
    v.setUint32(0, 0x04034b50, true); // local file header
    v.setUint16(4, 20, true); // version needed
    v.setUint16(8, 0, true); // method: stored
    v.setUint32(14, crc, true);
    v.setUint32(18, data.length, true); // compressed
    v.setUint32(22, data.length, true); // uncompressed
    v.setUint16(26, name.length, true);
    header.set(name, 30);
    central.push({ name, crc, size: data.length, offset });
    parts.push(header, data);
    offset += header.length + data.length;
  }

  const centralStart = offset;
  for (const c of central) {
    const rec = new Uint8Array(46 + c.name.length);
    const v = new DataView(rec.buffer);
    v.setUint32(0, 0x02014b50, true); // central directory header
    v.setUint16(4, 20, true);
    v.setUint16(6, 20, true);
    v.setUint16(10, 0, true); // stored
    v.setUint32(16, c.crc, true);
    v.setUint32(20, c.size, true);
    v.setUint32(24, c.size, true);
    v.setUint16(28, c.name.length, true);
    v.setUint32(42, c.offset, true);
    rec.set(c.name, 46);
    parts.push(rec);
    offset += rec.length;
  }

  const end = new Uint8Array(22);
  const v = new DataView(end.buffer);
  v.setUint32(0, 0x06054b50, true); // end of central directory
  v.setUint16(8, central.length, true);
  v.setUint16(10, central.length, true);
  v.setUint32(12, offset - centralStart, true);
  v.setUint32(16, centralStart, true);
  parts.push(end);

  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const p of parts) {
    out.set(p, cursor);
    cursor += p.length;
  }
  return out.buffer;
}

/** Triggers a browser download for the given bytes. */
export function downloadBytes(
  bytes: ArrayBuffer,
  fileName: string,
  mime: string,
): void {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
