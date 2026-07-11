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
// Slice mode: run for at most N seconds, then cancel cleanly and report
// progress. Partials persist, so repeated slices accumulate to a full
// separation. Works around execution-time caps on this machine.
const budgetArg = process.argv.find((a) => a.startsWith("--budget="));
const budgetSeconds = budgetArg ? Number(budgetArg.split("=")[1]) : null;
if (!wav) throw new Error("usage: node scripts/bench-night2.mjs <wav> <out> [--headless] [--budget=seconds]");

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

// Persistent profile so IndexedDB (stem cache, resume partials) survives
// across benchmark slices and launches.
const profileDir = process.env.BENCH_PROFILE ?? ".bench-profile";
const browser = await chromium.launchPersistentContext(
  profileDir,
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

let sliced = false;
if (budgetSeconds) {
  setTimeout(async () => {
    try {
      const stillGoing = await page
        .getByRole("button", { name: "Cancel separation" })
        .isVisible()
        .catch(() => false);
      if (stillGoing) {
        sliced = true;
        console.log("budget reached; cancelling cleanly (partials persist)");
        await page.getByRole("button", { name: "Cancel separation" }).click();
        await page
          .getByTestId("separation-status")
          .filter({ hasText: "PAUSED" })
          .waitFor({ timeout: 30_000 })
          .catch(() => {});
        const status = await page
          .getByTestId("separation-status")
          .textContent()
          .catch(() => "");
        const result = {
          wav,
          headless,
          slice: true,
          budgetSeconds,
          statusAtCancel: status?.trim() ?? null,
          elapsedSeconds: Math.round((Date.now() - t0) / 1000),
          peakHeapMB,
        };
        mkdirSync("spike", { recursive: true });
        writeFileSync(out, JSON.stringify(result, null, 2));
        console.log(JSON.stringify(result, null, 2));
        await browser.close();
        if (devServer) devServer.kill();
        process.exit(0);
      }
    } catch {
      /* completed already */
    }
  }, budgetSeconds * 1000);
}

try {
  await page
    .getByTestId("stem-lanes")
    .waitFor({ state: "visible", timeout: 25 * 60 * 1000 });
} catch (err) {
  // Dump everything visible before dying so a hang is diagnosable.
  clearInterval(heapTimer);
  const dump = await page.evaluate(() => ({
    status: document.querySelector("[data-testid=separation-status]")?.textContent ?? null,
    error: document.querySelector("[data-testid=deck-error]")?.textContent ?? null,
    warning: document.querySelector("[data-testid=wasm-warning]")?.textContent ?? null,
    song: document.querySelector("[data-testid=song-label]")?.textContent ?? null,
  }));
  console.error("TIMED OUT. Page state:", JSON.stringify(dump, null, 2));
  await page.screenshot({ path: "spike/bench-timeout.png" }).catch(() => {});
  await browser.close();
  if (devServer) devServer.kill();
  process.exit(1);
}
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
