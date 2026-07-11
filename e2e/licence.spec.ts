import { expect, test, type Page } from "@playwright/test";

// Licence lifecycle against a mocked Lemon Squeezy licence API (route
// interception; no real network, no secrets). ?locked=1 disables the dev
// permissiveness so the real gate applies.

const API = "https://api.lemonsqueezy.com/v1/licenses";

function mockLicenceApi(page: Page, options: { valid?: boolean } = {}) {
  const valid = options.valid ?? true;
  return Promise.all([
    page.route(`${API}/activate`, (route) =>
      route.fulfill({
        json: valid
          ? {
              activated: true,
              error: null,
              instance: { id: "inst-test-1", name: "Woodshed desk" },
              meta: {
                store_id: 0,
                product_id: 0,
                product_name: "Woodshed",
                customer_email: "player@example.com",
              },
            }
          : { activated: false, error: "license_key not found" },
      }),
    ),
    page.route(`${API}/validate`, (route) =>
      route.fulfill({ json: { valid, error: null } }),
    ),
    page.route(`${API}/deactivate`, (route) =>
      route.fulfill({ json: { deactivated: true, error: null } }),
    ),
  ]);
}

async function loadFixture(page: Page) {
  await page
    .getByTestId("file-input")
    .setInputFiles("e2e/fixtures/test-tone.wav");
  await expect(page.getByTestId("song-label")).toHaveText("test-tone.wav");
}

async function openPanelAndActivate(page: Page, key: string) {
  await page.getByRole("button", { name: "Open licence panel" }).click();
  await page.getByRole("textbox", { name: "Licence key" }).fill(key);
  await page.getByRole("button", { name: "Activate licence key" }).click();
}

test("activating a key unlocks export and chords; releasing relocks", async ({
  page,
}) => {
  await mockLicenceApi(page);
  await page.goto("/?mockSeparation=1&locked=1");
  await loadFixture(page);

  // Locked before activation.
  await expect(page.getByTestId("licence-status")).toHaveText("UNLICENSED");
  await expect(page.getByTestId("chord-readout")).toHaveText("LOCKED");

  await openPanelAndActivate(page, "TEST-KEY-VALID");
  await expect(page.getByTestId("licence-status")).toHaveText("ACTIVE");
  await expect(page.getByTestId("licence-panel")).toContainText(
    "player@example.com",
  );

  // Paid features unlock live, no reload needed.
  await expect(page.getByTestId("chord-readout")).not.toHaveText("LOCKED");
  await page.getByRole("button", { name: "Separate into stems" }).click();
  await expect(page.getByTestId("stem-lanes")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("export-readout")).toHaveText("WAV 16-BIT");

  // Release the licence: the desk relocks immediately.
  await page.getByRole("button", { name: "Deactivate licence on this device" }).click();
  await expect(page.getByTestId("licence-status")).toHaveText("UNLICENSED");
  await expect(page.getByTestId("export-readout")).toHaveText("LOCKED");
});

test("an invalid key shows the API's error and stays locked", async ({
  page,
}) => {
  await mockLicenceApi(page, { valid: false });
  await page.goto("/?mockSeparation=1&locked=1");
  await loadFixture(page);

  await openPanelAndActivate(page, "TEST-KEY-BAD");
  await expect(page.getByTestId("licence-error")).toContainText(
    "license_key not found",
  );
  await expect(page.getByTestId("licence-status")).toHaveText("UNLICENSED");
  await expect(page.getByTestId("chord-readout")).toHaveText("LOCKED");
});

test("an activated licence keeps working when the licence API is unreachable", async ({
  page,
}) => {
  await mockLicenceApi(page);
  await page.goto("/?mockSeparation=1&locked=1");
  await loadFixture(page);
  await openPanelAndActivate(page, "TEST-KEY-VALID");
  await expect(page.getByTestId("licence-status")).toHaveText("ACTIVE");

  // Fresh page with every licence call failing at the network layer: the
  // stored activation must keep the desk unlocked (offline grace).
  await page.unrouteAll();
  await page.route(`${API}/**`, (route) => route.abort("internetdisconnected"));
  await page.goto("/?mockSeparation=1&locked=1");
  await loadFixture(page);
  await expect(page.getByTestId("licence-status")).toHaveText("ACTIVE");
  await expect(page.getByTestId("chord-readout")).not.toHaveText("LOCKED");
});
