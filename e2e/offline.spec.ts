import { expect, test, type Page } from "@playwright/test";

// The cached-once, works-forever promise, against a production preview
// build (the only place the service worker registers). The flow: first
// online visit caches the shell and the mock-separated stems; the browser
// then goes offline and the desk must load, reopen the song from cache,
// and keep practising. No real separation or model download is involved.

async function loadFixture(page: Page) {
  await page
    .getByTestId("file-input")
    .setInputFiles("e2e/fixtures/test-tone.wav");
  await expect(page.getByTestId("song-label")).toHaveText("test-tone.wav");
}

test("after one online visit the desk works fully offline", async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);

  // Online first visit: register the SW, separate (mock), let the page
  // finish precaching its own resources.
  await page.goto("/studio?mockSeparation=1&sw=1");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await loadFixture(page);
  await page.getByRole("button", { name: "Separate into stems" }).click();
  await expect(page.getByTestId("stem-lanes")).toBeVisible({ timeout: 15_000 });
  // Give the first-visit precache a moment to finish writing.
  await page.waitForTimeout(1_500);

  // Offline: a fresh navigation must come from the service worker.
  await context.setOffline(true);
  await page.goto("/studio?mockSeparation=1&sw=1");
  await expect(page.getByTestId("song-label")).toContainText(
    "drop a song here",
  );

  // The separated song reopens from IndexedDB with no network at all.
  await loadFixture(page);
  await expect(page.getByTestId("stem-lanes")).toBeVisible({ timeout: 10_000 });

  // And practising works: play, watch the clock advance, loop.
  await page.keyboard.press("Space");
  await expect
    .poll(async () => page.getByTestId("time-readout").textContent(), {
      timeout: 5_000,
    })
    .not.toBe("00:00.0");
  await page.getByRole("button", { name: "Set loop start" }).click();
  await expect(page.getByTestId("loop-readout")).toContainText("SET B");
  await page.keyboard.press("Space");

  // The landing page is cached too.
  await page.goto("/");
  await expect(page.locator("body")).toContainText(/Woodshed/i);
});
