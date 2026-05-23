import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { waitlistSignups, newsletterSignups } from "@raltic/db";
import { sendEmail } from "@raltic/auth-core";
import type { Env, Variables } from "../lib/env";

/**
 * Public, anonymous marketing form submissions:
 *
 *   POST /api/v1/marketing/waitlist  — full Team-tier waitlist form
 *   POST /api/v1/marketing/newsletter — single-field email signup
 *
 * No auth required — visitors hitting raltic.com submit these. Bodies
 * are size-capped and rate-limited via KV to defend against bots.
 *
 * Sinks:
 *   1. D1 row (durable; admin can query later — see admin tooling TBD)
 *   2. Notification email to hello@raltic.com so a human is told within
 *      seconds (uses the existing EMAIL binding that better-auth uses)
 *
 * The web form also captures UTM from the `ral_utm` cookie and sends
 * it in the body so we can attribute paid traffic when CRM lands.
 */
export const marketingSignupsRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const TEAM_SIZE_BUCKETS = ["1-4", "5-20", "21-100", "100+"] as const;

const waitlistBody = z.object({
  email: z.string().email().max(200),
  name: z.string().min(1).max(120),
  company: z.string().max(200).optional().nullable(),
  teamSize: z.enum(TEAM_SIZE_BUCKETS).optional(),
  useCase: z.string().max(2000).optional().nullable(),
  utmSource: z.string().max(64).optional().nullable(),
  utmCampaign: z.string().max(64).optional().nullable(),
  refererPath: z.string().max(200).optional().nullable(),
});

const newsletterBody = z.object({
  email: z.string().email().max(200),
  page: z.string().max(200).optional().nullable(),
  utmSource: z.string().max(64).optional().nullable(),
  utmCampaign: z.string().max(64).optional().nullable(),
});

/**
 * Rate-limit per IP. Anonymous endpoint — without it a bot could
 * insert 10k rows in seconds and exhaust the unique index check.
 * KV-backed, 24h window: 10 waitlist + 20 newsletter per IP / day.
 */
async function rateLimit(
  env: Env, key: string, max: number, windowSec: number,
): Promise<boolean> {
  const k = `mkt:${key}`;
  const cur = await env.RATE_LIMITS.get(k);
  const n = cur ? Number(cur) : 0;
  if (n >= max) return false;
  await env.RATE_LIMITS.put(k, String(n + 1), { expirationTtl: windowSec });
  return true;
}

function clientIp(req: Request): string {
  return req.headers.get("cf-connecting-ip")
      ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      ?? "unknown";
}

function userAgent(req: Request): string {
  return (req.headers.get("user-agent") ?? "unknown").slice(0, 200);
}

const MAX_BODY_BYTES = 4096;

/** Reject early on Content-Length so we don't parse multi-MB JSON
 *  before zod gets the chance to cap fields. Codex-style M5 fix. */
function isBodyTooLarge(req: Request): boolean {
  const cl = req.headers.get("content-length");
  if (!cl) return false;
  const n = Number(cl);
  return Number.isFinite(n) && n > MAX_BODY_BYTES;
}

/** Flatten an error AND its .cause (Drizzle wraps D1 errors with
 *  "Failed query: ..." and tucks the SQLite-level cause into .cause).
 *  Used to detect UNIQUE-constraint collisions from inside a catch. */
function flattenError(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const parts = [e.message];
  const cause = (e as { cause?: unknown }).cause;
  if (cause instanceof Error) parts.push(cause.message);
  else if (typeof cause === "string") parts.push(cause);
  else if (cause && typeof cause === "object") {
    try { parts.push(JSON.stringify(cause)); } catch { /* skip */ }
  }
  return parts.join(" | ");
}

/** UNIQUE-constraint detector resilient to Drizzle's wrapper. Matches
 *  any of: "UNIQUE", "constraint failed", "D1_ERROR:" (Cloudflare's
 *  wrapped error prefix). Earlier draft only matched "UNIQUE", which
 *  Drizzle's "Failed query: insert into..." wrapper hides. */
function isUniqueViolation(e: unknown): boolean {
  const msg = flattenError(e);
  return /UNIQUE|constraint failed|D1_ERROR/i.test(msg);
}

marketingSignupsRoutes.post("/api/v1/marketing/waitlist", async (c) => {
  if (isBodyTooLarge(c.req.raw)) return c.json({ error: { code: "PAYLOAD_TOO_LARGE", message: "body too large" } }, 413);

  let parsed: z.infer<typeof waitlistBody>;
  try { parsed = waitlistBody.parse(await c.req.json()); }
  catch (e) {
    return c.json({ error: { code: "BAD_INPUT", message: e instanceof z.ZodError ? e.issues[0]?.message ?? "invalid body" : "bad body" } }, 400);
  }

  const ip = clientIp(c.req.raw);
  if (!await rateLimit(c.env, `wl:${ip}`, 10, 86_400)) {
    return c.json({ error: { code: "RATE_LIMIT", message: "too many submissions; try again tomorrow" } }, 429);
  }

  const db = drizzle(c.env.DB);
  const id = crypto.randomUUID();
  const now = new Date();
  const ua = userAgent(c.req.raw);
  try {
    await db.insert(waitlistSignups).values({
      id,
      email: parsed.email.toLowerCase().trim(),
      name: parsed.name.trim(),
      company: parsed.company?.trim() || null,
      teamSize: parsed.teamSize ?? null,
      useCase: parsed.useCase?.trim() || null,
      utmSource: parsed.utmSource ?? null,
      utmCampaign: parsed.utmCampaign ?? null,
      refererPath: parsed.refererPath ?? null,
      ip,
      userAgent: ua,
      status: "new",
      adminNote: null,
      createdAt: now,
      updatedAt: now,
    });
  } catch (e) {
    // Unique-index collision (same email + refererPath) — return
    // deduped success and SKIP the notify email. Earlier draft swallowed
    // the error but still fired notify on every retry, so a single
    // visitor hitting Submit twice would spam hello@raltic.com.
    // Claude review H1.
    if (isUniqueViolation(e)) {
      return c.json({ ok: true, deduped: true });
    }
    console.error("[waitlist] insert failed:", flattenError(e));
    return c.json({ error: { code: "INTERNAL", message: "couldn't save your submission, please retry" } }, 500);
  }

  // Fire-and-forget email so the response stays snappy. Only runs on
  // the SUCCESS path now (the UNIQUE branch returns early above).
  c.executionCtx.waitUntil(notifyHumanWaitlist(c.env, parsed, { ip, ua, submittedAt: now }).catch((e) => {
    console.warn("[waitlist] notification email failed:", e instanceof Error ? e.message : String(e));
  }));

  return c.json({ ok: true, id });
});

marketingSignupsRoutes.post("/api/v1/marketing/newsletter", async (c) => {
  if (isBodyTooLarge(c.req.raw)) return c.json({ error: { code: "PAYLOAD_TOO_LARGE", message: "body too large" } }, 413);

  let parsed: z.infer<typeof newsletterBody>;
  try { parsed = newsletterBody.parse(await c.req.json()); }
  catch (e) {
    return c.json({ error: { code: "BAD_INPUT", message: e instanceof z.ZodError ? e.issues[0]?.message ?? "invalid body" : "bad body" } }, 400);
  }

  const ip = clientIp(c.req.raw);
  if (!await rateLimit(c.env, `nl:${ip}`, 20, 86_400)) {
    return c.json({ error: { code: "RATE_LIMIT", message: "too many submissions; try again tomorrow" } }, 429);
  }

  const db = drizzle(c.env.DB);
  const id = crypto.randomUUID();
  const email = parsed.email.toLowerCase().trim();
  try {
    // INSERT-then-catch. Earlier draft did SELECT-then-INSERT which
    // was a wasted D1 read AND still raced (two near-simultaneous
    // submits both passed the SELECT then one lost the INSERT).
    // Now: rely solely on the UNIQUE catch for idempotency. Claude
    // review M2.
    await db.insert(newsletterSignups).values({
      id,
      email,
      page: parsed.page ?? null,
      utmSource: parsed.utmSource ?? null,
      utmCampaign: parsed.utmCampaign ?? null,
      ip,
      userAgent: userAgent(c.req.raw),
      createdAt: new Date(),
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      return c.json({ ok: true, deduped: true });
    }
    console.error("[newsletter] insert failed:", flattenError(e));
    return c.json({ error: { code: "INTERNAL", message: "couldn't save your subscription, please retry" } }, 500);
  }

  return c.json({ ok: true, id });
});

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c));
}

async function notifyHumanWaitlist(
  env: Env,
  body: z.infer<typeof waitlistBody>,
  meta: { ip: string; ua: string; submittedAt: Date },
): Promise<void> {
  const subject = `[Waitlist] ${body.name} · ${body.company ?? "no company"} · ${body.teamSize ?? "n/a"}`;
  // Plain <p> wrapping instead of <pre> — Outlook desktop strips
  // <pre> styling. style="white-space:pre-wrap" on a <div> survives
  // every major client. Claude review M1.
  const html = `
    <p>New <strong>Teams waitlist</strong> submission:</p>
    <table cellpadding="6" style="border-collapse:collapse;font-family:system-ui,sans-serif">
      <tr><td><strong>Name</strong></td><td>${escapeHtml(body.name)}</td></tr>
      <tr><td><strong>Email</strong></td><td><a href="mailto:${escapeHtml(body.email)}">${escapeHtml(body.email)}</a></td></tr>
      <tr><td><strong>Company</strong></td><td>${escapeHtml(body.company ?? "—")}</td></tr>
      <tr><td><strong>Team size</strong></td><td>${escapeHtml(body.teamSize ?? "—")}</td></tr>
      <tr><td><strong>Use case</strong></td><td><div style="white-space:pre-wrap;margin:0">${escapeHtml(body.useCase ?? "—")}</div></td></tr>
      <tr><td><strong>UTM source</strong></td><td>${escapeHtml(body.utmSource ?? "—")}</td></tr>
      <tr><td><strong>UTM campaign</strong></td><td>${escapeHtml(body.utmCampaign ?? "—")}</td></tr>
      <tr><td><strong>Referrer</strong></td><td>${escapeHtml(body.refererPath ?? "—")}</td></tr>
      <tr><td><strong>Submitted</strong></td><td>${escapeHtml(meta.submittedAt.toISOString())}</td></tr>
      <tr><td><strong>IP</strong></td><td>${escapeHtml(meta.ip)}</td></tr>
      <tr><td><strong>User-Agent</strong></td><td style="color:#666;font-size:11px">${escapeHtml(meta.ua)}</td></tr>
    </table>
    <p style="color:#888;font-size:12px;margin-top:24px">
      Saved to the <code>waitlist_signups</code> table. Reply directly to the visitor or update status in admin (TODO admin UI).
    </p>`;
  await sendEmail(env, {
    to: "hello@raltic.com",
    subject,
    html,
    text: `Waitlist: ${body.name} <${body.email}> · ${body.company ?? "—"} · ${body.teamSize ?? "—"}\nSubmitted: ${meta.submittedAt.toISOString()}\nIP: ${meta.ip}\nUA: ${meta.ua}\n\n${body.useCase ?? "(no use case provided)"}`,
  });
}
