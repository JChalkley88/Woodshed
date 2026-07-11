import { expect, test } from "@playwright/test";

// Cross-browser degradation paths with capabilities mocked via init
// scripts (per the brief: code paths and messaging, no real separations
// per browser). Chromium plays the part of Firefox and Safari by having
// the relevant APIs removed before the app boots.

test("no WebGPU shows the honest processor-path notice (the Firefox case)", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "gpu", { value: undefined });
  });
  await page.goto("/studio?mockSeparation=1");
  const notice = page.getByTestId("capability-notice");
  await expect(notice).toContainText("NO GPU ACCELERATION");
  await expect(notice).toContainText("SAME QUALITY");
  // Degraded, not blocked: the desk works normally.
  await page
    .getByTestId("file-input")
    .setInputFiles("e2e/fixtures/test-tone.wav");
  await expect(
    page.getByRole("button", { name: "Separate into stems" }),
  ).toBeVisible();
});

test("no cross-origin isolation shows the header guidance (the Safari/self-hosting case)", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "crossOriginIsolated", { value: false });
  });
  await page.goto("/studio?mockSeparation=1");
  const notice = page.getByTestId("capability-notice");
  await expect(notice).toContainText("SINGLE-THREADED");
  await expect(notice).toContainText("COOP AND COEP");
});

test("a browser without web audio gets a clear block, never a broken desk", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "AudioWorkletNode", { value: undefined });
  });
  await page.goto("/studio?mockSeparation=1");
  const notice = page.getByTestId("capability-notice");
  await expect(notice).toContainText("CANNOT RUN WOODSHED");
  // The desk chrome still renders around the message.
  await expect(page.locator(".brandplate-name")).toHaveText("Woodshed");
  await expect(page.getByTestId("deck-message")).toContainText("LOAD A SONG");
});

test("below the desktop breakpoint the polite panel replaces the desk", async ({
  page,
}) => {
  await page.setViewportSize({ width: 480, height: 800 });
  await page.goto("/studio");
  await expect(page.locator(".small-screen-notice")).toBeVisible();
  await expect(page.locator(".small-screen-notice")).toContainText(
    "built for a desktop or laptop",
  );
  await expect(page.locator(".desk")).not.toBeVisible();
});
