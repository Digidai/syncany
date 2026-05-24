import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL;
if (!baseURL) {
  throw new Error("E2E_BASE_URL must be set explicitly; do not default Playwright E2E to production.");
}

/**
 * Raltic E2E suite.
 *
 * Target must be explicit:
 *   E2E_BASE_URL=https://staging.example.com E2E_API_URL=https://api-staging.example.com pnpm e2e
 *   E2E_BASE_URL=http://localhost:3000 E2E_API_URL=http://localhost:8787 pnpm e2e
 *
 * Default smoke tests are read-only. Auth/channel tests write data and require
 * E2E_RUN_AUTH=1 or E2E_RUN_CHANNELS=1; they also refuse production unless
 * E2E_ALLOW_PROD_WRITES=1 is set intentionally.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 2,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
