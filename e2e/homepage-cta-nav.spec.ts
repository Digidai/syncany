import { test, expect, type Page } from "@playwright/test";

const MINIMUM_FOOTER_PATHS = [
  "/runtimes",
  "/connectors",
  "/security",
  "/indie",
  "/teams",
  "/privacy",
  "/terms",
  "/signup",
  "/login",
];

function hero(page: Page) {
  return page.locator("section").first();
}

function topNav(page: Page) {
  return page.getByRole("navigation").first();
}

async function expectPathname(page: Page, pathname: string) {
  await expect.poll(() => new URL(page.url()).pathname).toBe(pathname);
}

async function expectPathAndSearch(page: Page, pathname: string, search: string) {
  await expect.poll(() => {
    const url = new URL(page.url());
    return `${url.pathname}${url.search}`;
  }).toBe(`${pathname}${search}`);
}

test.describe("homepage CTAs", () => {
  test("anonymous hero CTAs point at signup flows", async ({ page }) => {
    await page.goto("/");

    // Primary CTA renamed to "Start a cloud Agent" (codex GTM H2 fix).
    const primaryCta = hero(page).getByRole("link", { name: /^Start a cloud Agent$/ });
    await expect(primaryCta).toBeVisible();
    await expect(primaryCta).toHaveAttribute("href", "/signup");

    const secondaryCta = hero(page).getByRole("link", { name: /^Bring your own daemon$/ });
    await expect(secondaryCta).toBeVisible();
    await expect(secondaryCta).toHaveAttribute("href", "/signup?wizard=1");
  });

  test("hero secondary CTA navigates to the bridge wizard", async ({ page }) => {
    await page.goto("/");

    await hero(page).getByRole("link", { name: /^Bring your own daemon$/ }).click();
    await expectPathAndSearch(page, "/signup", "?wizard=1");
  });
});

test.describe("homepage top navigation", () => {
  for (const { name, path } of [
    { name: "Runtimes", path: "/runtimes" },
    { name: "Connectors", path: "/connectors" },
    { name: "Security", path: "/security" },
    { name: "Sign in", path: "/login" },
    // Top-nav primary kept as generic "Get started" for compactness
    // even though the hero primary uses the more specific "Start a
    // cloud Agent" copy. (Keeps the nav from getting too wide.)
    { name: "Get started", path: "/signup" },
  ]) {
    test(`${name} link navigates to ${path}`, async ({ page }) => {
      await page.goto("/");

      await topNav(page).getByRole("link", { name: new RegExp(`^${name}$`) }).click();
      await expectPathname(page, path);
    });
  }
});

test.describe("homepage ForDropdown audience menu", () => {
  test("opens, navigates to audience pages, and closes on outside click", async ({ page }) => {
    await page.goto("/");

    await topNav(page).getByRole("button", { name: /^For$/ }).click();
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();

    const indieItem = menu.getByRole("menuitem", { name: /Indie devs/ });
    const teamsItem = menu.getByRole("menuitem", { name: /Teams/ });
    await expect(indieItem).toBeVisible();
    await expect(teamsItem).toBeVisible();
    await expect(teamsItem.getByText("Waitlist")).toBeVisible();

    await indieItem.click();
    await expectPathname(page, "/indie");

    await topNav(page).getByRole("button", { name: /^For$/ }).click();
    await expect(page.getByRole("menu")).toBeVisible();
    await page.getByRole("menu").getByRole("menuitem", { name: /Teams/ }).click();
    await expectPathname(page, "/teams");

    await topNav(page).getByRole("button", { name: /^For$/ }).click();
    await expect(page.getByRole("menu")).toBeVisible();
    await page.mouse.click(10, 10);
    await expect(page.getByRole("menu")).toBeHidden();
  });
});

test.describe("homepage footer", () => {
  test("internal footer links return public 200 responses", async ({ page, request }) => {
    await page.goto("/");

    const footer = page.getByRole("contentinfo");
    await expect(footer).toBeVisible();

    const hrefs = await footer.locator("a").evaluateAll((links) =>
      links.map((link) => link.getAttribute("href")).filter((href): href is string => Boolean(href)),
    );
    const baseUrl = new URL(page.url());
    const internalPaths = Array.from(new Set(hrefs.flatMap((href) => {
      const url = new URL(href, baseUrl.href);
      if (!["http:", "https:"].includes(url.protocol) || url.origin !== baseUrl.origin) return [];
      return [`${url.pathname}${url.search}`];
    }))).sort();

    for (const path of MINIMUM_FOOTER_PATHS) {
      expect(internalPaths).toContain(path);
    }

    for (const path of internalPaths) {
      const res = await request.get(path, { maxRedirects: 0 });
      expect(res.status(), `${path} returned ${res.status()} ${res.headers().location ?? ""}`).toBe(200);
    }
  });
});

test.describe("homepage FAQ", () => {
  test("details expand and collapse on click", async ({ page }) => {
    await page.goto("/");

    const firstDetails = page.locator("#faq details").first();
    const summary = firstDetails.locator("summary");

    await expect.poll(() => firstDetails.evaluate((node) => (node as HTMLDetailsElement).open)).toBe(false);
    await summary.click();
    await expect.poll(() => firstDetails.evaluate((node) => (node as HTMLDetailsElement).open)).toBe(true);
    await expect(firstDetails.getByText(/Teammates who just chat/i)).toBeVisible();

    await summary.click();
    await expect.poll(() => firstDetails.evaluate((node) => (node as HTMLDetailsElement).open)).toBe(false);
  });
});
