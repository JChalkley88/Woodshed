// Night 2 benchmark: full-song separation through the real product UI.
// Measures wall time, which EP ran, JS heap peak (sampled), and cached
// reopen time. Usage:
//   node scripts/bench-night2.mjs <wavPath> <outJson> [--headless]
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const wav = process.argv[2];
const out = process.argv[3] ?? "spike/night2-bench.json";
const headless = process.argv.includes("--headless");
if (!wav) throw new Error("usage: node scripts/bench-night2.mjs <wav> <out>");

async function serverUp() {
  try {
    return (await fetch("http://localhost:5173/")).ok;
  } catch {
    return false;
  }
}
let devServer = null;
if (!(await serverUp())) {
  devServer = spawn("npm", ["run", "dev"], { shell: true, stdio: "ignore" });
  for (let i = 0; i < 60 && !(await serverUp()); i++) {
    await new Promise((r) => setTimeout(r, 1000));
  }
}

const browser = await chromium.launch(
  headless
    ? { headless: true }
    : { channel: "chrome", headless: false, args: ["--enable-unsafe-webgpu"] },
);
const page = await browser.newPage();
page.on("console", (m) => {
  if (m.type() === "error") console.error("[page]", m.text());
});
await page.goto("http://localhost:5173/");
await page.getByTestId("file-input").setInputFiles(wav);

console.log("separating (watch the LCD)...");
const t0 = Date.now();
let peakHeapMB = 0;
let lastStatus = "";
const heapTimer = setInterval(async () => {
  try {
    const heap = await page.evaluate(
      () => performance.memory?.usedJSHeapSize ?? 0,
    );
    peakHeapMB = Math.max(peakHeapMB, Math.round(heap / 1048576));
    const error = await page
      .getByTestId("deck-error")
      .textContent()
      .catch(() => null);
    if (error) {
      console.error(`FAILED after ${Math.round((Date.now() - t0) / 1000)}s: ${error}`);
      process.exitCode = 1;
    }
    const status = await page
      .getByTestId("separation-status")
      .textContent()
      .catch(() => "");
    if (status && status !== lastStatus) {
      console.log(`${Math.round((Date.now() - t0) / 1000)}s  ${status.trim()}  heap ${peakHeapMB}MB`);
      lastStatus = status;
    }
  } catch {
    /* page busy */
  }
}, 5000);

await page
  .getByTestId("stem-lanes")
  .waitFor({ state: "visible", timeout: 45 * 60 * 1000 });
clearInterval(heapTimer);
const separationSeconds = Math.round((Date.now() - t0) / 1000);
const outcome = await page.evaluate(() => window.__woodshedLastOutcome ?? null);

// Cached reopen timing on a fresh page.
await page.goto("http://localhost:5173/");
const t1 = Date.now();
await page.getByTestId("file-input").setInputFiles(wav);
await page
  .getByTestId("stem-lanes")
  .waitFor({ state: "visible", timeout: 60_000 });
const reopenMs = Date.now() - t1;

const result = {
  wav,
  headless,
  separationSeconds,
  peakHeapMB,
  reopenMs,
  outcome,
};
mkdirSync("spike", { recursive: true });
writeFileSync(out, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
await browser.close();
if (devServer) devServer.kill();
