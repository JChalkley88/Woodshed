import { expect, test, type Page } from "@playwright/test";

// Chord analysis (real DSP on the 6-second fixture; CPU-light, no
// separation involved), stem export against mock-separated stems, and the
// LOCKED treatment with the licence panel.

async function loadFixture(page: Page) {
  await page
    .getByTestId("file-input")
    .setInputFiles("e2e/fixtures/test-tone.wav");
  await expect(page.getByTestId("song-label")).toHaveText("test-tone.wav");
}

test("chord analysis runs on demand, fills the lane, seeks on tap, and caches", async ({
  page,
}) => {
  await page.goto("/studio?mockSeparation=1");
  await loadFixture(page);

  // Honest empty state, beta label, and no auto-analysis on load.
  await expect(page.getByTestId("chord-readout")).toHaveText("NO CHORDS YET");
  await expect(page.getByTestId("chord-status")).toContainText(/beta/i);

  await page.getByRole("button", { name: "Analyse chords" }).click();
  await expect(page.getByTestId("chord-lane")).toBeVisible({
    timeout: 30_000,
  });
  const chips = page.getByTestId("chord-chip");
  expect(await chips.count()).toBeGreaterThan(0);

  // Tapping a chip seeks the transport to its start: move the playhead
  // away first, then tap the first chip (start 0) and land back on it.
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("time-readout")).not.toHaveText("00:00.0");
  await chips.first().click();
  await expect(page.getByTestId("time-readout")).toHaveText("00:00.0");

  // Reload: chords restore from the IndexedDB cache with no re-analysis.
  await page.goto("/studio?mockSeparation=1");
  await loadFixture(page);
  await expect(page.getByTestId("chord-lane")).toBeVisible({ timeout: 5_000 });
});

test("stems export as WAV files and as a zip", async ({ page }) => {
  await page.goto("/studio?mockSeparation=1");
  await loadFixture(page);
  await page.getByRole("button", { name: "Separate into stems" }).click();
  await expect(page.getByTestId("stem-lanes")).toBeVisible({ timeout: 15_000 });

  const rack = page.getByTestId("export-rack");
  await expect(rack).toBeVisible();
  await expect(page.getByTestId("export-readout")).toHaveText("WAV 16-BIT");

  // Zip export: one download containing every stem.
  const zipDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export stems as a zip" }).click();
  expect((await zipDownload).suggestedFilename()).toBe("test-tone-stems.zip");

  // 24-bit toggle reflects in the readout, then per-stem WAVs download.
  await page.getByRole("button", { name: "Export at 24 bit" }).click();
  await expect(page.getByTestId("export-readout")).toHaveText("WAV 24-BIT");
  const downloads: string[] = [];
  page.on("download", (d) => void downloads.push(d.suggestedFilename()));
  await page.getByRole("button", { name: "Export stems as WAV files" }).click();
  await expect.poll(() => downloads.length, { timeout: 10_000 }).toBe(4);
  expect(downloads.sort()).toEqual([
    "test-tone-bass.wav",
    "test-tone-drums.wav",
    "test-tone-other.wav",
    "test-tone-vocals.wav",
  ]);
});

test("locked state greys the paid controls and opens the licence rack unit", async ({
  page,
}) => {
  await page.goto("/studio?mockSeparation=1&locked=1");
  await loadFixture(page);

  // Chord control present but LOCKED; free features untouched.
  await expect(page.getByTestId("chord-readout")).toHaveText("LOCKED");
  await expect(page.getByRole("button", { name: "Analyse chords" })).toBeVisible();

  // Export rack appears with the stems and reads LOCKED too.
  await page.getByRole("button", { name: "Separate into stems" }).click();
  await expect(page.getByTestId("stem-lanes")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("export-readout")).toHaveText("LOCKED");
  // Bit-depth LEDs stay unlit while locked.
  await expect(
    page.getByRole("button", { name: "Export at 16 bit" }),
  ).toHaveAttribute("aria-pressed", "false");

  // Interacting with a locked control opens the licence panel; no export
  // happens.
  let downloaded = false;
  page.on("download", () => void (downloaded = true));
  await page.getByRole("button", { name: "Export stems as a zip" }).click();
  await expect(page.getByTestId("licence-panel")).toBeVisible();
  expect(downloaded).toBe(false);
  await page.getByRole("button", { name: "Close licence panel" }).click();
  await expect(page.getByTestId("licence-panel")).toHaveCount(0);

  // The chord control routes to the same panel.
  await page.getByRole("button", { name: "Analyse chords" }).click();
  await expect(page.getByTestId("licence-panel")).toBeVisible();

  // Free features still work while locked: mute latches.
  const muteOther = page.getByRole("button", { name: "Mute Other" });
  await muteOther.click();
  await expect(muteOther).toHaveAttribute("aria-pressed", "true");
});
