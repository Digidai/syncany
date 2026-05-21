/**
 * Regressions for codex review findings (P0 W1):
 *   - HIGH: symlink escape
 *   - MED:  daemon token reachable from bash subprocess
 *   - LOW:  git ref-name starting with `-`
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.js";

const TOKEN = "sekret-token-XYZ";
const bearer = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };

describe("regressions: codex P0 W1 review", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "sbx-sec-"));
    // Mirror prod env so the env-scrub test is meaningful.
    process.env.RALTIC_SANDBOX_TOKEN = TOKEN;
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    delete process.env.RALTIC_SANDBOX_TOKEN;
  });

  it("HIGH: refuses to read through a symlink pointing outside workspace", async () => {
    // Create /tmp/raltic-outside-XXX/secret outside the workspace,
    // and a symlink inside workspace pointing to it.
    const outsideRoot = mkdtempSync(join(tmpdir(), "outside-"));
    try {
      writeFileSync(join(outsideRoot, "secret"), "TOP-SECRET-DATA");
      symlinkSync(join(outsideRoot, "secret"), join(root, "leak"));
      const app = createApp({ workspaceRoot: root, bearerToken: TOKEN });
      const res = await app.request("/file/read", {
        method: "POST", body: JSON.stringify({ path: "leak" }),
        headers: bearer,
      });
      // Either 400 (refused due to symlink) or 404 (refused before realpath)
      // — what we MUST NOT see is 200 with the secret content.
      expect(res.status).toBeGreaterThanOrEqual(400);
      const body = await res.json() as { content?: string };
      expect(body.content).toBeUndefined();
    } finally {
      rmSync(outsideRoot, { recursive: true, force: true });
    }
  });

  it("MED: bash cannot see RALTIC_SANDBOX_TOKEN", async () => {
    const app = createApp({ workspaceRoot: root, bearerToken: TOKEN });
    const res = await app.request("/bash/exec", {
      method: "POST",
      body: JSON.stringify({ command: "echo $RALTIC_SANDBOX_TOKEN" }),
      headers: bearer,
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { stdout: string };
    expect(body.stdout).not.toContain(TOKEN);
  });

  it("MED: bash cannot see GIT_ASKPASS_TOKEN even if set on daemon", async () => {
    process.env.GIT_ASKPASS_TOKEN = "git-token-LEAK";
    try {
      const app = createApp({ workspaceRoot: root, bearerToken: TOKEN });
      const res = await app.request("/bash/exec", {
        method: "POST",
        body: JSON.stringify({ command: "echo $GIT_ASKPASS_TOKEN" }),
        headers: bearer,
      });
      const body = await res.json() as { stdout: string };
      expect(body.stdout).not.toContain("git-token-LEAK");
    } finally {
      delete process.env.GIT_ASKPASS_TOKEN;
    }
  });

  it("MED: bash cannot reintroduce a secret via the env override", async () => {
    const app = createApp({ workspaceRoot: root, bearerToken: TOKEN });
    const res = await app.request("/bash/exec", {
      method: "POST",
      body: JSON.stringify({
        command: "echo $RALTIC_SANDBOX_TOKEN",
        env: { RALTIC_SANDBOX_TOKEN: "agent-supplied" },
      }),
      headers: bearer,
    });
    const body = await res.json() as { stdout: string };
    // Neither the daemon's real token nor the agent override should leak.
    expect(body.stdout).not.toContain(TOKEN);
    expect(body.stdout).not.toContain("agent-supplied");
  });

  it("LOW: git push refuses remote starting with '-'", async () => {
    mkdirSync(join(root, "repo"));
    const app = createApp({ workspaceRoot: root, bearerToken: TOKEN });
    const res = await app.request("/git/push", {
      method: "POST",
      body: JSON.stringify({ path: "repo", remote: "--exec=evil" }),
      headers: bearer,
    });
    // Zod validation should reject at the boundary (400), never invoke git.
    expect(res.status).toBe(400);
  });
});
