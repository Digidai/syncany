import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import {
  assertOverlayMetrics,
  contrast,
  json,
  overlayMetrics,
  setupMockWorkspace,
  simulateVisualViewportHeight,
} from "./helpers/heroui-workspace";

async function setupAgentDialogMocks(page: Page, context: BrowserContext) {
  await setupMockWorkspace(page, context);

  await page.route("**/api/v1/machine-keys**", (route) => {
    if (route.request().method() === "OPTIONS") return route.fallback();
    return route.fulfill(json({
      keys: [
        {
          id: "mk-1",
          prefix: "rlt_live",
          name: "Gene's MacBook",
          serverId: "srv-demo",
          createdAt: Date.now(),
          lastUsedAt: Date.now(),
          revokedAt: null,
          lastDetectedAt: Date.now(),
          machines: [
            {
              hostId: "macbook",
              hostname: "Gene-MacBook",
              platform: "darwin",
              arch: "arm64",
              bridgeVersion: "0.0.0-test",
              detectedAt: Date.now(),
              runtimes: [
                { id: "claude", detected: true, authed: true, version: "test", error: null },
                { id: "codex", detected: true, authed: false, version: "test", error: "login required" },
                { id: "openclaw", detected: false, authed: false, version: null, error: null },
                { id: "hermes", detected: false, authed: false, version: null, error: null },
              ],
            },
          ],
        },
      ],
    }));
  });
}

async function openAgentsIndex(page: Page) {
  await page.goto("/s/demo/agents", { waitUntil: "domcontentloaded" });
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" }).catch(() => {});
  await expect(page.getByTestId("workspace-shell")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Agents" })).toBeVisible();
}

async function openSettingsAgents(page: Page) {
  await page.goto("/s/demo/settings/agents", { waitUntil: "domcontentloaded" });
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" }).catch(() => {});
  await expect(page.getByTestId("workspace-shell")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Channels & agents" })).toBeVisible();
}

async function assertFocusedControlKeepsIosSafeFontSize(page: Page) {
  const fontSize = await page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    return active ? Number.parseFloat(getComputedStyle(active).fontSize) : 0;
  });
  expect(fontSize).toBeGreaterThanOrEqual(16);
}

async function assertDialogFitsViewport(page: Page, dialogName: RegExp) {
  const dialog = page.getByRole("dialog", { name: dialogName });
  await expect(dialog).toBeVisible();
  const fit = await dialog.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      bottom: rect.bottom,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      documentScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
    };
  });
  expect(fit.left).toBeGreaterThanOrEqual(0);
  expect(fit.right).toBeLessThanOrEqual(fit.viewportWidth + 1);
  expect(fit.bottom).toBeLessThanOrEqual(fit.viewportHeight + 1);
  expect(fit.documentScrollWidth).toBeLessThanOrEqual(fit.viewportWidth + 1);
  expect(fit.bodyScrollWidth).toBeLessThanOrEqual(fit.viewportWidth + 1);
}

async function assertDialogFooterVisibleInVisualViewport(page: Page, dialogName: RegExp, height = 500) {
  await expect(page.getByRole("dialog", { name: dialogName })).toBeVisible();
  await simulateVisualViewportHeight(page, height);
  await page.waitForFunction((expectedHeight) => {
    const dialog = document.querySelector<HTMLElement>('[data-raltic-overlay="dialog"]');
    const footer = dialog?.querySelector<HTMLElement>('[data-slot="modal-footer"]');
    const submit = footer?.querySelector<HTMLElement>('button[type="submit"]');
    if (!dialog || !footer || !submit) return false;
    return dialog.getBoundingClientRect().bottom <= expectedHeight + 1
      && footer.getBoundingClientRect().bottom <= expectedHeight + 1
      && submit.getBoundingClientRect().bottom <= expectedHeight + 1;
  }, height);
}

function parseRgb(value: string) {
  const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])] as const;
}

async function expectDialogTextContrast(page: Page, dialogName: RegExp, texts: string[]) {
  const dialog = page.getByRole("dialog", { name: dialogName });
  const samples = await dialog.evaluate((el, labels) => {
    const background = getComputedStyle(el).backgroundColor;
    return labels.map((label) => {
      const node = Array.from(el.querySelectorAll<HTMLElement>("*"))
        .find((candidate) => candidate.textContent?.trim().startsWith(label));
      return {
        label,
        background,
        color: node ? getComputedStyle(node).color : "",
      };
    });
  }, texts);

  for (const sample of samples) {
    const foreground = parseRgb(sample.color);
    const background = parseRgb(sample.background);
    expect(
      foreground && background ? contrast(foreground, background) : 0,
      `${sample.label} contrast`,
    ).toBeGreaterThanOrEqual(4.5);
  }
}

test("create agent dialog covers mobile viewport, runtime controls, and iOS-safe field focus", async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setupAgentDialogMocks(page, context);
  await openAgentsIndex(page);

  const createRequests: unknown[] = [];
  await page.route("**/api/v1/agents", async (route) => {
    if (route.request().method() === "POST") {
      createRequests.push(route.request().postDataJSON());
      return route.fulfill(json({ id: "agent-new" }));
    }
    return route.fallback();
  });

  await page.getByRole("button", { name: "New agent" }).click();
  const dialogName = /Create agent/;
  const dialog = page.getByRole("dialog", { name: dialogName });
  await expect(dialog).toBeVisible();
  assertOverlayMetrics(await overlayMetrics(page, dialogName));
  await assertDialogFitsViewport(page, dialogName);

  await dialog.getByLabel("Identifier").fill("research_agent");
  await assertFocusedControlKeepsIosSafeFontSize(page);
  await dialog.getByLabel("Display name").fill("Research Agent");
  await dialog.getByLabel("Description").fill("Tracks open research threads.");
  await dialog.getByLabel("System prompt").fill("You summarize research clearly.");

  await dialog.getByRole("button", { name: /My machine \(Bridge\)/ }).click();
  await expect(dialog.getByRole("group", { name: "Runtime" })).toBeVisible();
  await dialog.getByRole("button", { name: /OpenAI Codex/ }).click();
  await expect(dialog.getByRole("button", { name: /OpenAI Codex/ })).toHaveAttribute("aria-pressed", "true");
  await dialog.getByRole("button", { name: "gpt-5.4", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "gpt-5.4", exact: true })).toHaveAttribute("aria-pressed", "true");

  await assertDialogFooterVisibleInVisualViewport(page, dialogName, 500);
  await expect(dialog.getByRole("button", { name: "Create" })).toBeVisible();
  await dialog.getByRole("button", { name: "Create" }).click();

  await expect.poll(() => createRequests.length).toBe(1);
  expect(createRequests[0]).toMatchObject({
    serverId: "srv-demo",
    name: "research_agent",
    displayName: "Research Agent",
    runtimeMode: "bridge",
    runtime: "codex",
    model: "gpt-5.4",
  });
});

test("edit agent dialog from settings loads readable content without horizontal overflow", async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setupAgentDialogMocks(page, context);
  await openSettingsAgents(page);

  await page.getByRole("button", { name: "Edit Cloud Test Agent" }).click();
  const dialogName = /Edit cloud-test/;
  const dialog = page.getByRole("dialog", { name: dialogName });
  await expect(dialog).toBeVisible();
  assertOverlayMetrics(await overlayMetrics(page, dialogName));
  await assertDialogFitsViewport(page, dialogName);

  await expect(dialog.getByLabel("Identifier")).toHaveValue("cloud-test");
  await expect(dialog.getByLabel("Display name")).toHaveValue("Cloud Test Agent");
  await expect(dialog.getByLabel("Description")).toHaveValue("Runs in Raltic cloud");
  await expect(dialog.getByRole("group", { name: "Model" })).toContainText("claude-haiku-4-5");

  await dialog.getByLabel("Display name").focus();
  await assertFocusedControlKeepsIosSafeFontSize(page);

  await assertDialogFooterVisibleInVisualViewport(page, dialogName, 520);
  await expect(dialog.getByRole("button", { name: "Save" })).toBeVisible();
});

test("dark mode create and edit agent dialogs keep close, text, and primary button contrast", async ({ page, context }) => {
  await page.setViewportSize({ width: 430, height: 760 });
  await setupAgentDialogMocks(page, context);
  await openSettingsAgents(page);
  await page.evaluate(() => document.documentElement.classList.add("dark"));

  await page.getByRole("button", { name: "New agent" }).click();
  assertOverlayMetrics(await overlayMetrics(page, /Create agent/));
  await expectDialogTextContrast(page, /Create agent/, [
    "Where does this agent live?",
    "Identifier",
    "Display name",
    "Model",
  ]);

  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("dialog", { name: /Create agent/ })).toBeHidden();

  await page.getByRole("button", { name: "Edit Cloud Test Agent" }).click();
  assertOverlayMetrics(await overlayMetrics(page, /Edit cloud-test/));
  await expectDialogTextContrast(page, /Edit cloud-test/, [
    "Avatar",
    "Identifier",
    "Display name",
    "System prompt",
    "Model",
  ]);
});
