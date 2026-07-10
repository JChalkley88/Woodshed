import { expect, test } from "@playwright/test";

test("studio desk renders", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".brandplate-name")).toHaveText("Woodshed");
  await expect(page.getByTestId("deck-message")).toContainText("LOAD A SONG");
  await expect(page.getByTestId("time-readout")).toHaveText("00:00.0");
  await expect(
    page.getByText("All processing on this device — nothing uploaded"),
  ).toBeVisible();
});

test("hardware QA page shows every component family", async ({ page }) => {
  await page.goto("/hardware");
  for (const section of [
    "4.1 Knob",
    "4.2 Channel fader",
    "4.3 Tempo fader",
    "4.4 Buttons",
    "4.5 LED meter",
    "4.6 LCD",
    "4.7 Scribble strip",
    "4.8 Transport",
  ]) {
    await expect(page.getByRole("heading", { name: section })).toBeVisible();
  }
  // Full state coverage spot-checks.
  await expect(page.locator(".hw-knob")).toHaveCount(4);
  await expect(page.locator(".hw-fader-slot")).toHaveCount(9);
  await expect(page.locator(".hw-seg-red")).toHaveCount(2);
  await expect(page.locator(".hw-chord-now")).toHaveText("A7");
  await expect(page.locator(".hw-looplamp-on")).toBeVisible();
});
