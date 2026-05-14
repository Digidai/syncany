import { test, expect } from "@playwright/test";

test("/ document is scrollable (no body overflow:hidden lock)", async ({ page }) => {
  await page.goto("/");
  const metrics = await page.evaluate(() => ({
    docHeight: document.documentElement.scrollHeight,
    viewport: window.innerHeight,
    bodyOverflow: getComputedStyle(document.body).overflow,
    htmlOverflow: getComputedStyle(document.documentElement).overflow,
  }));
  expect(metrics.docHeight).toBeGreaterThan(metrics.viewport);
  expect(metrics.bodyOverflow).not.toBe("hidden");
  expect(metrics.htmlOverflow).not.toBe("hidden");

  await page.evaluate(() => window.scrollTo(0, 600));
  const y = await page.evaluate(() => window.scrollY);
  expect(y).toBeGreaterThan(400);
});
