// Generates a synthetic "song" WAV for benchmarks: bass line, drums-ish
// clicks and noise bursts, chord pad, and a melody, varying over time so
// every chunk has real work to do. Usage:
//   node scripts/make-song.mjs <seconds> <outPath>
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const seconds = Number(process.argv[2] ?? 240);
const out = process.argv[3] ?? `bench-song-${seconds}s.wav`;
const SR = 44100;
const n = SR * seconds;
const ch = [new Float32Array(n), new Float32Array(n)];

const bassNotes = [55, 61.74, 73.42, 82.41];
for (let i = 0; i < n; i++) {
  const t = i / SR;
  const bar = Math.floor(t / 2);
  const beat = (t * 2) % 1;
  const bass =
    0.28 * Math.sin(2 * Math.PI * bassNotes[bar % 4] * t) * (0.4 + 0.6 * Math.exp(-beat * 3));
  const kick = beat < 0.03 ? 0.5 * Math.sin(2 * Math.PI * 55 * beat * 20) : 0;
  const hat = (t * 4) % 1 < 0.02 ? (Math.random() - 0.5) * 0.3 : 0;
  const chord =
    0.09 *
    (Math.sin(2 * Math.PI * 220 * t) +
      Math.sin(2 * Math.PI * 277.18 * t) +
      Math.sin(2 * Math.PI * 329.63 * t)) *
    (0.5 + 0.5 * Math.sin(2 * Math.PI * t / 8));
  const melody =
    0.12 * Math.sin(2 * Math.PI * (440 * Math.pow(2, (bar % 8) / 12)) * t) *
    Math.max(0, Math.sin(2 * Math.PI * t / 4));
  ch[0][i] = bass + kick + hat * 0.8 + chord + melody * 0.7;
  ch[1][i] = bass * 0.9 + kick + hat * 1.2 + chord * 1.1 + melody;
}

const buf = Buffer.alloc(44 + n * 4);
buf.write("RIFF", 0);
buf.writeUInt32LE(36 + n * 4, 4);
buf.write("WAVE", 8);
buf.write("fmt ", 12);
buf.writeUInt32LE(16, 16);
buf.writeUInt16LE(1, 20);
buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(SR, 24);
buf.writeUInt32LE(SR * 4, 28);
buf.writeUInt16LE(4, 32);
buf.writeUInt16LE(16, 34);
buf.write("data", 36);
buf.writeUInt32LE(n * 4, 40);
let off = 44;
for (let i = 0; i < n; i++) {
  for (let c = 0; c < 2; c++) {
    const v = Math.max(-1, Math.min(1, ch[c][i]));
    buf.writeInt16LE(Math.round(v < 0 ? v * 0x8000 : v * 0x7fff), off);
    off += 2;
  }
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, buf);
console.log(`wrote ${out} (${(buf.length / 1048576).toFixed(1)} MB, ${seconds}s)`);
