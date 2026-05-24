import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { requirePolicy, policy } from "@raltic/auth-core";
import { agents, servers, serverMembers, channels, channelMembers, messages, machineKeys, user } from "@raltic/db";
import { and, asc, desc, eq, gt, isNotNull } from "drizzle-orm";
import { z } from "zod";
import type { Env, Variables } from "../lib/env";
import { requireAuth, requireUser, ctxFor } from "../lib/auth";

export const meRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// Validated activity payload — replaces an unsafe `as { ... }` cast.
const agentActivityBody = z.object({
  agentId: z.string().min(1).max(128),
  status: z.enum(["idle", "thinking", "working", "error"]),
  label: z.string().max(120).optional(),
  detail: z.string().max(2000).optional(),
});

// ---------------------------------------------------------------------------
// /api/v1/agent-activity — bridge POSTs activity events; fanout via UserGateway
// ---------------------------------------------------------------------------
meRoutes.post("/api/v1/agent-activity", requireAuth, async (c) => {
  const subject = c.get("subject");
  const body = agentActivityBody.parse(await c.req.json());
  // Verify the agent is actually owned by this subject's user. (status
  // enum already validated by zod, so no manual check needed.)
  void subject;
  const ctx = ctxFor(c);
  await requirePolicy(policy.agents.canReportActivity(ctx, body.agentId));

  // Persist a coarse online/offline state on the agent row. The fine-grained
  // per-message status (thinking/working/error/idle) only lives in
  // UserGateway DO + use-agent-activity hook (transient). Without this DB
  // update, sidebar shows offline gray dot for an alive bridge between
  // messages.
  const persistedStatus =
    body.status === "error" ? "offline" :
    (body.status === "idle" || body.status === "thinking" || body.status === "working") ? "online" :
    null;
  if (persistedStatus) {
    const db = drizzle(c.env.DB);
    await db.update(agents).set({ status: persistedStatus, updatedAt: new Date() })
      .where(eq(agents.id, body.agentId));
  }

  const stub = c.env.USER_GATEWAY.get(c.env.USER_GATEWAY.idFromName(subject.userId));
  await stub.fetch("https://user-gateway/internal/notify", {
    method: "POST",
    headers: { "x-internal-secret": c.env.CHAT_ROOM_AUTH_SECRET, "content-type": "application/json" },
    body: JSON.stringify({
      v: 1, t: "activity",
      agentId: body.agentId,
      status: body.status,
      label: body.label ?? "",
      detail: body.detail ?? "",
    }),
  });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// /api/v1/agent/messages/check — poll for messages since cursor (CLI)
// ---------------------------------------------------------------------------
meRoutes.get("/api/v1/agent/messages/check", requireAuth, async (c) => {
  const agentId = c.req.query("agentId");
  if (!agentId) return c.json({ error: { code: "BAD_REQ", message: "agentId required" } }, 400);
  const ctx = ctxFor(c);
  await requirePolicy(policy.agents.canRead(ctx, agentId));

  const since = Number(c.req.query("since") ?? 0);
  const db = drizzle(c.env.DB);
  // Don't echo the agent's own messages back to itself.
  const conds = [
    eq(channelMembers.memberId, agentId),
    eq(channelMembers.memberType, "agent"),
  ];
  if (since > 0) conds.push(gt(messages.createdAt, new Date(since)));
  const rows = await db
    .select({ m: messages, channel: channels.name, channelType: channels.type })
    .from(messages)
    .innerJoin(channels, eq(channels.id, messages.channelId))
    .innerJoin(channelMembers, eq(channelMembers.channelId, messages.channelId))
    .where(and(...conds))
    .orderBy(desc(messages.createdAt))
    .limit(50);
  const filtered = rows.filter(r => r.m.senderId !== agentId);
  const cursor = filtered.reduce((m, r) => Math.max(m, r.m.createdAt instanceof Date ? r.m.createdAt.getTime() : Number(r.m.createdAt)), since);
  return c.json({ messages: filtered, cursor });
});

// ---------------------------------------------------------------------------
// /api/v1/me — sanity check + bootstrap data for the web UI.
// hasConnectedBridge tells the onboarding wizard whether the user has ever
// successfully run `raltic bridge` (machine_keys.last_used_at is set).
// ---------------------------------------------------------------------------
meRoutes.get("/api/v1/me", requireAuth, requireUser, async (c) => {
  const subject = c.get("subject");
  // Bootstrap data is for human-session UI only. A machine key bearer
  // hitting /me would be enumerating all the user's servers, leaking
  // serverB metadata through a serverA key. The requireUser middleware
  // (mounted above) returns 403 before we even reach this handler;
  // bridges already get their own bootstrap payload via /bridge/connect.
  const db = drizzle(c.env.DB);

  // Memberships with role + stable sort. Previous code returned the
  // joined `{ servers, server_members }` shape unsorted with no role,
  // and the variable was misleadingly named `ownedServers` — it included
  // workspaces the user was merely invited to. New consumers (sidebar
  // grouped switcher, default-workspace picker) need to discriminate
  // owner vs admin vs member.
  //
  // Stable sort: role priority (owner > admin > member) then joinedAt
  // ascending so the oldest membership is first. The default-workspace
  // fallback chain depends on this ordering.
  const membershipRows = await db
    .select({
      id: servers.id,
      slug: servers.slug,
      name: servers.name,
      description: servers.description,
      iconUrl: servers.iconUrl,
      ownerId: servers.ownerId,
      role: serverMembers.role,
      joinedAt: serverMembers.joinedAt,
    })
    .from(servers)
    .innerJoin(serverMembers, and(
      eq(serverMembers.serverId, servers.id),
      eq(serverMembers.memberId, subject.userId),
      eq(serverMembers.memberType, "human"),
    ))
    .orderBy(asc(serverMembers.joinedAt));

  const ROLE_RANK = { owner: 0, admin: 1, member: 2 } as const;
  const myServers = membershipRows
    .map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      description: r.description,
      iconUrl: r.iconUrl,
      role: (r.role ?? "member") as "owner" | "admin" | "member",
      joinedAt: r.joinedAt instanceof Date ? r.joinedAt.getTime() : Number(r.joinedAt),
    }))
    .sort((a, b) => {
      const r = ROLE_RANK[a.role] - ROLE_RANK[b.role];
      return r !== 0 ? r : a.joinedAt - b.joinedAt;
    });

  // Personal workspace = the earliest workspace the user OWNS. This is
  // the one runOnboarding creates and is the canonical "your private
  // workspace" address — the wizard targets this, /s/[slug]?welcome=
  // joined toast references this, etc.
  const personalServer = myServers.find((s) => s.role === "owner") ?? null;

  // Default workspace = where /` redirects to. Source of truth is
  // users.default_server_id; falls back to personal, then to the
  // earliest joined workspace if (somehow) the user owns none.
  //   default_server_id valid (still a member)  →  use it
  //   personal exists                            →  use it
  //   earliest membership (any role)             →  last resort
  // Null only when the user has zero memberships, which currently
  // shouldn't happen after runOnboarding succeeds.
  const userRow = await db
    .select({ defaultServerId: user.defaultServerId })
    .from(user)
    .where(eq(user.id, subject.userId))
    .limit(1);
  const explicitDefault = userRow[0]?.defaultServerId ?? null;
  const defaultCandidate =
    (explicitDefault && myServers.find((s) => s.id === explicitDefault)) ||
    personalServer ||
    myServers[0] ||
    null;

  // Bridge status — `?serverId=` scopes to a single workspace so the
  // setup wizard auto-pop on /s/[slug] correctly answers "does THIS
  // workspace have a bridge?" rather than "has the user EVER run a
  // bridge ANYWHERE". The previous user-level flag caused a real
  // confusing bug: a user who'd already set up a bridge for workspace A
  // would visit workspace B (their own, fresh), see the agent stay
  // offline forever, but the wizard wouldn't auto-pop because the flag
  // was globally true — so they'd never realize they needed a SECOND
  // key bound to workspace B.
  const scopeServerId = c.req.query("serverId");
  const baseConds = [eq(machineKeys.userId, subject.userId), isNotNull(machineKeys.lastUsedAt)];
  if (scopeServerId) baseConds.push(eq(machineKeys.serverId, scopeServerId));
  const everUsed = await db
    .select({ id: machineKeys.id })
    .from(machineKeys)
    .where(and(...baseConds))
    .limit(1);

  return c.json({
    subject,
    servers: myServers,
    personalServerId: personalServer?.id ?? null,
    personalServerSlug: personalServer?.slug ?? null,
    defaultServerId: defaultCandidate?.id ?? null,
    defaultServerSlug: defaultCandidate?.slug ?? null,
    hasConnectedBridge: everUsed.length > 0,
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/v1/me/default-server — sets the workspace `/` redirects to.
// ---------------------------------------------------------------------------
const setDefaultServerBody = z.object({
  // Allow null to "unset" — falls back to personal/earliest in /me.
  serverId: z.string().min(1).max(128).nullable(),
});
meRoutes.patch("/api/v1/me/default-server", requireAuth, requireUser, async (c) => {
  const subject = c.get("subject");
  // requireUser already gated this — only a human session reaches here.
  // Machine-key changing a human's landing page would be sideways
  // privilege escalation; not worth shipping.
  const body = setDefaultServerBody.parse(await c.req.json());
  if (body.serverId) {
    // canRead doubles as a membership check — if the user can't read the
    // workspace they can't make it their default. Stops IDOR probing.
    const ctx = ctxFor(c);
    await requirePolicy(policy.servers.canRead(ctx, body.serverId));
  }
  const db = drizzle(c.env.DB);
  await db.update(user)
    .set({ defaultServerId: body.serverId })
    .where(eq(user.id, subject.userId));
  return c.json({ ok: true, defaultServerId: body.serverId });
});
