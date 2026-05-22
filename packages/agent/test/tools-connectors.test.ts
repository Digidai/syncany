/**
 * Unit tests for connector tools — decrypt round-trip, ACL gating, GH
 * helpers. We don't hit real GitHub/Linear/Notion APIs; we mock fetch.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { decryptConnectorToken } from "../src/tools/connectors/decrypt.js";
import { githubTools, REPO_NAME } from "../src/tools/connectors/github.js";
import { linearTools } from "../src/tools/connectors/linear.js";
import { notionTools } from "../src/tools/connectors/notion.js";

// ── Encryption round-trip ────────────────────────────────────────────────

describe("decryptConnectorToken", () => {
  it("decrypts what auth-core encrypts (round-trip)", async () => {
    // Inline-implement the encrypt half to avoid pulling auth-core's
    // type graph (same boundary as the runtime split).
    const kek = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
    function decodeBase64(b: string) {
      const s = atob(b); const u = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
      return u;
    }
    async function encrypt(plain: string) {
      const raw = decodeBase64(kek);
      const key = await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt"]);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain)));
      const combined = new Uint8Array(iv.byteLength + ct.byteLength);
      combined.set(iv, 0); combined.set(ct, iv.byteLength);
      let s = ""; for (const b of combined) s += String.fromCharCode(b);
      return btoa(s);
    }
    const blob = await encrypt("ghp_super_secret_pat");
    const out = await decryptConnectorToken(blob, kek);
    expect(out).toBe("ghp_super_secret_pat");
  });

  it("throws on a tampered ciphertext", async () => {
    const kek = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
    // Construct a syntactically-valid blob with random bytes — auth tag will fail.
    const rand = crypto.getRandomValues(new Uint8Array(12 + 16 + 16));   // iv + pt + tag
    let s = ""; for (const b of rand) s += String.fromCharCode(b);
    await expect(decryptConnectorToken(btoa(s), kek)).rejects.toThrow();
  });

  it("throws on wrong-length key", async () => {
    const shortKek = btoa("short");
    await expect(decryptConnectorToken("xxxxx", shortKek)).rejects.toThrow(/32 bytes/);
  });
});

// ── GitHub: regex + tool behavior with no connector ─────────────────────

describe("github_*", () => {
  it("REPO_NAME accepts owner/repo and rejects junk", () => {
    expect(REPO_NAME.safeParse("anthropics/claude-cli").success).toBe(true);
    expect(REPO_NAME.safeParse("just-one-thing").success).toBe(false);
    expect(REPO_NAME.safeParse("owner/repo/extra").success).toBe(false);
    expect(REPO_NAME.safeParse("../etc").success).toBe(false);
  });

  it("all github tools return {error} when no connector is enabled", async () => {
    const ctx = makeCtxNoConnector();
    const tools = githubTools(ctx);
    for (const t of ["github_list_repos", "github_get_file", "github_create_issue", "github_comment_issue", "github_create_pr", "github_list_pr_files"]) {
      // Pick a minimal valid input that passes zod for each
      const inputs: Record<string, unknown> = {
        github_list_repos: {},
        github_get_file: { repo: "owner/repo", path: "README.md" },
        github_create_issue: { repo: "owner/repo", title: "x" },
        github_comment_issue: { repo: "owner/repo", number: 1, body: "x" },
        github_create_pr: { repo: "owner/repo", title: "x", head: "branch", base: "main" },
        github_list_pr_files: { repo: "owner/repo", number: 1 },
      };
      const res = await tools[t]!.execute!(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        inputs[t] as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        {} as any,
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((res as any).error).toBeTruthy();
    }
  });
});

describe("linear_*", () => {
  it("returns {error} when no connector", async () => {
    const ctx = makeCtxNoConnector();
    const tools = linearTools(ctx);
    const res = await tools.linear_list_issues!.execute!({}, {} as never);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((res as any).error).toBeTruthy();
  });
});

describe("notion_*", () => {
  it("returns {error} when no connector", async () => {
    const ctx = makeCtxNoConnector();
    const tools = notionTools(ctx);
    const res = await tools.notion_search!.execute!({ query: "x" }, {} as never);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((res as any).error).toBeTruthy();
  });
});

// ── Helpers ─────────────────────────────────────────────────────────────

function makeCtxNoConnector() {
  // D1.prepare(...).bind(...).all() — return zero results so resolver
  // returns null and the tool short-circuits.
  const stmt = {
    bind: () => ({ all: async () => ({ results: [] }) }),
  };
  return {
    state: {
      agentId: "a",
      workspaceId: "w",
      ownerId: "o",
      runtime: "raltic",
      history: [],
      todoList: [],
      workspaceContainerId: null,
      workspaceContainerBearer: null,
      totalTokensThisPeriod: 0,
      taskStartedAt: null,
      lastActiveAt: 0,
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    env: { DB: { prepare: () => stmt } as any } as any,
    sandbox: null,
    ensureSandbox: async () => { throw new Error("nope"); },
    updateTodo: async () => {},
    updateSchedules: async () => [],
    appendTerminal: async () => {},
  };
}
