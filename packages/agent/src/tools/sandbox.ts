/**
 * Sandbox-backed tools — file system, bash, search, git.
 *
 * Each tool lazy-allocates the per-Agent container on first use via
 * `ctx.ensureSandbox()`. Subsequent calls re-use the cached client
 * (`ctx.sandbox`). This means Connector-only agents pay zero compute
 * for the sandbox until they actually need it.
 */
import { tool } from "ai";
import { z } from "zod";
import type { ToolDispatchCtx, ToolRegistry } from "./registry.js";

async function need(ctx: ToolDispatchCtx) {
  if (ctx.sandbox) return ctx.sandbox;
  return ctx.ensureSandbox();
}

/**
 * Detect whether a path touches /workspace/.memory/ in any form a
 * prompt-injected agent could craft. The string-level guard for the
 * memory reserved area, in addition to the daemon's path-resolution
 * check (defense in depth). Codex final-review HIGH: the prior naive
 * `startsWith("/workspace/.memory/")` was bypassable via:
 *   - traversal:  /workspace/x/../.memory/foo
 *   - case-fold:  /workspace/.Memory/foo (Daemon FS may be case-
 *                 insensitive on macOS dev hosts; container Alpine FS
 *                 is case-sensitive but we don't want to depend on that.)
 *   - double slash: /workspace//.memory/foo
 *
 * Strategy: normalize via segment-walking (resolve ".." stack-style,
 * drop "." and empty segments), then case-insensitive scan for any
 * segment named ".memory".
 */
function touchesMemoryDir(rawPath: string): boolean {
  if (!rawPath) return false;
  const segments: string[] = [];
  for (const seg of rawPath.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (segments.length > 0) segments.pop();
      continue;
    }
    segments.push(seg);
  }
  // Match `.memory` case-insensitively as a path component anywhere
  // under workspace. The agent-side check is intentionally strict —
  // the daemon will still reject paths that escape /workspace via
  // resolveSafeForFs, so we don't have to be paranoid about absolute
  // paths to other locations (those just hit the daemon's guard).
  return segments.some(s => s.toLowerCase() === ".memory");
}

export function sandboxTools(ctx: ToolDispatchCtx): ToolRegistry {
  return {
    file_read: tool({
      description:
        "Read a file from the agent's workspace. Returns full content for files up to ~5 MiB; larger files are truncated with `truncated: true`. Pass `encoding: 'base64'` for binary.",
      inputSchema: z.object({
        path: z.string().min(1).max(4096),
        encoding: z.enum(["utf-8", "base64"]).optional(),
      }),
      execute: async ({ path, encoding }) =>
        (await need(ctx)).fileRead(path, encoding ?? "utf-8"),
    }),

    file_write: tool({
      description:
        "Write (or overwrite) a file in the agent's workspace. Creates intermediate directories as needed. Max 5 MiB. " +
        "Note: paths under `/workspace/.memory/` are reserved for the memory_* tools; use memory_remember to store notes there.",
      inputSchema: z.object({
        path: z.string().min(1).max(4096),
        content: z.string(),
        encoding: z.enum(["utf-8", "base64"]).optional(),
      }),
      execute: async ({ path, content, encoding }) => {
        if (touchesMemoryDir(path)) {
          throw new Error(
            "file_write refused: /workspace/.memory/ is reserved — use memory_remember instead",
          );
        }
        return (await need(ctx)).fileWrite(path, content, encoding ?? "utf-8");
      },
    }),

    file_edit: tool({
      description:
        "Edit a file by replacing `oldStr` with `newStr`. Match must be unique unless `replaceAll: true`.",
      inputSchema: z.object({
        path: z.string().min(1).max(4096),
        oldStr: z.string().min(1),
        newStr: z.string(),
        replaceAll: z.boolean().optional(),
      }),
      execute: async ({ path, oldStr, newStr, replaceAll }) => {
        if (touchesMemoryDir(path)) {
          throw new Error(
            "file_edit refused: /workspace/.memory/ is reserved — use memory_remember/forget instead",
          );
        }
        return (await need(ctx)).fileEdit(path, oldStr, newStr, replaceAll);
      },
    }),

    file_list: tool({
      description: "List immediate entries in a workspace directory.",
      inputSchema: z.object({ path: z.string().min(1).max(4096) }),
      execute: async ({ path }) => (await need(ctx)).fileList(path),
    }),

    bash_exec: tool({
      description:
        "Run a shell command in the agent's workspace. Pipes / env / redirects work. Output capped 1 MiB; per-tier wall-clock timeout.",
      inputSchema: z.object({
        command: z.string().min(1).max(64 * 1024),
        cwd: z.string().min(1).max(4096).optional(),
        timeoutMs: z.number().int().positive().max(600_000).optional(),
      }),
      execute: async ({ command, cwd, timeoutMs }) => {
        const client = await need(ctx);
        const result = await client.bashExec(command, {
          ...(cwd ? { cwd } : {}),
          ...(timeoutMs ? { timeoutMs } : {}),
        });
        // Mirror output into the agent's terminal ring buffer so the
        // Workspace pane has something to render. Best-effort — a ring
        // write failure must NOT mask the actual bash result.
        const frame = [
          `$ ${command}`,
          result.stdout ?? "",
          result.stderr ? `[stderr] ${result.stderr}` : "",
        ].filter(Boolean).join("\n") + "\n";
        try { await ctx.appendTerminal(frame); } catch { /* swallow */ }
        return result;
      },
    }),

    grep: tool({
      description:
        "Fast text search across files (ripgrep). Honors .gitignore. `glob` scopes (e.g. '**/*.ts'). `fixedString: true` for literal.",
      inputSchema: z.object({
        pattern: z.string().min(1).max(4096),
        path: z.string().min(1).max(4096).optional(),
        glob: z.string().max(256).optional(),
        fixedString: z.boolean().optional(),
        ignoreCase: z.boolean().optional(),
        maxMatches: z.number().int().positive().max(1000).optional(),
      }),
      execute: async (params) => (await need(ctx)).grep(params.pattern, params),
    }),

    glob: tool({
      description:
        "List files matching a glob (e.g. '**/*.ts'). Honors .gitignore.",
      inputSchema: z.object({
        pattern: z.string().min(1).max(4096),
        path: z.string().min(1).max(4096).optional(),
        maxResults: z.number().int().positive().max(1000).optional(),
      }),
      execute: async (params) => (await need(ctx)).glob(params.pattern, params),
    }),

    git_clone: tool({
      description: "Clone a git repo into a workspace path. `depth` for shallow. `token` for private (never persisted).",
      inputSchema: z.object({
        url: z.string().url(),
        path: z.string().min(1).max(4096),
        token: z.string().min(1).max(512).optional(),
        depth: z.number().int().positive().max(1000).optional(),
      }),
      execute: async (params) => (await need(ctx)).gitClone(params.url, params.path, params),
    }),

    git_commit: tool({
      description: "Stage and commit changes in a workspace repo. Without `files`, stages everything.",
      inputSchema: z.object({
        path: z.string().min(1).max(4096),
        message: z.string().min(1).max(4096),
        authorName: z.string().min(1).max(128).optional(),
        authorEmail: z.string().email().max(256).optional(),
        files: z.array(z.string().min(1).max(4096)).max(1000).optional(),
      }),
      execute: async (params) => (await need(ctx)).gitCommit(params.path, params.message, params),
    }),

    git_push: tool({
      description: "Push commits from a workspace repo. `remote`/`branch` must not start with '-'.",
      inputSchema: z.object({
        path: z.string().min(1).max(4096),
        remote: z.string().regex(/^[^-][A-Za-z0-9._/+:-]*$/).max(128).optional(),
        branch: z.string().regex(/^[^-][A-Za-z0-9._/+:-]*$/).max(256).optional(),
        token: z.string().min(1).max(512).optional(),
      }),
      execute: async (params) => (await need(ctx)).gitPush(params.path, params),
    }),

    git_status: tool({
      description: "Show porcelain git status of a workspace repo.",
      inputSchema: z.object({ path: z.string().min(1).max(4096) }),
      execute: async ({ path }) => (await need(ctx)).gitStatus(path),
    }),
  };
}
