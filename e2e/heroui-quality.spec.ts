import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  assertOverlayMetrics,
  clickVisible,
  openMockChannel,
  overlayMetrics,
  setupMockWorkspace,
} from "./helpers/heroui-workspace";

type ThemeMode = "light" | "dark";

type ConsoleIssue = {
  level: "error" | "warning" | "pageerror";
  text: string;
};

const THEMES: ThemeMode[] = ["light", "dark"];

test.describe("HeroUI Pro global quality gates", () => {
  test("channel page and key overlays emit no React or ARIA console regressions", async ({ page, context }) => {
    const consoleGate = watchConsoleQuality(page);

    await page.setViewportSize({ width: 1280, height: 900 });
    await setupMockWorkspace(page, context);
    await openMockChannel(page);
    await consoleGate.expectClean("channel page");

    await page.getByRole("button", { name: /Members:/ }).click();
    await expect(page.getByRole("dialog", { name: /Members of #onboarding/ })).toBeVisible();
    await assertCloseControl(page.getByRole("dialog", { name: /Members of #onboarding/ }));
    await page.getByRole("dialog", { name: /Members of #onboarding/ }).getByRole("button", { name: "Close" }).first().click();
    await expect(page.getByRole("dialog", { name: /Members of #onboarding/ })).toBeHidden();

    await openChannelAction(page, "Channel settings");
    await expect(page.getByRole("dialog", { name: /Channel settings/ })).toBeVisible();
    await assertCloseControl(page.getByRole("dialog", { name: /Channel settings/ }));
    await page.getByRole("dialog", { name: /Channel settings/ }).getByRole("button", { name: "Close" }).first().click();
    await expect(page.getByRole("dialog", { name: /Channel settings/ })).toBeHidden();

    await openChannelAction(page, "Leave channel");
    await expect(page.getByRole("alertdialog", { name: /Leave #onboarding/ })).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("alertdialog", { name: /Leave #onboarding/ })).toBeHidden();

    await consoleGate.expectClean("channel overlays");
  });

  for (const theme of THEMES) {
    test(`${theme} mode overlays keep readable text, close controls, and action contrast`, async ({ page, context }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await setupMockWorkspace(page, context);
      await openMockChannel(page);
      await setTheme(page, theme);

      const membersTrigger = page.getByRole("button", { name: "Channel actions" });
      await membersTrigger.click();
      await page.getByRole("menuitem", { name: "Members" }).click();
      await assertNamedDialog(page, /Members of #onboarding/);
      await assertCloseControl(page.getByRole("dialog", { name: /Members of #onboarding/ }));
      await assertEnabledButtonsUsable(page.getByRole("dialog", { name: /Members of #onboarding/ }));

      await page.getByRole("button", { name: "Remove Cloud Test Agent" }).click();
      await assertNamedDialog(page, /Remove Cloud Test Agent from #onboarding/, "alertdialog", { requireClose: false });
      await assertEnabledButtonsUsable(page.getByRole("alertdialog", { name: /Remove Cloud Test Agent from #onboarding/ }));
      await page.getByRole("button", { name: "Cancel" }).click();
      await expect(page.getByRole("alertdialog", { name: /Remove Cloud Test Agent from #onboarding/ })).toBeHidden();
      await page.getByRole("dialog", { name: /Members of #onboarding/ }).getByRole("button", { name: "Close" }).first().click();
      await expect(page.getByRole("dialog", { name: /Members of #onboarding/ })).toBeHidden();

      await openChannelAction(page, "Channel settings");
      const settingsDialog = page.getByRole("dialog", { name: /Channel settings/ });
      await settingsDialog.getByLabel("Current topic").fill(`quality-${theme}`);
      await assertNamedDialog(page, /Channel settings/);
      await assertCloseControl(settingsDialog);
      await assertEnabledButtonsUsable(settingsDialog);
      await settingsDialog.getByRole("button", { name: "Private" }).click();
      await assertNamedDialog(page, /Convert #onboarding to private/, "alertdialog", { requireClose: false });
      await assertEnabledButtonsUsable(page.getByRole("alertdialog", { name: /Convert #onboarding to private/ }));
      await page.getByRole("button", { name: "Cancel" }).click();
      await expect(page.getByRole("alertdialog", { name: /Convert #onboarding to private/ })).toBeHidden();
    });
  }

  test("sidebar-launched dialogs lock the background and restore focus to launch controls", async ({ page, context }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await setupMockWorkspace(page, context);
    await openMockChannel(page);

    const createChannelTrigger = page.getByRole("button", { name: "Create channel" }).first();
    await createChannelTrigger.focus();
    await createChannelTrigger.click();
    const createDialog = page.getByRole("dialog", { name: /Create channel/ });
    await createDialog.getByLabel("Name").fill("quality-check");
    await assertNamedDialog(page, /Create channel/);
    await assertCloseControl(createDialog);
    await assertEnabledButtonsUsable(createDialog);
    await createDialog.getByRole("button", { name: "Close" }).first().click();
    await expect(createDialog).toBeHidden();
    await expect(createChannelTrigger).toBeFocused();

    const newDmTrigger = page.getByRole("button", { name: "Start a new direct message" }).first();
    await newDmTrigger.focus();
    await newDmTrigger.click();
    const dmDialog = page.getByRole("dialog", { name: /Start a direct message/ });
    await assertNamedDialog(page, /Start a direct message/);
    await assertCloseControl(dmDialog);
    await assertEnabledButtonsUsable(dmDialog);
    await dmDialog.getByRole("button", { name: "Close" }).first().click();
    await expect(dmDialog).toBeHidden();
    await expect(newDmTrigger).toBeFocused();
  });
});

function watchConsoleQuality(page: Page) {
  const issues: ConsoleIssue[] = [];

  page.on("console", (message) => {
    const text = message.text();
    if (message.type() === "error" && isReactOrAriaConsoleError(text)) {
      issues.push({ level: "error", text });
    }
    if (message.type() === "warning" && isActionableA11yWarning(text)) {
      issues.push({ level: "warning", text });
    }
  });
  page.on("pageerror", (error) => {
    issues.push({ level: "pageerror", text: error.stack ?? error.message });
  });

  return {
    async expectClean(label: string) {
      await page.waitForTimeout(100);
      expect(issues, `${label} React/ARIA console issues`).toEqual([]);
    },
  };
}

function isReactOrAriaConsoleError(text: string) {
  return [
    /React/i,
    /Hydration/i,
    /@react-aria/i,
    /react-aria/i,
    /\bARIA\b/i,
    /\baria-/i,
    /PressResponder/i,
    /Dialog/i,
  ].some((pattern) => pattern.test(text));
}

function isActionableA11yWarning(text: string) {
  // Keep this filter narrow: third-party primitives may warn about internal
  // press responders, but missing dialog titles/labels are user-facing a11y bugs.
  return [
    /does not contain a <Heading/i,
    /accessible name/i,
    /aria-label/i,
    /aria-labelledby/i,
    /aria-describedby/i,
    /role=.*dialog/i,
  ].some((pattern) => pattern.test(text));
}

async function setTheme(page: Page, theme: ThemeMode) {
  await page.evaluate((mode) => {
    const root = document.documentElement;
    if (mode === "dark") {
      root.dataset.theme = "dark";
      root.classList.add("dark");
      return;
    }
    delete root.dataset.theme;
    root.classList.remove("dark");
  }, theme);
}

async function openChannelAction(page: Page, itemName: string) {
  await page.getByRole("button", { name: "Channel actions" }).click();
  await page.getByRole("menuitem", { name: itemName }).click();
}

async function assertNamedDialog(
  page: Page,
  name: RegExp,
  role: "dialog" | "alertdialog" = "dialog",
  options: { requireClose?: boolean } = {},
) {
  const dialog = page.getByRole(role, { name });
  await expect(dialog).toBeVisible();
  const metrics = await overlayMetrics(page, name, role);
  assertOverlayMetrics(metrics, options);
  await assertBackgroundLocked(page);
}

async function assertBackgroundLocked(page: Page) {
  const lockState = await page.evaluate(() => {
    const html = getComputedStyle(document.documentElement);
    const body = getComputedStyle(document.body);
    return {
      bodyScrollable: document.body.scrollHeight > document.body.clientHeight,
      documentScrollable: document.documentElement.scrollHeight > document.documentElement.clientHeight,
      htmlOverflow: html.overflow,
      bodyOverflow: body.overflow,
    };
  });
  expect(lockState.bodyScrollable, `body scrollable with overlay open (${lockState.bodyOverflow})`).toBe(false);
  expect(lockState.documentScrollable, `document scrollable with overlay open (${lockState.htmlOverflow})`).toBe(false);
}

async function assertCloseControl(dialog: Locator) {
  const close = dialog.locator('[data-slot="modal-close-trigger"]').first();
  await expect(close).toBeVisible();
  await expect(close).toHaveAccessibleName(/^Close$/);

  const details = await close.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return {
      width: rect.width,
      height: rect.height,
      opacity: Number.parseFloat(style.opacity || "1"),
      visibility: style.visibility,
      pointerEvents: style.pointerEvents,
      color: style.color,
      disabled: el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true",
      topmost: Boolean(top && el.contains(top)),
    };
  });

  expect(details.width).toBeGreaterThanOrEqual(36);
  expect(details.height).toBeGreaterThanOrEqual(36);
  expect(details.opacity).toBeGreaterThanOrEqual(0.95);
  expect(details.visibility).toBe("visible");
  expect(details.pointerEvents).not.toBe("none");
  expect(details.color).not.toBe("rgba(0, 0, 0, 0)");
  expect(details.disabled).toBe(false);
  expect(details.topmost).toBe(true);
}

async function assertEnabledButtonsUsable(dialog: Locator) {
  const brokenButtons = await dialog.locator("button").evaluateAll((buttons) => {
    return buttons.flatMap((button) => {
      const rect = button.getBoundingClientRect();
      const style = getComputedStyle(button);
      const disabled = button.disabled || button.getAttribute("aria-disabled") === "true";
      const visible = rect.width > 0 && rect.height > 0 && style.visibility !== "hidden";
      if (!visible || disabled) return [];
      const label = button.getAttribute("aria-label") || button.textContent?.trim() || button.outerHTML.slice(0, 80);
      const transparentText = style.color === "rgba(0, 0, 0, 0)" || style.color === "transparent";
      const blocked = style.pointerEvents === "none";
      const tooSmall = rect.width < 24 || rect.height < 24;
      const faded = Number.parseFloat(style.opacity || "1") < 0.75;
      return transparentText || blocked || tooSmall || faded
        ? [`${label}: ${Math.round(rect.width)}x${Math.round(rect.height)} opacity=${style.opacity} pointer=${style.pointerEvents} color=${style.color}`]
        : [];
    });
  });
  expect(brokenButtons).toEqual([]);
}
