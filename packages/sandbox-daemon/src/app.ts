import { Hono } from "hono";
import { timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import type { AppOptions } from "./types.js";
import { fileRoutes } from "./handlers/file.js";
import { bashRoutes } from "./handlers/bash.js";
import { searchRoutes } from "./handlers/search.js";
import { gitRoutes } from "./handlers/git.js";

/**
 * Build the daemon Hono app. Pure function — no global state, no env
 * lookup — so tests can spin up an isolated instance per case.
 *
 * Routing:
 *   GET  /health           → liveness probe (no auth)
 *   POST /file/{read,write,edit,list}
 *   POST /bash/exec
 *   POST /grep, /glob
 *   POST /git/{clone,commit,push,status}
 *
 * All non-/health routes require `Authorization: Bearer <bearerToken>`.
 */
export function createApp(opts: AppOptions): Hono {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true, ts: Date.now() }));

  app.use("*", async (c, next) => {
    if (c.req.path === "/health") return next();
    const auth = c.req.header("authorization") ?? "";
    if (!auth.startsWith("Bearer ")) {
      return c.json({ error: { code: "UNAUTHORIZED", message: "bearer required" } }, 401);
    }
    const supplied = Buffer.from(auth.slice("Bearer ".length));
    const expected = Buffer.from(opts.bearerToken);
    // Reject on length mismatch BEFORE timingSafeEqual (which throws on
    // unequal-length buffers). Mismatched length also leaks 0 information.
    if (supplied.byteLength !== expected.byteLength || !timingSafeEqual(supplied, expected)) {
      return c.json({ error: { code: "UNAUTHORIZED", message: "bad bearer" } }, 401);
    }
    return next();
  });

  // Centralized error handler — daemon must never crash on a bad request.
  // Errors that carry a `.status` (zod's ZodError, our PathError, fs ENOENT
  // we annotate at the boundary) map to that status; everything else 500.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.onError((err: any, c) => {
    let status: number = err?.status ?? 500;
    let code = "INTERNAL";
    let message = err instanceof Error ? err.message : String(err);
    if (err?.name === "ZodError") {
      status = 400;
      code = "INVALID";
      // zod errors are verbose; flatten to first issue for the agent.
      const first = err.issues?.[0];
      message = first ? `${first.path?.join(".") ?? "(body)"}: ${first.message}` : "invalid request";
    } else if (err?.name === "PathError") {
      status = 400;
      code = "INVALID_PATH";
    } else if (status !== 500) {
      code = "BAD_REQUEST";
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return c.json({ error: { code, message } }, status as any);
  });

  app.route("/file", fileRoutes(opts));
  app.route("/bash", bashRoutes(opts));
  app.route("/git",  gitRoutes(opts));
  // /grep, /glob live at top level (not under /search/) to match the agent's
  // intuition — they're invoked as standalone tools.
  app.route("/",     searchRoutes(opts));

  return app;
}
