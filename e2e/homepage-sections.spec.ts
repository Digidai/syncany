import { expect, type Page, test } from "@playwright/test";

async function gotoHome(page: Page) {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
}

test.describe("homepage full section render", () => {
  test("/ returns 200 and shows the marketing nav header", async ({ page }) => {
    await gotoHome(page);

    const header = page.locator("header");
    await expect(header).toBeVisible();
    await expect(header.getByRole("link", { name: "Raltic" })).toBeVisible();
    await expect(header.getByRole("link", { name: "Runtimes" })).toBeVisible();
  });

  test("Hero is visible with the core positioning copy", async ({ page }) => {
    await gotoHome(page);

    // Hero H1 was rewritten to "Your AI Agent. Or theirs." — leads
    // with the dual-mode story instead of the old "ship together" copy.
    const hero = page.locator("section", { hasText: /Your AI Agent/i }).first();
    await expect(hero.getByRole("heading", { name: /Your AI Agent.*Or theirs/i })).toBeVisible();
    await expect(hero.getByText(/default cloud Agent/i)).toBeVisible();
    await expect(hero.getByText(/Claude Code, Codex, OpenClaw, Hermes/i)).toBeVisible();
  });

  test("TwoWaysToRun shows both run-mode cards and CTAs", async ({ page }) => {
    await gotoHome(page);

    const section = page.locator("section", { hasText: /Two ways to run/i });
    await expect(section.getByRole("heading", { name: "Raltic cloud Agent" })).toBeVisible();
    await expect(section.getByRole("heading", { name: /Your CLI.*Your daemon/i })).toBeVisible();
    await expect(section.getByRole("link", { name: /Start with the cloud Agent/i })).toBeVisible();
    await expect(section.getByRole("link", { name: /Set up the bridge/i })).toBeVisible();
  });

  test("RuntimeBadges lists all runtimes and experimental pills", async ({ page }) => {
    await gotoHome(page);

    const section = page.locator("section", { hasText: /Four runtimes/i });
    for (const runtime of ["Anthropic Claude", "OpenAI Codex", "OpenClaw", "Hermes"]) {
      await expect(section.getByText(runtime, { exact: true })).toBeVisible();
    }
    await expect(section.locator("span").filter({ hasText: /^Experimental$/ })).toHaveCount(2);
    // .first() to disambiguate strict mode — Experimental string may
    // appear on multiple descendants of the runtime card after the
    // 4-runtime + experimental-pill layout.
    await expect(section.locator("div.text-center").filter({ hasText: /OpenClaw/ }).getByText("Experimental").first()).toBeVisible();
    await expect(section.locator("div.text-center").filter({ hasText: /Hermes/ }).getByText("Experimental").first()).toBeVisible();
  });

  test("Architecture shows the three-card flow and visibility table", async ({ page }) => {
    await gotoHome(page);

    const section = page.locator("section", { hasText: /AI and security/i });
    await expect(section.locator("svg.lucide-laptop")).toBeVisible();
    await expect(section.locator("svg.lucide-cloud")).toBeVisible();
    await expect(section.locator("svg.lucide-globe")).toBeVisible();
    await expect(section.getByRole("heading", { name: "The work happens locally" })).toBeVisible();
    await expect(section.getByRole("heading", { name: "The chat happens in the cloud" })).toBeVisible();
    await expect(section.getByRole("heading", { name: "The team gets the value" })).toBeVisible();
    await expect(section.getByText("What we see", { exact: true })).toBeVisible();
    await expect(section.getByText("What we never see", { exact: true })).toBeVisible();
  });

  test("UseCases renders the engineering, ops, and product bento cards", async ({ page }) => {
    await gotoHome(page);

    const section = page.locator("section#use-cases");
    await expect(section.getByText("engineering", { exact: true })).toBeVisible();
    await expect(section.getByText("ops", { exact: true })).toBeVisible();
    await expect(section.getByText("product", { exact: true })).toBeVisible();
    await expect(section.locator("h3")).toHaveCount(3);
  });

  test("AgentRecipe shows the team-agent headline, roster, and thread mock", async ({ page }) => {
    await gotoHome(page);

    const section = page.locator("section", { hasText: /A team of agents is a teammate/i });
    await expect(section.getByRole("heading", { name: /team of agents is a teammate/i })).toBeVisible();
    await expect(section.getByText(/Your agent roster.*#engineering/i)).toBeVisible();
    await expect(section.getByText("A thread, ten minutes later", { exact: true })).toBeVisible();
  });

  test("WhyRaltic renders at least six feature cards", async ({ page }) => {
    await gotoHome(page);

    const section = page.locator("section#why");
    await expect(section.getByRole("heading", { name: /last AI rollout/i })).toBeVisible();
    expect(await section.locator("h3").count()).toBeGreaterThanOrEqual(6);
  });

  test("Comparison renders the product table with at least eight rows", async ({ page }) => {
    await gotoHome(page);

    const table = page.getByRole("table");
    await expect(table.getByRole("columnheader", { name: "ChatGPT for Work" })).toBeVisible();
    await expect(table.getByRole("columnheader", { name: /Cursor/i })).toBeVisible();
    await expect(table.getByRole("columnheader", { name: /Slack/i })).toBeVisible();
    await expect(table.getByRole("columnheader", { name: "Raltic" })).toBeVisible();
    expect(await table.locator("tbody tr").count()).toBeGreaterThanOrEqual(8);
  });

  test("Pricing renders cards and the free private beta message", async ({ page }) => {
    await gotoHome(page);

    const section = page.locator("section#pricing");
    await expect(section.getByRole("heading", { name: /Free.*beta/i })).toBeVisible();
    expect(await section.locator("h3").count()).toBeGreaterThanOrEqual(1);
    await expect(page.getByText(/Private beta.*Free/i).first()).toBeVisible();
  });

  test("FAQ renders details and expands on summary click", async ({ page }) => {
    await gotoHome(page);

    const firstDetails = page.locator("section#faq details").first();
    await expect(firstDetails).toBeVisible();
    await firstDetails.locator("summary").click();
    await expect(firstDetails).toHaveAttribute("open", "");
    await expect(firstDetails.locator("p")).toBeVisible();
  });

  test("FinalCta shows the stop tab-switching headline and HomeCta", async ({ page }) => {
    await gotoHome(page);

    const section = page.locator("section", { hasText: /Stop tab-switching/i });
    await expect(section.getByRole("heading", { name: /Stop tab-switching/i })).toBeVisible();
    // Primary CTA renamed: "Get started" → "Start a cloud Agent"
    // (signed-out branch); signed-in branch is "Open Raltic".
    await expect(section.getByRole("link", { name: /Start a cloud Agent|Open Raltic/i })).toBeVisible();
  });

  test("Footer links to all public product, audience, and legal routes", async ({ page }) => {
    await gotoHome(page);

    const footer = page.locator("footer");
    for (const href of ["/runtimes", "/connectors", "/security", "/privacy", "/terms", "/indie", "/teams", "/signup", "/login"]) {
      await expect(footer.locator(`a[href="${href}"]`)).toBeVisible();
    }
  });
});
