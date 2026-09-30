import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.browser.mjs",
  fullyParallel: true,
  workers: 2,
  forbidOnly: !!process.env.CI,
  outputDir: "../../artifacts/marketing-browser",
  use: {
    baseURL: "http://127.0.0.1:19600",
    browserName: "chromium",
    headless: true,
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node scripts/serve.mjs",
    url: "http://127.0.0.1:19600",
    reuseExistingServer: false,
  },
});
