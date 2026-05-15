import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { requirePolicy, policy, sendEmail } from "@syncany/auth-core";
import { createInviteRequest } from "@syncany/protocol";
import { servers, serverMembers, invites, user } from "@syncany/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Env, Variables } from "../lib/env";
import { requireAuth, ctxFor } from "../lib/auth";
import { rateLimit } from "../lib/rate-limit";

export const invitesRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const emailInviteRequest = z.object({
  serverId: z.string(),
  email: z.string().email().max(254),
  role: z.enum(["admin", "member"]).default("member"),
  ttlHours: z.number().int().positive().max(24 * 30).default(24 * 7),
});

// ---------------------------------------------------------------------------
// /api/v1/invites — create / accept / list / revoke
// ---------------------------------------------------------------------------
invitesRoutes.post("/api/v1/invites", requireAuth, async (c) => {
  const body = createInviteRequest.parse(await c.req.json());
  const subject = c.get("subject");
  const ctx = ctxFor(c);
  await requirePolicy(policy.servers.canRead(ctx, body.serverId));
  // Only the server owner can create invites for now (admin role TBD).
  await requirePolicy(policy.servers.canUpdate(ctx, body.serverId));
  const id = "inv_" + crypto.randomUUID().replace(/-/g, "").slice(0, 24);
  const expiresAt = body.ttlHours ? new Date(Date.now() + body.ttlHours * 3600_000) : null;
  const db = drizzle(c.env.DB);
  await db.insert(invites).values({
    id, serverId: body.serverId, invitedBy: subject.userId,
    role: body.role, maxUses: body.maxUses, uses: 0,
    expiresAt, createdAt: new Date(),
  });
  return c.json({ id, url: `${c.env.WEB_ORIGIN}/invite/${id}` });
});

invitesRoutes.get("/api/v1/invites", requireAuth, async (c) => {
  const subject = c.get("subject");
  const serverId = c.req.query("serverId");
  if (!serverId) return c.json({ error: { code: "BAD_REQ", message: "serverId required" } }, 400);
  const ctx = ctxFor(c);
  await requirePolicy(policy.servers.canUpdate(ctx, serverId));
  const db = drizzle(c.env.DB);
  const rows = await db.select().from(invites).where(eq(invites.serverId, serverId));
  return c.json({ invites: rows });
});

invitesRoutes.delete("/api/v1/invites/:id", requireAuth, async (c) => {
  const id = c.req.param("id");
  const subject = c.get("subject");
  const db = drizzle(c.env.DB);
  const rows = await db.select({ serverId: invites.serverId }).from(invites).where(eq(invites.id, id)).limit(1);
  if (rows.length === 0) return c.json({ error: { code: "NOT_FOUND", message: "no such invite" } }, 404);
  const ctx = ctxFor(c);
  await requirePolicy(policy.servers.canUpdate(ctx, rows[0].serverId));
  await db.update(invites).set({ revokedAt: new Date() }).where(eq(invites.id, id));
  return c.json({ ok: true });
});

// Public lookup — used by the /invite/:id landing page to show server name
// before the user accepts. No auth required.
invitesRoutes.get("/api/v1/invites/:id/preview", async (c) => {
  const id = c.req.param("id");
  const db = drizzle(c.env.DB);
  const rows = await db
    .select({ inv: invites, server: servers })
    .from(invites)
    .innerJoin(servers, eq(servers.id, invites.serverId))
    .where(eq(invites.id, id))
    .limit(1);
  if (rows.length === 0) return c.json({ error: { code: "NOT_FOUND", message: "no such invite" } }, 404);
  const r = rows[0];
  if (r.inv.revokedAt) return c.json({ error: { code: "REVOKED", message: "invite revoked" } }, 410);
  if (r.inv.expiresAt && (r.inv.expiresAt as Date).getTime() <= Date.now()) {
    return c.json({ error: { code: "EXPIRED", message: "invite expired" } }, 410);
  }
  if (r.inv.maxUses > 0 && r.inv.uses >= r.inv.maxUses) {
    return c.json({ error: { code: "EXHAUSTED", message: "invite used up" } }, 410);
  }
  return c.json({
    server: { id: r.server.id, name: r.server.name, slug: r.server.slug, description: r.server.description },
    role: r.inv.role,
  });
});

// Email-invite: same flow as the link variant, but server emails the link
// to the recipient instead of returning it to the inviter to copy/paste.
invitesRoutes.post("/api/v1/invites/email", requireAuth, async (c) => {
  const body = emailInviteRequest.parse(await c.req.json());
  const subject = c.get("subject");
  const ctx = ctxFor(c);
  await requirePolicy(policy.servers.canUpdate(ctx, body.serverId));

  // Rate-limit: cap at 50 sent invites per server per day to stop a
  // compromised owner cookie from turning Syncany into a spam relay
  // (CF Email Sending will throttle/suspend the binding otherwise).
  const dayKey = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const limited = await rateLimit(c, "invite_email_server", `${body.serverId}:${dayKey}`, 50, 24 * 3600);
  if (limited) return limited;
  // Per-recipient cooldown: 1 invite per email per server per hour. Stops
  // accidental double-clicks + repeated unsolicited send to the same
  // person after they ignored the first.
  const recipKey = `${body.serverId}:${body.email.toLowerCase()}`;
  const recipLimited = await rateLimit(c, "invite_email_recip", recipKey, 1, 3600);
  if (recipLimited) return recipLimited;

  const id = "inv_" + crypto.randomUUID().replace(/-/g, "").slice(0, 24);
  const expiresAt = new Date(Date.now() + body.ttlHours * 3600_000);
  const db = drizzle(c.env.DB);
  await db.insert(invites).values({
    id, serverId: body.serverId, invitedBy: subject.userId,
    role: body.role, maxUses: 1, uses: 0, expiresAt, createdAt: new Date(),
  });
  const url = `${c.env.WEB_ORIGIN}/invite/${id}`;
  // Look up server name + inviter name+email for the email body — so the
  // recipient sees who invited them (avoids "looks like spam" + spam-folder).
  const [srv, [inv]] = await Promise.all([
    db.select({ name: servers.name }).from(servers).where(eq(servers.id, body.serverId)).limit(1)
      .then(r => r[0]),
    db.select({ name: user.name, email: user.email }).from(user).where(eq(user.id, subject.userId)).limit(1),
  ]);
  const serverName = srv?.name ?? "your workspace";
  const inviterName = inv?.name ?? inv?.email ?? "A teammate";
  await sendEmail(c.env, {
    to: body.email,
    subject: `${inviterName} invited you to ${serverName} on Syncany`,
    html: `<p><strong>${escapeHtml(inviterName)}</strong> invited you to join
        <strong>${escapeHtml(serverName)}</strong> on Syncany — a chat workspace
        where humans and AI agents work in the same channels.</p>
      <p style="margin-top:24px"><a href="${url}"
        style="background:#0e7490;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Accept invite</a></p>
      <p style="color:#888;font-size:12px;margin-top:24px">
        This link expires in ${body.ttlHours} hours and can be used once.
        If you weren't expecting this, you can ignore the email.
      </p>`,
  });
  return c.json({ id, url, sentTo: body.email });
});

invitesRoutes.post("/api/v1/invites/:id/accept", requireAuth, async (c) => {
  const id = c.req.param("id");
  const subject = c.get("subject");
  const db = drizzle(c.env.DB);
  const rows = await db.select().from(invites).where(eq(invites.id, id)).limit(1);
  if (rows.length === 0) return c.json({ error: { code: "NOT_FOUND", message: "no such invite" } }, 404);
  const inv = rows[0];
  if (inv.revokedAt) return c.json({ error: { code: "REVOKED", message: "invite revoked" } }, 410);
  if (inv.expiresAt && (inv.expiresAt as Date).getTime() <= Date.now()) {
    return c.json({ error: { code: "EXPIRED", message: "invite expired" } }, 410);
  }
  if (inv.maxUses > 0 && inv.uses >= inv.maxUses) {
    return c.json({ error: { code: "EXHAUSTED", message: "invite used up" } }, 410);
  }

  // Already a member?
  const existing = await db.select({ id: serverMembers.serverId }).from(serverMembers)
    .where(and(
      eq(serverMembers.serverId, inv.serverId),
      eq(serverMembers.memberId, subject.userId),
      eq(serverMembers.memberType, "human"),
    )).limit(1);
  if (existing.length === 0) {
    await db.batch([
      db.insert(serverMembers).values({
        serverId: inv.serverId, memberId: subject.userId,
        memberType: "human", role: inv.role, joinedAt: new Date(),
      }),
      db.update(invites).set({ uses: inv.uses + 1 }).where(eq(invites.id, id)),
    ]);
  }

  const srv = await db.select({ slug: servers.slug }).from(servers).where(eq(servers.id, inv.serverId)).limit(1);
  return c.json({ ok: true, serverSlug: srv[0]?.slug });
});

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
