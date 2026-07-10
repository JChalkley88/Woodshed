// Generates e2e/fixtures/test-tone.wav: 6 seconds of stereo 44.1kHz 16-bit
// audio (bass + chord + click) used by the Playwright practice-flow test.
import { mkdirSync, writeFileSync } from "node:fs";

const SR = 44100;
const SECONDS = 6;
const n = SR * SECONDS;
const channels = [new Float32Array(n), new Float32Array(n)];
for (let i = 0; i < n; i++) {
  const t = i / SR;
  const bass = 0.4 * Math.sin(2 * Math.PI * 82.41 * t);
  const chord =
    0.15 * Math.sin(2 * Math.PI * 220 * t) +
    0.12 * Math.sin(2 * Math.PI * 329.63 * t);
  const click = t % 0.5 < 0.01 ? 0.5 : 0;
  channels[0][i] = bass + chord + click;
  channels[1][i] = bass * 0.8 + chord * 1.1 + click;
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
    const v = Math.max(-1, Math.min(1, channels[c][i]));
    buf.writeInt16LE(Math.round(v < 0 ? v * 0x8000 : v * 0x7fff), off);
    off += 2;
  }
}
mkdirSync("e2e/fixtures", { recursive: true });
writeFileSync("e2e/fixtures/test-tone.wav", buf);
console.log(`wrote e2e/fixtures/test-tone.wav (${(buf.length / 1024).toFixed(0)} KB)`);
