import { Hono } from "hono";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { requirePolicy, policy, revokeToken, seedPersonalDefaults as seedPersonalDefaultsCall } from "@raltic/auth-core";
import { rateLimit } from "../lib/rate-limit";
import { servers, serverMembers, agents, channels, channelMembers, messages, user, machineKeys, tasks } from "@raltic/db";
import { updateServerRequest } from "@raltic/protocol";
import { and, eq, inArray, or, sql as sqlFn } from "drizzle-orm";
import type { Env } from "../lib/env";
import type { Variables } from "../lib/env";
import { requireAuth, ctxFor } from "../lib/auth";

/**
 * Shared cleanup for leave + kick. CRITICAL SECURITY: removing a human
 * from server_members is not enough — without also destroying their
 * agents + machine keys, their already-connected bridge keeps posting
 * messages via owned agents (`policy.messages.canSendAs` only checks
 * `userOwnsAgent + agentIsChannelMember`, both still true).
 *
 * Cleanup order (children first to satisfy FK):
 *   1. channelMembers (human) — remove user from every channel in server
 *   2. channelMembers (agents owned by user) — remove from channels
 *      (FK from agents would cascade, but we do it explicitly to avoid
 *      relying on FK behavior across the agent delete below)
 *   3. tasks.assigneeId = NULL — avoid ghost-user assignments
 *   4. agents — destroy owned agents in this server (cascades agent's
 *      memberships + DM channel via existing FK chain)
 *   5. machineKeys — revoke (set revokedAt) so any live bridge using
 *      this key gets booted on next /connect; we don't hard-delete so
 *      revocation audit trail survives
 *   6. serverMembers — finally drop human membership
 *
 * Both DELETE /members/:userId and POST /leave call this. Channel IDs
 * are passed as a subquery rather than a materialized array so workspaces
 * with >1000 channels don't blow past SQLite's bound-parameter limit.
 */
async function cleanupServerMembership(
  env: Env,
  serverId: string,
  targetUserId: string,
): Promise<void> {
  const db = drizzle(env.DB);
  // First read which machine keys are about to be revoked — needed so we
  // can ALSO push their bridgeId onto the JWT denylist (the per-key revoke
  // endpoint at /machine-keys/:id does this; the cleanup path used to miss
  // it, leaving sy_bridge_ JWTs valid for up to 7 days after a kick).
  const keysToRevoke = await db
    .select({ id: machineKeys.id })
    .from(machineKeys)
    .where(and(
      eq(machineKeys.userId, targetUserId),
      eq(machineKeys.serverId, serverId),
      // Don't re-revoke already-revoked keys; saves KV writes.
      sqlFn`${machineKeys.revokedAt} IS NULL`,
    ));

  // Atomic batch — D1 supports atomic multi-statement batches. Either every
  // mutation lands or none does, so we never end up half-cleaned-up (e.g.
  // agents deleted but serverMembers row intact, which would leave the
  // user "appearing" as a member of a workspace with phantom agent ids).
  await db.batch([
    // 1. User's own channel memberships, scoped to this server's channels.
    db.delete(channelMembers).where(and(
      eq(channelMembers.memberId, targetUserId),
      eq(channelMembers.memberType, "human"),
      inArray(
        channelMembers.channelId,
        db.select({ id: channels.id }).from(channels).where(eq(channels.serverId, serverId)),
      ),
    )),
    // 2. Their owned agents' channel memberships (defensive — agent FK
    //    would cascade but we don't want to rely on intra-batch ordering).
    db.delete(channelMembers).where(and(
      eq(channelMembers.memberType, "agent"),
      inArray(
        channelMembers.memberId,
        db.select({ id: agents.id }).from(agents).where(and(
          eq(agents.ownerId, targetUserId),
          eq(agents.serverId, serverId),
        )),
      ),
    )),
    // 3. Null out tasks they were assigned to in this workspace's channels.
    db.update(tasks).set({ assigneeId: null, assigneeType: null }).where(and(
      eq(tasks.assigneeId, targetUserId),
      eq(tasks.assigneeType, "human"),
      inArray(
        tasks.channelId,
        db.select({ id: channels.id }).from(channels).where(eq(channels.serverId, serverId)),
      ),
    )),
    // 4. Destroy owned agents in this workspace.
    db.delete(agents).where(and(
      eq(agents.ownerId, targetUserId),
      eq(agents.serverId, serverId),
    )),
    // 5. Soft-revoke machine keys for this workspace (preserves audit trail).
    db.update(machineKeys)
      .set({ revokedAt: new Date() })
      .where(and(
        eq(machineKeys.userId, targetUserId),
        eq(machineKeys.serverId, serverId),
      )),
    // 6. Server membership last.
    db.delete(serverMembers).where(and(
      eq(serverMembers.serverId, serverId),
      eq(serverMembers.memberId, targetUserId),
      eq(serverMembers.memberType, "human"),
    )),
  ]);

  // After the batch lands, kill any live sy_bridge_ JWTs minted from the
  // revoked keys. Best-effort; KV failure shouldn't undo the cleanup
  // (cookies don't get un-bridged just because KV blipped).
  await Promise.all(
    keysToRevoke.map((k) =>
      revokeToken(env.RATE_LIMITS, `bridge:${k.id}`).catch((e) => {
        console.warn("[cleanupServerMembership] denylist push failed", k.id, e);
      }),
    ),
  );
}

export const serversRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
const AGENT_STATUS_STALE_MS = 2 * 60_000;
type AgentStatus = "online" | "sleeping" | "offline";

function computedAgentStatus<T extends { status: AgentStatus; updatedAt: Date | number | string }>(
  agent: T,
): Omit<T, "status"> & { status: AgentStatus } {
  const updatedAt = agent.updatedAt instanceof Date
    ? agent.updatedAt.getTime()
    : typeof agent.updatedAt === "number"
      ? agent.updatedAt
      : new Date(agent.updatedAt).getTime();
  if (agent.status === "online" && (!Number.isFinite(updatedAt) || Date.now() - updatedAt > AGENT_STATUS_STALE_MS)) {
    return { ...agent, status: "offline" };
  }
  return agent;
}

// ---------------------------------------------------------------------------
// /api/v1/servers — list mine + lookup by slug + detail with channels
// ---------------------------------------------------------------------------
serversRoutes.get("/api/v1/servers", requireAuth, async (c) => {
  const subject = c.get("subject");
  const db = drizzle(c.env.DB);
  // Machine subjects MUST be scoped to their own server — a machine key
  // for serverA must not see serverB metadata even if the same user owns
  // both. User subjects see all their server memberships.
  const memberConds = [
    eq(serverMembers.serverId, servers.id),
    eq(serverMembers.memberId, subject.userId),
    eq(serverMembers.memberType, "human"),
  ];
  if (subject.kind === "machine") memberConds.push(eq(servers.id, subject.serverId));
  const rows = await db
    .select({ s: servers, role: serverMembers.role })
    .from(servers)
    .innerJoin(serverMembers, and(...memberConds));
  return c.json({ servers: rows.map(r => ({ ...r.s, role: r.role })) });
});

serversRoutes.get("/api/v1/servers/by-slug/:slug", requireAuth, async (c) => {
  const subject = c.get("subject");
  const slug = c.req.param("slug");
  const db = drizzle(c.env.DB);
  const rows = await db
    .select({ s: servers, role: serverMembers.role })
    .from(servers)
    .innerJoin(serverMembers, and(
      eq(serverMembers.serverId, servers.id),
      eq(serverMembers.memberId, subject.userId),
      eq(serverMembers.memberType, "human"),
    ))
    .where(eq(servers.slug, slug))
    .limit(1);
  if (rows.length === 0) return c.json({ error: { code: "NOT_FOUND", message: "no such server" } }, 404);
  const server = rows[0];
  // Machine-subject scope check: only the server whose serverId matches
  // the machine key. Otherwise a key for serverA could enumerate serverB
  // by its slug.
  if (subject.kind === "machine" && server.s.id !== subject.serverId) {
    return c.json({ error: { code: "NOT_FOUND", message: "no such server" } }, 404);
  }

  // Lazy seed for invite-flow personal workspaces: if seeded=0 AND the
  // caller is the owner, run seedPersonalDefaults inline so the owner's
  // first visit lands on a populated workspace (Onboarding Assistant +
  // welcome channels + welcome message). Race-safe via the same
  // conditional UPDATE pattern as the explicit /seed endpoint.
  // Non-owner visits to a still-unseeded workspace (rare — invite
  // wasn't issued for this server) see the bare workspace, which is
  // correct — only the owner should trigger the welcome content.
  if (server.s.seeded === false && server.s.ownerId === subject.userId && subject.kind === "user") {
    const claim = await c.env.DB.prepare("UPDATE servers SET seeded = 1 WHERE id = ? AND seeded = 0")
      .bind(server.s.id).run();
    if (claim.meta.changes) {
      try {
        const ownerName = (await db.select({ name: user.name }).from(user)
          .where(eq(user.id, server.s.ownerId)).limit(1))[0]?.name ?? "there";
        await seedPersonalDefaultsCall(c.env as unknown as Parameters<typeof seedPersonalDefaultsCall>[0], {
          id: server.s.id, ownerId: server.s.ownerId, ownerName,
        });
        // Mark the local row so the rest of this handler sees seeded=1.
        server.s.seeded = true;
      } catch (e) {
        // Best-effort: revert flag so a later visit can retry.
        await c.env.DB.prepare("UPDATE servers SET seeded = 0 WHERE id = ?")
          .bind(server.s.id).run().catch(() => { /* swallow */ });
        console.error("[seedPersonal] lazy-seed failed for", server.s.id, e);
        // Continue serving the (bare) workspace; user can manually
        // trigger via Settings → Agents "Restore Onboarding Assistant".
      }
    }
  }
  const [chans, ags, unreadRows] = await Promise.all([
    db.select().from(channels).where(and(
      eq(channels.serverId, server.s.id),
      or(
        eq(channels.type, "public"),
        sqlFn`${channels.id} IN (
          SELECT channel_id FROM channel_members
          WHERE member_id = ${subject.userId} AND member_type = 'human'
        )`,
        sqlFn`${channels.id} IN (
          SELECT cm.channel_id FROM channel_members cm
          INNER JOIN agents a ON a.id = cm.member_id
          WHERE cm.member_type = 'agent'
            AND a.owner_id = ${subject.userId}
            AND a.server_id = ${server.s.id}
        )`,
      ),
    )),
    db.select().from(agents).where(eq(agents.serverId, server.s.id)),
    // For each channel the user is a member of, max(seq) - lastReadSeq = unread.
    db.select({
      channelId: channelMembers.channelId,
      lastReadSeq: channelMembers.lastReadSeq,
    }).from(channelMembers).where(and(
      eq(channelMembers.memberId, subject.userId),
      eq(channelMembers.memberType, "human"),
    )),
  ]);
  // Compute unread per channel via a single SQL aggregation.
  const lastReadByChannel = new Map(unreadRows.map(r => [r.channelId, r.lastReadSeq ?? 0]));
  const channelIds = chans.map(c => c.id);
  const seqRows = channelIds.length === 0 ? [] : await db
    .select({ channelId: messages.channelId, maxSeq: sqlFn<number>`max(${messages.seq})` })
    .from(messages)
    .where(inArray(messages.channelId, channelIds))
    .groupBy(messages.channelId);
  const maxSeqByChannel = new Map(seqRows.map(r => [r.channelId, Number(r.maxSeq ?? 0)]));
  // For DM channels: resolve the OTHER party so the client can render
  // "Olivia" instead of channel.name (which is just a stable identifier
  // — for human↔human DMs it's the peerId hex prefix, never a real name).
  // Without this every human DM in the sidebar would display as 8 hex
  // characters; the sidebar already special-cased agent DMs by walking
  // the agents list, but humans had no path.
  //
  // Strategy: query all channel_members rows for the dm channelIds, group
  // by channelId, take the row whose (member_id, member_type) ≠ caller's
  // (subject.userId, 'human'). For agents, the row will be (agentId,
  // 'agent'). Then JOIN to user / agents for display name + identity.
  const dmChannelIds = chans.filter(ch => ch.type === "dm").map(ch => ch.id);
  type DmPeer = {
    name: string;
    type: "human" | "agent";
    id: string;
    avatarSeed?: string | null;
    runtime?: "claude" | "codex" | "gemini" | "copilot" | null;
  };
  const dmPeerByChannel = new Map<string, DmPeer>();
  if (dmChannelIds.length > 0) {
    const memberRows = await db
      .select({
        channelId: channelMembers.channelId,
        memberId: channelMembers.memberId,
        memberType: channelMembers.memberType,
      })
      .from(channelMembers)
      .where(inArray(channelMembers.channelId, dmChannelIds));
    // Collect peer IDs (humans + agents) for batch name lookup.
    const humanPeerIds = new Set<string>();
    const agentPeerIds = new Set<string>();
    const peerByChannel = new Map<string, { id: string; type: "human" | "agent" }>();
    for (const r of memberRows) {
      const isMe = r.memberType === "human" && r.memberId === subject.userId;
      if (isMe) continue;
      peerByChannel.set(r.channelId, { id: r.memberId, type: r.memberType as "human" | "agent" });
      if (r.memberType === "human") humanPeerIds.add(r.memberId);
      else agentPeerIds.add(r.memberId);
    }
    const [humanRows, agentRows] = await Promise.all([
      humanPeerIds.size > 0
        ? db.select({ id: user.id, name: user.name }).from(user)
            .where(inArray(user.id, [...humanPeerIds]))
        : Promise.resolve([] as Array<{ id: string; name: string }>),
      agentPeerIds.size > 0
        ? db.select({
            id: agents.id, displayName: agents.displayName,
            avatarSeed: agents.avatarSeed, runtime: agents.runtime,
          }).from(agents).where(inArray(agents.id, [...agentPeerIds]))
        : Promise.resolve([] as Array<{ id: string; displayName: string; avatarSeed: string | null; runtime: "claude" | "codex" | "gemini" | "copilot" }>),
    ]);
    const humanName = new Map(humanRows.map(r => [r.id, r.name]));
    const agentRow = new Map(agentRows.map(r => [r.id, r]));
    for (const [cid, peer] of peerByChannel) {
      if (peer.type === "human") {
        const name = humanName.get(peer.id);
        if (name) dmPeerByChannel.set(cid, { name, type: "human", id: peer.id });
      } else {
        const a = agentRow.get(peer.id);
        if (a) dmPeerByChannel.set(cid, {
          name: a.displayName, type: "agent", id: peer.id,
          avatarSeed: a.avatarSeed, runtime: a.runtime,
        });
      }
    }
  }

  const channelsOut = chans.map(c => {
    // If the user isn't a member of this channel (only possible for public
    // channels they haven't explicitly joined), don't compute "unread" at all.
    const isMember = lastReadByChannel.has(c.id);
    const maxSeq = maxSeqByChannel.get(c.id) ?? 0;
    const lastReadSeq = lastReadByChannel.get(c.id) ?? 0;
    return {
      ...c,
      maxSeq,
      lastReadSeq,
      unread: isMember
        ? Math.max(0, maxSeq - lastReadSeq)
        : 0,
      // null for non-DM channels; populated for DMs so the client can
      // skip an extra per-channel members fetch on render.
      peer: dmPeerByChannel.get(c.id) ?? null,
    };
  });

  return c.json({ server: { ...server.s, role: server.role }, channels: channelsOut, agents: ags.map(computedAgentStatus) });
});

// ---------------------------------------------------------------------------
// Workspace member management — list humans + remove. Owner-only for delete.
// ---------------------------------------------------------------------------
serversRoutes.get("/api/v1/servers/:id/members", requireAuth, async (c) => {
  const id = c.req.param("id");
  const subject = c.get("subject");
  const ctx = ctxFor(c);
  await requirePolicy(policy.servers.canRead(ctx, id));
  const db = drizzle(c.env.DB);

  // Email is PII. Only admins/owners see peer emails; regular members get
  // name + role + image only. Ownership of email enumeration prevented.
  const myRow = await db
    .select({ role: serverMembers.role })
    .from(serverMembers)
    .where(and(
      eq(serverMembers.serverId, id),
      eq(serverMembers.memberId, subject.userId),
      eq(serverMembers.memberType, "human"),
    )).limit(1);
  const myRole = myRow[0]?.role ?? "member";
  const canSeeEmails = myRole === "owner" || myRole === "admin";

  const rows = await db
    .select({
      userId: serverMembers.memberId,
      role: serverMembers.role,
      joinedAt: serverMembers.joinedAt,
      name: user.name,
      email: user.email,
      image: user.image,
    })
    .from(serverMembers)
    .innerJoin(user, eq(user.id, serverMembers.memberId))
    .where(and(
      eq(serverMembers.serverId, id),
      eq(serverMembers.memberType, "human"),
    ));
  const out = rows.map(r => canSeeEmails ? r : { ...r, email: null });
  return c.json({ members: out, viewerRole: myRole });
});

serversRoutes.delete("/api/v1/servers/:id/members/:userId", requireAuth, async (c) => {
  const id = c.req.param("id");
  const targetUserId = c.req.param("userId");
  const subject = c.get("subject");
  const ctx = ctxFor(c);
  // Owner or admin can remove members. Self-removal is blocked here so
  // there's a single intent per endpoint: members use POST /leave to
  // self-exit; admins use DELETE to kick someone else. Prevents a UI
  // mis-wire from accidentally letting an admin kick themselves while
  // editing a member row.
  await requirePolicy(policy.servers.canEdit(ctx, id));
  if (targetUserId === subject.userId) {
    return c.json({ error: { code: "BAD_REQ", message: "use POST /leave to remove yourself" } }, 400);
  }
  // Cannot remove the workspace owner. Ownership transfer is the only path.
  const ownerRow = await drizzle(c.env.DB)
    .select({ ownerId: servers.ownerId })
    .from(servers).where(eq(servers.id, id)).limit(1);
  if (ownerRow[0]?.ownerId === targetUserId) {
    return c.json({ error: { code: "BAD_REQ", message: "cannot remove the workspace owner; transfer ownership first" } }, 400);
  }
  await cleanupServerMembership(c.env, id, targetUserId);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// PATCH /api/v1/servers/:id — rename + description + icon (owner/admin).
// Slug change is intentionally NOT here; warrants its own endpoint with
// redirect-from-old-slug semantics.
// ---------------------------------------------------------------------------
// Reserved slug list lives in @raltic/protocol so the API + web client
// + (future) docs site all check the same set. See protocol/src/
// reserved-slugs.ts for the rationale + add-a-new-reserved checklist.
import { RESERVED_SLUG_SET as RESERVED_SLUGS } from "@raltic/protocol";

serversRoutes.patch("/api/v1/servers/:id", requireAuth, async (c) => {
  const id = c.req.param("id");
  const subject = c.get("subject");
  // 60 server-patches/hr/user — workspace rename + icon updates are
  // bursty (icon picker may double-fire), but anything beyond this is
  // either a probe or a runaway script.
  const limited = await rateLimit(c, "server_patch", subject.userId, 60, 3600);
  if (limited) return limited;
  const ctx = ctxFor(c);
  await requirePolicy(policy.servers.canEdit(ctx, id));
  const body = updateServerRequest.parse(await c.req.json());

  // Slug is owner-only. Admin can edit name / description / iconUrl,
  // but changing the slug breaks every bookmark, every workspace URL,
  // and the sidebar's "switch by slug" path. That's a workspace-
  // identity decision, not a content-management one — owner only.
  if (body.slug !== undefined) {
    const owner = await drizzle(c.env.DB)
      .select({ ownerId: servers.ownerId })
      .from(servers)
      .where(eq(servers.id, id))
      .limit(1);
    if (owner.length === 0) {
      return c.json({ error: { code: "NOT_FOUND", message: "no such server" } }, 404);
    }
    if (subject.kind !== "user" || subject.userId !== owner[0].ownerId) {
      return c.json({ error: { code: "FORBIDDEN", message: "only the workspace owner can change the slug" } }, 403);
    }
  }
  // iconUrl host-validation: must be the same origin as our API (the upload
  // flow always returns a publicUrl on this origin) OR null. Stops an admin
  // from setting iconUrl to an attacker-controlled tracking pixel / SSRF
  // probe / referer-leak target rendered to every workspace viewer's <img>.
  if (body.iconUrl !== undefined && body.iconUrl !== null) {
    const ownOrigin = new URL(c.req.url).origin;
    try {
      const u = new URL(body.iconUrl);
      const isOwn = u.origin === ownOrigin && u.pathname.startsWith("/uploads/server-icons/");
      if (!isOwn) {
        return c.json({ error: { code: "BAD_HOST", message: "iconUrl must be a workspace-icon upload from this server" } }, 400);
      }
    } catch {
      return c.json({ error: { code: "BAD_URL", message: "iconUrl is not a valid URL" } }, 400);
    }
  }
  // Slug change: zod has already enforced format (6-48 chars, lowercase,
  // alphanumeric+hyphens, no leading/trailing hyphen). Defensive checks
  // here: reserved-word collision + DB unique violation. We skip the
  // update if the slug is unchanged so we don't trigger a 409 against
  // the workspace's own current slug.
  if (body.slug !== undefined) {
    if (RESERVED_SLUGS.has(body.slug)) {
      return c.json({ error: { code: "RESERVED_SLUG", message: `"${body.slug}" is reserved` } }, 400);
    }
  }
  const db = drizzle(c.env.DB);
  const patch: Partial<typeof servers.$inferInsert> = {};
  if (body.name !== undefined) patch.name = body.name;
  if (body.description !== undefined) patch.description = body.description;
  if (body.iconUrl !== undefined) patch.iconUrl = body.iconUrl;
  if (body.slug !== undefined) patch.slug = body.slug;
  try {
    await db.update(servers).set(patch).where(eq(servers.id, id));
  } catch (e) {
    // D1 surfaces UNIQUE constraint violations as `SqliteError` containing
    // "UNIQUE constraint failed: servers.slug". Map to 409 so the UI can
    // show a tasteful "that URL is taken" error rather than a generic 500.
    const msg = e instanceof Error ? e.message : String(e);
    if (/UNIQUE constraint failed.*servers\.slug/i.test(msg)) {
      return c.json({ error: { code: "SLUG_TAKEN", message: "that workspace URL is already in use" } }, 409);
    }
    throw e;
  }
  const updated = await db.select().from(servers).where(eq(servers.id, id)).limit(1);
  return c.json({ server: updated[0] });
});

// ---------------------------------------------------------------------------
// DELETE /api/v1/servers/:id — owner-only. Cascades via FK ON DELETE CASCADE
// down to channels / agents / members / messages / invites.
// ---------------------------------------------------------------------------
serversRoutes.delete("/api/v1/servers/:id", requireAuth, async (c) => {
  const id = c.req.param("id");
  const ctx = ctxFor(c);
  await requirePolicy(policy.servers.canDelete(ctx, id));
  const db = drizzle(c.env.DB);
  await db.delete(servers).where(eq(servers.id, id));
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// POST /api/v1/servers/:id/leave — self-exit. Non-owner members only;
// owner must transfer or delete instead. Mirrors the kick-member cleanup
// (channel memberships + server membership).
// ---------------------------------------------------------------------------
serversRoutes.post("/api/v1/servers/:id/leave", requireAuth, async (c) => {
  const id = c.req.param("id");
  const subject = c.get("subject");
  const ctx = ctxFor(c);
  await requirePolicy(policy.servers.canLeave(ctx, id));
  await cleanupServerMembership(c.env, id, subject.userId);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// POST /api/v1/servers/:id/seed — owner-only "create Onboarding Assistant +
// welcome channels in this workspace". Two use cases:
//   1. Lazy-seed: personal workspace created via invite-flow signup
//      (servers.seeded=0); first owner visit triggers this via the
//      handler below from getServerBySlug too.
//   2. Restore: owner deleted the Onboarding Assistant and wants the
//      starter content back. Settings → Agents exposes a "Restore" button.
//
// Race-safe: a conditional UPDATE WHERE seeded=0 acts as the lock —
// the second concurrent call sees changes=0 and exits without seeding.
// ---------------------------------------------------------------------------
serversRoutes.post("/api/v1/servers/:id/seed", requireAuth, async (c) => {
  const id = c.req.param("id");
  const subject = c.get("subject");
  // 10/hr/user — bounds accidental restore-button mashing.
  const limited = await rateLimit(c, "server_seed", subject.userId, 10, 3600);
  if (limited) return limited;

  const db = drizzle(c.env.DB);
  const ownerRow = await db.select({ ownerId: servers.ownerId, name: servers.name, seeded: servers.seeded })
    .from(servers).where(eq(servers.id, id)).limit(1);
  if (ownerRow.length === 0) {
    return c.json({ error: { code: "NOT_FOUND", message: "no such server" } }, 404);
  }
  if (subject.kind !== "user" || subject.userId !== ownerRow[0].ownerId) {
    return c.json({ error: { code: "FORBIDDEN", message: "only the workspace owner can seed" } }, 403);
  }

  // Conditional flip seeded 0→1. If 0 rows changed:
  //   - already seeded (1) AND no force flag → return as no-op.
  //   - OR genuinely lost a race; either way return 200/ok with seeded=true.
  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  const force = body && typeof body === "object" && (body as { force?: boolean }).force === true;

  if (!force) {
    const claim = await c.env.DB.prepare("UPDATE servers SET seeded = 1 WHERE id = ? AND seeded = 0")
      .bind(id).run();
    if (!claim.meta.changes) {
      return c.json({ ok: true, seeded: true, created: false });
    }
  } else {
    // force=true is used by the "Restore Onboarding Assistant" UI when
    // the workspace is already seeded (seeded=1) but the agent was
    // manually deleted. WITHOUT a duplicate-check here, a re-run would
    // create a SECOND onboarding agent + a SECOND #onboarding channel
    // alongside the existing ones — exactly the kind of "two of
    // everything" mess users open support tickets about.
    const existing = await db.select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.serverId, id), eq(agents.name, "onboarding")))
      .limit(1);
    if (existing.length > 0) {
      return c.json({ ok: true, seeded: true, created: false, reason: "onboarding_agent_already_exists" });
    }
    // Also guard against half-restored state: an "onboarding" or
    // "onboarding-assistant" channel sitting around from a prior
    // partial run. Skip seeding if either exists; user must delete
    // them manually first (preserves their history).
    const stalChannels = await db.select({ id: channels.id })
      .from(channels)
      .where(and(
        eq(channels.serverId, id),
        inArray(channels.name, ["onboarding", "onboarding-assistant"]),
      ))
      .limit(1);
    if (stalChannels.length > 0) {
      return c.json({
        ok: true, seeded: true, created: false,
        reason: "starter_channel_already_exists",
      });
    }
  }

  // Resolve owner display name for the welcome message.
  const ownerName = (await db.select({ name: user.name }).from(user)
    .where(eq(user.id, ownerRow[0].ownerId)).limit(1))[0]?.name ?? "there";

  try {
    const env = c.env as unknown as Parameters<typeof seedPersonalDefaultsCall>[0];
    await seedPersonalDefaultsCall(env, { id, ownerId: ownerRow[0].ownerId, ownerName });
  } catch (e) {
    // Roll seeded back to 0 so a retry can succeed; surface the error.
    if (!force) {
      await c.env.DB.prepare("UPDATE servers SET seeded = 0 WHERE id = ?").bind(id).run().catch(() => { /* best-effort */ });
    }
    throw e;
  }
  return c.json({ ok: true, seeded: true, created: true });
});
