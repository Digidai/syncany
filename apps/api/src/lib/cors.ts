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
    const allowed = [c.env.WEB_ORIGIN, "http://localhost:3000"].filter(Boolean);
    return cors({
      origin: (origin) => (origin && allowed.includes(origin) ? origin : null),
      credentials: true,
      allowHeaders: ["content-type", "authorization", "x-internal-secret"],
    })(c, next);
  };
}
