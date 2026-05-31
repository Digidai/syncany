import { expect, test } from "@playwright/test";
import { login, missingAuthSkipReason } from "./helpers/auth";

const RUN = process.env.E2E_RUN_WORKSPACE === "1";
const AUTH_SKIP = missingAuthSkipReason();

async function openFirstChannel(page: import("@playwright/test").Page) {
  const nav = page.getByRole("navigation", { name: "Workspace navigation" });
  const firstChannel = nav.getByRole("link", { name: /^onboarding\b/i }).first();
  await expect(firstChannel).toBeVisible({ timeout: 15000 });
  await firstChannel.click();
  await expect(page).toHaveURL(/\/s\/[^/]+\/channel\/[0-9a-f-]+$/, { timeout: 10000 });
}

test.describe(RUN ? "workspace shell read-only" : "workspace shell read-only (skipped — set E2E_RUN_WORKSPACE=1)", () => {
  test.skip(!RUN, "read-only authenticated workspace gate is opt-in");
  test.skip(RUN && Boolean(AUTH_SKIP), AUTH_SKIP ?? "");

  test.beforeEach(async ({ page }) => {
    await login(page);
    await expect(page.getByTestId("workspace-shell")).toBeVisible({ timeout: 15000 });
  });

  test("renders shell navigation with link semantics and stable browser state", async ({ page, context }) => {
    const shell = page.getByTestId("workspace-shell");
    const sidebar = page.getByTestId("workspace-sidebar");
    const main = page.getByTestId("workspace-main");
    const nav = page.getByRole("navigation", { name: "Workspace navigation" });

    await expect(shell).toBeVisible();
    await expect(shell).toHaveAttribute("data-visual-pass", "heroui-pro-v2");
    await expect(sidebar).toHaveAttribute("data-state", "expanded");
    await expect(nav).toBeVisible();
    await expect(main).toBeVisible();

    const workspaceMatch = new URL(page.url()).pathname.match(/^\/s\/([^/]+)/);
    expect(workspaceMatch, "login should land on a workspace route").toBeTruthy();
    const slug = workspaceMatch?.[1];

    for (const item of ["Inbox", "Tasks", "Agents", "People"]) {
      const link = nav.getByRole("link", { name: item });
      await expect(link, `${item} should remain a real link`).toBeVisible();
      await expect(link).toHaveAttribute("href", new RegExp(`/s/${slug}/${item.toLowerCase()}`));
    }

    await nav.getByRole("link", { name: "Inbox" }).click();
    await expect(page).toHaveURL(new RegExp(`/s/${slug}/inbox$`));
    await expect(page.getByRole("navigation", { name: "Workspace navigation" })).toBeVisible();

    await page.keyboard.press(process.platform === "darwin" ? "Meta+B" : "Control+B");
    await expect(page.getByTestId("workspace-sidebar")).toHaveAttribute("data-state", "expanded");

    await page.getByTestId("user-pill-trigger").click();
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Account" })).toBeVisible();
    await page.keyboard.press("Escape");

    const cookies = await context.cookies();
    expect(cookies.filter((cookie) => /^(sidebar_state|aside_state)$/.test(cookie.name))).toEqual([]);
  });

  test("keeps page scrolling locked to the workspace shell", async ({ page }) => {
    const shellScroll = await page.evaluate(() => ({
      bodyScrollable: document.body.scrollHeight > document.body.clientHeight,
      documentScrollable: document.documentElement.scrollHeight > document.documentElement.clientHeight,
      shellOverflow: getComputedStyle(document.querySelector("[data-testid='workspace-shell']")!).overflow,
      mainOverflow: getComputedStyle(document.querySelector("[data-testid='workspace-main']")!).overflow,
    }));

    expect(shellScroll).toEqual({
      bodyScrollable: false,
      documentScrollable: false,
      shellOverflow: "hidden",
      mainOverflow: "hidden",
    });
  });

  test("keeps the message composer as a card composer surface", async ({ page }) => {
    await openFirstChannel(page);

    const composer = page.getByTestId("message-composer");
    await expect(composer).toBeVisible();

    const composerMetrics = await page.evaluate(() => {
      const composer = document.querySelector("[data-testid='message-composer']")?.getBoundingClientRect();
      const attach = document.querySelector("[aria-label='Attach file or image']")?.getBoundingClientRect();
      const input = document.querySelector("[data-testid='message-composer-input']")?.getBoundingClientRect();
      const send = document.querySelector("[aria-label='Send message']")?.getBoundingClientRect();
      const editor = document.querySelector("[data-testid='message-composer-input'] [role='textbox']");
      const editorStyle = editor ? getComputedStyle(editor) : null;
      if (!composer || !attach || !input || !send) return null;
      return {
        attachInsideComposer:
          attach.top >= composer.top &&
          attach.left >= composer.left &&
          attach.bottom <= composer.bottom &&
          attach.right <= composer.right,
        inputInsideComposer:
          input.top >= composer.top &&
          input.left >= composer.left &&
          input.bottom <= composer.bottom &&
          input.right <= composer.right,
        sendInsideComposer:
          send.top >= composer.top &&
          send.left >= composer.left &&
          send.bottom <= composer.bottom &&
          send.right <= composer.right,
        toolbarBelowInput: attach.top >= input.bottom - 1 && send.top >= input.bottom - 1,
        composerVisibleInViewport: composer.top >= 0 && composer.bottom <= window.innerHeight,
        composerHeight: composer.height,
        editorFontSize: editorStyle?.fontSize ?? "",
      };
    });

    expect(composerMetrics).toMatchObject({
      attachInsideComposer: true,
      inputInsideComposer: true,
      sendInsideComposer: true,
      toolbarBelowInput: true,
      composerVisibleInViewport: true,
    });
    expect(composerMetrics?.composerHeight).toBeGreaterThanOrEqual(96);
    expect(parseInt(composerMetrics?.editorFontSize ?? "", 10)).toBeGreaterThanOrEqual(14);
  });

  test("opens workspace navigation from the mobile shell", async ({ page, context }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();

    const openNav = page.getByRole("button", { name: "Open workspace navigation" });
    await expect(openNav).toBeVisible();
    await openNav.click();

    const mobileSidebar = page.getByTestId("workspace-sidebar-mobile");
    await expect(mobileSidebar).toBeVisible();
    await expect(mobileSidebar.getByRole("navigation", { name: "Workspace navigation" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(mobileSidebar).toBeHidden();

    const cookies = await context.cookies();
    expect(cookies.filter((cookie) => /^(sidebar_state|aside_state)$/.test(cookie.name))).toEqual([]);
  });
});
