import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  reporter: "list",
  use: {
    browserName: "chromium",
    headless: true,
    baseURL: "http://127.0.0.1:4318",
    trace: "retain-on-failure"
  }
});
