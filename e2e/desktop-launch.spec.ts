import { expect, test, type Page } from "@playwright/test";

const SECURITY_HEADERS = [
  "content-security-policy",
  "x-frame-options",
  "x-content-type-options",
  "referrer-policy",
  "permissions-policy",
];
const API_BASE = (process.env.E2E_API_URL ?? "https://api.raltic.com").replace(/\/$/, "");
const TARGET_WORKSPACE = {
  id: "srv_desktop_target",
  slug: "desktop-home",
  name: "Desktop Home",
};

function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

function corsHeaders(baseURL: string | undefined): Record<string, string> {
  const origin = baseURL ? new URL(baseURL).origin : "http://localhost:3000";
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  };
}

async function addFakeSession(page: Page, baseURL: string | undefined) {
  if (!baseURL) throw new Error("baseURL is required for desktop auth tests");
  await page.context().addCookies([{
    name: "better-auth.session_token",
    value: "desktop-e2e-session",
    url: baseURL,
  }]);
}

async function mockAuthAndMe(page: Page, baseURL: string | undefined, opts?: {
  workspace?: typeof TARGET_WORKSPACE;
  servers?: Array<typeof TARGET_WORKSPACE>;
  personal?: typeof TARGET_WORKSPACE;
  defaultServer?: typeof TARGET_WORKSPACE;
}) {
  const workspace = opts?.workspace ?? TARGET_WORKSPACE;
  const servers = opts?.servers ?? [workspace];
  const personal = opts?.personal ?? workspace;
  const defaultServer = opts?.defaultServer ?? personal;
  await page.route("**/api/me/api-token", async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "UNAUTHENTICATED", message: "No API token in E2E" } }),
    });
  });
  await page.route(apiUrl("/api/v1/me**"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: corsHeaders(baseURL),
      body: JSON.stringify({
        subject: { kind: "user", userId: "usr_desktop_e2e" },
        servers: servers.map((s) => ({
          id: s.id,
          slug: s.slug,
          name: s.name,
          description: null,
          iconUrl: null,
          role: "owner",
          joinedAt: Date.now(),
        })),
        personalServerId: personal.id,
        personalServerSlug: personal.slug,
        defaultServerId: defaultServer.id,
        defaultServerSlug: defaultServer.slug,
        hasConnectedBridge: false,
      }),
    });
  });
}

async function mockMachineKeys(page: Page, baseURL: string | undefined, opts?: {
  connectFails?: boolean;
}) {
  const created: unknown[] = [];
  const revoked: string[] = [];
  await page.route(apiUrl("/api/v1/machine-keys**"), async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: corsHeaders(baseURL) });
      return;
    }
    if (req.method() === "POST") {
      created.push(req.postDataJSON());
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: corsHeaders(baseURL),
        body: JSON.stringify({
          id: "mk_desktop_e2e",
          apiKey: "ck_desktopE2eMachineKey1234567890",
          name: "Raltic Desktop Mac",
          createdAt: Date.now(),
        }),
      });
      return;
    }
    if (req.method() === "DELETE") {
      revoked.push(new URL(req.url()).pathname.split("/").pop() ?? "");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: corsHeaders(baseURL),
        body: JSON.stringify({ ok: true }),
      });
      return;
    }
    await route.fallback();
  });
  await page.addInitScript(({ connectFails }) => {
    (window as typeof window & { raltic?: unknown }).raltic = {
      bridgeStatus: async () => ({ running: false, serverId: null }),
      connectBridge: async (cfg: { apiKey: string; serverUrl?: string; serverId: string }) => {
        (window as typeof window & { __desktopConnectPayload?: unknown }).__desktopConnectPayload = cfg;
        if (connectFails) throw new Error("bridge start failed in E2E");
        return { ok: true, running: true, serverId: cfg.serverId };
      },
    };
  }, { connectFails: opts?.connectFails ?? false });
  return { created, revoked };
}

test.describe("desktop launch surface", () => {
  test("/desktop/launch preserves desktop intent when unauthenticated", async ({ request }) => {
    const res = await request.get("/desktop/launch", { maxRedirects: 0 });

    expect(res.status()).toBe(307);
    const location = res.headers().location;
    expect(location).toBeTruthy();
    const url = new URL(location ?? "", "https://raltic.com");
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("client")).toBe("desktop");
    expect(url.searchParams.get("next")).toBe("/desktop/launch");
    for (const header of SECURITY_HEADERS) {
      expect(res.headers()[header], `/desktop/launch redirect should include ${header}`).toBeTruthy();
    }
  });

  test("desktop login copy is product-specific", async ({ page }) => {
    await page.goto("/login?client=desktop&next=/desktop/launch");

    await expect(page.locator('[data-slot="card-title"]').filter({ hasText: "Raltic Desktop" })).toBeVisible();
    await expect(page.getByText("Sign in to connect this computer to your workspace")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in to desktop" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign up" })).toHaveAttribute("href", "/signup?client=desktop&next=%2Fdesktop%2Flaunch");
  });

  test("desktop signup copy preserves desktop intent", async ({ page }) => {
    await page.goto("/signup?client=desktop&next=/desktop/launch");

    await expect(page.locator('[data-slot="card-title"]').filter({ hasText: "Raltic Desktop" })).toBeVisible();
    await expect(page.getByText("Create an account to connect this computer")).toBeVisible();
    await expect(page.getByRole("button", { name: "Create desktop account" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login?client=desktop&next=%2Fdesktop%2Flaunch");
  });

  test("connects the current computer with a workspace-scoped machine key", async ({ page, baseURL }) => {
    await addFakeSession(page, baseURL);
    await mockAuthAndMe(page, baseURL);
    const keys = await mockMachineKeys(page, baseURL);

    await page.goto("/desktop/launch");
    await expect(page.getByText("Ready for Desktop Home")).toBeVisible();
    await page.getByRole("button", { name: "Connect this computer" }).click();

    await expect(page).toHaveURL(/\/s\/desktop-home(?:[?#].*)?$/);
    expect(keys.created).toEqual([{ serverId: TARGET_WORKSPACE.id, name: expect.stringMatching(/^Raltic Desktop/) }]);
    await expect.poll(async () => page.evaluate(() => (window as typeof window & { __desktopConnectPayload?: unknown }).__desktopConnectPayload)).toEqual({
      apiKey: "ck_desktopE2eMachineKey1234567890",
      serverUrl: API_BASE,
      serverId: TARGET_WORKSPACE.id,
    });
  });

  test("targets the personal workspace before an invited default workspace", async ({ page, baseURL }) => {
    const personal = { id: "srv_personal_home", slug: "personal-home", name: "Personal Home" };
    const invited = { id: "srv_invited_team", slug: "invited-team", name: "Invited Team" };
    await addFakeSession(page, baseURL);
    await mockAuthAndMe(page, baseURL, {
      servers: [invited, personal],
      personal,
      defaultServer: invited,
    });
    const keys = await mockMachineKeys(page, baseURL);

    await page.goto("/desktop/launch");
    await expect(page.getByText("Ready for Personal Home")).toBeVisible();
    await page.getByRole("button", { name: "Connect this computer" }).click();

    await expect(page).toHaveURL(/\/s\/personal-home(?:[?#].*)?$/);
    expect(keys.created).toEqual([{ serverId: personal.id, name: expect.stringMatching(/^Raltic Desktop/) }]);
    await expect.poll(async () => page.evaluate(() => (window as typeof window & { __desktopConnectPayload?: unknown }).__desktopConnectPayload)).toMatchObject({
      serverId: personal.id,
    });
  });

  test("does not treat another workspace bridge as connected", async ({ page, baseURL }) => {
    await addFakeSession(page, baseURL);
    await mockAuthAndMe(page, baseURL);
    await page.addInitScript(() => {
      (window as typeof window & { raltic?: unknown }).raltic = {
        bridgeStatus: async () => ({ running: true, serverId: "srv_other_workspace" }),
        connectBridge: async (cfg: { serverId: string }) => ({ ok: true, running: true, serverId: cfg.serverId }),
      };
    });

    await page.goto("/desktop/launch");

    await expect(page).toHaveURL(/\/desktop\/launch$/);
    await expect(page.getByText("Running for another workspace")).toBeVisible();
    await expect(page.getByRole("button", { name: "Connect this computer" })).toBeVisible();
  });

  test("treats any running desktop workspace as connected", async ({ page, baseURL }) => {
    await addFakeSession(page, baseURL);
    await mockAuthAndMe(page, baseURL);
    await page.addInitScript(() => {
      (window as typeof window & { raltic?: unknown }).raltic = {
        bridgeStatus: async () => ({
          running: true,
          serverId: "srv_other_workspace",
          serverIds: ["srv_other_workspace", "srv_desktop_target"],
        }),
      };
    });

    await page.goto("/desktop/launch");

    await expect(page).toHaveURL(/\/s\/desktop-home(?:[?#].*)?$/);
  });

  test("revokes the issued key when desktop bridge connect fails", async ({ page, baseURL }) => {
    await addFakeSession(page, baseURL);
    await mockAuthAndMe(page, baseURL);
    const keys = await mockMachineKeys(page, baseURL, { connectFails: true });

    await page.goto("/desktop/launch");
    await page.getByRole("button", { name: "Connect this computer" }).click();

    await expect(page.getByText("bridge start failed in E2E")).toBeVisible();
    await expect.poll(() => Promise.resolve(keys.revoked)).toEqual(["mk_desktop_e2e"]);
  });

  test("skip enters the workspace without reopening bridge setup immediately", async ({ page, baseURL }) => {
    await addFakeSession(page, baseURL);
    await mockAuthAndMe(page, baseURL);
    await page.addInitScript(() => {
      (window as typeof window & { raltic?: unknown }).raltic = {
        bridgeStatus: async () => ({ running: false, serverId: null }),
        connectBridge: async (cfg: { serverId: string }) => ({ ok: true, running: true, serverId: cfg.serverId }),
      };
    });

    await page.goto("/desktop/launch");
    await page.getByRole("button", { name: "Skip for now" }).click();

    await expect(page).toHaveURL(/\/s\/desktop-home\?skipBridgeSetup=1$/);
  });
});
