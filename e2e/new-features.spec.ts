import { test, expect } from "@playwright/test";

const API_URL = process.env.E2E_API_URL ?? "https://api.raltic.com";

/**
 * Coverage for the audit-fix + collab batch (commit 6609b5e):
 *   - new endpoints: /api/v1/invites/email, /servers/:id/members
 *   - new pages: /not-existing → not-found.tsx, /__force_error
 *   - landing copy + collab framing
 *   - sidebar/login brand cyan applied
 *
 * All assertions hit the deployed staging — no local servers spun up.
 */

test.describe("new endpoints — auth gating + zod validation", () => {
  test("POST /api/v1/invites/email rejects unauthenticated callers (401)", async ({ request }) => {
    const res = await request.post(`${API_URL}/api/v1/invites/email`, {
      data: { serverId: "srv_x", email: "test@example.com" },
    });
    expect(res.status()).toBe(401);
  });

  test("POST /api/v1/invites/email rejects malformed body (still 401 — auth runs first)", async ({ request }) => {
    const res = await request.post(`${API_URL}/api/v1/invites/email`, {
      data: { serverId: "srv_x", email: "not-an-email" },
    });
    // Auth gate fires before zod parse for unauthed requests.
    expect(res.status()).toBe(401);
  });

  test("GET /api/v1/servers/:id/members rejects unauthed (401)", async ({ request }) => {
    const res = await request.get(`${API_URL}/api/v1/servers/srv_x/members`);
    expect(res.status()).toBe(401);
  });

  test("DELETE /api/v1/servers/:id/members/:userId rejects unauthed (401)", async ({ request }) => {
    const res = await request.delete(`${API_URL}/api/v1/servers/srv_x/members/user_y`);
    expect(res.status()).toBe(401);
  });
});

test.describe("error surfaces — auth-gated not-found", () => {
  test("/random-path bounces unauthed visitors to /login (no info leak)", async ({ page }) => {
    await page.goto("/this-route-does-not-exist");
    // Middleware redirects unauth + unknown paths to /login; the branded
    // not-found.tsx is reserved for authed users hitting bad URLs.
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("landing — collab framing", () => {
  test("hero promises ship together (human + AI)", async ({ page }) => {
    await page.goto("/");
    // ".first()" — both the h1 and the final-CTA h2 contain "ship together".
    await expect(page.getByRole("heading", { name: /ship together/i }).first()).toBeVisible();
    await expect(page.locator("h1").filter({ hasText: /humans/i }).first()).toBeVisible();
  });

  test("step 1 mentions email invites (multi-human)", async ({ page }) => {
    await page.goto("/");
    await page.locator("a[href='#how']").click();
    // .first() — same copy may appear elsewhere; first occurrence is the
    // Step 1 card body.
    await expect(page.getByText(/invite teammates by email/i).first()).toBeVisible();
  });

  test("step 3 calls out human ↔ agent collaboration", async ({ page }) => {
    await page.goto("/");
    await page.locator("a[href='#how']").click();
    await expect(page.getByText(/people talk to agents/i).first()).toBeVisible();
  });
});

test.describe("public pages still work after migration", () => {
  test("/login renders without regression", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByPlaceholder("you@example.com")).toBeVisible();
    await expect(page.getByPlaceholder("Your password")).toBeVisible();
  });

  test("/signup renders all 3 fields", async ({ page }) => {
    await page.goto("/signup");
    await expect(page.getByPlaceholder("Your name")).toBeVisible();
    await expect(page.getByPlaceholder("you@example.com")).toBeVisible();
    await expect(page.getByPlaceholder("At least 6 characters")).toBeVisible();
  });
});

test.describe("api health + bridge connect surface (post-serverId-fix)", () => {
  test("/health stays green", async ({ request }) => {
    const res = await request.get(`${API_URL}/health`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test("bridge/connect with bad api key returns 401 (not 500)", async ({ request }) => {
    // ck_ prefix + 32+ alphanumeric chars (matches bridgeConnectRequest schema
    // pattern), but no row in DB → resolveMachineKey null → 401.
    const fakeKey = "ck_" + "a".repeat(40);
    const res = await request.post(`${API_URL}/api/v1/bridge/connect`, {
      data: { apiKey: fakeKey },
    });
    expect(res.status()).toBe(401);
  });

  test("bridge/connect with malformed body returns 400 (zod rejected)", async ({ request }) => {
    const res = await request.post(`${API_URL}/api/v1/bridge/connect`, {
      data: { not_an_apikey: "x" },
    });
    expect(res.status()).toBe(400);
  });
});
