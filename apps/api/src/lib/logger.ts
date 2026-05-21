/**
 * Structured request logger middleware for Hono on Cloudflare Workers.
 *
 * Emits one JSON line per request. Fields are kept stable so downstream
 * log aggregation (CF Workers Logs, Sentry breadcrumbs, dashboards) can
 * filter and group reliably.
 *
 * Shape:
 *   { ts, level, msg, request_id, method, path, status, dur_ms,
 *     user_id?, workspace_id?, subject_kind?, ip?, ray_id?, ua? }
 *
 * Why JSON not text:
 *   Cloudflare Workers Logpush ships logs as JSON anyway. Emitting JSON
 *   from the application means every line is queryable without regex —
 *   GROUP BY user_id, etc. Plain `console.log("foo", obj)` produces a
 *   line that's hard to slice.
 *
 * Why not pino:
 *   pino requires Node async hooks which Workers don't have. A 60-line
 *   home-grown logger is enough and pulls zero dependencies.
 *
 * Sampling:
 *   Workers prints up to 64KB of log per invocation. At our traffic,
 *   logging every request is fine. We add a `sample` toggle for noise
 *   sources (health checks) — see `c.set("log_skip", true)`.
 */
import type { MiddlewareHandler } from "hono";
import type { Variables } from "./env";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogLine {
  ts: string;
  level: LogLevel;
  msg: string;
  request_id?: string;
  method?: string;
  path?: string;
  status?: number;
  dur_ms?: number;
  user_id?: string;
  workspace_id?: string;
  subject_kind?: "user" | "machine";
  ip?: string;
  ray_id?: string;
  ua?: string;
  [k: string]: unknown;
}

/**
 * Circular-ref-safe replacer for JSON.stringify. Without this, a handler
 * that calls `log(c, "info", "x", { err })` with an Error whose `cause`
 * chains back to itself (or with a Request/Response object) crashes
 * the logger mid-emit, which in the request-error path means the worker
 * returns a generic 500 with no logs and no x-request-id. Capture the
 * shape rather than the live reference.
 */
function safeStringify(line: LogLine): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(line, (_key, value) => {
    if (value instanceof Error) {
      // Built-in serialisation drops name/stack; include them explicitly.
      return {
        name: value.name,
        message: value.message,
        stack: value.stack,
        ...(value.cause !== undefined ? { cause: String(value.cause) } : {}),
      };
    }
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) return "[Circular]";
      seen.add(value);
    }
    return value;
  });
}

function emit(line: LogLine): void {
  // CF Workers' console.log goes straight to Logpush / tail. Keep it as
  // a single JSON line per call so downstream parsers don't need to
  // multiline-merge. Wrap in try/catch — if the replacer somehow still
  // produces a value that can't serialise, fall back to a minimal line
  // so we get SOME signal instead of a thrown error inside the logger.
  let out: string;
  try {
    out = safeStringify(line);
  } catch (e) {
    out = JSON.stringify({
      ts: new Date().toISOString(),
      level: "error",
      msg: "logger.serialize_failed",
      original_msg: line.msg,
      error: e instanceof Error ? e.message : String(e),
    });
  }
  if (line.level === "error" || line.level === "warn") {
    // eslint-disable-next-line no-console
    console.error(out);
  } else {
    // eslint-disable-next-line no-console
    console.log(out);
  }
}

/** Public — call from inside a handler to log a custom event with the
 *  request context already attached. */
export function log(
  c: { get<K extends keyof Variables>(k: K): Variables[K] | undefined },
  level: LogLevel,
  msg: string,
  fields: Record<string, unknown> = {},
): void {
  const ctx = (c.get as (k: string) => unknown)("log_ctx") as Partial<LogLine> | undefined;
  emit({
    ts: new Date().toISOString(),
    level,
    msg,
    ...(ctx ?? {}),
    ...fields,
  });
}

/** Hono middleware. Mounts on every request, logs once at end. */
export function loggerMiddleware(): MiddlewareHandler<{ Variables: Variables }> {
  return async (c, next) => {
    const start = Date.now();
    const request_id = crypto.randomUUID();
    const url = new URL(c.req.url);

    // Pre-stash context so individual handlers can log against it via
    // `log(c, "info", "agent.spawned", { agent_id })` without re-deriving
    // request_id / method / path each time.
    const baseCtx: Partial<LogLine> = {
      request_id,
      method: c.req.method,
      path: url.pathname,
      ip: c.req.header("cf-connecting-ip") || undefined,
      ray_id: c.req.header("cf-ray") || undefined,
      ua: c.req.header("user-agent")?.slice(0, 200) || undefined,
    };
    // Stash via Hono's `c.set` — Variables type extended in env.ts.
    (c.set as (k: string, v: unknown) => void)("log_ctx", baseCtx);

    // Surface the request_id back to the client so support requests can
    // be cross-referenced against logs.
    c.header("x-request-id", request_id);

    let status = 500;
    try {
      await next();
      status = c.res.status;
    } catch (err) {
      // Re-throw so app.onError can format the response, but log the
      // raw failure here with the request context attached.
      emit({
        ts: new Date().toISOString(),
        level: "error",
        msg: "request.unhandled_error",
        ...baseCtx,
        error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : String(err),
        dur_ms: Date.now() - start,
      });
      throw err;
    }

    // Pull subject identity if a handler resolved one (auth middleware sets it).
    const subject = (c.get as (k: string) => unknown)("subject") as
      | { kind: "user" | "machine"; userId: string; serverId?: string }
      | undefined;

    // Skip noisy paths from the access log (still goes via console for
    // tail-driven debugging, but we silence the JSON emit).
    const skip = (c.get as (k: string) => unknown)("log_skip") as boolean | undefined;
    if (skip || url.pathname === "/health") return;

    emit({
      ts: new Date().toISOString(),
      level: status >= 500 ? "error" : status >= 400 ? "warn" : "info",
      msg: "request",
      ...baseCtx,
      status,
      dur_ms: Date.now() - start,
      user_id: subject?.userId,
      workspace_id: subject?.serverId,
      subject_kind: subject?.kind,
    });
  };
}
