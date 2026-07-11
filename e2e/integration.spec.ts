import { existsSync } from "node:fs";
import { expect, test } from "@playwright/test";

// Real end-to-end separation of the 6-second fixture through the actual
// ONNX pipeline (one chunk). Heavy: session creation plus one inference,
// WASM in headless Chromium (no WebGPU there), so the timeout is generous.
// Skipped automatically when the gitignored model file is absent.
const MODEL_PRESENT = existsSync("models/htdemucs_fp16_preopt.onnx");

declare global {
  interface Window {
    __woodshedLastOutcome?: {
      stemRms: number[];
      reconstructionError: number | null;
      ep: string;
      fromCache: boolean;
      elapsedMs: number | null;
    };
  }
}

test.skip(!MODEL_PRESENT, "models/htdemucs_fp16_preopt.onnx not present");

test("separates the fixture for real: four stems, sane output, cached", async ({
  page,
}) => {
  test.setTimeout(360_000);
  await page.goto("/");
  await page
    .getByTestId("file-input")
    .setInputFiles("e2e/fixtures/test-tone.wav");

  // Night 3: separation is explicit, never a side effect of loading.
  await page.getByRole("button", { name: "Separate into stems" }).click();
  await expect(page.getByTestId("separation-status")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("stem-lanes")).toBeVisible({
    timeout: 300_000,
  });
  await expect(page.getByTestId("waveform-lane")).toHaveCount(4);

  const outcome = await page.evaluate(() => window.__woodshedLastOutcome!);
  expect(outcome.fromCache).toBe(false);
  expect(["webgpu", "wasm"]).toContain(outcome.ep);
  expect(outcome.stemRms).toHaveLength(4);
  for (const rms of outcome.stemRms) expect(Number.isFinite(rms)).toBe(true);
  // The fixture is bass + chord + click with no vocals: stems must be
  // differentiated, with real energy somewhere and near-silence in vocals.
  const [drums, bass, other, vocals] = outcome.stemRms;
  expect(Math.max(drums, bass, other)).toBeGreaterThan(0.01);
  expect(vocals).toBeLessThan(Math.max(drums, bass, other) / 3);
  // Mix reconstruction error under 5% (brief).
  expect(outcome.reconstructionError).not.toBeNull();
  expect(outcome.reconstructionError!).toBeLessThan(0.05);

  // Cached reopen is instant (same profile, fresh page), no SEPARATE step.
  await page.goto("/");
  await page
    .getByTestId("file-input")
    .setInputFiles("e2e/fixtures/test-tone.wav");
  await expect(page.getByTestId("stem-lanes")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("separate-control")).toHaveCount(0);
  const cached = await page.evaluate(() => window.__woodshedLastOutcome!);
  expect(cached.fromCache).toBe(true);
});
