import { expect, test, type Page } from "@playwright/test";

const KIB = 1024;
const MIB = KIB * KIB;

const HOME_DOM_CONTENT_LOADED_BUDGET_MS = 5_000;
const HOME_FCP_BUDGET_MS = 3_000;
const HOME_LCP_BUDGET_MS = 4_000;
const HOME_TRANSFER_BUDGET_BYTES = 1.5 * MIB;
const HOME_REQUEST_BUDGET = 80;
const LOGIN_DOM_CONTENT_LOADED_BUDGET_MS = 4_000;
const LOGIN_TRANSFER_BUDGET_BYTES = 800 * KIB;

type CriticalResourceFailure = {
  resourceType: string;
  status: number;
  url: string;
};

type NetworkMetrics = {
  criticalFailures: CriticalResourceFailure[];
  requestCount: number;
  transferBytes: number;
};

async function waitForPageTail(page: Page) {
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
}

async function gotoAndExpectOk(page: Page, path: string) {
  const response = await page.goto(path, { waitUntil: "load" });
  expect(response, `${path} should return a navigation response`).not.toBeNull();
  expect(response?.ok(), `${path} navigation status should be 2xx/3xx`).toBeTruthy();
}

async function measureDomContentLoaded(page: Page, path: string) {
  await gotoAndExpectOk(page, path);

  return page.evaluate(() => {
    const [navigation] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
    return navigation?.domContentLoadedEventEnd ?? 0;
  });
}

async function measureFirstContentfulPaint(page: Page, path: string) {
  await gotoAndExpectOk(page, path);

  return page.evaluate(() => {
    const paintEntries = performance.getEntriesByType("paint");
    const fcpEntry = paintEntries.find((entry) => entry.name === "first-contentful-paint");
    return fcpEntry?.startTime ?? 0;
  });
}

async function measureLargestContentfulPaint(page: Page, path: string) {
  const response = await page.goto(path, { waitUntil: "domcontentloaded" });
  expect(response, `${path} should return a navigation response`).not.toBeNull();
  expect(response?.ok(), `${path} navigation status should be 2xx/3xx`).toBeTruthy();

  const lcpPromise = page.evaluate(() => {
    return new Promise<number>((resolve) => {
      if (!("PerformanceObserver" in window)) {
        resolve(0);
        return;
      }

      let latestLcp = 0;
      let observer: PerformanceObserver | undefined;
      const finish = () => {
        observer?.disconnect();
        resolve(latestLcp);
      };

      try {
        observer = new PerformanceObserver((entryList) => {
          const entries = entryList.getEntries();
          const lastEntry = entries[entries.length - 1];
          if (lastEntry) {
            latestLcp = lastEntry.startTime;
          }
        });
        observer.observe({ type: "largest-contentful-paint", buffered: true });
        window.setTimeout(finish, 2_500);
      } catch {
        resolve(0);
      }
    });
  });

  await page.waitForLoadState("load", { timeout: 10_000 }).catch(() => undefined);
  return lcpPromise;
}

async function collectNetworkMetrics(page: Page, path: string): Promise<NetworkMetrics> {
  const metrics: NetworkMetrics = {
    criticalFailures: [],
    requestCount: 0,
    transferBytes: 0,
  };
  const criticalResourceTypes = new Set(["document", "script", "stylesheet"]);

  page.on("request", () => {
    metrics.requestCount += 1;
  });

  page.on("response", (response) => {
    const contentLength = response.headers()["content-length"];
    if (contentLength) {
      const parsedLength = Number(contentLength);
      if (Number.isFinite(parsedLength)) {
        metrics.transferBytes += parsedLength;
      }
    }

    const request = response.request();
    const resourceType = request.resourceType();
    if (criticalResourceTypes.has(resourceType) && response.status() >= 400) {
      metrics.criticalFailures.push({
        resourceType,
        status: response.status(),
        url: response.url(),
      });
    }
  });

  await gotoAndExpectOk(page, path);
  await waitForPageTail(page);
  return metrics;
}

function formatBytes(bytes: number) {
  return `${bytes} bytes (${(bytes / KIB).toFixed(1)} KiB)`;
}

function formatCriticalFailures(failures: CriticalResourceFailure[]) {
  return failures
    .map((failure) => `${failure.status} ${failure.resourceType} ${failure.url}`)
    .join("\n");
}

test.describe("performance budgets", () => {
  test("/ DOMContentLoaded stays within 5s", async ({ page }) => {
    const domContentLoadedMs = await measureDomContentLoaded(page, "/");
    console.log(
      `PERF route=/ metric=dom_content_loaded_ms value=${domContentLoadedMs.toFixed(0)} budget=${HOME_DOM_CONTENT_LOADED_BUDGET_MS}`,
    );

    expect(domContentLoadedMs).toBeGreaterThan(0);
    expect(domContentLoadedMs).toBeLessThanOrEqual(HOME_DOM_CONTENT_LOADED_BUDGET_MS);
  });

  test("/ first contentful paint stays under 3s", async ({ page }) => {
    const fcpMs = await measureFirstContentfulPaint(page, "/");
    console.log(`PERF route=/ metric=fcp_ms value=${fcpMs.toFixed(0)} budget=${HOME_FCP_BUDGET_MS}`);

    expect(fcpMs).toBeGreaterThan(0);
    expect(fcpMs).toBeLessThan(HOME_FCP_BUDGET_MS);
  });

  test("/ largest contentful paint stays under 4s", async ({ page }) => {
    const lcpMs = await measureLargestContentfulPaint(page, "/");
    console.log(`PERF route=/ metric=lcp_ms value=${lcpMs.toFixed(0)} budget=${HOME_LCP_BUDGET_MS}`);

    expect(lcpMs).toBeGreaterThan(0);
    expect(lcpMs).toBeLessThan(HOME_LCP_BUDGET_MS);
  });

  test("/ transfer size stays under 1.5 MiB", async ({ page }) => {
    const metrics = await collectNetworkMetrics(page, "/");
    console.log(
      `PERF route=/ metric=transfer value=${formatBytes(metrics.transferBytes)} request_count=${metrics.requestCount} budget=${formatBytes(HOME_TRANSFER_BUDGET_BYTES)}`,
    );

    expect(metrics.transferBytes).toBeLessThan(HOME_TRANSFER_BUDGET_BYTES);
  });

  test("/ network request count stays under 80", async ({ page }) => {
    const metrics = await collectNetworkMetrics(page, "/");
    console.log(
      `PERF route=/ metric=request_count value=${metrics.requestCount} transfer=${formatBytes(metrics.transferBytes)} budget=${HOME_REQUEST_BUDGET}`,
    );

    expect(metrics.requestCount).toBeLessThan(HOME_REQUEST_BUDGET);
  });

  test("/ has no 4xx/5xx document, script, or stylesheet responses", async ({ page }) => {
    const metrics = await collectNetworkMetrics(page, "/");
    console.log(`PERF route=/ metric=critical_failures value=${metrics.criticalFailures.length}`);

    expect(metrics.criticalFailures, formatCriticalFailures(metrics.criticalFailures)).toHaveLength(0);
  });

  test("/login DOMContentLoaded stays within 4s", async ({ page }) => {
    const domContentLoadedMs = await measureDomContentLoaded(page, "/login");
    console.log(
      `PERF route=/login metric=dom_content_loaded_ms value=${domContentLoadedMs.toFixed(0)} budget=${LOGIN_DOM_CONTENT_LOADED_BUDGET_MS}`,
    );

    expect(domContentLoadedMs).toBeGreaterThan(0);
    expect(domContentLoadedMs).toBeLessThanOrEqual(LOGIN_DOM_CONTENT_LOADED_BUDGET_MS);
  });

  test("/login transfer size stays under 800 KiB", async ({ page }) => {
    const metrics = await collectNetworkMetrics(page, "/login");
    console.log(
      `PERF route=/login metric=transfer value=${formatBytes(metrics.transferBytes)} request_count=${metrics.requestCount} budget=${formatBytes(LOGIN_TRANSFER_BUDGET_BYTES)}`,
    );

    expect(metrics.transferBytes).toBeLessThan(LOGIN_TRANSFER_BUDGET_BYTES);
  });

  test("/login emits no console errors during load", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });

    await gotoAndExpectOk(page, "/login");
    await waitForPageTail(page);
    console.log(`PERF route=/login metric=console_errors value=${consoleErrors.length}`);

    expect(consoleErrors).toEqual([]);
  });

  test("/ has no uncaught exceptions during load", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => {
      pageErrors.push(error.message);
    });

    await gotoAndExpectOk(page, "/");
    await waitForPageTail(page);
    console.log(`PERF route=/ metric=page_errors value=${pageErrors.length}`);

    expect(pageErrors).toEqual([]);
  });
});
