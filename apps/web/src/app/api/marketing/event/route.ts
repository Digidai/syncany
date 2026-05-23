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

export async function POST(req: Request): Promise<Response> {
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY) return new NextResponse(null, { status: 413 });
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const event = typeof parsed.event === "string" ? parsed.event.slice(0, 64) : null;
    if (!event) return new NextResponse(null, { status: 400 });
    // Stash a single-line log entry for easy `wrangler tail | jq` ingestion.
    console.log(JSON.stringify({
      kind: "marketing_event",
      event,
      path: typeof parsed.path === "string" ? parsed.path.slice(0, 200) : null,
      target: typeof parsed.target === "string" ? parsed.target.slice(0, 100) : undefined,
      referrer: typeof parsed.referrer === "string" ? parsed.referrer.slice(0, 200) : null,
      utm: parsed.utm && typeof parsed.utm === "object" ? parsed.utm : undefined,
      ts: typeof parsed.ts === "number" ? parsed.ts : Date.now(),
    }));
  } catch {
    // 204 even on parse failure — we don't want clients to retry.
  }
  return new NextResponse(null, { status: 204 });
}
