/**
 * Smoke test — proves the vitest-pool-workers harness boots the worker
 * with the API bundle, applies migrations, and routes requests.
 *
 * Failure here means the entire test setup is broken (config / migration
 * application / app import), not your route. Fix this first before
 * suspecting any individual route test.
 */
import { describe, it, expect } from "vitest";
import { request } from "./helpers";
import app from "../src/index";

describe("worker boot", () => {
  it("serves /health with ok=true", async () => {
    const res = await request(app as never, "https://test.local/health");
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; ts: number };
    expect(body.ok).toBe(true);
    expect(typeof body.ts).toBe("number");
  });

  it("adds x-request-id header on every response", async () => {
    const res = await request(app as never, "https://test.local/health");
    const rid = res.headers.get("x-request-id");
    expect(rid).toMatch(/^[0-9a-f-]{36}$/);  // UUID v4 format
  });

  it("returns 404 on unknown routes (not 500)", async () => {
    const res = await request(app as never, "https://test.local/api/v1/does-not-exist");
    expect(res.status).toBe(404);
  });
});
