import { expect, type Page } from "@playwright/test";

export const E2E_EMAIL = process.env.RALTIC_E2E_EMAIL ?? "";
export const E2E_PASSWORD = process.env.RALTIC_E2E_PASSWORD ?? "";

export function missingAuthSkipReason(): string | null {
  if (!E2E_EMAIL || !E2E_PASSWORD) {
    return "RALTIC_E2E_EMAIL + RALTIC_E2E_PASSWORD required";
  }
  return null;
}

/** Sign in via the rendered login form so the browser owns the real
 * better-auth cookie shape for web, workspace, and websocket requests. */
export async function login(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder(/you@example\.com/i).fill(E2E_EMAIL);
  await page.getByPlaceholder(/password/i).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await expect(page).toHaveURL(/\/s\/[^/]+/, { timeout: 20000 });
}
