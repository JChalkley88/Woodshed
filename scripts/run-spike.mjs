// Drives the /spike page in a real Chrome (WebGPU needs it; headless
// Chromium's WebGPU support is patchy on Windows) and saves the benchmark
// JSON to spike/results.json for STATE.md.
// Usage: npm run spike   (expects the dev server on :5173, or starts one)
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const URL = "http://localhost:5173/spike?autorun=1";
const OUT = "spike/results.json";
const TIMEOUT_MS = 30 * 60 * 1000; // WASM runs can be slow; be patient.

async function serverUp() {
  try {
    const res = await fetch("http://localhost:5173/");
    return res.ok;
  } catch {
    return false;
  }
}

let devServer = null;
if (!(await serverUp())) {
  console.log("starting dev server...");
  devServer = spawn("npm", ["run", "dev"], {
    shell: true,
    stdio: "ignore",
    detached: false,
  });
  for (let i = 0; i < 60 && !(await serverUp()); i++) {
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!(await serverUp())) throw new Error("dev server failed to start");
}

console.log("launching Chrome...");
const browser = await chromium.launch({
  channel: "chrome",
  headless: false,
  args: ["--enable-unsafe-webgpu", "--window-size=900,700"],
});
const page = await browser.newPage();
page.on("console", (msg) => {
  if (msg.type() === "error") console.error("[page]", msg.text());
});
await page.goto(URL);

console.log("running benchmarks (this can take many minutes on WASM)...");
const start = Date.now();
while (Date.now() - start < TIMEOUT_MS) {
  const results = await page.evaluate(() => window.__SPIKE_RESULTS__ ?? null);
  if (results) {
    mkdirSync("spike", { recursive: true });
    writeFileSync(OUT, JSON.stringify(results, null, 2));
    console.log(`saved ${OUT}`);
    console.table(
      results.results.map((r) => ({
        run: r.label,
        ok: r.ok,
        chunk_s: r.chunkSeconds,
        create_ms: r.sessionCreateMs,
        infer_ms: r.inferenceMs?.join("/"),
        steady_ms: r.steadyStateMs,
        err: r.error?.slice(0, 60),
      })),
    );
    await browser.close();
    if (devServer) devServer.kill();
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 2000));
}
console.error("spike timed out");
await browser.close();
if (devServer) devServer.kill();
process.exit(1);
