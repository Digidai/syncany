import { test, expect } from "@playwright/test";
import { mutatingTargetSkipReason } from "./helpers/env";

/**
 * Auth round-trip — creates a real user in the target environment and signs
 * them up through the email verification handoff. Skipped by default to avoid
 * polluting shared environments.
 *
 * Run locally with:
 *   E2E_RUN_AUTH=1 E2E_BASE_URL=http://localhost:3000 E2E_API_URL=http://localhost:8787 pnpm e2e -- auth-roundtrip.spec.ts
 */
const RUN = process.env.E2E_RUN_AUTH === "1";
const TARGET_SKIP = mutatingTargetSkipReason();

test.describe(RUN ? "auth round-trip" : "auth round-trip (skipped — set E2E_RUN_AUTH=1)", () => {
  test.skip(!RUN, "auth round-trip writes to the target DB; opt-in only");
  test.skip(Boolean(TARGET_SKIP), TARGET_SKIP ?? "");

  test("signup → redirected to verify-email page", async ({ page }) => {
    const stamp = Date.now();
    const email = `e2e-${stamp}@raltic-test.local`;
    const password = "Test123!secure";
    const name = `e2e-user-${stamp}`;

    await page.goto("/signup");
    await page.getByPlaceholder(/Your name/i).fill(name);
    await page.getByPlaceholder("you@example.com").fill(email);
    await page.getByPlaceholder(/At least \d+ characters/i).fill(password);
    await page.getByRole("button", { name: /sign up|create account/i }).click();

    // better-auth flow lands on verify-email; we don't have inbox access
    // in CI so the test stops here.
    await expect(page).toHaveURL(/verify-email|\/$/, { timeout: 15000 });
  });
});
