import { expect, test, type BrowserContext, type Page } from "@playwright/test";

export const server = {
  id: "srv-demo",
  name: "Gene's Workspace",
  slug: "demo",
  description: "Get familiar with Raltic",
  iconUrl: null,
  ownerId: "u1",
  createdAt: Date.now(),
  role: "owner",
};

export const onboardingChannel = {
  id: "ch-onboarding",
  serverId: "srv-demo",
  name: "onboarding",
  description: "Get familiar with Raltic",
  topic: null,
  type: "public",
  createdBy: "u1",
  createdAt: Date.now(),
  archivedAt: null,
  archivedBy: null,
  starredAt: null,
  unread: 0,
  maxSeq: 2,
  lastReadSeq: 2,
  mutedAt: null,
};

export const researchChannel = {
  ...onboardingChannel,
  id: "ch-research",
  name: "research",
  description: "Research channel",
  maxSeq: 1,
  lastReadSeq: 1,
};

export const dmChannel = {
  id: "dm-agent",
  serverId: "srv-demo",
  name: "cloud-test",
  description: null,
  topic: null,
  type: "dm",
  createdBy: "u1",
  createdAt: Date.now(),
  archivedAt: null,
  archivedBy: null,
  starredAt: null,
  unread: 0,
  maxSeq: 0,
  lastReadSeq: 0,
  mutedAt: null,
  peer: { name: "Cloud Test Agent", type: "agent", id: "agent-cloud", runtime: "claude", avatarSeed: null },
};

export const agents = [
  {
    id: "agent-onboard",
    serverId: "srv-demo",
    ownerId: "u1",
    name: "onboarding",
    displayName: "Onboarding Assistant",
    description: "Helps with setup",
    systemPrompt: null,
    model: "claude-haiku-4-5",
    runtime: "claude",
    runtimeMode: "raltic",
    status: "online",
    avatarSeed: null,
    isDefault: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    dmChannelId: null,
  },
  {
    id: "agent-cloud",
    serverId: "srv-demo",
    ownerId: "u1",
    name: "cloud-test",
    displayName: "Cloud Test Agent",
    description: "Runs in Raltic cloud",
    systemPrompt: null,
    model: "claude-haiku-4-5",
    runtime: "claude",
    runtimeMode: "raltic",
    status: "online",
    avatarSeed: null,
    isDefault: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    dmChannelId: "dm-agent",
  },
];

export const workspaceMembers = [
  { userId: "u1", role: "owner", joinedAt: Date.now(), name: "Gene", email: "dai@live.cn", image: null },
  { userId: "u2", role: "member", joinedAt: Date.now(), name: "Olivia", email: "olivia@example.com", image: null },
];

export const channelMembers = [
  { channelId: "ch-onboarding", memberId: "u1", memberType: "human", joinedAt: Date.now() },
  { channelId: "ch-onboarding", memberId: "agent-onboard", memberType: "agent", joinedAt: Date.now() },
  { channelId: "ch-onboarding", memberId: "agent-cloud", memberType: "agent", joinedAt: Date.now() },
];

function corsHeaders() {
  const baseURL = test.info().project.use.baseURL;
  const origin = baseURL ? new URL(String(baseURL)).origin : "http://localhost:3000";
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
  };
}

export function json(body: unknown, status = 200) {
  return {
    status,
    contentType: "application/json",
    headers: corsHeaders(),
    body: JSON.stringify(body),
  };
}

export function noContent(status = 204) {
  return { status, headers: corsHeaders(), body: "" };
}

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
    const [r, g, b] = match
      .slice(1, 4)
      .map((token) => Math.round(Number(token) * 255));

    if (r == null || g == null || b == null || Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
    return [Math.min(255, Math.max(0, r)), Math.min(255, Math.max(0, g)), Math.min(255, Math.max(0, b))] as const;
  }

  match = value.match(/^#([0-9a-fA-F]{6})$/);
  if (match) {
    const hex = match[1];
    return [
      Number.parseInt(hex.slice(0, 2), 16),
      Number.parseInt(hex.slice(2, 4), 16),
      Number.parseInt(hex.slice(4, 6), 16),
    ] as const;
  }

  return null;
}

function luminanceChannel(value: number) {
  const v = value / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

export function contrast(foreground: readonly number[], background: readonly number[]) {
  const fg = 0.2126 * luminanceChannel(foreground[0]) + 0.7152 * luminanceChannel(foreground[1]) + 0.0722 * luminanceChannel(foreground[2]);
  const bg = 0.2126 * luminanceChannel(background[0]) + 0.7152 * luminanceChannel(background[1]) + 0.0722 * luminanceChannel(background[2]);
  return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
}

export async function setupMockWorkspace(page: Page, context: BrowserContext) {
  const baseURL = test.info().project.use.baseURL;
  const host = new URL(String(baseURL)).hostname;
  await context.addCookies([
    { name: "better-auth.session_token", value: "mock", domain: host, path: "/", httpOnly: true, sameSite: "Lax" },
  ]);
  await page.route("**/api/auth/**", (route) => route.fulfill(json({
    user: { id: "u1", name: "Gene", email: "dai@live.cn" },
    session: { id: "s1", userId: "u1", expiresAt: new Date(Date.now() + 86_400_000).toISOString() },
  })));
  await page.route("**/api/me/api-token", (route) => route.fulfill(json({ token: "mock-token", expiresIn: 3600 })));
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();
    if (method === "OPTIONS") return route.fulfill(noContent());
    if (path === "/api/v1/servers/by-slug/demo") return route.fulfill(json({ server, channels: [onboardingChannel, researchChannel, dmChannel], agents }));
    if (path === "/api/v1/me") return route.fulfill(json({
      subject: { kind: "user", userId: "u1" },
      servers: [server],
      personalServerId: "srv-demo",
      personalServerSlug: "demo",
      defaultServerId: "srv-demo",
      defaultServerSlug: "demo",
      hasConnectedBridge: true,
    }));
    if (path === "/api/v1/inbox") return route.fulfill(json({ items: [], count: 0 }));
    if (path === "/api/v1/tasks" && method === "GET") return route.fulfill(json({ tasks: [] }));
    if (path === "/api/v1/servers/srv-demo/channels/browse") return route.fulfill(json({
      channels: [
        { id: onboardingChannel.id, name: onboardingChannel.name, description: onboardingChannel.description, createdAt: onboardingChannel.createdAt, isMember: true },
        { id: researchChannel.id, name: researchChannel.name, description: researchChannel.description, createdAt: researchChannel.createdAt, isMember: true },
      ],
    }));
    if (path === "/api/v1/agents") return route.fulfill(json({ agents }));
    if (path === "/api/v1/servers/srv-demo/members") return route.fulfill(json({ members: workspaceMembers, viewerRole: "owner" }));
    if (path === "/api/v1/channels/ch-onboarding") return route.fulfill(json({
      channel: onboardingChannel,
      members: channelMembers,
      peer: null,
      viewerCanManage: true,
      viewerCanAddMembers: true,
    }));
    if (path === "/api/v1/channels/ch-research") return route.fulfill(json({
      channel: researchChannel,
      members: channelMembers,
      peer: null,
      viewerCanManage: true,
      viewerCanAddMembers: true,
    }));
    if (path === "/api/v1/channels/dm-agent") return route.fulfill(json({
      channel: dmChannel,
      members: [],
      peer: dmChannel.peer,
      viewerCanManage: false,
      viewerCanAddMembers: false,
    }));
    if (path === "/api/v1/channels/ch-onboarding/messages") return route.fulfill(json({ messages: [] }));
    if (path === "/api/v1/channels/ch-research/messages") return route.fulfill(json({ messages: [] }));
    if (path === "/api/v1/channels/dm-agent/messages") return route.fulfill(json({ messages: [] }));
    if (path === "/api/v1/ws/token") return route.fulfill(json({ token: "ws-mock", wsUrl: "ws://127.0.0.1:9/ws/channel/ch-onboarding" }));
    if (path.endsWith("/read") && method === "POST") return route.fulfill(json({ ok: true }));
    if (path === "/api/v1/dm" && method === "POST") return route.fulfill(json({ channelId: "dm-agent", created: false }));
    if (path === "/api/v1/channels" && method === "POST") return route.fulfill(json({ id: "ch-new" }));
    if (path.includes("/members") && method === "POST") return route.fulfill(json({ ok: true }));
    if (path.includes("/members/") && method === "DELETE") return route.fulfill(json({ ok: true }));
    if (path.includes("/agents/") && method === "PATCH") return route.fulfill(json({ ok: true }));
    if (path === "/api/v1/agents" && method === "POST") return route.fulfill(json({ id: "agent-new" }));
    return route.fulfill(json({ error: { code: "MOCK_MISS", message: path } }, 404));
  });
}

export async function openMockChannel(page: Page, channelId = "ch-onboarding") {
  await page.goto(`/s/demo/channel/${channelId}`, { waitUntil: "domcontentloaded" });
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" }).catch(() => {});
  await expect(page.getByTestId("workspace-shell")).toBeVisible({ timeout: 15_000 });
}

export async function openMockDm(page: Page, channelId = "dm-agent") {
  await page.goto(`/s/demo/dm/${channelId}`, { waitUntil: "domcontentloaded" });
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" }).catch(() => {});
  await expect(page.getByTestId("workspace-shell")).toBeVisible({ timeout: 15_000 });
}

export async function clickVisible(page: Page, selector: string) {
  const target = page.locator(`${selector}:visible`).first();
  await expect(target, `click target exists: ${selector}`).toBeVisible({ timeout: 5_000 });
  await target.click();
}

export async function simulateVisualViewportHeight(page: Page, height: number) {
  await page.evaluate((nextHeight) => {
    const viewport = window.visualViewport;
    if (viewport) {
      Object.defineProperty(viewport, "height", {
        configurable: true,
        get: () => nextHeight,
      });
      viewport.dispatchEvent(new Event("resize"));
      return;
    }
    document.documentElement.style.setProperty("--raltic-visual-viewport-height", `${nextHeight}px`);
    window.dispatchEvent(new Event("resize"));
  }, height);
  await page.waitForFunction(
    (expected) => getComputedStyle(document.documentElement)
      .getPropertyValue("--raltic-visual-viewport-height")
      .trim() === `${expected}px`,
    height,
  );
}

export async function overlayMetrics(page: Page, dialogName: RegExp, role: "dialog" | "alertdialog" = "dialog") {
  const dialog = page.getByRole(role, { name: dialogName });
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  return dialog.evaluate((el) => {
    const textNode = (text: string) => Array.from(el.querySelectorAll<HTMLElement>("*")).find((node) => node.textContent?.trim() === text);
    const close = el.querySelector<HTMLElement>('[data-slot="modal-close-trigger"]');
    const primary = el.querySelector<HTMLElement>(".button--primary:not(:disabled):not([aria-disabled='true']), .button--danger:not(:disabled):not([aria-disabled='true'])");
    const secondary = textNode("dai@live.cn") ?? textNode("olivia@example.com") ?? textNode("claude · @onboarding");
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    const closeStyle = close ? getComputedStyle(close) : null;
    const primaryStyle = primary ? getComputedStyle(primary) : null;
    const secondaryStyle = secondary ? getComputedStyle(secondary) : null;
    return {
      rect: { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left, width: rect.width, height: rect.height },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      background: style.backgroundColor,
      color: style.color,
      close: close ? {
        color: closeStyle?.color ?? "",
        background: closeStyle?.backgroundColor ?? "",
        width: close.getBoundingClientRect().width,
        height: close.getBoundingClientRect().height,
      } : null,
      primary: primary ? {
        color: primaryStyle?.color ?? "",
        background: primaryStyle?.backgroundColor ?? "",
        text: primary.textContent?.trim() ?? "",
      } : null,
      secondary: secondary ? { color: secondaryStyle?.color ?? "", text: secondary.textContent?.trim() ?? "" } : null,
      topmost: (() => {
        const x = Math.floor(rect.left + rect.width / 2);
        const y = Math.floor(rect.top + Math.min(64, rect.height / 2));
        const top = document.elementFromPoint(x, y);
        return Boolean(top && el.contains(top));
      })(),
      hasOverlayScope: el.classList.contains("raltic-overlay-scope"),
      bodyScrollable: document.body.scrollHeight > document.body.clientHeight,
      documentScrollable: document.documentElement.scrollHeight > document.documentElement.clientHeight,
    };
  });
}

export function assertOverlayMetrics(metrics: Awaited<ReturnType<typeof overlayMetrics>>, options: { requireClose?: boolean } = {}) {
  const { requireClose = true } = options;
  expect(metrics.hasOverlayScope).toBe(true);
  expect(metrics.topmost).toBe(true);
  expect(metrics.bodyScrollable).toBe(false);
  expect(metrics.documentScrollable).toBe(false);
  expect(metrics.rect.left).toBeGreaterThanOrEqual(0);
  expect(metrics.rect.right).toBeLessThanOrEqual(metrics.viewport.width);
  expect(metrics.rect.bottom).toBeLessThanOrEqual(metrics.viewport.height + 1);
  if (requireClose) {
    expect(metrics.close?.width ?? 0).toBeGreaterThanOrEqual(36);
    expect(metrics.close?.height ?? 0).toBeGreaterThanOrEqual(36);
  }
  const background = parseRgb(metrics.background);
  const foreground = parseRgb(metrics.color);
  const closeForeground = parseRgb(metrics.close?.color ?? null);
  const closeBackground = parseRgb(metrics.close?.background ?? null);
  const primaryForeground = parseRgb(metrics.primary?.color ?? null);
  const primaryBackground = parseRgb(metrics.primary?.background ?? null);
  const secondary = parseRgb(metrics.secondary?.color ?? null);
  expect(background && foreground ? contrast(foreground, background) : 0).toBeGreaterThanOrEqual(4.5);
  if (requireClose || metrics.close) {
    expect(closeBackground && closeForeground ? contrast(closeForeground, closeBackground) : 0).toBeGreaterThanOrEqual(4.5);
  }
  if (primaryBackground && primaryForeground && background) {
    expect(contrast(primaryForeground, primaryBackground)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(primaryBackground, background)).toBeGreaterThanOrEqual(3);
  }
  if (secondary) {
    expect(background ? contrast(secondary, background) : 0).toBeGreaterThanOrEqual(4.5);
  }
}

export async function openMembersDialog(page: Page) {
  await page.getByRole("button", { name: "Channel actions" }).click();
  await page.getByRole("menuitem", { name: "Members" }).click();
  assertOverlayMetrics(await overlayMetrics(page, /Members of #onboarding/));
}
