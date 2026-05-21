import { Hono } from "hono";
import { z } from "zod";
import { spawn } from "node:child_process";
import type { AppOptions, GrepMatch } from "../types.js";
import { resolveWithinWorkspace } from "../security.js";

/**
 * /grep and /glob — wrap ripgrep for fast, sane defaults.
 *
 * We shell out to `rg` instead of reimplementing search in Node because
 * (a) ripgrep is what Claude Code uses internally, so behaviour matches
 * user expectations, and (b) it's an order of magnitude faster on the
 * sizes of repo we'll encounter.
 *
 * Caller-supplied `pattern` and `path` are NEVER concatenated into a
 * shell string. We always pass them as argv entries so a pattern
 * containing shell metacharacters is harmless.
 */

const grepBody = z.object({
  pattern: z.string().min(1).max(4096),
  path: z.string().min(1).max(4096).optional(),
  /** Glob-include filter (e.g. "**\/*.ts"); passed to `rg -g`. */
  glob: z.string().max(256).optional(),
  /** When true, treat `pattern` as a fixed string (`rg -F`). Default false. */
  fixedString: z.boolean().optional(),
  /** When true, case-insensitive (`rg -i`). Default false. */
  ignoreCase: z.boolean().optional(),
  maxMatches: z.number().int().positive().max(1000).optional(),
});

const globBody = z.object({
  pattern: z.string().min(1).max(4096),
  path: z.string().min(1).max(4096).optional(),
  maxResults: z.number().int().positive().max(1000).optional(),
});

export function searchRoutes(opts: AppOptions) {
  const app = new Hono();

  app.post("/grep", async (c) => {
    const body = grepBody.parse(await c.req.json());
    const root = body.path
      ? resolveWithinWorkspace(opts.workspaceRoot, body.path)
      : opts.workspaceRoot;
    const max = body.maxMatches ?? 200;

    const args = ["--json", "--max-count", String(max), "--no-heading"];
    if (body.fixedString) args.push("-F");
    if (body.ignoreCase) args.push("-i");
    if (body.glob) args.push("-g", body.glob);
    args.push("--", body.pattern, root);

    const matches = await runRg(args);
    return c.json({ matches: matches.slice(0, max) });
  });

  app.post("/glob", async (c) => {
    const body = globBody.parse(await c.req.json());
    const root = body.path
      ? resolveWithinWorkspace(opts.workspaceRoot, body.path)
      : opts.workspaceRoot;
    const max = body.maxResults ?? 200;
    // `rg --files -g <pattern>` lists files matching a glob, honoring .gitignore.
    const args = ["--files", "-g", body.pattern, root];
    const paths = await runRgFiles(args, max);
    return c.json({ paths });
  });

  return app;
}

// ---------------------------------------------------------------------------
// Subprocess helpers
// ---------------------------------------------------------------------------

/** Hard cap on the JSON line buffer between newlines. ripgrep emits one
 *  JSON event per line; binary blobs or minified single-line files can
 *  blow past this — codex review flagged unbounded `buf` growth. We
 *  drop the buffer and kill rg if it ever exceeds.
 */
const RG_LINE_BUFFER_LIMIT = 1 * 1024 * 1024;   // 1 MiB per line

function runRg(args: string[]): Promise<GrepMatch[]> {
  return new Promise<GrepMatch[]>((resolve) => {
    const child = spawn("rg", args, { stdio: ["ignore", "pipe", "pipe"] });
    let buf = "";
    let killed = false;
    const matches: GrepMatch[] = [];
    child.stdout?.on("data", (chunk: Buffer) => {
      buf += chunk.toString("utf-8");
      if (buf.length > RG_LINE_BUFFER_LIMIT) {
        killed = true;
        try { child.kill("SIGTERM"); } catch { /* ignore */ }
        buf = "";
        return;
      }
      let nl = buf.indexOf("\n");
      while (nl !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        nl = buf.indexOf("\n");
        if (!line) continue;
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const evt = JSON.parse(line) as any;
          if (evt.type === "match") {
            matches.push({
              path: evt.data?.path?.text ?? "",
              line: evt.data?.line_number ?? 0,
              text: (evt.data?.lines?.text ?? "").replace(/\n$/, ""),
            });
          }
        } catch { /* malformed line, skip */ }
      }
    });
    // rg writes errors to stderr; we swallow because exit-code 1 = no match
    // (a normal outcome) and exit-code 2 = real error which we surface via empty result.
    child.on("close", () => resolve(matches));
    child.on("error", () => resolve(matches));
    void killed; // referenced for future stderr surfacing
  });
}

function runRgFiles(args: string[], max: number): Promise<string[]> {
  return new Promise<string[]>((resolve) => {
    const child = spawn("rg", args, { stdio: ["ignore", "pipe", "pipe"] });
    let buf = "";
    const paths: string[] = [];
    child.stdout?.on("data", (chunk: Buffer) => {
      buf += chunk.toString("utf-8");
      let nl = buf.indexOf("\n");
      while (nl !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        nl = buf.indexOf("\n");
        if (line) paths.push(line);
        if (paths.length >= max) {
          try { child.kill("SIGTERM"); } catch { /* ignore */ }
          break;
        }
      }
    });
    child.on("close", () => resolve(paths.slice(0, max)));
    child.on("error", () => resolve(paths));
  });
}
