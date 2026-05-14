import type { Ctx } from "./env";

/**
 * Sliding-window rate limiter using KV. Counts requests in the most recent
 * `windowSeconds` seconds; if `>= max`, returns 429.
 *
 * KV is eventually consistent so this is best-effort, not exact, but the
 * window keeps drift bounded.
 */
export async function rateLimit(
  c: Ctx,
  kind: string,
  key: string,
  max: number,
  windowSeconds: number,
): Promise<Response | null> {
  const kv: KVNamespace | undefined = c.env.RATE_LIMITS;
  if (!kv) return null;
  const k = `rl:${kind}:${key}`;
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - windowSeconds;
  let arr: number[] = [];
  try {
    const raw = await kv.get(k, { type: "json" });
    if (Array.isArray(raw)) arr = raw.filter((t: unknown) => typeof t === "number" && t > cutoff);
  } catch { /* fail open */ }
  if (arr.length >= max) {
    return c.json({ error: { code: "RATE_LIMITED", message: `too many ${kind} attempts, retry later` } }, 429);
  }
  arr.push(now);
  c.executionCtx.waitUntil(kv.put(k, JSON.stringify(arr), { expirationTtl: windowSeconds * 2 }));
  return null;
}

export function clientIp(c: Ctx): string {
  return c.req.header("cf-connecting-ip")
    || c.req.header("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown";
}
