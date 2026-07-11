import { expect, test } from "@playwright/test";

// The Night 1 acceptance flow: load a file, play, set an A-B loop, change
// speed with the tempo fader, and confirm playback keeps running.
test("load, play, loop, and slow to 75 percent", async ({ page }) => {
  // Mocked separation keeps this flow deterministic; the real pipeline has
  // its own spec (separation.spec.ts, integration.spec.ts).
  await page.goto("/?mockSeparation=1");

  // Load the fixture through the hidden picker input.
  await page
    .getByTestId("file-input")
    .setInputFiles("e2e/fixtures/test-tone.wav");
  await expect(page.getByTestId("song-label")).toHaveText("test-tone.wav");
  await expect(page.getByTestId("waveform-lane").first()).toBeVisible();
  await expect(page.getByTestId("time-readout")).toHaveText("00:00.0");

  // Play with the space bar; the clock must advance.
  await page.keyboard.press("Space");
  await expect
    .poll(async () => page.getByTestId("time-readout").textContent(), {
      timeout: 5000,
    })
    .not.toBe("00:00.0");

  // Tap L twice to arm and engage a loop around the playhead.
  await page.keyboard.press("KeyL");
  await expect(page.getByTestId("loop-readout")).toContainText("SET B");
  await page.waitForTimeout(1200);
  await page.keyboard.press("KeyL");
  await expect(page.getByTestId("loop-readout")).toContainText("OUT 00:");
  await expect(page.getByTestId("loop-region").first()).toBeVisible();
  await expect(page.getByTestId("loop-lamp")).toHaveClass(/hw-looplamp-on/);

  // Slow to 75% with the tempo fader (Home = 50%, then 25 steps up).
  const tempo = page.getByRole("slider", { name: "Tempo" });
  await tempo.focus();
  await page.keyboard.press("Home");
  await expect(page.getByTestId("tempo-readout")).toHaveText("50%");
  for (let i = 0; i < 25; i++) await page.keyboard.press("ArrowUp");
  await expect(page.getByTestId("tempo-readout")).toHaveText("75%");
  await expect(tempo).toHaveAttribute("aria-valuenow", "75");

  // Still playing at the slower speed, and the loop holds the playhead
  // inside its region.
  // Poll rather than compare two instants: with a short loop the playhead
  // can wrap back to the same formatted position at a single sample point.
  const t1 = await page.getByTestId("time-readout").textContent();
  await expect
    .poll(async () => page.getByTestId("time-readout").textContent(), {
      timeout: 5000,
    })
    .not.toBe(t1);
  const loopText = await page.getByTestId("loop-readout").textContent();
  const out = loopText!.match(/OUT (\d+):(\d+\.\d)/)!;
  const outSeconds = Number(out[1]) * 60 + Number(out[2]);
  const now = (await page.getByTestId("time-readout").textContent())!;
  const nowMatch = now.match(/(\d+):(\d+\.\d)/)!;
  const nowSeconds = Number(nowMatch[1]) * 60 + Number(nowMatch[2]);
  expect(nowSeconds).toBeLessThanOrEqual(outSeconds + 0.5);

  // Shift down 2 semitones with the pitch knob; tempo must not move
  // (pitch and speed are independent) and playback keeps running.
  const pitch = page.getByRole("slider", { name: "Pitch" });
  await pitch.focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("pitch-readout")).toHaveText("-2 st");
  await expect(page.getByTestId("tempo-readout")).toHaveText("75%");
  const t2 = await page.getByTestId("time-readout").textContent();
  await expect
    .poll(async () => page.getByTestId("time-readout").textContent(), {
      timeout: 5000,
    })
    .not.toBe(t2);

  // Space pauses. Let the final position tick land before capturing.
  await page.keyboard.press("Space");
  await page.waitForTimeout(400);
  const paused = await page.getByTestId("time-readout").textContent();
  await page.waitForTimeout(700);
  expect(await page.getByTestId("time-readout").textContent()).toBe(paused);
});

test("a loop can be set, engaged, and cleared by clicking A B CLR", async ({
  page,
}) => {
  await page.goto("/?mockSeparation=1");
  await page
    .getByTestId("file-input")
    .setInputFiles("e2e/fixtures/test-tone.wav");
  await expect(page.getByTestId("song-label")).toHaveText("test-tone.wav");
  await expect(page.getByTestId("loop-readout")).toHaveText("NO LOOP");

  // A arms the start at the playhead; the LCD prompts for B.
  await page.getByRole("button", { name: "Set loop start" }).click();
  await expect(page.getByTestId("loop-readout")).toContainText("SET B");

  // B before any movement is a degenerate loop and stays armed.
  await page.getByRole("button", { name: "Set loop end" }).click();
  await expect(page.getByTestId("loop-readout")).toContainText("SET B");

  // Move the playhead, then B completes the loop and the lamp engages.
  await page.keyboard.press("ArrowRight");
  await page.getByRole("button", { name: "Set loop end" }).click();
  await expect(page.getByTestId("loop-readout")).toContainText("IN 00:00.0");
  await expect(page.getByTestId("loop-readout")).toContainText("OUT 00:05.0");
  await expect(page.getByTestId("loop-lamp")).toHaveClass(/hw-looplamp-on/);

  // CLR drops it.
  await page.getByRole("button", { name: "Clear loop" }).click();
  await expect(page.getByTestId("loop-readout")).toHaveText("NO LOOP");

  // The keyboard L flow is unchanged alongside the buttons.
  await page.keyboard.press("KeyL");
  await expect(page.getByTestId("loop-readout")).toContainText("SET B");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("KeyL");
  await expect(page.getByTestId("loop-readout")).toContainText("OUT");

  // The shortcut hint is engraved on the desk.
  await expect(page.locator(".shortcut-hint")).toBeVisible();
});

test("unsupported file gets a friendly error", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("file-input").setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not audio"),
  });
  await expect(page.getByTestId("deck-error")).toContainText(
    "not a supported format",
  );
});
