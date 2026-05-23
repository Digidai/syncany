import { devices, expect, type Page, test } from "@playwright/test";

const DESKTOP_VIEWPORT = { width: 1280, height: 800 };

async function gotoStable(page: Page, path: string) {
  const response = await page.goto(path, { waitUntil: "domcontentloaded" });
  expect(response?.status(), `${path} should load`).toBe(200);

  await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important}" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState("networkidle");
}

function rgbChannels(value: string): [number, number, number] {
  const channels = value.match(/\d+(?:\.\d+)?/g)?.slice(0, 3).map(Number);
  if (!channels || channels.length !== 3) {
    throw new Error(`Unable to parse RGB background value: ${value}`);
  }
  return [channels[0], channels[1], channels[2]];
}

test.describe("marketing visual snapshots", () => {
  test("home desktop full page", async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await gotoStable(page, "/");

    await expect(page).toHaveScreenshot("home-desktop.png", {
      fullPage: true,
      maxDiffPixelRatio: 0.05,
    });
  });

  test("home desktop above the fold", async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await gotoStable(page, "/");

    await expect(page).toHaveScreenshot("home-above-fold.png", {
      clip: { x: 0, y: 0, width: 1280, height: 900 },
      maxDiffPixelRatio: 0.05,
    });
  });

  test("login desktop", async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await gotoStable(page, "/login");

    await expect(page).toHaveScreenshot("login-desktop.png", {
      maxDiffPixelRatio: 0.05,
    });
  });

  test("hero section", async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await gotoStable(page, "/");

    const hero = page.locator("section").first();
    await expect(hero).toBeVisible();
    await expect(hero).toHaveScreenshot("hero-section.png", {
      maxDiffPixelRatio: 0.05,
    });
  });

  test("two ways to run section", async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await gotoStable(page, "/");

    const section = page.locator("section", { hasText: /Two ways to run/i });
    await expect(section).toBeVisible();
    await expect(section).toHaveScreenshot("two-ways-to-run-section.png", {
      maxDiffPixelRatio: 0.05,
    });
  });

  test("comparison table", async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await gotoStable(page, "/");

    const table = page.getByRole("table");
    await expect(table).toBeVisible();
    await expect(table).toHaveScreenshot("comparison-table.png", {
      maxDiffPixelRatio: 0.05,
    });
  });

  test("marketing footer", async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await gotoStable(page, "/");

    const footer = page.locator("footer");
    await expect(footer).toBeVisible();
    await expect(footer).toHaveScreenshot("marketing-footer.png", {
      maxDiffPixelRatio: 0.05,
    });
  });

  test("home page background is nearly black", async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await gotoStable(page, "/");

    const background = await page.locator("body > div.dark.bg-black").first().evaluate((element) => {
      return getComputedStyle(element).backgroundColor;
    });
    const [red, green, blue] = rgbChannels(background);

    expect(red, `red channel for ${background}`).toBeLessThanOrEqual(3);
    expect(green, `green channel for ${background}`).toBeLessThanOrEqual(3);
    expect(blue, `blue channel for ${background}`).toBeLessThanOrEqual(3);
  });
});

// iPhone-viewport snapshots — `test.use({ ...devices.iPhone14 })`
// cannot live inside a describe (Playwright forces a new worker only
// when test.use is top-level OR in playwright.config.ts). Workaround:
// set the viewport+UA manually per test via the iPhone 14 dimensions.
const IPHONE_14 = {
  viewport: { width: 390, height: 844 },
  userAgent: devices["iPhone 14"].userAgent,
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
};

test.describe("marketing visual snapshots on iPhone 14", () => {
  test("home mobile", async ({ browser }) => {
    const ctx = await browser.newContext(IPHONE_14);
    const page = await ctx.newPage();
    try {
      await gotoStable(page, "/");
      await expect(page).toHaveScreenshot("home-iphone-14.png", {
        fullPage: true,
        maxDiffPixelRatio: 0.05,
      });
    } finally {
      await ctx.close();
    }
  });

  test("login mobile", async ({ browser }) => {
    const ctx = await browser.newContext(IPHONE_14);
    const page = await ctx.newPage();
    try {
      await gotoStable(page, "/login");
      await expect(page).toHaveScreenshot("login-iphone-14.png", {
        fullPage: true,
        maxDiffPixelRatio: 0.05,
      });
    } finally {
      await ctx.close();
    }
  });
});
