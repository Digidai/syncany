import { NextResponse } from "next/server";

/**
 * Beacon sink for marketing events.
 *
 * Phase 5 MVP: log to console (visible in `wrangler tail`) so we can
 * eyeball the funnel during private beta. When volume justifies it,
 * upgrade to write into a CF Analytics Engine dataset or a D1 table.
 *
 * Schema accepted (loose — we drop fields we don't expect):
 *   { event: "landing_view"|"cta_click"|...,
 *     path: string,
 *     target?: string,
 *     referrer?: string|null,
 *     utm?: Record<string,string>,
 *     ts: number }
 *
 * No auth required; no PII collected; this endpoint is open to
 * unauth'd visitors by design. Body size cap defends against abuse.
 */
const MAX_BODY = 2048;
const ALLOWED_EVENTS = new Set([
  "landing_view",
  "cta_click",
  "runtime_card_click",
  "wizard_start",
  "cloud_agent_start",
]);
const ALLOWED_UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;
const MAX_UTM_VALUE_LEN = 64;

/**
 * Reject early on Content-Length so we don't even allocate a buffer for
 * oversize bodies — defends against an attacker streaming 100MB at our
 * worker. The string-length check below is a defense-in-depth for
 * clients that omit the header. Codex review MED.
 */
function isBodyTooLarge(req: Request): boolean {
  const cl = req.headers.get("content-length");
  if (cl) {
    const n = Number(cl);
    if (Number.isFinite(n) && n > MAX_BODY) return true;
  }
  return false;
}

export async function POST(req: Request): Promise<Response> {
  // Content-type whitelist — beacons from <MarketingTracking /> always
  // send application/json. Anything else is likely abuse.
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) return new NextResponse(null, { status: 415 });
  if (isBodyTooLarge(req)) return new NextResponse(null, { status: 413 });

  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY) return new NextResponse(null, { status: 413 });
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    // Event must be on the allowlist — prevents log/metric poisoning
    // with arbitrary attacker-chosen event names. Codex review MED.
    const event = typeof parsed.event === "string" ? parsed.event : null;
    if (!event || !ALLOWED_EVENTS.has(event)) return new NextResponse(null, { status: 400 });

    // utm whitelist — only accept the 5 standard keys, each capped at
    // 64 chars, values forced to string. Prevents arbitrary key/value
    // injection into log entries.
    const rawUtm = parsed.utm && typeof parsed.utm === "object" ? parsed.utm as Record<string, unknown> : null;
    let utm: Record<string, string> | undefined;
    if (rawUtm) {
      utm = {};
      for (const k of ALLOWED_UTM_KEYS) {
        const v = rawUtm[k];
        if (typeof v === "string" && v.length > 0) {
          utm[k] = v.slice(0, MAX_UTM_VALUE_LEN);
        }
      }
      if (Object.keys(utm).length === 0) utm = undefined;
    }

    console.log(JSON.stringify({
      kind: "marketing_event",
      event,
      path: typeof parsed.path === "string" ? parsed.path.slice(0, 200) : null,
      target: typeof parsed.target === "string" ? parsed.target.slice(0, 100) : undefined,
      referrer: typeof parsed.referrer === "string" ? parsed.referrer.slice(0, 200) : null,
      utm,
      ts: typeof parsed.ts === "number" ? parsed.ts : Date.now(),
    }));
  } catch {
    // 204 even on parse failure — we don't want clients to retry. The
    // failed parse case has already passed body+CT validation so it's
    // either truncated input or non-JSON content — log nothing.
  }
  return new NextResponse(null, { status: 204 });
}
