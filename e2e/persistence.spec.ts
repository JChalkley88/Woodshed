import { expect, test, type Page } from "@playwright/test";

// Per-song persistence in IndexedDB: scribble strips, saved loops, and
// last-used mixer state (fader, mute, solo, tempo, pitch) all survive a
// reload. Mock worker throughout.

async function loadFixture(page: Page) {
  await page
    .getByTestId("file-input")
    .setInputFiles("e2e/fixtures/test-tone.wav");
  await expect(page.getByTestId("song-label")).toHaveText("test-tone.wav");
}

test("scribbles, saved loops, and mixer state survive a reload", async ({
  page,
}) => {
  await page.goto("/?mockSeparation=1");
  await loadFixture(page);
  await page.getByRole("button", { name: "Separate into stems" }).click();
  await expect(page.getByTestId("stem-lanes")).toBeVisible({ timeout: 15_000 });

  // Rename the vocals scribble strip.
  await page.getByTestId("strip-vocals").locator(".hw-scrib").click();
  const scribbleInput = page.getByRole("textbox", {
    name: "Scribble strip label",
  });
  await scribbleInput.fill("melody");
  await scribbleInput.press("Enter");

  // Engage a loop and bank it.
  await page.keyboard.press("Space");
  await page.waitForTimeout(400);
  await page.keyboard.press("KeyL");
  await page.waitForTimeout(900);
  await page.keyboard.press("KeyL");
  await page.keyboard.press("Space");
  await expect(page.getByTestId("loop-readout")).toContainText("OUT 00:");
  await page.getByRole("button", { name: "Save current loop" }).click();
  await expect(page.getByTestId("loop-bank")).toContainText("Loop 1");

  // Mixer: slow down, shift down, mute drums, solo bass.
  const tempo = page.getByRole("slider", { name: "Tempo" });
  await tempo.focus();
  await page.keyboard.press("Home");
  for (let i = 0; i < 25; i++) await page.keyboard.press("ArrowUp");
  await expect(page.getByTestId("tempo-readout")).toHaveText("75%");
  const pitch = page.getByRole("slider", { name: "Pitch" });
  await pitch.focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("pitch-readout")).toHaveText("-2 st");
  await page.getByRole("button", { name: "Mute Drums" }).click();
  await page.getByRole("button", { name: "Solo Bass" }).click();

  // Let the persistence write settle, then reload the desk cold.
  await page.waitForTimeout(500);
  await page.goto("/?mockSeparation=1");
  await loadFixture(page);
  await expect(page.getByTestId("stem-lanes")).toBeVisible({ timeout: 5_000 });

  // Everything restored: scribble, saved loop, loop points, mixer.
  await expect(page.getByTestId("strip-vocals")).toContainText("melody");
  await expect(page.getByTestId("loop-bank")).toContainText("Loop 1");
  await expect(page.getByTestId("loop-readout")).toContainText("OUT 00:");
  await expect(page.getByTestId("tempo-readout")).toHaveText("75%");
  await expect(page.getByTestId("pitch-readout")).toHaveText("-2 st");
  await expect(
    page.getByRole("button", { name: "Mute Drums" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: "Solo Bass" }),
  ).toHaveAttribute("aria-pressed", "true");

  // A recalled bank loop engages on GO.
  await page.getByRole("button", { name: "Toggle loop" }).click();
  await expect(page.getByTestId("loop-readout")).toContainText("NO LOOP");
  await page.getByRole("button", { name: "Engage saved loop Loop 1" }).click();
  await expect(page.getByTestId("loop-readout")).toContainText("OUT 00:");
});
