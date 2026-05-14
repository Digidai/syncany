import { test, expect } from "@playwright/test";

const API_URL = process.env.E2E_API_URL ?? "https://api.syncany.app";

/**
 * Smoke suite — never writes to production. Verifies that:
 *   1. Public pages render.
 *   2. Auth gates work (unauthenticated → /login).
 *   3. The API is alive and rejects unauthorized requests.
 *   4. Auth UI elements are interactable (form fields exist + click works).
 */

test.describe("public pages render", () => {
  test("/login shows the email + password fields", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByPlaceholder("you@example.com")).toBeVisible();
    await expect(page.getByPlaceholder("Your password")).toBeVisible();
    // "Syncany" brand title renders as a <div> via the Card primitive.
    await expect(page.locator('[data-slot="card-title"]').filter({ hasText: /syncany/i })).toBeVisible();
  });

  test("/signup shows name + email + password", async ({ page }) => {
    await page.goto("/signup");
    await expect(page.getByPlaceholder("Your name")).toBeVisible();
    await expect(page.getByPlaceholder("you@example.com")).toBeVisible();
    await expect(page.getByPlaceholder("At least 6 characters")).toBeVisible();
  });

  test("/forgot-password renders", async ({ page }) => {
    const res = await page.goto("/forgot-password");
    expect(res?.ok()).toBeTruthy();
  });
});

test.describe("homepage", () => {
  test("/ renders the public marketing landing for unauthenticated visitors", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: /humans .* AI/i })).toBeVisible();
    // Auth-aware CTA pair (signed-out branch shows both buttons; appears in
    // both hero + final-CTA so .first() to avoid strict-mode multi-match).
    await expect(page.getByRole("link", { name: /get started/i }).first()).toBeVisible();
  });
});

test.describe("auth gating", () => {
  test("a deep workspace url redirects to /login when not signed in", async ({ page }) => {
    await page.goto("/s/anything");
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("api health + auth", () => {
  test("/health returns ok:true", async ({ request }) => {
    const res = await request.get(`${API_URL}/health`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.ts).toBe("number");
  });

  test("/api/v1/agents without auth returns 401", async ({ request }) => {
    const res = await request.get(`${API_URL}/api/v1/agents`);
    expect(res.status()).toBe(401);
  });

  test("/api/v1/messages POST without auth returns 401", async ({ request }) => {
    const res = await request.post(`${API_URL}/api/v1/messages`, {
      data: { channelId: "x", content: "y", idempotencyKey: "z" },
    });
    expect(res.status()).toBe(401);
  });
});
