import { test, expect, type BrowserContext, type Page, type Request, type Response } from "@playwright/test";

type RouteLabel = "/" | "/login";

type RouteTarget = {
  label: RouteLabel;
  path: string;
};

type ConsoleEntry = {
  text: string;
  location: string;
};

type FailedRequest = {
  method: string;
  resourceType: string;
  status: number | null;
  url: string;
  failureText?: string;
};

type SecretPattern = {
  label: string;
  regex: RegExp;
};

type SecretMatch = {
  pattern: string;
  location: string;
};

type CookieIssue = {
  name: string;
  reason: string;
};

const ROUTES: RouteTarget[] = [
  {
    label: "/",
    path: "/?utm_source=e2e&utm_medium=playwright&utm_campaign=hygiene",
  },
  { label: "/login", path: "/login" },
];

const SECRET_PATTERNS: SecretPattern[] = [
  { label: "/sk-[A-Za-z0-9_]{20,}/", regex: /sk-[A-Za-z0-9_]{20,}/ },
  { label: "/ghp_[A-Za-z0-9]{20,}/", regex: /ghp_[A-Za-z0-9]{20,}/ },
  { label: "/AKIA[0-9A-Z]{16}/", regex: /AKIA[0-9A-Z]{16}/ },
  { label: "/ANTHROPIC_API_KEY/", regex: /ANTHROPIC_API_KEY/ },
  { label: "/OPENAI_API_KEY/", regex: /OPENAI_API_KEY/ },
];

const SENSITIVE_COOKIE_NAME = /(auth|csrf|jwt|key|secret|session|token)/i;

test.describe("console, network, and browser hygiene", () => {
  for (const route of ROUTES) {
    test(`${route.label} has clean browser hygiene`, async ({ page, context, baseURL }) => {
      const ownOrigins = new Set<string>();
      if (baseURL) {
        ownOrigins.add(new URL(baseURL).origin);
      }

      const beforeCookieKeys = await cookieKeysForContext(context, baseURL);
      const consoleErrors: ConsoleEntry[] = [];
      const consoleWarnings: ConsoleEntry[] = [];
      const pageErrors: string[] = [];
      const failedRequests: FailedRequest[] = [];
      const requests: Request[] = [];
      const responses: Response[] = [];

      page.on("console", (message) => {
        const entry = {
          text: message.text(),
          location: formatConsoleLocation(message.location()),
        };
        if (message.type() === "error") {
          consoleErrors.push(entry);
        }
        if (message.type() === "warning") {
          consoleWarnings.push(entry);
        }
      });

      page.on("pageerror", (error) => {
        pageErrors.push(error.stack ?? error.message);
      });

      page.on("request", (request) => {
        requests.push(request);
      });

      page.on("requestfailed", (request) => {
        failedRequests.push({
          method: request.method(),
          resourceType: request.resourceType(),
          status: null,
          url: request.url(),
          failureText: request.failure()?.errorText,
        });
      });

      page.on("response", (response) => {
        responses.push(response);
        if (response.status() >= 400) {
          const request = response.request();
          failedRequests.push({
            method: request.method(),
            resourceType: request.resourceType(),
            status: response.status(),
            url: response.url(),
          });
        }
      });

      const mainResponse = await page.goto(route.path, { waitUntil: "load" });
      expect(mainResponse, `${route.label} returned a document response`).toBeTruthy();

      ownOrigins.add(new URL(page.url()).origin);
      await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
      await page.waitForTimeout(500);

      const ownOriginFailures = failedRequests.filter((request) => isOwnOrigin(request.url, ownOrigins));
      const thirdPartyFailures = failedRequests.filter((request) => !isOwnOrigin(request.url, ownOrigins));
      const secretMatches = await scanResponsesForSecrets(responses, ownOrigins);
      const missingSecurityHeaders = missingHeadersFor(route.label, mainResponse);
      const mixedContentRequests = mixedContentFor(page, requests);
      const cookieIssues = await cookieIssuesForContext(context, page, beforeCookieKeys);

      logRouteSummary(route.label, {
        consoleErrors,
        consoleWarnings,
        pageErrors,
        ownOriginFailures,
        thirdPartyFailures,
        secretMatches,
        missingSecurityHeaders,
        mixedContentRequests,
        cookieIssues,
      });

      expect(formatConsoleEntries(consoleErrors), `${route.label} console.error messages`).toEqual([]);
      expect(pageErrors, `${route.label} uncaught page errors`).toEqual([]);
      expect(formatFailedRequests(ownOriginFailures), `${route.label} own-origin failed requests`).toEqual([]);
      expect(formatSecretMatches(secretMatches), `${route.label} leaked secret matches`).toEqual([]);
      expect(missingSecurityHeaders, `${route.label} missing security headers`).toEqual([]);
      expect(mixedContentRequests, `${route.label} mixed-content requests`).toEqual([]);
      expect(formatCookieIssues(cookieIssues), `${route.label} cookie hygiene issues`).toEqual([]);
    });
  }
});

async function cookieKeysForContext(context: BrowserContext, baseURL: string | undefined): Promise<Set<string>> {
  if (!baseURL) {
    return new Set();
  }

  const cookies = await context.cookies([baseURL]);
  return new Set(cookies.map(cookieKey));
}

async function cookieIssuesForContext(
  context: BrowserContext,
  page: Page,
  beforeCookieKeys: Set<string>,
): Promise<CookieIssue[]> {
  const cookies = (await context.cookies([page.url()])).filter((cookie) => !beforeCookieKeys.has(cookieKey(cookie)));
  const issues: CookieIssue[] = [];

  for (const cookie of cookies) {
    if (cookie.sameSite !== "Lax" && cookie.sameSite !== "Strict") {
      issues.push({ name: cookie.name, reason: `SameSite=${cookie.sameSite}` });
    }

    if (SENSITIVE_COOKIE_NAME.test(cookie.name) && (!cookie.secure || !cookie.httpOnly)) {
      const missing = [
        cookie.secure ? null : "Secure",
        cookie.httpOnly ? null : "HttpOnly",
      ].filter(Boolean);
      issues.push({ name: cookie.name, reason: `sensitive cookie missing ${missing.join("+")}` });
    }
  }

  return issues;
}

async function scanResponsesForSecrets(responses: Response[], ownOrigins: Set<string>): Promise<SecretMatch[]> {
  const matches: SecretMatch[] = [];

  for (const response of responses) {
    if (!isOwnOrigin(response.url(), ownOrigins) || !isHtmlOrJavaScript(response)) {
      continue;
    }

    let body = "";
    try {
      body = await response.text();
    } catch {
      continue;
    }

    for (const pattern of SECRET_PATTERNS) {
      if (pattern.regex.test(body)) {
        matches.push({
          pattern: pattern.label,
          location: responseLocation(response),
        });
      }
    }
  }

  return matches;
}

function isHtmlOrJavaScript(response: Response): boolean {
  const headers = response.headers();
  const contentType = (headers["content-type"] ?? "").toLowerCase();
  const resourceType = response.request().resourceType();
  const pathname = safePathname(response.url());

  return (
    resourceType === "document" ||
    resourceType === "script" ||
    contentType.includes("text/html") ||
    contentType.includes("javascript") ||
    contentType.includes("ecmascript") ||
    pathname.endsWith(".js") ||
    pathname.endsWith(".mjs")
  );
}

function missingHeadersFor(route: RouteLabel, response: Response | null): string[] {
  if (!response) {
    return [`${route}: document response missing`];
  }

  const headers = response.headers();
  const missing: string[] = [];

  if (!headers["content-security-policy"]?.trim()) {
    missing.push(`${route}: content-security-policy`);
  }

  if ((headers["x-frame-options"] ?? "").toLowerCase() !== "deny") {
    missing.push(`${route}: x-frame-options=DENY`);
  }

  if (!headers["strict-transport-security"]?.trim()) {
    missing.push(`${route}: strict-transport-security`);
  }

  return missing;
}

function mixedContentFor(page: Page, requests: Request[]): string[] {
  if (new URL(page.url()).protocol !== "https:") {
    return [];
  }

  return requests
    .map((request) => request.url())
    .filter((url) => {
      try {
        return new URL(url).protocol === "http:";
      } catch {
        return false;
      }
    });
}

function isOwnOrigin(url: string, ownOrigins: Set<string>): boolean {
  try {
    return ownOrigins.has(new URL(url).origin);
  } catch {
    return false;
  }
}

function safePathname(url: string): string {
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    return "";
  }
}

function responseLocation(response: Response): string {
  const contentType = response.headers()["content-type"]?.split(";")[0] ?? response.request().resourceType();
  return `${response.url()} (${contentType})`;
}

function formatConsoleLocation(location: { url: string; lineNumber: number; columnNumber: number }): string {
  if (!location.url) {
    return "unknown";
  }

  return `${location.url}:${location.lineNumber}:${location.columnNumber}`;
}

function cookieKey(cookie: { domain: string; path: string; name: string }): string {
  return `${cookie.domain}|${cookie.path}|${cookie.name}`;
}

function formatConsoleEntries(entries: ConsoleEntry[]): string[] {
  return entries.map((entry) => `${entry.location} ${entry.text}`);
}

function formatFailedRequests(requests: FailedRequest[]): string[] {
  return requests.map((request) => {
    const status = request.status === null ? "requestfailed" : String(request.status);
    const failure = request.failureText ? ` ${request.failureText}` : "";
    return `${status} ${request.method} ${request.resourceType} ${request.url}${failure}`;
  });
}

function formatSecretMatches(matches: SecretMatch[]): string[] {
  return matches.map((match) => `${match.pattern} at ${match.location}`);
}

function formatCookieIssues(issues: CookieIssue[]): string[] {
  return issues.map((issue) => `${issue.name}: ${issue.reason}`);
}

function logRouteSummary(
  route: RouteLabel,
  summary: {
    consoleErrors: ConsoleEntry[];
    consoleWarnings: ConsoleEntry[];
    pageErrors: string[];
    ownOriginFailures: FailedRequest[];
    thirdPartyFailures: FailedRequest[];
    secretMatches: SecretMatch[];
    missingSecurityHeaders: string[];
    mixedContentRequests: string[];
    cookieIssues: CookieIssue[];
  },
): void {
  console.log(
    [
      `[hygiene:${route}]`,
      `consoleErrors=${summary.consoleErrors.length}`,
      `consoleWarnings=${summary.consoleWarnings.length}`,
      `pageErrors=${summary.pageErrors.length}`,
      `failedOwnOrigin=${summary.ownOriginFailures.length}`,
      `failedThirdParty=${summary.thirdPartyFailures.length}`,
      `secretMatches=${formatSecretMatches(summary.secretMatches).join(" | ") || "none"}`,
      `missingSecurityHeaders=${summary.missingSecurityHeaders.join(" | ") || "all present"}`,
      `mixedContent=${summary.mixedContentRequests.length}`,
      `cookieIssues=${formatCookieIssues(summary.cookieIssues).join(" | ") || "none"}`,
    ].join(" "),
  );

  if (summary.consoleWarnings.length > 0) {
    console.warn(`[hygiene:${route}] console warnings: ${formatConsoleEntries(summary.consoleWarnings).join(" | ")}`);
  }

  if (summary.thirdPartyFailures.length > 0) {
    console.warn(
      `[hygiene:${route}] third-party failures: ${formatFailedRequests(summary.thirdPartyFailures).join(" | ")}`,
    );
  }
}
