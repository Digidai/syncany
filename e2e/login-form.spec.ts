import { expect, test, type Locator, type Page } from "@playwright/test";

const BASE_URL = process.env.E2E_BASE_URL ?? "https://raltic.com";
const AUTH_ROUTE = "**/api/auth/**";

function emailInput(page: Page): Locator {
  return page.getByPlaceholder("you@example.com");
}

function passwordInput(page: Page): Locator {
  return page.getByPlaceholder("Your password");
}

function submitButton(page: Page): Locator {
  return page.getByRole("button", { name: /sign in|log in/i });
}

function forgotPasswordLink(page: Page): Locator {
  return page.getByRole("link", { name: /forgot/i });
}

function signUpLink(page: Page): Locator {
  return page.getByRole("link", { name: /sign up|create account/i });
}

async function expectActiveElement(locator: Locator): Promise<void> {
  await expect(locator).toBeFocused();
  expect(await locator.evaluate((element) => element === document.activeElement)).toBe(true);
}

test.describe("login form", () => {
  test("GET /login returns 200 and renders email + password fields", async ({ page }) => {
    const response = await page.goto("/login");

    expect(response?.status()).toBe(200);
    await expect(emailInput(page)).toBeVisible();
    await expect(passwordInput(page)).toBeVisible();
  });

  test("renders the brand title", async ({ page }) => {
    await page.goto("/login");

    await expect(page.locator('[data-slot="card-title"]').filter({ hasText: /^Raltic$/ })).toBeVisible();
  });

  test("shows the submit button with a sign-in accessible name", async ({ page }) => {
    await page.goto("/login");

    await expect(submitButton(page)).toBeVisible();
  });

  test("empty submit is blocked by validation", async ({ page }) => {
    let authRequests = 0;
    await page.route(AUTH_ROUTE, async (route) => {
      authRequests += 1;
      await route.abort();
    });
    await page.goto("/login");

    await submitButton(page).click();

    expect(await emailInput(page).evaluate((element) => (element as HTMLInputElement).matches(":invalid"))).toBe(true);
    expect(authRequests).toBe(0);
    await expect(page).toHaveURL(/\/login(?:[?#].*)?$/);
  });

  test("invalid email is blocked by validation", async ({ page }) => {
    let authRequests = 0;
    await page.route(AUTH_ROUTE, async (route) => {
      authRequests += 1;
      await route.abort();
    });
    await page.goto("/login");

    await emailInput(page).fill("not-an-email");
    await passwordInput(page).fill("bogus-password");
    await submitButton(page).click();

    expect(await emailInput(page).evaluate((element) => (element as HTMLInputElement).validity.typeMismatch)).toBe(true);
    expect(authRequests).toBe(0);
    await expect(page).toHaveURL(/\/login(?:[?#].*)?$/);
  });

  test("forgot password link navigates to /forgot-password", async ({ page }) => {
    await page.goto("/login");

    const forgot = forgotPasswordLink(page);
    await expect(forgot).toBeVisible();
    await expect(forgot).toHaveAttribute("href", "/forgot-password");
    await forgot.click();
    await expect(page).toHaveURL(/\/forgot-password(?:[?#].*)?$/);
  });

  test("sign up link navigates to /signup", async ({ page }) => {
    await page.goto("/login");

    const signUp = signUpLink(page);
    await expect(signUp).toBeVisible();
    await signUp.click();
    await expect(page).toHaveURL(/\/signup(?:[?#].*)?$/);
  });

  test("Google sign-in button is visible and enabled when configured", async ({ page }) => {
    await page.goto("/login");

    const googleButton = page.getByRole("button", { name: /continue with google/i });
    if ((await googleButton.count()) > 0) {
      await expect(googleButton).toBeVisible();
      await expect(googleButton).toBeEnabled();
    }
  });

  test("form structure is present without JavaScript", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();

    try {
      const response = await page.goto(new URL("/login", BASE_URL).toString());

      expect(response?.status()).toBe(200);
      await expect(emailInput(page)).toBeVisible();
      await expect(passwordInput(page)).toBeVisible();
      await expect(submitButton(page)).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("keyboard navigation reaches password, submit, forgot, then signup", async ({ page }) => {
    await page.goto("/login");

    const email = emailInput(page);
    const password = passwordInput(page);
    const submit = submitButton(page);
    const forgot = forgotPasswordLink(page);
    const signUp = signUpLink(page);

    await email.focus();
    await expectActiveElement(email);

    await page.keyboard.press("Tab");
    await expectActiveElement(password);

    await page.keyboard.press("Tab");
    await expectActiveElement(submit);

    await page.keyboard.press("Tab");
    await expectActiveElement(forgot);

    await page.keyboard.press("Tab");
    await expectActiveElement(signUp);
  });

  test("wrong credentials do not throw an uncaught JavaScript error", async ({ page }) => {
    const pageErrors: string[] = [];
    let authRequests = 0;

    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.route(AUTH_ROUTE, async (route) => {
      authRequests += 1;
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({
          code: "INVALID_EMAIL_OR_PASSWORD",
          message: "Invalid email or password",
          error: {
            code: "INVALID_EMAIL_OR_PASSWORD",
            message: "Invalid email or password",
          },
        }),
      });
    });
    await page.goto("/login");

    await emailInput(page).fill("bogus@example.com");
    await passwordInput(page).fill("wrong-password");
    await Promise.all([
      page.waitForRequest((request) => request.url().includes("/api/auth/") && request.method() === "POST"),
      submitButton(page).click(),
    ]);
    await expect(submitButton(page)).toBeEnabled();

    expect(authRequests).toBeGreaterThan(0);
    expect(pageErrors).toEqual([]);
  });

  test("email and password inputs expose expected autocomplete attributes", async ({ page }) => {
    await page.goto("/login");

    await expect(emailInput(page)).toHaveAttribute("autocomplete", "email");
    await expect(passwordInput(page)).toHaveAttribute("autocomplete", "current-password");
  });
});
