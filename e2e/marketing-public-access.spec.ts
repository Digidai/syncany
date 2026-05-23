import { expect, test } from "@playwright/test";

type MarketingRoute = {
  path: string;
  heading: RegExp;
  headingSelector?: "h1" | "h1, h2";
  robots?: "noindex,nofollow";
};

const marketingRoutes: MarketingRoute[] = [
  {
    path: "/runtimes",
    heading: /Four agent runtimes|One chat surface/i,
  },
  {
    path: "/runtimes/claude",
    heading: /Claude/i,
    headingSelector: "h1",
  },
  {
    path: "/runtimes/codex",
    heading: /Codex/i,
    headingSelector: "h1",
  },
  {
    path: "/runtimes/openclaw",
    heading: /OpenClaw/i,
    headingSelector: "h1",
    robots: "noindex,nofollow",
  },
  {
    path: "/runtimes/hermes",
    heading: /Hermes/i,
    headingSelector: "h1",
    robots: "noindex,nofollow",
  },
  {
    path: "/indie",
    heading: /All your AI agents|indie devs/i,
  },
  {
    path: "/teams",
    heading: /Your team's AI workspace|Waitlist/i,
    robots: "noindex,nofollow",
  },
  {
    path: "/connectors",
    heading: /Give your agents access|Connectors/i,
  },
  {
    path: "/security",
    heading: /What we see|What we don't|Security/i,
  },
  {
    path: "/privacy",
    heading: /Privacy Policy/i,
  },
  {
    path: "/terms",
    heading: /Terms of Service/i,
  },
];

test.describe("marketing public access", () => {
  for (const route of marketingRoutes) {
    test(`${route.path} is reachable anonymously and renders marketing chrome`, async ({ page }) => {
      const response = await page.goto(route.path, { waitUntil: "domcontentloaded" });

      expect(response?.status(), `${route.path} should return 200`).toBe(200);
      expect(new URL(page.url()).pathname, `${route.path} should not redirect to /login`).toBe(route.path);

      const headingSelector = route.headingSelector ?? "h1, h2";
      await expect(
        page.locator(headingSelector).filter({ hasText: route.heading }).first(),
      ).toBeVisible();

      const footer = page.locator("footer");
      await expect(footer.getByRole("link", { name: /privacy policy/i })).toBeVisible();
      await expect(footer.getByRole("link", { name: /terms of service/i })).toBeVisible();

      if (route.robots) {
        const robots = await page.locator("meta[name='robots']").getAttribute("content");
        expect(robots?.replace(/\s+/g, "")).toBe(route.robots);
      }
    });
  }
});
