import { expect, test, type Page } from "@playwright/test";

import {
  assertOverlayMetrics,
  clickVisible,
  openMembersDialog,
  openMockChannel,
  overlayMetrics,
  setupMockWorkspace,
  simulateVisualViewportHeight,
} from "./helpers/heroui-workspace";

async function assertComposerFollowsVisualViewport(page: Page) {
  await page.getByRole("textbox", { name: /Message onboarding/ }).focus();
  await simulateVisualViewportHeight(page, 560);
  await page.waitForFunction(() => {
    const footer = document.querySelector<HTMLElement>('[data-testid="message-composer-footer"]');
    const rect = footer?.getBoundingClientRect();
    return rect ? rect.bottom <= 561 : false;
  });
  const composer = await page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    const footer = document.querySelector<HTMLElement>('[data-testid="message-composer-footer"]');
    const composerBox = document.querySelector<HTMLElement>('[data-testid="message-composer"]');
    const footerRect = footer?.getBoundingClientRect();
    const composerRect = composerBox?.getBoundingClientRect();
    return {
      activeRole: active?.getAttribute("role") ?? "",
      fontSize: active ? Number.parseFloat(getComputedStyle(active).fontSize) : 0,
      footerBottom: footerRect?.bottom ?? 0,
      composerBottom: composerRect?.bottom ?? 0,
      bodyScrollable: document.body.scrollHeight > document.body.clientHeight,
      documentScrollable: document.documentElement.scrollHeight > document.documentElement.clientHeight,
    };
  });
  expect(composer.activeRole).toBe("textbox");
  expect(composer.fontSize).toBeGreaterThanOrEqual(16);
  expect(composer.footerBottom).toBeLessThanOrEqual(560);
  expect(composer.footerBottom).toBeGreaterThanOrEqual(520);
  expect(composer.composerBottom).toBeLessThanOrEqual(560);
  expect(composer.bodyScrollable).toBe(false);
  expect(composer.documentScrollable).toBe(false);
}

async function assertMembersPickerFollowsVisualViewport(page: Page) {
  await page.getByRole("button", { name: "Add people or agents" }).click();
  await page.getByLabel("Search people or agents").focus();
  await simulateVisualViewportHeight(page, 560);
  await page.waitForFunction(() => {
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const input = document.activeElement as HTMLElement | null;
    return Boolean(dialog && input && dialog.getBoundingClientRect().bottom <= 561 && input.getBoundingClientRect().bottom <= 561);
  });
  const focused = await page.evaluate(() => {
    const input = document.activeElement;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    return {
      inputBottom: input?.getBoundingClientRect().bottom ?? 0,
      dialogBottom: dialog?.getBoundingClientRect().bottom ?? 0,
    };
  });
  expect(focused.inputBottom).toBeLessThanOrEqual(560);
  expect(focused.dialogBottom).toBeLessThanOrEqual(560);
}

async function assertDialogFooterReachable(page: Page, dialogName: RegExp) {
  const dialog = page.getByRole("dialog", { name: dialogName });
  await expect(dialog).toBeVisible();
  await simulateVisualViewportHeight(page, 500);
  await page.waitForFunction(() => {
    const dialog = document.querySelector<HTMLElement>('[data-raltic-overlay="dialog"]');
    const footer = dialog?.querySelector<HTMLElement>('[data-slot="modal-footer"]');
    const body = dialog?.querySelector<HTMLElement>('[data-slot="modal-body"]');
    if (!dialog || !footer || !body) return false;
    return dialog.getBoundingClientRect().bottom <= 501 && footer.getBoundingClientRect().bottom <= 501;
  });
  const metrics = await page.evaluate(() => {
    const dialog = document.querySelector<HTMLElement>('[data-raltic-overlay="dialog"]');
    const footer = dialog?.querySelector<HTMLElement>('[data-slot="modal-footer"]');
    const body = dialog?.querySelector<HTMLElement>('[data-slot="modal-body"]');
    const submit = dialog?.querySelector<HTMLElement>('button[type="submit"]');
    return {
      dialogBottom: dialog?.getBoundingClientRect().bottom ?? 0,
      footerBottom: footer?.getBoundingClientRect().bottom ?? 0,
      bodyScrollable: body ? body.scrollHeight > body.clientHeight : false,
      submitVisible: submit ? submit.getBoundingClientRect().bottom <= 501 : false,
    };
  });
  expect(metrics.dialogBottom).toBeLessThanOrEqual(501);
  expect(metrics.footerBottom).toBeLessThanOrEqual(501);
  expect(metrics.bodyScrollable).toBe(true);
  expect(metrics.submitVisible).toBe(true);
}

test("chat composer follows the mobile visual viewport", async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setupMockWorkspace(page, context);
  await openMockChannel(page);

  await assertComposerFollowsVisualViewport(page);
});

test("member overlays keep contrast and picker inputs above the keyboard", async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setupMockWorkspace(page, context);
  await openMockChannel(page);

  await openMembersDialog(page);
  await assertMembersPickerFollowsVisualViewport(page);

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: /Members of #onboarding/ })).toBeHidden();
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await page.getByRole("button", { name: "Channel actions" }).click();
  await page.getByRole("menuitem", { name: "Members" }).click();
  assertOverlayMetrics(await overlayMetrics(page, /Members of #onboarding/));
});

test("alert dialogs keep contrast and require an explicit choice", async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setupMockWorkspace(page, context);
  await openMockChannel(page);

  await page.getByRole("button", { name: "Channel actions" }).click();
  await page.getByRole("menuitem", { name: "Leave channel" }).click();
  assertOverlayMetrics(await overlayMetrics(page, /Leave #onboarding/, "alertdialog"), { requireClose: false });

  await page.mouse.click(12, 12);
  await expect(page.getByRole("alertdialog", { name: /Leave #onboarding/ })).toBeVisible();
});

test("legacy remove-member alert dialogs keep HeroUI Pro spacing and behavior", async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setupMockWorkspace(page, context);
  await openMockChannel(page);

  await openMembersDialog(page);
  await page.getByRole("button", { name: "Remove Cloud Test Agent" }).click();
  assertOverlayMetrics(await overlayMetrics(page, /Remove Cloud Test Agent from #onboarding/, "alertdialog"), { requireClose: false });

  await page.mouse.click(12, 12);
  await expect(page.getByRole("alertdialog", { name: /Remove Cloud Test Agent from #onboarding/ })).toBeVisible();
});

test("mobile sidebar-launched dialogs render above the sidebar overlay", async ({ page, context }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await setupMockWorkspace(page, context);
  await openMockChannel(page);

  await page.getByRole("button", { name: "Open workspace navigation" }).click();
  await clickVisible(page, 'button[aria-label="Create channel"]');
  assertOverlayMetrics(await overlayMetrics(page, /Create channel/));
  await assertDialogFooterReachable(page, /Create channel/);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: /Create channel/ })).toBeHidden();

  await page.keyboard.press("Escape").catch(() => {});
  await page.getByRole("button", { name: "Open workspace navigation" }).click();
  await clickVisible(page, 'button[aria-label="Start a new direct message"]');
  assertOverlayMetrics(await overlayMetrics(page, /Start a direct message/));
});
