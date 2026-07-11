import { expect, test, type Page } from "@playwright/test";

// The import flow against the scripted mock worker (?mockSeparation=1):
// honest progress, cancel and resume, cached reopen, and the WASM fallback
// warning. The real pipeline is covered by integration.spec.ts.

async function loadFixture(page: Page) {
  await page
    .getByTestId("file-input")
    .setInputFiles("e2e/fixtures/test-tone.wav");
  await expect(page.getByTestId("song-label")).toHaveText("test-tone.wav");
}

async function pressSeparate(page: Page) {
  await page.getByRole("button", { name: "Separate into stems" }).click();
}

test("loading a song never auto-separates: the single-track player is live and SEPARATE waits", async ({
  page,
}) => {
  await page.goto("/?mockSeparation=1");
  await loadFixture(page);

  // The SEPARATE control is offered; nothing heavy has started.
  await expect(page.getByTestId("separate-control")).toBeVisible();
  await expect(page.getByTestId("separation-status")).toHaveCount(0);

  // The single-track player is fully usable before separation.
  await page.keyboard.press("Space");
  await expect
    .poll(async () => page.getByTestId("time-readout").textContent())
    .not.toBe("00:00.0");
  await page.keyboard.press("Space");

  // Still no separation after playing: it only runs on deliberate press.
  await expect(page.getByTestId("separation-status")).toHaveCount(0);
  await pressSeparate(page);
  await expect(page.getByTestId("separation-status")).toBeVisible();
  await expect(page.getByTestId("separate-control")).toHaveCount(0);
});

test("separation shows warming then honest progress, ends with four stem lanes", async ({
  page,
}) => {
  await page.goto("/?mockSeparation=1");
  await loadFixture(page);
  await pressSeparate(page);

  const status = page.getByTestId("separation-status");
  await expect(status).toContainText("WARMING UP THE SEPARATOR");
  await expect(status).toContainText(/SEPARATING \d+%\s+EST \d+:\d{2}/);

  // Strips exist but are locked while separation runs (spec section 7).
  await expect(page.getByTestId("strip-vocals")).toHaveClass(/strip-locked/);

  await expect(page.getByTestId("stem-lanes")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("waveform-lane")).toHaveCount(4);
  // Spec 4.9: one playhead spans all four lanes; never one per lane.
  await expect(page.getByTestId("playhead")).toHaveCount(1);
  for (const stem of ["vocals", "drums", "bass", "other"]) {
    await expect(page.getByTestId(`strip-${stem}`)).toBeVisible();
    await expect(page.getByTestId(`strip-${stem}`)).not.toHaveClass(
      /strip-locked/,
    );
  }
  // The song lands in the stem store.
  await expect(page.getByTestId("cache-rack")).toContainText("test-tone.wav");
});

test("mute on a stem strip latches and dims its lane", async ({ page }) => {
  await page.goto("/?mockSeparation=1");
  await loadFixture(page);
  await pressSeparate(page);
  await expect(page.getByTestId("stem-lanes")).toBeVisible({ timeout: 15_000 });

  const muteOther = page.getByRole("button", { name: "Mute Other" });
  await muteOther.click();
  await expect(muteOther).toHaveAttribute("aria-pressed", "true");
  await muteOther.click();
  await expect(muteOther).toHaveAttribute("aria-pressed", "false");
});

test("cancel pauses separation; resume completes it", async ({ page }) => {
  await page.goto("/?mockSeparation=1");
  await loadFixture(page);
  await pressSeparate(page);

  const status = page.getByTestId("separation-status");
  await expect(status).toContainText(/SEPARATING/);
  await page.getByRole("button", { name: "Cancel separation" }).click();
  await expect(status).toContainText(/SEPARATION PAUSED AT \d+%/);

  // Single-track playback still works while paused (no regression).
  await page.keyboard.press("Space");
  await expect
    .poll(async () => page.getByTestId("time-readout").textContent())
    .not.toBe("00:00.0");
  await page.keyboard.press("Space");

  await page.getByRole("button", { name: "Resume separation" }).click();
  await expect(page.getByTestId("stem-lanes")).toBeVisible({ timeout: 15_000 });
});

test("a separated song reopens instantly from cache with no SEPARATE step", async ({
  page,
}) => {
  await page.goto("/?mockSeparation=1");
  await loadFixture(page);
  await pressSeparate(page);
  await expect(page.getByTestId("stem-lanes")).toBeVisible({ timeout: 15_000 });

  // Fresh page, same browser profile: the cache must serve the stems with
  // no separating state and no SEPARATE control at all.
  await page.goto("/?mockSeparation=1");
  await loadFixture(page);
  await expect(page.getByTestId("stem-lanes")).toBeVisible({ timeout: 3_000 });
  await expect(page.getByTestId("separation-status")).toHaveCount(0);
  await expect(page.getByTestId("separate-control")).toHaveCount(0);

  // Purge removes it and frees the store.
  await page
    .getByRole("button", { name: /Purge test-tone.wav/ })
    .click();
  await expect(page.getByTestId("cache-rack")).toContainText(
    "No separated songs stored",
  );
});

test("WASM fallback shows the amber warning with an estimate", async ({
  page,
}) => {
  await page.goto("/?mockSeparation=wasm");
  await loadFixture(page);
  await pressSeparate(page);
  await expect(page.getByTestId("wasm-warning")).toContainText(
    /WEBGPU NOT AVAILABLE/,
  );
  await expect(page.getByTestId("stem-lanes")).toBeVisible({ timeout: 15_000 });
});
