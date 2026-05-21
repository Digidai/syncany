import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.js";

const TOKEN = "tk";
const bearer = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };

describe("/bash/exec", () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), "sbx-bash-")); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it("runs a simple command", async () => {
    const app = createApp({ workspaceRoot: root, bearerToken: TOKEN });
    const res = await app.request("/bash/exec", {
      method: "POST", body: JSON.stringify({ command: "echo hello" }),
      headers: bearer,
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { exitCode: number; stdout: string };
    expect(body.exitCode).toBe(0);
    expect(body.stdout.trim()).toBe("hello");
  });

  it("captures non-zero exit", async () => {
    const app = createApp({ workspaceRoot: root, bearerToken: TOKEN });
    const res = await app.request("/bash/exec", {
      method: "POST", body: JSON.stringify({ command: "exit 7" }),
      headers: bearer,
    });
    const body = await res.json() as { exitCode: number };
    expect(body.exitCode).toBe(7);
  });

  it("times out and reports timedOut=true", async () => {
    const app = createApp({ workspaceRoot: root, bearerToken: TOKEN, bashTimeoutMs: 200 });
    const res = await app.request("/bash/exec", {
      method: "POST", body: JSON.stringify({ command: "sleep 5" }),
      headers: bearer,
    });
    const body = await res.json() as { timedOut: boolean; exitCode: number };
    expect(body.timedOut).toBe(true);
  }, 10_000);

  it("rejects cwd escape", async () => {
    const app = createApp({ workspaceRoot: root, bearerToken: TOKEN });
    const res = await app.request("/bash/exec", {
      method: "POST",
      body: JSON.stringify({ command: "pwd", cwd: "../../../" }),
      headers: bearer,
    });
    expect(res.status).toBe(400);
  });

  it("runs in workspace cwd by default", async () => {
    const app = createApp({ workspaceRoot: root, bearerToken: TOKEN });
    const res = await app.request("/bash/exec", {
      method: "POST", body: JSON.stringify({ command: "pwd" }),
      headers: bearer,
    });
    const body = await res.json() as { stdout: string };
    // pwd may go through symlinks (e.g. /tmp → /private/tmp on macOS); compare basename to keep CI portable.
    expect(body.stdout.trim().endsWith(root.split("/").pop()!)).toBe(true);
  });
});
