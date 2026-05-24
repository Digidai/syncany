import { expect, test, type APIRequestContext, type APIResponse } from "@playwright/test";

const SECURITY_HEADERS = [
  "content-security-policy",
  "x-frame-options",
  "x-content-type-options",
  "referrer-policy",
  "permissions-policy",
];

async function expectSecurityHeaders(headers: Record<string, string>, context: string) {
  for (const header of SECURITY_HEADERS) {
    expect(headers[header], `${context} should include ${header}`).toBeTruthy();
  }
}

async function getWithRetry(
  request: APIRequestContext,
  url: string,
  options: Parameters<APIRequestContext["get"]>[1] = {},
): Promise<APIResponse> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await request.get(url, options);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
  }
  throw lastError;
}

test.describe("public routing and crawler files", () => {
  for (const path of ["/sitemap.xml", "/icon", "/apple-icon", "/opengraph-image"]) {
    test(`${path} is public and carries security headers`, async ({ request }) => {
      const res = await getWithRetry(request, path, { maxRedirects: 0 });

      expect(res.status(), `${path} should not redirect to /login`).toBe(200);
      expect(res.headers().location, `${path} should not set Location`).toBeFalsy();
      await expectSecurityHeaders(res.headers(), path);
    });
  }

  test("/robots.txt is public", async ({ request }) => {
    const res = await getWithRetry(request, "/robots.txt", { maxRedirects: 0 });

    expect(res.status(), "/robots.txt should not redirect to /login").toBe(200);
    expect(res.headers().location, "/robots.txt should not set Location").toBeFalsy();
    expect(res.headers()["content-type"]).toContain("text/plain");
  });

  test("sitemap contains only indexable public routes", async ({ request }) => {
    const res = await getWithRetry(request, "/sitemap.xml");
    expect(res.status()).toBe(200);
    const body = await res.text();

    for (const path of ["/", "/runtimes", "/runtimes/claude", "/runtimes/codex", "/indie", "/connectors", "/security", "/privacy", "/terms", "/signup", "/login", "/forgot-password"]) {
      expect(body, `sitemap should include ${path}`).toContain(`https://raltic.com${path === "/" ? "/" : path}`);
    }
    for (const path of ["/teams", "/runtimes/openclaw", "/runtimes/hermes", "/s/"]) {
      expect(body, `sitemap should exclude ${path}`).not.toContain(`https://raltic.com${path}`);
    }
  });

  test("robots disallows non-indexable public and private surfaces", async ({ request }) => {
    const res = await getWithRetry(request, "/robots.txt");
    expect(res.status()).toBe(200);
    const body = await res.text();

    for (const disallow of ["/api/", "/desktop/", "/s/", "/invite/", "/verify-email", "/reset-password", "/teams", "/runtimes/openclaw", "/runtimes/hermes"]) {
      expect(body, `robots.txt should disallow ${disallow}`).toContain(`Disallow: ${disallow}`);
    }
    expect(body).toContain("Sitemap: https://raltic.com/sitemap.xml");
  });

  for (const path of ["/login-helper", "/api/me-internal", "/runtimes-old"]) {
    test(`${path} does not pass public prefix boundaries`, async ({ request }) => {
      const res = await getWithRetry(request, path, { maxRedirects: 0 });

      expect(res.status(), `${path} should redirect without a session`).toBe(307);
      expect(res.headers().location, `${path} should redirect to /login`).toBeTruthy();
      expect(new URL(res.headers().location ?? "", "https://raltic.com").pathname).toBe("/login");
      await expectSecurityHeaders(res.headers(), path);
    });
  }

  for (const path of ["/api/me/api-token", "/api/me/session-token"]) {
    test(`${path} returns JSON 401 instead of redirecting`, async ({ request }) => {
      const res = await getWithRetry(request, path, { maxRedirects: 0 });

      expect(res.status()).toBe(401);
      expect(res.headers().location).toBeFalsy();
      expect(res.headers()["content-type"]).toContain("application/json");
      await expectSecurityHeaders(res.headers(), path);
    });
  }
});
