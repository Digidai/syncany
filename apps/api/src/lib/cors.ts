import { cors } from "hono/cors";
import type { MiddlewareHandler } from "hono";
import type { Env, Variables } from "./env";

/**
 * CORS gate. Only allow our own web origin (and localhost during dev).
 * Bridge / CLI use Bearer auth; they don't trigger CORS preflight.
 *
 * /ws/* is excluded — WebSocket upgrades aren't subject to CORS, and
 * adding non-WebSocket headers to a 101 response breaks Node's WS client.
 */
export function corsMiddleware(): MiddlewareHandler<{ Bindings: Env; Variables: Variables }> {
  return async (c, next) => {
    if (c.req.path.startsWith("/ws/")) return next();
    // Production allowlist = WEB_ORIGIN only. Allowing localhost:3000 in
    // prod would let any locally-running page read CORS responses with
    // credentials; harmless today because API is bearer-auth, but a
    // footgun the moment we add a cookie-backed endpoint.
    //
    // Fail-closed when WEB_ORIGIN is unset / not http(s) — we'd rather
    // break cleanly than silently allow localhost on a misconfigured env.
    const webOrigin = c.env.WEB_ORIGIN;
    const allowLocalhost = webOrigin !== undefined && webOrigin.startsWith("http://");
    const allowed = [
      webOrigin,
      ...(allowLocalhost ? ["http://localhost:3000"] : []),
    ].filter(Boolean);
    return cors({
      origin: (origin) => (origin && allowed.includes(origin) ? origin : null),
      credentials: true,
      allowHeaders: ["content-type", "authorization", "x-internal-secret"],
    })(c, next);
  };
}
