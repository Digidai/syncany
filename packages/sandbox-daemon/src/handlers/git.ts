import { Hono } from "hono";
import { z } from "zod";
import { spawn } from "node:child_process";
import type { AppOptions, GitResult } from "../types.js";
import { resolveWithinWorkspace } from "../security.js";
import { buildChildEnv } from "../env.js";

/**
 * Refs / remotes / branches that start with `-` would be interpreted by
 * git as options (e.g. `--exec=evil-script`). zod regex blocks them at
 * the parse boundary; we also re-check at runtime in case bypass.
 */
const safeRefName = z.string()
  .min(1)
  .max(256)
  .regex(/^[^-][A-Za-z0-9._/+:-]*$/, "ref must not start with '-'");

/**
 * /git/* — clone / commit / push helpers.
 *
 * We DON'T accept raw `args` from the agent (avoids `--exec` and friends).
 * Each route exposes a narrow shape and constructs argv server-side.
 *
 * Credentials: token is provided per-call, NEVER stored in the workspace
 * .git/config. We inject via the `GIT_ASKPASS` environment trick so the
 * token doesn't appear in `git remote -v` output later.
 */

const cloneBody = z.object({
  url: z.string().url(),
  path: z.string().min(1).max(4096),
  token: z.string().min(1).max(512).optional(),
  depth: z.number().int().positive().max(1000).optional(),
});

const commitBody = z.object({
  path: z.string().min(1).max(4096),
  message: z.string().min(1).max(4096),
  authorName: z.string().min(1).max(128).optional(),
  authorEmail: z.string().email().max(256).optional(),
  /** When omitted, stages all changes (`git add -A`). */
  files: z.array(z.string().min(1).max(4096)).max(1000).optional(),
});

const pushBody = z.object({
  path: z.string().min(1).max(4096),
  remote: safeRefName.optional(),
  branch: safeRefName.optional(),
  token: z.string().min(1).max(512).optional(),
});

const statusBody = z.object({
  path: z.string().min(1).max(4096),
});

export function gitRoutes(opts: AppOptions) {
  const app = new Hono();

  app.post("/clone", async (c) => {
    const body = cloneBody.parse(await c.req.json());
    const target = resolveWithinWorkspace(opts.workspaceRoot, body.path);
    const args = ["clone"];
    if (body.depth) args.push("--depth", String(body.depth));
    args.push(body.url, target);
    const result = await runGit(args, { cwd: opts.workspaceRoot, token: body.token });
    return c.json(result);
  });

  app.post("/commit", async (c) => {
    const body = commitBody.parse(await c.req.json());
    const cwd = resolveWithinWorkspace(opts.workspaceRoot, body.path);
    if (body.files) {
      // Stage each file individually to keep argv predictable.
      for (const f of body.files) {
        const abs = resolveWithinWorkspace(cwd, f);
        const add = await runGit(["add", "--", abs], { cwd });
        if (!add.ok) return c.json(add, 500);
      }
    } else {
      const add = await runGit(["add", "-A"], { cwd });
      if (!add.ok) return c.json(add, 500);
    }
    const env: Record<string, string> = {};
    if (body.authorName)  env.GIT_AUTHOR_NAME = body.authorName;
    if (body.authorEmail) env.GIT_AUTHOR_EMAIL = body.authorEmail;
    if (body.authorName)  env.GIT_COMMITTER_NAME = body.authorName;
    if (body.authorEmail) env.GIT_COMMITTER_EMAIL = body.authorEmail;
    const result = await runGit(["commit", "-m", body.message], { cwd, env });
    if (result.ok) {
      const sha = await runGit(["rev-parse", "HEAD"], { cwd });
      result.sha = sha.output.trim();
    }
    return c.json(result);
  });

  app.post("/push", async (c) => {
    const body = pushBody.parse(await c.req.json());
    const cwd = resolveWithinWorkspace(opts.workspaceRoot, body.path);
    const args = ["push"];
    if (body.remote) args.push(body.remote);
    if (body.branch) args.push(body.branch);
    const result = await runGit(args, { cwd, token: body.token });
    return c.json(result);
  });

  app.post("/status", async (c) => {
    const body = statusBody.parse(await c.req.json());
    const cwd = resolveWithinWorkspace(opts.workspaceRoot, body.path);
    const result = await runGit(["status", "--porcelain=v1"], { cwd });
    return c.json(result);
  });

  return app;
}

// ---------------------------------------------------------------------------
// git runner
// ---------------------------------------------------------------------------

interface GitOpts {
  cwd: string;
  env?: Record<string, string>;
  token?: string;
}

/**
 * Inject the token via an ephemeral credential helper without touching
 * .git/config or embedding it in the remote URL.
 *
 * Resource controls (codex review):
 *   - Output capped at GIT_OUTPUT_LIMIT bytes (1 MiB), to bound memory.
 *   - Wall-clock timeout via SIGTERM → SIGKILL on the process GROUP, so
 *     subprocess children (hooks, ssh, gpg) are also killed.
 *   - Env scrubbed via buildChildEnv() so daemon's RALTIC_SANDBOX_TOKEN
 *     never leaks to repo hooks (e.g. a malicious post-commit hook in a
 *     freshly cloned untrusted repo could otherwise read it).
 *   - core.hooksPath=/dev/null on daemon-managed ops disables repo hooks.
 */
const GIT_OUTPUT_LIMIT = 1 * 1024 * 1024;
const GIT_TIMEOUT_MS = 60_000;

function runGit(args: string[], opts: GitOpts): Promise<GitResult> {
  return new Promise<GitResult>((resolve) => {
    const extraEnv: Record<string, string> = {
      ...(opts.env ?? {}),
      // Force non-interactive: no terminal prompts that would hang the spawn.
      GIT_TERMINAL_PROMPT: "0",
    };
    // If a token was passed, expose it through the credential helper only
    // for this single git invocation. Note buildChildEnv strips
    // GIT_ASKPASS_TOKEN from the inherited env, so we have to re-add it
    // here AFTER scrubbing — meaning ONLY this git child sees it, never
    // the bash handler or future tools.
    if (opts.token) {
      extraEnv.GIT_ASKPASS_TOKEN = opts.token;
    }
    const baseArgs: string[] = [
      // Daemon-managed git ops never run untrusted repo hooks. Without
      // this a freshly-cloned repo's post-checkout hook would execute
      // with the daemon's privileges (cwd, FS, network).
      "-c", "core.hooksPath=/dev/null",
    ];
    if (opts.token) {
      baseArgs.push(
        "-c",
        `credential.helper=!f() { echo "username=x-access-token"; echo "password=$GIT_ASKPASS_TOKEN"; }; f`,
      );
    }
    const finalArgs = [...baseArgs, ...args];

    const env = buildChildEnv(extraEnv);
    const child = spawn("git", finalArgs, {
      cwd: opts.cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,            // new process group for clean kill
    });

    let outBytes = 0;
    let errBytes = 0;
    let truncated = false;
    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];

    function captureInto(target: Buffer[], chunk: Buffer, currentBytes: number, set: (n: number) => void) {
      if (currentBytes >= GIT_OUTPUT_LIMIT) { truncated = true; return; }
      const room = GIT_OUTPUT_LIMIT - currentBytes;
      if (chunk.byteLength <= room) {
        target.push(chunk);
        set(currentBytes + chunk.byteLength);
      } else {
        target.push(chunk.subarray(0, room));
        set(currentBytes + room);
        truncated = true;
      }
    }

    child.stdout?.on("data", (c: Buffer) => captureInto(outChunks, c, outBytes, (n) => { outBytes = n; }));
    child.stderr?.on("data", (c: Buffer) => captureInto(errChunks, c, errBytes, (n) => { errBytes = n; }));

    let timedOut = false;
    const killGroup = (sig: NodeJS.Signals) => {
      try { if (child.pid) process.kill(-child.pid, sig); }
      catch { /* group gone */ }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup("SIGTERM");
      setTimeout(() => killGroup("SIGKILL"), 1000);
    }, GIT_TIMEOUT_MS);

    child.on("close", (code) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(outChunks).toString("utf-8");
      const stderr = Buffer.concat(errChunks).toString("utf-8");
      let output = stdout || stderr;
      if (truncated) output += "\n[...truncated]";
      if (timedOut) output += `\n[git: timed out after ${GIT_TIMEOUT_MS}ms]`;
      resolve({
        ok: code === 0,
        output,
      });
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ ok: false, output: `git spawn failed: ${e.message}` });
    });
  });
}
