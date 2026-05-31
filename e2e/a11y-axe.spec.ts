import { expect, type Page, test } from "@playwright/test";
// @axe-core/playwright is already declared on @raltic/web; use that
// installed copy so this test does not churn the workspace lockfile.
import AxeBuilder from "../apps/web/node_modules/@axe-core/playwright/dist/index.mjs";

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

type AxeImpact = "minor" | "moderate" | "serious" | "critical";
type AxeViolation = {
  id: string;
  impact: AxeImpact | null;
  nodes: Array<{ target: string[] }>;
};
type AxeResult = { violations: AxeViolation[] };
type ImpactCounts = Record<AxeImpact, number>;

function normalizedImpact(violation: AxeViolation): AxeImpact {
  return violation.impact ?? "minor";
}

function countByImpact(violations: AxeViolation[]): ImpactCounts {
  return violations.reduce<ImpactCounts>(
    (counts, violation) => {
      counts[normalizedImpact(violation)] += 1;
      return counts;
    },
    { critical: 0, serious: 0, moderate: 0, minor: 0 },
  );
}

function violationDetails(violations: AxeViolation[]) {
  return violations.map((violation) => ({
    id: violation.id,
    severity: normalizedImpact(violation),
    axeImpact: violation.impact,
    targets: violation.nodes.flatMap((node) => node.target),
  }));
}

async function runAxe(page: Page, path: string): Promise<void> {
  const result = (await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze()) as AxeResult;
  const counts = countByImpact(result.violations);
  const details = violationDetails(result.violations);
  const moderate = details.filter((violation) => violation.severity === "moderate");
  const minor = details.filter((violation) => violation.severity === "minor");
  const blocking = result.violations.filter(
    (violation) =>
      (violation.impact === "critical" || violation.impact === "serious"),
  );

  console.log(`[a11y-axe] ${path} counts ${JSON.stringify(counts)}`);
  if (moderate.length > 0) {
    console.warn(`[a11y-axe] ${path} MED ${JSON.stringify(moderate)}`);
  }
  if (minor.length > 0) {
    console.info(`[a11y-axe] ${path} minor ${JSON.stringify(minor)}`);
  }

  expect(
    violationDetails(blocking),
    JSON.stringify({ path, counts, blocking: violationDetails(blocking) }, null, 2),
  ).toEqual([]);
}

async function expectSingleH1(page: Page, path: string): Promise<void> {
  await expect(
    page.locator("h1"),
    `${path} should expose exactly one h1`,
  ).toHaveCount(1);
}

async function expectLoginFormControlsHaveLabels(page: Page): Promise<void> {
  const unlabeled = await page.locator("form").evaluateAll((forms) => {
    function selectorFor(element: Element): string {
      const tag = element.tagName.toLowerCase();
      const id = element.id ? `#${CSS.escape(element.id)}` : "";
      const name = element.getAttribute("name");
      const type = element.getAttribute("type");
      const placeholder = element.getAttribute("placeholder");
      return [
        `${tag}${id}`,
        name ? `[name="${name}"]` : "",
        type ? `[type="${type}"]` : "",
        placeholder ? `[placeholder="${placeholder}"]` : "",
      ].join("");
    }

    function hasAssociatedLabel(control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): boolean {
      if (control.matches("input[type='hidden']")) return true;
      if (control.getAttribute("aria-label")?.trim()) return true;
      const labelledBy = control.getAttribute("aria-labelledby")?.trim();
      if (labelledBy) {
        const ids = labelledBy.split(/\s+/);
        if (ids.some((id) => document.getElementById(id)?.textContent?.trim())) return true;
      }
      return Array.from(control.labels ?? []).some((label) => label.textContent?.trim());
    }

    return forms.flatMap((form) =>
      Array.from(form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
        "input:not([type='hidden']), select, textarea",
      ))
        .filter((control) => !hasAssociatedLabel(control))
        .map(selectorFor),
    );
  });

  expect(unlabeled, `Unlabeled /login controls: ${JSON.stringify(unlabeled)}`).toEqual([]);
}

async function expectVisibleInteractiveElementsKeyboardFocusable(page: Page): Promise<void> {
  const failures = await page.locator("body").evaluate(() => {
    const selector = [
      "a[href]",
      "button",
      "input:not([type='hidden'])",
      "select",
      "textarea",
      "summary",
      "[tabindex]",
      "[role='button']",
      "[role='link']",
      "[role='menuitem']",
      "[role='tab']",
      "[role='checkbox']",
      "[role='radio']",
      "[role='switch']",
      "[role='combobox']",
    ].join(",");

    function selectorFor(element: Element): string {
      const tag = element.tagName.toLowerCase();
      const id = element.id ? `#${CSS.escape(element.id)}` : "";
      const href = element.getAttribute("href");
      const role = element.getAttribute("role");
      const text = element.textContent?.trim().replace(/\s+/g, " ").slice(0, 80);
      return [
        `${tag}${id}`,
        href ? `[href="${href}"]` : "",
        role ? `[role="${role}"]` : "",
        text ? ` text="${text}"` : "",
      ].join("");
    }

    function isVisible(element: HTMLElement): boolean {
      if (element.closest("[hidden],[inert],[aria-hidden='true']")) return false;
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") {
        return false;
      }
      return element.getClientRects().length > 0;
    }

    return Array.from(document.querySelectorAll<HTMLElement>(selector))
      .filter((element) => isVisible(element))
      .filter((element) => !element.hasAttribute("disabled"))
      .filter((element) => element.getAttribute("aria-disabled") !== "true")
      // Allow explicit `tabindex="-1"` opt-outs — these are legit for
      // programmatically-focused targets (skip-link targets, scroll
      // regions, modal containers). Test still catches MISSING
      // focusability on elements that should clearly be in tab order.
      .filter((element) => element.getAttribute("tabindex") !== "-1")
      .flatMap((element) => {
        const reasons: string[] = [];
        if (element.tabIndex < 0) reasons.push(`tabIndex=${element.tabIndex}`);
        element.focus({ preventScroll: true });
        if (document.activeElement !== element) reasons.push("focus() did not move activeElement");
        return reasons.length > 0 ? [{ selector: selectorFor(element), reasons }] : [];
      });
  });

  expect(failures, `Non-keyboard-focusable / elements: ${JSON.stringify(failures)}`).toEqual([]);
}

test("/", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");

  await runAxe(page, "/");
  await expectSingleH1(page, "/");

  const trigger = page.getByRole("button", { name: "For" });
  await expect(trigger).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-haspopup", "menu");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("menu")).toBeVisible();

  await expectVisibleInteractiveElementsKeyboardFocusable(page);
});

test("/login", async ({ page }) => {
  await page.goto("/login");

  await runAxe(page, "/login");
  await expectSingleH1(page, "/login");
  await expectLoginFormControlsHaveLabels(page);
});

test("/desktop/welcome", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/desktop/welcome");

  await runAxe(page, "/desktop/welcome");
  await expectSingleH1(page, "/desktop/welcome");
  await expect(page.getByRole("link", { name: "Get started" })).toHaveAttribute("href", "/desktop/launch");
  await expectVisibleInteractiveElementsKeyboardFocusable(page);
});
