import { defineConfig, devices } from "@playwright/test";

/**
 * Syncany E2E suite.
 *
 * Default target = deployed staging worker. Override with E2E_BASE_URL for
 * local dev (`E2E_BASE_URL=http://localhost:3000 pnpm e2e`).
 *
 * Auth-mutating tests (E2E_RUN_AUTH=1) create a unique throwaway user
 * per run; smoke tests run unconditionally and never write to the system.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 2,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "https://syncany-web.genedai.workers.dev",
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
