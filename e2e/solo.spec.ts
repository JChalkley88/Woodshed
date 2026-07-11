import { expect, test, type Page } from "@playwright/test";

// Solo-group behaviour on the four stem strips, driven by the scripted
// mock worker. Lane silencing is asserted via data-silenced, which feeds
// the spec 4.9 dim states.

async function loadSeparated(page: Page) {
  await page.goto("/studio?mockSeparation=1");
  await page
    .getByTestId("file-input")
    .setInputFiles("e2e/fixtures/test-tone.wav");
  await expect(page.getByTestId("song-label")).toHaveText("test-tone.wav");
  await page.getByRole("button", { name: "Separate into stems" }).click();
  await expect(page.getByTestId("stem-lanes")).toBeVisible({ timeout: 15_000 });
}

// Lane order on the deck is the display order: vocals, drums, bass, other.
function lane(page: Page, index: number) {
  return page.getByTestId("waveform-lane").nth(index);
}
const VOCALS = 0;
const DRUMS = 1;
const BASS = 2;
const OTHER = 3;

test("solo isolates a stem and dims the rest; release restores everything", async ({
  page,
}) => {
  await loadSeparated(page);

  const soloBass = page.getByRole("button", { name: "Solo Bass" });
  await soloBass.click();
  await expect(soloBass).toHaveAttribute("aria-pressed", "true");
  await expect(lane(page, BASS)).toHaveAttribute("data-silenced", "false");
  await expect(lane(page, VOCALS)).toHaveAttribute("data-silenced", "true");
  await expect(lane(page, DRUMS)).toHaveAttribute("data-silenced", "true");
  await expect(lane(page, OTHER)).toHaveAttribute("data-silenced", "true");

  await soloBass.click();
  for (const i of [VOCALS, DRUMS, BASS, OTHER]) {
    await expect(lane(page, i)).toHaveAttribute("data-silenced", "false");
  }
});

test("solos are additive across strips", async ({ page }) => {
  await loadSeparated(page);

  await page.getByRole("button", { name: "Solo Bass" }).click();
  await page.getByRole("button", { name: "Solo Drums" }).click();
  await expect(lane(page, BASS)).toHaveAttribute("data-silenced", "false");
  await expect(lane(page, DRUMS)).toHaveAttribute("data-silenced", "false");
  await expect(lane(page, VOCALS)).toHaveAttribute("data-silenced", "true");
  await expect(lane(page, OTHER)).toHaveAttribute("data-silenced", "true");
});

test("an explicitly muted stem stays muted through solo and release", async ({
  page,
}) => {
  await loadSeparated(page);

  await page.getByRole("button", { name: "Mute Vocals" }).click();
  await expect(lane(page, VOCALS)).toHaveAttribute("data-silenced", "true");

  // Soloing the muted stem does not unmute it (standard console rule).
  await page.getByRole("button", { name: "Solo Vocals" }).click();
  await expect(lane(page, VOCALS)).toHaveAttribute("data-silenced", "true");

  // Releasing the solo restores the prior mute state exactly.
  await page.getByRole("button", { name: "Solo Vocals" }).click();
  await expect(lane(page, VOCALS)).toHaveAttribute("data-silenced", "true");
  await expect(lane(page, DRUMS)).toHaveAttribute("data-silenced", "false");
  await expect(
    page.getByRole("button", { name: "Mute Vocals" }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("S and M toggle solo and mute on the focused strip", async ({ page }) => {
  await loadSeparated(page);

  await page.getByRole("button", { name: "Mute Bass" }).focus();
  await page.keyboard.press("s");
  await expect(
    page.getByRole("button", { name: "Solo Bass" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(lane(page, DRUMS)).toHaveAttribute("data-silenced", "true");

  await page.keyboard.press("s");
  await expect(
    page.getByRole("button", { name: "Solo Bass" }),
  ).toHaveAttribute("aria-pressed", "false");

  await page.keyboard.press("m");
  await expect(
    page.getByRole("button", { name: "Mute Bass" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(lane(page, BASS)).toHaveAttribute("data-silenced", "true");
});
