import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './browser-tests', testMatch: '**/*.browser.ts',
  fullyParallel: true, workers: 2, forbidOnly: !!process.env.CI,
  timeout: 30_000, outputDir: '../../artifacts/browser-tests',
  use: {
    browserName: 'chromium', headless: true,
    baseURL: 'http://127.0.0.1:19589', viewport: { width: 1400, height: 900 },
    // This is Photino.NET 4.0.16's default; do NOT test only a normal Chrome UA.
    userAgent: 'Photino WebView', screenshot: 'only-on-failure', trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 19589 --strictPort',
    url: 'http://127.0.0.1:19589', reuseExistingServer: false,
  },
})
