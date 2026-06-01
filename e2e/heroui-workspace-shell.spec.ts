import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  agents,
  contrast,
  dmChannel,
  json,
  onboardingChannel,
  openMockChannel,
  researchChannel,
  server,
  setupMockWorkspace,
} from "./helpers/heroui-workspace";

type Rect = {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
};

type ShellMetrics = {
  viewport: { width: number; height: number };
  bodyOverflowX: boolean;
  documentOverflowX: boolean;
  bodyScrollable: boolean;
  documentScrollable: boolean;
  shell: Rect | null;
  sidebar: Rect | null;
  mobileSidebar: Rect | null;
  main: Rect | null;
  conversationHeader: Rect | null;
  composerFooter: Rect | null;
  composer: Rect | null;
  openNav: Rect | null;
  visibleConversationHeaders: number;
};

function parseRgb(value: string | null) {
  if (!value) return null;

  let match = value.match(/^rgba?\(([^)]+)\)$/);
  if (match) {
    const [r, g, b] = match[1]
      .replace(/\//g, " ")
      .split(/[\s,]+/)
      .filter(Boolean)
      .slice(0, 3)
      .map((token) => Number(token.endsWith("%") ? Number(token.slice(0, -1)) * 2.55 : Number(token)));

    if (r == null || g == null || b == null || Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
    return [Math.round(r), Math.round(g), Math.round(b)] as const;
  }

  match = value.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*[\d.]+)?\)$/);
  if (match) {
    const [r, g, b] = match.slice(1, 4).map((token) => Math.round(Number(token) * 255));
    if (r == null || g == null || b == null || Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
    return [Math.min(255, Math.max(0, r)), Math.min(255, Math.max(0, g)), Math.min(255, Math.max(0, b))] as const;
  }

  return null;
}

async function visibleDangerTextSamples(page: Page) {
  return page.evaluate(() => {
    type Rgba = [number, number, number, number];

    function parseColor(value: string | null): Rgba | null {
      if (!value || value === "transparent") return null;

      let match = value.match(/^rgba?\(([^)]+)\)$/);
      if (match) {
        const parts = match[1].replace(/\//g, " ").split(/[\s,]+/).filter(Boolean);
        const [r, g, b] = parts.slice(0, 3).map((token) => Number(token.endsWith("%") ? Number(token.slice(0, -1)) * 2.55 : Number(token)));
        const alpha = parts[3] == null ? 1 : Number(parts[3].endsWith("%") ? Number(parts[3].slice(0, -1)) / 100 : parts[3]);
        if ([r, g, b, alpha].some((component) => Number.isNaN(component))) return null;
        return [Math.round(r), Math.round(g), Math.round(b), Math.min(1, Math.max(0, alpha))];
      }

      match = value.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)$/);
      if (match) {
        const [r, g, b] = match.slice(1, 4).map((token) => Math.round(Number(token) * 255));
        const alpha = match[4] == null ? 1 : Number(match[4]);
        if ([r, g, b, alpha].some((component) => Number.isNaN(component))) return null;
        return [Math.min(255, Math.max(0, r)), Math.min(255, Math.max(0, g)), Math.min(255, Math.max(0, b)), Math.min(1, Math.max(0, alpha))];
      }

      return null;
    }

    function blend(layer: Rgba, base: Rgba): Rgba {
      const alpha = layer[3] + base[3] * (1 - layer[3]);
      if (alpha === 0) return [0, 0, 0, 0];
      return [
        Math.round((layer[0] * layer[3] + base[0] * base[3] * (1 - layer[3])) / alpha),
        Math.round((layer[1] * layer[3] + base[1] * base[3] * (1 - layer[3])) / alpha),
        Math.round((layer[2] * layer[3] + base[2] * base[3] * (1 - layer[3])) / alpha),
        alpha,
      ];
    }

    function effectiveBackground(node: HTMLElement) {
      const chain: HTMLElement[] = [];
      let current: HTMLElement | null = node;
      while (current) {
        chain.push(current);
        current = current.parentElement;
      }

      let background: Rgba = [255, 255, 255, 1];
      for (const element of chain.reverse()) {
        const layer = parseColor(getComputedStyle(element).backgroundColor);
        if (layer && layer[3] > 0) background = blend(layer, background);
      }
      return background.slice(0, 3);
    }

    return Array.from(document.querySelectorAll<HTMLElement>(".text-danger-text"))
      .filter((node) => {
        const box = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return box.width > 0
          && box.height > 0
          && style.visibility !== "hidden"
          && style.display !== "none"
          && Boolean(node.textContent?.trim());
      })
      .map((node) => ({
        text: node.textContent?.replace(/\s+/g, " ").trim() ?? "",
        color: getComputedStyle(node).color,
        background: `rgb(${effectiveBackground(node).join(", ")})`,
      }));
  });
}

async function assertVisibleDangerTextReadable(page: Page, label: string) {
  const samples = await visibleDangerTextSamples(page);
  expect(samples.length, `${label} should render danger text samples`).toBeGreaterThan(0);

  for (const sample of samples) {
    const foreground = parseRgb(sample.color);
    const background = parseRgb(sample.background);
    expect(
      foreground && background ? contrast(foreground, background) : 0,
      `${label}: ${sample.text}`,
    ).toBeGreaterThanOrEqual(4.5);
  }
}

async function setupWorkspaceWithUnread(page: Page, context: Parameters<typeof setupMockWorkspace>[1]) {
  await setupMockWorkspace(page, context);
  await page.route("**/api/v1/servers/by-slug/demo", (route) => route.fulfill(json({
    server,
    channels: [
      onboardingChannel,
      {
        ...researchChannel,
        unread: 3,
        maxSeq: 4,
        lastReadSeq: 1,
      },
      dmChannel,
    ],
    agents,
  })));
}

async function shellMetrics(page: Page): Promise<ShellMetrics> {
  return page.evaluate(() => {
    const rect = (selector: string): Rect | null => {
      const el = document.querySelector<HTMLElement>(selector);
      if (!el) return null;
      const box = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (box.width === 0 || box.height === 0 || style.visibility === "hidden" || style.display === "none") return null;
      return {
        top: box.top,
        right: box.right,
        bottom: box.bottom,
        left: box.left,
        width: box.width,
        height: box.height,
      };
    };
    const visibleByLabel = (selector: string, label: string) => {
      const candidates = Array.from(document.querySelectorAll<HTMLElement>(selector))
        .filter((el) => el.getAttribute("aria-label") === label);
      return candidates.filter((el) => {
        const box = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      });
    };
    const shell = rect("[data-testid='workspace-shell']");
    const sidebar = rect("[data-testid='workspace-sidebar']");
    const mobileSidebar = rect("[data-testid='workspace-sidebar-mobile']");
    const main = rect("[data-testid='workspace-main']");
    const conversationHeader = rect("[aria-label='Conversation header']");
    const composerFooter = rect("[data-testid='message-composer-footer']");
    const composer = rect("[data-testid='message-composer']");
    const openNav = rect("[aria-label='Open workspace navigation']");
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      bodyOverflowX: document.body.scrollWidth > window.innerWidth + 1,
      documentOverflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
      bodyScrollable: document.body.scrollHeight > document.body.clientHeight + 1,
      documentScrollable: document.documentElement.scrollHeight > document.documentElement.clientHeight + 1,
      shell,
      sidebar,
      mobileSidebar,
      main,
      conversationHeader,
      composerFooter,
      composer,
      openNav,
      visibleConversationHeaders: visibleByLabel("[aria-label='Conversation header']", "Conversation header").length,
    };
  });
}

function assertNoDocumentOverflow(metrics: ShellMetrics) {
  expect(metrics.bodyOverflowX, "body must not horizontally overflow").toBe(false);
  expect(metrics.documentOverflowX, "documentElement must not horizontally overflow").toBe(false);
  expect(metrics.bodyScrollable, "body scroll should stay locked to the shell").toBe(false);
  expect(metrics.documentScrollable, "document scroll should stay locked to the shell").toBe(false);
}

function assertRectInsideViewport(rect: Rect | null, viewport: ShellMetrics["viewport"], label: string) {
  expect(rect, `${label} should be visible`).not.toBeNull();
  expect(rect!.left, `${label} left edge`).toBeGreaterThanOrEqual(-1);
  expect(rect!.right, `${label} right edge`).toBeLessThanOrEqual(viewport.width + 1);
  expect(rect!.top, `${label} top edge`).toBeGreaterThanOrEqual(-1);
  expect(rect!.bottom, `${label} bottom edge`).toBeLessThanOrEqual(viewport.height + 1);
}

async function visibleLinkBox(page: Page, name: RegExp) {
  const link = page.getByRole("navigation", { name: "Workspace navigation" }).getByRole("link", { name }).first();
  await expect(link).toBeVisible();
  const box = await link.boundingBox();
  expect(box, `link box should exist for ${name}`).not.toBeNull();
  return box!;
}

async function locatorRect(locator: Locator, label: string): Promise<Rect> {
  await expect(locator, `${label} should be visible`).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, `${label} should have a layout box`).not.toBeNull();
  return {
    top: box!.y,
    right: box!.x + box!.width,
    bottom: box!.y + box!.height,
    left: box!.x,
    width: box!.width,
    height: box!.height,
  };
}

test("desktop shell keeps sidebar, header, chat surface, and composer aligned", async ({ page, context }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setupWorkspaceWithUnread(page, context);
  await openMockChannel(page);
  const headerRect = await locatorRect(page.getByRole("navigation", { name: "Conversation header" }), "conversation header");

  const metrics = await shellMetrics(page);
  assertNoDocumentOverflow(metrics);
  expect(metrics.shell).toMatchObject({ left: 0, top: 0 });
  expect(metrics.shell?.right).toBeCloseTo(1440, 1);
  expect(metrics.shell?.bottom).toBeCloseTo(900, 1);
  assertRectInsideViewport(metrics.sidebar, metrics.viewport, "desktop sidebar");
  assertRectInsideViewport(metrics.main, metrics.viewport, "workspace main");
  assertRectInsideViewport(headerRect, metrics.viewport, "conversation header");
  assertRectInsideViewport(metrics.composerFooter, metrics.viewport, "composer footer");
  assertRectInsideViewport(metrics.composer, metrics.viewport, "composer");

  expect(metrics.openNav, "desktop should not show the mobile menu toggle").toBeNull();
  expect(metrics.mobileSidebar, "mobile drawer should not occupy visible space on desktop").toBeNull();
  expect(metrics.visibleConversationHeaders, "only one conversation header should render").toBe(1);
  expect(metrics.sidebar!.width).toBeGreaterThanOrEqual(220);
  expect(metrics.sidebar!.width).toBeLessThanOrEqual(280);
  expect(Math.abs(metrics.sidebar!.right - metrics.main!.left), "main should start where sidebar ends").toBeLessThanOrEqual(1);
  expect(headerRect.left).toBeCloseTo(metrics.main!.left, 1);
  expect(headerRect.top).toBeCloseTo(metrics.main!.top, 1);
  expect(metrics.composerFooter!.left).toBeCloseTo(metrics.main!.left, 1);
  expect(metrics.composerFooter!.bottom).toBeCloseTo(metrics.main!.bottom, 1);
  expect(metrics.composer!.left).toBeGreaterThanOrEqual(metrics.main!.left + 24);
  expect(metrics.composer!.right).toBeLessThanOrEqual(metrics.main!.right - 24);
});

test("sidebar destination pages fill the workspace main column and keep navigation highlight subtle", async ({ page, context }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setupMockWorkspace(page, context);

  const destinations = [
    { path: "/s/demo/inbox", nav: "Inbox", heading: "Inbox" },
    { path: "/s/demo/tasks", nav: "Tasks", heading: "Tasks" },
    { path: "/s/demo/agents", nav: "Agents", heading: "Agents" },
    { path: "/s/demo/people", nav: "People", heading: "People" },
    { path: "/s/demo/channels", nav: "Channels", heading: "Channels" },
  ];

  for (const destination of destinations) {
    await page.goto(destination.path, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("workspace-shell")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("heading", { name: destination.heading })).toBeVisible();
    await expect(
      page
        .getByRole("navigation", { name: "Workspace navigation" })
        .getByRole("link", { name: "Inbox", exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("navigation", { name: "Workspace navigation" })
        .getByRole("link", { name: destination.nav, exact: true }),
    ).toHaveAttribute("aria-current", "page");

    const metrics = await shellMetrics(page);
    assertNoDocumentOverflow(metrics);
    assertRectInsideViewport(metrics.sidebar, metrics.viewport, "desktop sidebar");
    assertRectInsideViewport(metrics.main, metrics.viewport, "workspace main");
    expect(metrics.sidebar!.width).toBeGreaterThanOrEqual(260);
    expect(metrics.sidebar!.width).toBeLessThanOrEqual(280);

    const pageMetrics = await page.evaluate(() => {
      const main = document.querySelector<HTMLElement>("[data-testid='workspace-main']");
      const stage = main?.firstElementChild as HTMLElement | null;
      const root = stage?.firstElementChild as HTMLElement | null;
      const header = main?.querySelector<HTMLElement>("header");
      const active = document.querySelector<HTMLElement>("[data-testid='workspace-sidebar'] [aria-current='page']");
      const activeContent = active?.closest<HTMLElement>(".sidebar__menu-item-content") ?? null;
      const topDestinationLinks = Array.from(document.querySelectorAll<HTMLElement>("[data-testid='workspace-sidebar'] nav a"))
        .filter((el) => ["Inbox", "Tasks", "Agents", "People", "Channels"].includes(el.textContent?.trim() ?? ""))
        .map((el) => {
          const box = el.getBoundingClientRect();
          return { top: box.top, bottom: box.bottom, height: box.height };
        });
      const rect = (el: HTMLElement | null) => {
        if (!el) return null;
        const box = el.getBoundingClientRect();
        return {
          left: box.left,
          right: box.right,
          width: box.width,
          height: box.height,
          borderRadius: getComputedStyle(el).borderRadius,
          backgroundColor: getComputedStyle(el).backgroundColor,
        };
      };
      return {
        main: rect(main),
        root: rect(root),
        header: rect(header),
        active: rect(active),
        activeContent: rect(activeContent),
        topDestinationGaps: topDestinationLinks.slice(1).map((row, index) => row.top - topDestinationLinks[index].bottom),
        mainListRowShadows: Array.from(main?.querySelectorAll<HTMLElement>("li") ?? [])
          .map((el) => getComputedStyle(el).boxShadow)
          .filter((shadow) => {
            if (shadow === "none") return false;
            const onlyTransparentZeroLayers = shadow
              .replaceAll("rgba(0, 0, 0, 0) 0px 0px 0px 0px", "")
              .replaceAll(",", "")
              .trim().length === 0;
            return !onlyTransparentZeroLayers;
          }),
      };
    });

    expect(pageMetrics.root?.width, `${destination.path} root should fill main`).toBeCloseTo(pageMetrics.main!.width, 1);
    expect(pageMetrics.header?.left, `${destination.path} header starts at main edge`).toBeCloseTo(pageMetrics.main!.left, 1);
    expect(pageMetrics.header?.right, `${destination.path} header reaches main edge`).toBeCloseTo(pageMetrics.main!.right, 1);
    expect(pageMetrics.topDestinationGaps, `${destination.path} top-level sidebar rows should stay compact`).toEqual([6, 6, 6, 6]);
    expect(pageMetrics.mainListRowShadows, `${destination.path} repeated list rows should not add nested card shadows`).toEqual([]);
    expect(pageMetrics.active?.height, `${destination.nav} active row height`).toBeCloseTo(32, 1);
    expect(pageMetrics.active?.borderRadius, `${destination.nav} active row should not render as a square slab`).not.toBe("0px");
    expect(pageMetrics.active?.backgroundColor, `${destination.nav} active row should not use the old solid green fill`).not.toBe("rgb(84, 167, 131)");
    expect(pageMetrics.active?.backgroundColor, `${destination.nav} active row should render one visible layer`).not.toBe("rgba(0, 0, 0, 0)");
    expect(pageMetrics.activeContent?.backgroundColor, `${destination.nav} HeroUI wrapper should not add a second active layer`).toBe("rgba(0, 0, 0, 0)");
  }
});

test("settings sections expose every destination and keep the active state in one layer", async ({ page, context }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setupMockWorkspace(page, context);

  const sections = [
    { path: "/s/demo/settings/workspace", nav: "Workspace", heading: "Workspace" },
    { path: "/s/demo/settings/members", nav: "Members & invites", heading: "Members & invites" },
    { path: "/s/demo/settings/agents", nav: "Channels & agents", heading: "Channels & agents" },
    { path: "/s/demo/settings/keys", nav: "Runtimes", heading: "Runtimes" },
    { path: "/s/demo/settings/connectors", nav: "Connectors", heading: "Connectors" },
    { path: "/s/demo/settings/account", nav: "Account", heading: "Account" },
  ];

  for (const section of sections) {
    await page.goto(section.path, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("workspace-shell")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("heading", { name: section.heading })).toBeVisible();

    const settingsNav = page.getByRole("navigation", { name: "Settings sections" });
    await expect(settingsNav.getByRole("link", { name: "Connectors" })).toBeVisible();
    await expect(settingsNav.getByRole("link", { name: section.nav })).toHaveAttribute("aria-current", "page");

    const metrics = await shellMetrics(page);
    assertNoDocumentOverflow(metrics);

    const navMetrics = await page.evaluate(() => {
      const nav = document.querySelector<HTMLElement>("[aria-label='Settings sections']");
      const active = nav?.querySelector<HTMLElement>("[aria-current='page']") ?? null;
      const activeContent = active?.closest<HTMLElement>(".button") ?? active;
      const rect = (el: HTMLElement | null) => {
        if (!el) return null;
        const box = el.getBoundingClientRect();
        return {
          height: box.height,
          borderRadius: getComputedStyle(el).borderRadius,
          backgroundColor: getComputedStyle(el).backgroundColor,
        };
      };
      return {
        active: rect(active),
        activeContent: rect(activeContent),
        allLinks: Array.from(nav?.querySelectorAll<HTMLElement>("a") ?? []).map((el) => el.textContent?.trim() ?? ""),
      };
    });

    expect(navMetrics.allLinks).toEqual(["Workspace", "Members & invites", "Channels & agents", "Runtimes", "Connectors", "Account"]);
    expect(navMetrics.active?.height, `${section.nav} active row height`).toBeCloseTo(32, 1);
    expect(navMetrics.active?.borderRadius, `${section.nav} active row radius`).not.toBe("0px");
    expect(navMetrics.active?.backgroundColor, `${section.nav} active row should render one visible layer`).not.toBe("rgba(0, 0, 0, 0)");
    expect(navMetrics.activeContent?.backgroundColor, `${section.nav} wrapper should be the active layer`).toBe(navMetrics.active?.backgroundColor);
  }
});

test("workspace URL field keeps the prefix readable and aligned with the form", async ({ page, context }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setupMockWorkspace(page, context);

  await page.goto("/s/demo/settings/workspace", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("workspace-shell")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByLabel("URL")).toBeVisible();

  const metrics = await page.evaluate(() => {
    const slugInput = document.querySelector<HTMLInputElement>("#workspace-slug");
    const urlField = slugInput?.parentElement as HTMLElement | null;
    const prefix = urlField?.querySelector<HTMLElement>("span") ?? null;
    const form = slugInput?.closest("form") as HTMLElement | null;
    const rect = (el: HTMLElement | null) => {
      if (!el) return null;
      const box = el.getBoundingClientRect();
      return { width: box.width, height: box.height };
    };
    const style = (el: HTMLElement | null) => el ? getComputedStyle(el) : null;

    return {
      form: rect(form),
      urlField: rect(urlField),
      prefix: rect(prefix),
      input: rect(slugInput),
      prefixColor: style(prefix)?.color ?? null,
      prefixBackground: style(prefix)?.backgroundColor ?? null,
      mutedToken: getComputedStyle(document.documentElement).getPropertyValue("--muted").trim(),
    };
  });

  const prefixForeground = parseRgb(metrics.prefixColor);
  const prefixBackground = parseRgb(metrics.prefixBackground);
  const mutedToken = parseRgb(metrics.mutedToken);

  expect(metrics.form).not.toBeNull();
  expect(metrics.urlField).not.toBeNull();
  expect(metrics.prefix).not.toBeNull();
  expect(metrics.input).not.toBeNull();
  expect(metrics.urlField!.width, "URL input should align to the full form width").toBeGreaterThan(metrics.form!.width * 0.9);
  expect(metrics.prefix!.height, "prefix and input heights should align").toBeCloseTo(metrics.input!.height, 1);
  expect(prefixBackground, "prefix should not reuse the dark muted text token as its background").not.toEqual(mutedToken);
  expect(prefixForeground && prefixBackground ? contrast(prefixForeground, prefixBackground) : 0, "prefix contrast").toBeGreaterThanOrEqual(4.5);
});

test("workspace settings danger copy remains readable on gray and soft-danger panels", async ({ page, context }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setupMockWorkspace(page, context);

  await page.goto("/s/demo/settings/workspace", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("workspace-shell")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Workspace" })).toBeVisible();
  await expect(page.getByText("Danger zone", { exact: true })).toBeVisible();
  await expect(page.getByText("Delete workspace", { exact: true })).toBeVisible();
  await assertVisibleDangerTextReadable(page, "light mode workspace settings");

  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await assertVisibleDangerTextReadable(page, "dark mode workspace settings");
});

test("mobile settings navigation keeps every destination visible without horizontal drift", async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setupMockWorkspace(page, context);

  await page.goto("/s/demo/settings/workspace", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("workspace-shell")).toBeVisible({ timeout: 15_000 });
  const settingsNav = page.getByRole("navigation", { name: "Settings sections" });

  for (const label of ["Workspace", "Members & invites", "Channels & agents", "Runtimes", "Connectors", "Account"]) {
    await expect(settingsNav.getByRole("link", { name: label })).toBeVisible();
  }

  const metrics = await settingsNav.evaluate((nav) => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const linkRects = Array.from(nav.querySelectorAll<HTMLElement>("a")).map((link) => {
      const box = link.getBoundingClientRect();
      return {
        text: link.textContent?.trim() ?? "",
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
      };
    });
    return {
      bodyOverflowX: document.body.scrollWidth > viewport.width + 1,
      documentOverflowX: document.documentElement.scrollWidth > viewport.width + 1,
      linkRects,
      viewport,
    };
  });

  expect(metrics.bodyOverflowX).toBe(false);
  expect(metrics.documentOverflowX).toBe(false);
  for (const rect of metrics.linkRects) {
    expect(rect.left, `${rect.text} left edge`).toBeGreaterThanOrEqual(0);
    expect(rect.right, `${rect.text} right edge`).toBeLessThanOrEqual(metrics.viewport.width);
  }
});

test("agent detail page stays in the workspace shell on desktop and mobile", async ({ page, context }) => {
  await setupMockWorkspace(page, context);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    pageErrors.length = 0;

    await page.goto("/s/demo/agents/agent-cloud", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("workspace-shell")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Cloud Test Agent" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "This page hit an error" })).toHaveCount(0);

    const tabMetrics = await page.getByRole("tablist", { name: "Agent sections" }).evaluate((tablist) => {
      const viewport = { width: window.innerWidth };
      return Array.from(tablist.querySelectorAll<HTMLElement>("[role='tab']")).map((tab) => {
        const box = tab.getBoundingClientRect();
        return {
          text: tab.textContent?.trim() ?? "",
          left: box.left,
          right: box.right,
          viewport,
        };
      });
    });
    for (const tab of tabMetrics) {
      expect(tab.left, `${tab.text} tab left edge`).toBeGreaterThanOrEqual(0);
      expect(tab.right, `${tab.text} tab right edge`).toBeLessThanOrEqual(tab.viewport.width);
    }

    const metrics = await shellMetrics(page);
    assertNoDocumentOverflow(metrics);
    assertRectInsideViewport(metrics.main, metrics.viewport, "agent detail main");
    if (viewport.width >= 768) {
      assertRectInsideViewport(metrics.sidebar, metrics.viewport, "agent detail desktop sidebar");
    } else {
      expect(metrics.sidebar, "agent detail desktop sidebar stays hidden on mobile").toBeNull();
      assertRectInsideViewport(metrics.openNav, metrics.viewport, "agent detail mobile menu toggle");
    }
    expect(pageErrors).toEqual([]);
  }
});

test("user account menu opens from the agents page without crashing the workspace", async ({ page, context }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setupMockWorkspace(page, context);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/s/demo/agents", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("workspace-shell")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Agents" })).toBeVisible();

  await page.getByTestId("user-pill-trigger").click();
  await expect(page.getByRole("menuitem", { name: "Account settings" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Workspace settings" })).toBeVisible();
  await expect(page.getByText("Switch workspace", { exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Sign out" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Something went wrong" })).toHaveCount(0);
  expect(pageErrors, "opening the account menu should not raise client runtime errors").toEqual([]);
});

test("workspace controls live in the settings menu instead of the sidebar brand header", async ({ page, context }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setupMockWorkspace(page, context);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/s/demo/agents", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("workspace-shell")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Agents" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Raltic workspace home" })).toBeVisible();
  await expect(page.getByTestId("workspace-switcher-trigger")).toHaveCount(0);

  await page.getByTestId("user-pill-trigger").click();
  const menu = page.getByRole("menu");
  await expect(menu.getByText("Current workspace", { exact: true })).toBeVisible();
  await expect(menu.getByText("Gene's Workspace", { exact: true })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Workspace settings" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Members & invites" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Browse channels" })).toBeVisible();
  await expect(menu.getByText("Switch workspace", { exact: true })).toBeVisible();
  await expect(menu.getByText("No other workspaces.", { exact: true })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Sign out" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Something went wrong" })).toHaveCount(0);
  expect(pageErrors, "opening the settings workspace controls should not raise client runtime errors").toEqual([]);
});

test("mobile drawer closes after channel and DM navigation without covering the next page", async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setupWorkspaceWithUnread(page, context);
  await openMockChannel(page);

  const openNav = page.getByRole("button", { name: "Open workspace navigation" });
  await expect(openNav).toBeVisible();
  await openNav.click();

  const mobileSidebar = page.getByTestId("workspace-sidebar-mobile");
  await expect(mobileSidebar).toBeVisible();
  await mobileSidebar.getByRole("link", { name: /research/i }).click();
  await expect(page).toHaveURL(/\/s\/demo\/channel\/ch-research$/);
  await expect(mobileSidebar).toBeHidden();
  await expect(page.getByRole("heading", { name: "research" })).toBeVisible();

  let metrics = await shellMetrics(page);
  assertNoDocumentOverflow(metrics);
  expect(metrics.sidebar, "desktop sidebar should stay hidden on mobile").toBeNull();
  assertRectInsideViewport(metrics.openNav, metrics.viewport, "mobile menu toggle");
  assertRectInsideViewport(metrics.conversationHeader, metrics.viewport, "mobile conversation header");
  assertRectInsideViewport(metrics.composerFooter, metrics.viewport, "mobile composer footer");
  expect(metrics.visibleConversationHeaders).toBe(1);

  await page.getByRole("button", { name: "Channel actions" }).click();
  await expect(page.getByRole("menuitem", { name: "Members" })).toBeVisible();
  await page.keyboard.press("Escape");

  await openNav.click();
  await expect(mobileSidebar).toBeVisible();
  await mobileSidebar.getByRole("link", { name: /Cloud Test Agent/i }).click();
  await expect(page).toHaveURL(/\/s\/demo\/dm\/dm-agent$/);
  await expect(mobileSidebar).toBeHidden();
  await expect(page.getByRole("heading", { name: "Cloud Test Agent" })).toBeVisible();

  metrics = await shellMetrics(page);
  assertNoDocumentOverflow(metrics);
  expect(metrics.mobileSidebar, "closed drawer should not retain a visible hit area").toBeNull();
  await page.getByRole("textbox", { name: /Message Cloud Test Agent/ }).click();
  await expect(page.getByRole("button", { name: "Send message" })).toBeVisible();
});

for (const width of [768, 769]) {
  test(`breakpoint ${width}px renders exactly one navigation mode and no duplicate chat header`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 844 });
    await setupWorkspaceWithUnread(page, context);
    await openMockChannel(page);
    const headerRect = await locatorRect(page.getByRole("navigation", { name: "Conversation header" }), "conversation header");

    const metrics = await shellMetrics(page);
    assertNoDocumentOverflow(metrics);
    assertRectInsideViewport(metrics.main, metrics.viewport, "workspace main");
    assertRectInsideViewport(headerRect, metrics.viewport, "conversation header");
    assertRectInsideViewport(metrics.composerFooter, metrics.viewport, "composer footer");
    expect(metrics.visibleConversationHeaders).toBe(1);
    expect(Boolean(metrics.sidebar) !== Boolean(metrics.openNav), "desktop sidebar and mobile navbar toggle should not be visible together").toBe(true);

    if (metrics.sidebar) {
      expect(metrics.mobileSidebar, "mobile drawer should not leave a blank visible rail at desktop breakpoint").toBeNull();
      expect(Math.abs(metrics.sidebar.right - metrics.main!.left), "main should stay flush with desktop sidebar").toBeLessThanOrEqual(1);
    } else {
      assertRectInsideViewport(metrics.openNav, metrics.viewport, "mobile menu toggle");
      expect(metrics.main!.left).toBeGreaterThanOrEqual(0);
      expect(headerRect.top).toBeGreaterThanOrEqual(48);
      expect(headerRect.top).toBeLessThanOrEqual(52);
    }
  });
}

test("active channel, unread count, online status, and runtime badge do not shift shell layout", async ({ page, context }) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await setupWorkspaceWithUnread(page, context);
  await openMockChannel(page);

  const onboarding = page.getByRole("navigation", { name: "Workspace navigation" }).getByRole("link", { name: /onboarding/i }).first();
  const research = page.getByRole("navigation", { name: "Workspace navigation" }).getByRole("link", { name: /research/i }).first();
  const userPill = page.getByTestId("user-pill-trigger");
  const onlineBadge = userPill.locator("div").filter({ hasText: /^Online$/ }).first();
  await expect(onboarding).toHaveAttribute("aria-current", "page");
  await expect(research.getByText("3", { exact: true }), "seeded unread badge should render").toBeVisible();
  await expect(onlineBadge, "user online badge should render").toBeVisible();
  await expect(page.getByLabel("Runtime: Claude")).toBeVisible();

  const initialMetrics = await shellMetrics(page);
  const onboardingBox = await visibleLinkBox(page, /onboarding/i);
  const researchBox = await visibleLinkBox(page, /research/i);
  expect(researchBox.height).toBeCloseTo(onboardingBox.height, 1);

  await research.click();
  await expect(page).toHaveURL(/\/s\/demo\/channel\/ch-research$/);
  await expect(research).toHaveAttribute("aria-current", "page");
  await expect(onlineBadge, "user online badge should survive channel navigation").toBeVisible();

  const afterChannelChange = await shellMetrics(page);
  assertNoDocumentOverflow(afterChannelChange);
  expect(afterChannelChange.sidebar!.width).toBeCloseTo(initialMetrics.sidebar!.width, 1);
  expect(afterChannelChange.main!.left).toBeCloseTo(initialMetrics.main!.left, 1);
  expect(afterChannelChange.composerFooter!.bottom).toBeCloseTo(initialMetrics.composerFooter!.bottom, 1);

  const dm = page.getByRole("navigation", { name: "Workspace navigation" }).getByRole("link", { name: /Cloud Test Agent/i }).first();
  await dm.click();
  await expect(page).toHaveURL(/\/s\/demo\/dm\/dm-agent$/);
  await expect(page.getByRole("heading", { name: "Cloud Test Agent" })).toBeVisible();
  await expect(page.getByLabel("Runtime: Claude")).toBeVisible();

  const afterDmChange = await shellMetrics(page);
  assertNoDocumentOverflow(afterDmChange);
  expect(afterDmChange.sidebar!.width).toBeCloseTo(initialMetrics.sidebar!.width, 1);
  expect(afterDmChange.main!.left).toBeCloseTo(initialMetrics.main!.left, 1);
  expect(afterDmChange.composerFooter!.bottom).toBeCloseTo(initialMetrics.composerFooter!.bottom, 1);
});
