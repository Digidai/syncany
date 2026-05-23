import { test, expect } from "@playwright/test";

const API_URL = process.env.E2E_API_URL ?? "https://api.raltic.com";

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
    // "Raltic" brand title renders as a <div> via the Card primitive.
    await expect(page.locator('[data-slot="card-title"]').filter({ hasText: /raltic/i })).toBeVisible();
  });

  test("/signup shows name + email + password", async ({ page }) => {
    await page.goto("/signup");
    // Placeholder evolved to "Your name (shown to teammates)"; match by prefix.
    await expect(page.getByPlaceholder(/Your name/)).toBeVisible();
    await expect(page.getByPlaceholder("you@example.com")).toBeVisible();
    // MIN_PASSWORD_LENGTH bumped from 6 → 8; match by pattern so future changes don't break.
    await expect(page.getByPlaceholder(/At least \d+ characters/)).toBeVisible();
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
    // Hero H1 was rewritten to lead with the dual-mode story; match
    // "Your AI Agent. Or theirs." (codex GTM H1 fix).
    await expect(page.getByRole("heading", { name: /Your AI Agent.*Or theirs/i })).toBeVisible();
    // Primary CTA renamed from "Get started" → "Start a cloud Agent".
    await expect(page.getByRole("link", { name: /Start a cloud Agent/i }).first()).toBeVisible();
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
