import type { Ctx } from "./env";
import { log } from "./logger";

/**
 * Sliding-window rate limiter using KV. Counts requests in the most recent
 * `windowSeconds` seconds; if `>= max`, returns 429.
 *
 * KV is eventually consistent so this is best-effort, not exact, but the
 * window keeps drift bounded. On any KV error we fail OPEN — the
 * alternative (fail-closed) would 429 every request during a KV outage,
 * taking the whole API down. To make the trade-off observable, we emit
 * a structured warn so dashboards can alert when fail-open fires often.
 */
export async function rateLimit(
  c: Ctx,
  kind: string,
  key: string,
  max: number,
  windowSeconds: number,
): Promise<Response | null> {
  const kv: KVNamespace | undefined = c.env.RATE_LIMITS;
  if (!kv) {
    log(c, "warn", "ratelimit.kv_missing", { kind });
    return null;
  }
  const k = `rl:${kind}:${key}`;
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - windowSeconds;
  let arr: number[] = [];
  let read_failed = false;
  try {
    const raw = await kv.get(k, { type: "json" });
    if (Array.isArray(raw)) arr = raw.filter((t: unknown) => typeof t === "number" && t > cutoff);
  } catch (e) {
    read_failed = true;
    log(c, "warn", "ratelimit.kv_read_failed", {
      kind,
      error: e instanceof Error ? e.message : String(e),
    });
  }
  if (arr.length >= max) {
    return c.json({ error: { code: "RATE_LIMITED", message: `too many ${kind} attempts, retry later` } }, 429);
  }
  if (!read_failed) {
    arr.push(now);
    c.executionCtx.waitUntil(
      kv.put(k, JSON.stringify(arr), { expirationTtl: windowSeconds * 2 }).catch((e) => {
        log(c, "warn", "ratelimit.kv_write_failed", {
          kind,
          error: e instanceof Error ? e.message : String(e),
        });
      }),
    );
  }
  return null;
}

export function clientIp(c: Ctx): string {
  return c.req.header("cf-connecting-ip")
    || c.req.header("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown";
}
