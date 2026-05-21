import { Hono } from "hono";
import { z } from "zod";
import { spawn } from "node:child_process";
import type { AppOptions, BashResult } from "../types.js";
import { resolveWithinWorkspace } from "../security.js";
import { buildChildEnv } from "../env.js";

/**
 * /bash/exec — run a command inside the workspace.
 *
 * Security boundary:
 *   - We DO pass user-supplied command through a shell (`bash -lc`) because
 *     agents legitimately want pipes, env vars, glob expansion. The
 *     container itself is the isolation layer — daemon has no host
 *     access, /workspace is the only writable mount.
 *   - We DO cap output size and wall-clock time per invocation.
 *   - We DO refuse if `cwd` escapes the workspace root.
 */

const bashBody = z.object({
  command: z.string().min(1).max(64 * 1024),  // 64 KB upper bound on script body
  cwd: z.string().min(1).max(4096).optional(),
  env: z.record(z.string()).optional(),
  /** Per-invocation override (cannot exceed daemon default). */
  timeoutMs: z.number().int().positive().max(600_000).optional(),
});

const DEFAULT_OUTPUT_LIMIT = 1 * 1024 * 1024;   // 1 MiB stdout / stderr cap

export function bashRoutes(opts: AppOptions) {
  const app = new Hono();
  const defaultTimeoutMs = opts.bashTimeoutMs ?? 30_000;
  const maxBytes = opts.maxResponseBytes ?? DEFAULT_OUTPUT_LIMIT;

  app.post("/exec", async (c) => {
    const body = bashBody.parse(await c.req.json());
    const cwd = body.cwd
      ? resolveWithinWorkspace(opts.workspaceRoot, body.cwd)
      : opts.workspaceRoot;
    const timeoutMs = Math.min(body.timeoutMs ?? defaultTimeoutMs, defaultTimeoutMs);

    const result = await runBash({
      command: body.command,
      cwd,
      env: body.env,
      timeoutMs,
      maxBytes,
    });
    return c.json(result);
  });

  return app;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

interface RunOpts {
  command: string;
  cwd: string;
  env?: Record<string, string>;
  timeoutMs: number;
  maxBytes: number;
}

function runBash(opts: RunOpts): Promise<BashResult> {
  return new Promise<BashResult>((resolve) => {
    const started = Date.now();
    // `bash -lc` so login dotfiles apply (PATH, NVM, pyenv). The agent
    // expects "Bash" tool semantics from Claude Code, which uses
    // /bin/bash -c on POSIX. Daemon secrets scrubbed in buildChildEnv.
    const child = spawn("/bin/bash", ["-lc", opts.command], {
      cwd: opts.cwd,
      env: buildChildEnv(opts.env),
      stdio: ["ignore", "pipe", "pipe"],
      // Spawn in a new process group so SIGTERM/SIGKILL on timeout
      // reaches the whole tree (subshells, pipelines) not just bash.
      detached: true,
    });

    let stdoutBytes = 0;
    let stderrBytes = 0;
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let truncated = false;

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdoutBytes >= opts.maxBytes) { truncated = true; return; }
      const room = opts.maxBytes - stdoutBytes;
      if (chunk.byteLength <= room) {
        stdoutChunks.push(chunk);
        stdoutBytes += chunk.byteLength;
      } else {
        stdoutChunks.push(chunk.subarray(0, room));
        stdoutBytes += room;
        truncated = true;
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderrBytes >= opts.maxBytes) { truncated = true; return; }
      const room = opts.maxBytes - stderrBytes;
      if (chunk.byteLength <= room) {
        stderrChunks.push(chunk);
        stderrBytes += chunk.byteLength;
      } else {
        stderrChunks.push(chunk.subarray(0, room));
        stderrBytes += room;
        truncated = true;
      }
    });

    let timedOut = false;
    const killGroup = (sig: NodeJS.Signals) => {
      // Negative PID = whole process group (we set `detached: true`).
      // Catches subshells, pipelines, anything the bash command spawned.
      try { if (child.pid) process.kill(-child.pid, sig); }
      catch { /* group gone already */ }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup("SIGTERM");
      setTimeout(() => killGroup("SIGKILL"), 1000);
    }, opts.timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timer);
      const out = Buffer.concat(stdoutChunks).toString("utf-8");
      const err = Buffer.concat(stderrChunks).toString("utf-8");
      resolve({
        exitCode: code ?? -1,
        stdout: truncated ? out + "\n[...truncated]" : out,
        stderr: truncated ? err + "\n[...truncated]" : err,
        timedOut,
        durationMs: Date.now() - started,
      });
    });

    child.on("error", (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      resolve({
        exitCode: -1,
        stdout: "",
        stderr: `spawn failed: ${e.code ?? ""} ${e.message}`,
        timedOut: false,
        durationMs: Date.now() - started,
      });
    });
  });
}
