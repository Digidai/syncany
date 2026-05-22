/**
 * GitHub connector tools (P2-D2).
 *
 * Auth: per-user Personal Access Token (PAT) stored encrypted in
 * user_connectors and linked to this agent via agent_connectors. The
 * server decrypts on demand at the api Worker layer and passes the
 * PAT to GitHub via Authorization: Bearer.
 *
 * Scope philosophy: we surface a small, opinionated set of tools that
 * cover the 80% case (read repo, manage issues, file PRs). For
 * everything else the agent can use raw `gh` CLI via bash inside its
 * sandbox container (if the user installed it).
 *
 * Failure modes documented:
 *   - 401: PAT revoked or wrong scope. Tool surfaces "needs:reauth"
 *     so the UI can prompt the user to update the connector.
 *   - 403 (rate-limit): we surface the reset window in the response.
 *   - 404: surfaced as "not found" — agent decides whether that's a
 *     real error (asked for a known repo) or expected (probing).
 *
 * Why not OAuth (yet): PAT-only keeps v1 self-contained — no app
 * registration, no callback URL, no token refresh dance. OAuth lands
 * in P2.5 once we know which scopes the average agent actually uses.
 */
import { tool } from "ai";
import { z } from "zod";
import type { ToolDispatchCtx, ToolRegistry } from "../registry.js";

const GITHUB_API = "https://api.github.com";
const USER_AGENT = "raltic-agent/0.1 (cloud)";

/** Connector lookup result for a given agent + kind. */
export interface ConnectorToken {
  connectorId: string;
  token: string;     // plaintext (decrypted on demand by api Worker)
  scopes: string[];
}

/**
 * Resolve the FIRST github connector enabled for this agent. If the
 * agent has multiple GitHub connectors linked we pick by createdAt
 * order (oldest first) — agents that need a specific one can name it
 * via the future `connector_label` param.
 *
 * Lookup goes through ctx.env.DB directly since this code path is on
 * the DO side of the Worker, not the api route handler.
 */
async function resolveGithubConnector(ctx: ToolDispatchCtx): Promise<ConnectorToken | null> {
  // We need raw D1 access via the agent DO's env binding. Drizzle
  // would pull the whole orm; for one query we inline the SQL.
  const sql = `
    SELECT uc.id AS id, uc.encrypted_token AS encrypted_token, uc.scopes AS scopes
    FROM agent_connectors ac
    INNER JOIN user_connectors uc ON uc.id = ac.connector_id
    WHERE ac.agent_id = ?1 AND uc.kind = 'github'
    ORDER BY uc.created_at ASC
    LIMIT 1
  `;
  const { results } = await ctx.env.DB.prepare(sql).bind(ctx.state.agentId).all<{
    id: string; encrypted_token: string; scopes: string;
  }>();
  if (!results || results.length === 0) return null;
  const row = results[0]!;
  // Decrypt with the same format auth-core's encryptToken produces.
  // Local mirror in ./decrypt.ts — keeps the agent package's TS
  // type-resolution graph isolated from auth-core's transitive deps.
  const { decryptConnectorToken } = await import("./decrypt.js");
  const kek = (ctx.env as unknown as { CONNECTOR_TOKEN_KEY?: string }).CONNECTOR_TOKEN_KEY;
  if (!kek) throw new Error("CONNECTOR_TOKEN_KEY not configured on agent env");
  const token = await decryptConnectorToken(row.encrypted_token, kek);
  let scopes: string[] = [];
  try { scopes = JSON.parse(row.scopes); }
  catch { scopes = []; }
  return { connectorId: row.id, token, scopes };
}

async function ghFetch<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  // Restrict outbound to api.github.com. The earlier `startsWith("http")
  // → use as-is` shortcut was an SSRF / token-leak hazard if anyone
  // ever passed a caller-controlled path here (codex P2 SSRF MED).
  if (!path.startsWith("/")) {
    throw new Error(`ghFetch: path must start with '/' (got: ${path.slice(0, 40)})`);
  }
  const url = `${GITHUB_API}${path}`;
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Accept", "application/vnd.github+json");
  headers.set("X-GitHub-Api-Version", "2022-11-28");
  headers.set("User-Agent", USER_AGENT);
  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // Surface common failure modes in a shape the agent can read.
    if (res.status === 401) throw new Error(`github 401 (token invalid or revoked) — needs:reauth`);
    if (res.status === 403) {
      const reset = res.headers.get("x-ratelimit-reset");
      throw new Error(`github 403${reset ? ` rate-limited until ${new Date(Number(reset) * 1000).toISOString()}` : ""}: ${text.slice(0, 200)}`);
    }
    if (res.status === 404) throw new Error(`github 404: ${text.slice(0, 200)}`);
    throw new Error(`github ${res.status}: ${text.slice(0, 400)}`);
  }
  // Some endpoints (delete reactions etc) return 204.
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/**
 * Repo full-name regex — owner/repo with the standard GitHub character
 * set, BUT no leading dot in either segment. Without the no-leading-dot
 * guard, `..` (path traversal) sneaks through because both `.` and `-`
 * are individually legal. We also bound total length at 140 — GitHub
 * caps owner+name well below this.
 */
const REPO_NAME = z.string().regex(
  /^[A-Za-z0-9_-][A-Za-z0-9._-]*\/[A-Za-z0-9_-][A-Za-z0-9._-]*$/,
  "expected owner/repo format (no leading dot in either segment)",
).max(140);

export function githubTools(ctx: ToolDispatchCtx): ToolRegistry {
  return {
    github_list_repos: tool({
      description:
        "List repositories the connected GitHub user has access to. Returns owner/name and visibility. Paginated — pass `page` to fetch beyond the first 30.",
      inputSchema: z.object({
        page: z.number().int().positive().max(50).optional(),
      }),
      execute: async ({ page }) => {
        const c = await resolveGithubConnector(ctx);
        if (!c) return { error: "no GitHub connector enabled for this agent" };
        const repos = await ghFetch<Array<{
          full_name: string; private: boolean; description: string | null;
          html_url: string; default_branch: string;
        }>>(c.token, `/user/repos?per_page=30&page=${page ?? 1}&sort=updated`);
        return {
          repos: repos.map(r => ({
            fullName: r.full_name,
            private: r.private,
            description: r.description,
            url: r.html_url,
            defaultBranch: r.default_branch,
          })),
        };
      },
    }),

    github_get_file: tool({
      description:
        "Read a file from a repository at a given ref (branch / tag / sha). Returns decoded content + sha. Use `ref` to pin to a specific commit; defaults to the repo's default branch.",
      inputSchema: z.object({
        repo: REPO_NAME,
        path: z.string().min(1).max(2048),
        ref: z.string().min(1).max(128).optional(),
      }),
      execute: async ({ repo, path, ref }) => {
        const c = await resolveGithubConnector(ctx);
        if (!c) return { error: "no GitHub connector enabled for this agent" };
        // Validate: no leading slash, no dot segments. Without this,
        // `path="../../something"` after slash restoration could
        // escape /repos/owner/repo/contents/ into another endpoint
        // entirely (codex P2 HIGH finding). zod's regex would also
        // work; explicit check gives a clearer error.
        const segments = path.split("/");
        if (path.startsWith("/") || segments.some(s => s === "" || s === "." || s === "..")) {
          return { error: "invalid path: must be a workspace-relative file path with no dot segments" };
        }
        const q = ref ? `?ref=${encodeURIComponent(ref)}` : "";
        // Per-segment encodeURIComponent → join with literal slashes.
        // Safer than encodeURIComponent + replace(%2F→/), which makes
        // it harder to reason about edge cases.
        const encodedPath = segments.map(encodeURIComponent).join("/");
        const res = await ghFetch<{
          type: string; encoding: string; content: string; sha: string; size: number;
        }>(c.token, `/repos/${repo}/contents/${encodedPath}${q}`);
        if (res.type !== "file") {
          return { error: `path is not a file (type=${res.type})` };
        }
        if (res.encoding !== "base64") {
          return { error: `unsupported encoding ${res.encoding}` };
        }
        const content = atob(res.content);
        return { content, sha: res.sha, size: res.size };
      },
    }),

    github_create_issue: tool({
      description:
        "Create a new issue on a repository. Returns the created issue's number and URL.",
      inputSchema: z.object({
        repo: REPO_NAME,
        title: z.string().min(1).max(256),
        body: z.string().max(64_000).optional(),
        labels: z.array(z.string().min(1).max(50)).max(20).optional(),
      }),
      execute: async ({ repo, title, body, labels }) => {
        const c = await resolveGithubConnector(ctx);
        if (!c) return { error: "no GitHub connector enabled for this agent" };
        const created = await ghFetch<{ number: number; html_url: string }>(
          c.token,
          `/repos/${repo}/issues`,
          {
            method: "POST",
            body: JSON.stringify({ title, body, labels }),
          },
        );
        return { number: created.number, url: created.html_url };
      },
    }),

    github_comment_issue: tool({
      description:
        "Add a comment to an existing issue or PR. (PRs are issues in the GitHub model.)",
      inputSchema: z.object({
        repo: REPO_NAME,
        number: z.number().int().positive(),
        body: z.string().min(1).max(64_000),
      }),
      execute: async ({ repo, number, body }) => {
        const c = await resolveGithubConnector(ctx);
        if (!c) return { error: "no GitHub connector enabled for this agent" };
        const r = await ghFetch<{ id: number; html_url: string }>(
          c.token,
          `/repos/${repo}/issues/${number}/comments`,
          { method: "POST", body: JSON.stringify({ body }) },
        );
        return { commentId: r.id, url: r.html_url };
      },
    }),

    github_create_pr: tool({
      description:
        "Open a pull request against a base branch from a head branch. Both branches must already exist on the remote.",
      inputSchema: z.object({
        repo: REPO_NAME,
        title: z.string().min(1).max(256),
        head: z.string().min(1).max(128),    // source branch
        base: z.string().min(1).max(128),    // target branch (e.g. main)
        body: z.string().max(64_000).optional(),
        draft: z.boolean().optional(),
      }),
      execute: async ({ repo, title, head, base, body, draft }) => {
        const c = await resolveGithubConnector(ctx);
        if (!c) return { error: "no GitHub connector enabled for this agent" };
        const r = await ghFetch<{ number: number; html_url: string }>(
          c.token,
          `/repos/${repo}/pulls`,
          {
            method: "POST",
            body: JSON.stringify({ title, head, base, body, draft }),
          },
        );
        return { number: r.number, url: r.html_url };
      },
    }),

    github_list_pr_files: tool({
      description:
        "List the files changed in a pull request, with patch hunks. Use to review code without cloning the repo.",
      inputSchema: z.object({
        repo: REPO_NAME,
        number: z.number().int().positive(),
        // Cap how many files to return; PRs with thousands of files
        // would otherwise blow the token budget.
        limit: z.number().int().positive().max(100).optional(),
      }),
      execute: async ({ repo, number, limit }) => {
        const c = await resolveGithubConnector(ctx);
        if (!c) return { error: "no GitHub connector enabled for this agent" };
        const files = await ghFetch<Array<{
          filename: string; status: string; additions: number; deletions: number;
          changes: number; patch?: string; sha: string;
        }>>(c.token, `/repos/${repo}/pulls/${number}/files?per_page=${Math.min(limit ?? 30, 100)}`);
        return {
          files: files.map(f => ({
            filename: f.filename,
            status: f.status,
            additions: f.additions,
            deletions: f.deletions,
            // Trim per-file patch — agents can fetch individual files in full via github_get_file.
            patch: f.patch ? f.patch.slice(0, 8_000) : undefined,
            sha: f.sha,
          })),
        };
      },
    }),
  };
}

// Exports for tests
export { resolveGithubConnector, ghFetch, REPO_NAME };
