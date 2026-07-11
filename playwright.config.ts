import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      testIgnore: /offline\.spec\.ts/,
      use: {
        browserName: "chromium",
        launchOptions: {
          // Web Audio in headless Chromium needs a fake audio device.
          args: [
            "--autoplay-policy=no-user-gesture-required",
            "--use-fake-device-for-media-stream",
          ],
        },
      },
    },
    {
      // The offline/PWA flow needs a production build (the service worker
      // is not registered against the dev server, which HMR owns).
      name: "offline",
      testMatch: /offline\.spec\.ts/,
      use: {
        browserName: "chromium",
        baseURL: "http://localhost:4174",
        launchOptions: {
          args: ["--autoplay-policy=no-user-gesture-required"],
        },
      },
    },
  ],
  webServer: [
    {
      command: "npm run dev",
      url: "http://localhost:5173",
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: "npm run build && npm run preview -- --port 4174 --strictPort",
      url: "http://localhost:4174",
      reuseExistingServer: true,
      timeout: 180_000,
    },
  ],
});
