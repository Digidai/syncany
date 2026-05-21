import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.js";

function bearer(token: string) {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

describe("/file routes", () => {
  let root: string;
  const TOKEN = "test-token-1234";

  beforeEach(() => { root = mkdtempSync(join(tmpdir(), "sbx-test-")); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  function build() {
    return createApp({ workspaceRoot: root, bearerToken: TOKEN });
  }

  it("rejects unauthenticated", async () => {
    const app = build();
    const res = await app.request("/file/read", {
      method: "POST", body: JSON.stringify({ path: "x" }),
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(401);
  });

  it("read/write round-trip", async () => {
    const app = build();
    const w = await app.request("/file/write", {
      method: "POST", body: JSON.stringify({ path: "a.txt", content: "hello" }),
      headers: bearer(TOKEN),
    });
    expect(w.status).toBe(200);
    expect(readFileSync(join(root, "a.txt"), "utf-8")).toBe("hello");

    const r = await app.request("/file/read", {
      method: "POST", body: JSON.stringify({ path: "a.txt" }),
      headers: bearer(TOKEN),
    });
    expect(r.status).toBe(200);
    const body = await r.json() as { content: string };
    expect(body.content).toBe("hello");
  });

  it("write creates intermediate dirs", async () => {
    const app = build();
    const res = await app.request("/file/write", {
      method: "POST", body: JSON.stringify({ path: "deep/nested/dir/x.md", content: "z" }),
      headers: bearer(TOKEN),
    });
    expect(res.status).toBe(200);
    expect(existsSync(join(root, "deep/nested/dir/x.md"))).toBe(true);
  });

  it("rejects path escape", async () => {
    const app = build();
    const res = await app.request("/file/read", {
      method: "POST", body: JSON.stringify({ path: "../../etc/passwd" }),
      headers: bearer(TOKEN),
    });
    expect(res.status).toBe(400);
  });

  it("edit (single replace) succeeds", async () => {
    const app = build();
    writeFileSync(join(root, "code.ts"), "const x = 1;\nconst y = 2;");
    const res = await app.request("/file/edit", {
      method: "POST",
      body: JSON.stringify({ path: "code.ts", oldStr: "const x = 1;", newStr: "const x = 42;" }),
      headers: bearer(TOKEN),
    });
    expect(res.status).toBe(200);
    expect(readFileSync(join(root, "code.ts"), "utf-8")).toBe("const x = 42;\nconst y = 2;");
  });

  it("edit refuses ambiguous match without replaceAll", async () => {
    const app = build();
    writeFileSync(join(root, "code.ts"), "x\nx\n");
    const res = await app.request("/file/edit", {
      method: "POST",
      body: JSON.stringify({ path: "code.ts", oldStr: "x", newStr: "y" }),
      headers: bearer(TOKEN),
    });
    expect(res.status).toBe(409);
  });

  it("edit replaceAll", async () => {
    const app = build();
    writeFileSync(join(root, "code.ts"), "x\nx\nx");
    const res = await app.request("/file/edit", {
      method: "POST",
      body: JSON.stringify({ path: "code.ts", oldStr: "x", newStr: "y", replaceAll: true }),
      headers: bearer(TOKEN),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { occurrences: number };
    expect(body.occurrences).toBe(3);
    expect(readFileSync(join(root, "code.ts"), "utf-8")).toBe("y\ny\ny");
  });

  it("list directory", async () => {
    const app = build();
    writeFileSync(join(root, "a.txt"), "");
    writeFileSync(join(root, "b.md"), "");
    const res = await app.request("/file/list", {
      method: "POST", body: JSON.stringify({ path: "." }),
      headers: bearer(TOKEN),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { entries: { name: string }[] };
    expect(body.entries.map(e => e.name).sort()).toEqual(["a.txt", "b.md"]);
  });
});
