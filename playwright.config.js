import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser", testMatch: "*.spec.js", fullyParallel: false, workers: 1,
  timeout: 90000, expect: { timeout: 15000 }, retries: 0,
  outputDir: "artifacts/browser-results",
  reporter: [["list"], ["html", { outputFolder: "artifacts/browser-report", open: "never" }]],
  use: { baseURL: "http://127.0.0.1:5183", trace: "retain-on-failure", screenshot: "only-on-failure",
    serviceWorkers: "block", launchOptions: { channel: process.env.BROWSER_CHANNEL || undefined,
      args: ["--enable-webgl", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } },
  projects: [
    { name: "desktop-en", use: { viewport: { width: 1280, height: 900 } } },
    { name: "mobile-zh", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 } },
  ],
  webServer: { command: "node tests/browser/server.mjs", url: "http://127.0.0.1:5183", reuseExistingServer: false, timeout: 60000 },
});
