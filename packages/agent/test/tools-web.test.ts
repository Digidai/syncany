/**
 * Unit tests for the web tools (web_fetch).
 *
 * Covers: success paths (text/html/json), schema validation, redirect
 * to blocked host, timeout via fake AbortSignal, network reject, non-2xx,
 * JSON parse failure, oversized stream truncation.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { webTools } from "../src/tools/web.js";
import type { ToolDispatchCtx } from "../src/tools/registry.js";

function makeCtx(): ToolDispatchCtx {
  return {
    state: {
      agentId: "test-agent",
      workspaceId: "test-ws",
      ownerId: "test-owner",
      runtime: "raltic" as const,
      history: [],
      todoList: [],
      workspaceContainerId: null,
      workspaceContainerBearer: null,
      totalTokensThisPeriod: 0,
      taskStartedAt: null,
      lastActiveAt: 0,
      schedules: [],
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    env: {} as any,
    sandbox: null,
    ensureSandbox: async () => { throw new Error("not in this test"); },
    updateTodo: async () => {},
    updateSchedules: async (updater) => updater([]),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("web_fetch", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function stubFetch(body: string, opts?: { status?: number; contentType?: string; headers?: Record<string, string> }) {
    const enc = new TextEncoder().encode(body);
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(enc, {
      status: opts?.status ?? 200,
      headers: { "content-type": opts?.contentType ?? "text/html", ...(opts?.headers ?? {}) },
    }));
  }

  it("strips HTML to plain text by default", async () => {
    stubFetch("<html><body><h1>Hello</h1><p>World <strong>!</strong></p></body></html>");
    const tools = webTools(makeCtx());
    const res = await tools.web_fetch!.execute!(
      { url: "https://example.com/" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { toolCallId: "t1" } as any,
    ) as { ok: boolean; body: string };
    expect(res.ok).toBe(true);
    expect(res.body).toContain("Hello");
    expect(res.body).toContain("World");
    expect(res.body).not.toContain("<h1>");
  });

  it("returns raw HTML when format=html", async () => {
    stubFetch("<h1>raw</h1>");
    const tools = webTools(makeCtx());
    const res = await tools.web_fetch!.execute!(
      { url: "https://example.com/", format: "html" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { toolCallId: "t1" } as any,
    ) as { ok: boolean; body: string };
    expect(res.body).toBe("<h1>raw</h1>");
  });

  it("parses JSON when format=json", async () => {
    stubFetch(JSON.stringify({ hello: "world", n: 42 }), { contentType: "application/json" });
    const tools = webTools(makeCtx());
    const res = await tools.web_fetch!.execute!(
      { url: "https://example.com/api", format: "json" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { toolCallId: "t1" } as any,
    ) as { ok: boolean; body: { hello: string; n: number } };
    expect(res.body).toEqual({ hello: "world", n: 42 });
  });

  it("rejects non-https URLs at schema validation", () => {
    const tools = webTools(makeCtx());
    const schema = (tools.web_fetch as { inputSchema: { safeParse: (x: unknown) => { success: boolean } } }).inputSchema;
    expect(schema.safeParse({ url: "http://insecure.example.com/" }).success).toBe(false);
    expect(schema.safeParse({ url: "https://ok.example.com/" }).success).toBe(true);
  });

  it("strips <script> and <style> blocks from text format", async () => {
    stubFetch("<style>body{color:red}</style><p>hi</p><script>alert(1)</script>");
    const tools = webTools(makeCtx());
    const res = await tools.web_fetch!.execute!(
      { url: "https://example.com/" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { toolCallId: "t1" } as any,
    ) as { body: string };
    expect(res.body).toContain("hi");
    expect(res.body).not.toContain("alert");
    expect(res.body).not.toContain("color:red");
  });

  it("refuses an https URL to a blocked host (literal private IP)", async () => {
    const tools = webTools(makeCtx());
    const res = await tools.web_fetch!.execute!(
      { url: "https://10.0.0.1/admin" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { toolCallId: "t1" } as any,
    ) as { ok: false; error: string };
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/blocked host/);
  });

  it("refuses a redirect that lands on a private host", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, {
      status: 302,
      headers: { location: "https://169.254.169.254/" },
    }));
    const tools = webTools(makeCtx());
    const res = await tools.web_fetch!.execute!(
      { url: "https://example.com/redirect" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { toolCallId: "t1" } as any,
    ) as { ok: false; error: string };
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/redirect to blocked host/);
  });

  it("returns the raw status for non-2xx responses (no exception)", async () => {
    stubFetch("server boom", { status: 500 });
    const tools = webTools(makeCtx());
    const res = await tools.web_fetch!.execute!(
      { url: "https://example.com/oops" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { toolCallId: "t1" } as any,
    ) as { ok: boolean; status: number };
    expect(res.ok).toBe(false);
    expect(res.status).toBe(500);
  });

  it("surfaces JSON parse failure as ok:false instead of throwing", async () => {
    stubFetch("not json", { contentType: "application/json" });
    const tools = webTools(makeCtx());
    const res = await tools.web_fetch!.execute!(
      { url: "https://example.com/api", format: "json" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { toolCallId: "t1" } as any,
    ) as { ok: false; error: string };
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/JSON parse/);
  });

  it("returns ok:false on fetch network reject", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("connection refused"));
    const tools = webTools(makeCtx());
    const res = await tools.web_fetch!.execute!(
      { url: "https://example.com/" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { toolCallId: "t1" } as any,
    ) as { ok: false; error: string };
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/connection refused/);
  });

  it("refuses decimal IPv4 shorthand (127.0.0.1 as 2130706433)", async () => {
    const tools = webTools(makeCtx());
    const res = await tools.web_fetch!.execute!(
      { url: "https://2130706433/" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { toolCallId: "t1" } as any,
    ) as { ok: false; error: string };
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/blocked host/);
  });

  it("refuses IPv6 loopback variants (::1, full form)", async () => {
    const tools = webTools(makeCtx());
    for (const url of [
      "https://[::1]/",
      "https://[0:0:0:0:0:0:0:1]/",
      "https://[0000:0000:0000:0000:0000:0000:0000:0001]/",
    ]) {
      const res = await tools.web_fetch!.execute!(
        { url },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { toolCallId: "t1" } as any,
      ) as { ok: false; error: string };
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/blocked host/);
    }
  });

  it("refuses IPv4-mapped IPv6 to private space (::ffff:127.0.0.1)", async () => {
    const tools = webTools(makeCtx());
    const res = await tools.web_fetch!.execute!(
      { url: "https://[::ffff:127.0.0.1]/" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { toolCallId: "t1" } as any,
    ) as { ok: false; error: string };
    expect(res.ok).toBe(false);
  });

  it("refuses URLs carrying userinfo", async () => {
    const tools = webTools(makeCtx());
    const res = await tools.web_fetch!.execute!(
      { url: "https://attacker@ok.example.com/" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { toolCallId: "t1" } as any,
    ) as { ok: false; error: string };
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/userinfo/);
  });

  it("passes the AbortSignal to fetch (timeout wiring)", async () => {
    const spy = vi.fn().mockResolvedValue(new Response("ok"));
    globalThis.fetch = spy;
    const tools = webTools(makeCtx());
    await tools.web_fetch!.execute!(
      { url: "https://example.com/" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { toolCallId: "t1" } as any,
    );
    // The fetch call MUST receive a signal so the timeout can cancel it.
    expect(spy).toHaveBeenCalled();
    const init = (spy.mock.calls[0]?.[1] as RequestInit | undefined);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
});
