import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { requirePolicy, policy } from "@raltic/auth-core";
import { createAgentRequest, RUNTIME_MODELS } from "@raltic/protocol";
import { agents, channels, channelMembers } from "@raltic/db";
import { and, eq, sql as sqlFn } from "drizzle-orm";
import { z } from "zod";

// Validated patch payload — replaces an unsafe `as Partial<{...}>` cast.
const updateAgentBody = z.object({
  displayName: z.string().min(1).max(64).optional(),
  description: z.string().max(2000).nullable().optional(),
  systemPrompt: z.string().max(50_000).nullable().optional(),
  model: z.string().max(64).optional(),
  // Accept the full RuntimeId enum (matches packages/agent-runtime).
  // openclaw + hermes are external_daemon runtimes — see
  // docs/DESIGN_openclaw_hermes_runtimes.md. The PATCH handler
  // additionally enforces RUNTIME_MODELS combos.
  runtime: z.enum(["claude", "codex", "openclaw", "hermes"]).optional(),
  avatarSeed: z.string().max(64).nullable().optional(),
});
import type { Env, Variables } from "../lib/env";
import { requireAuth, ctxFor } from "../lib/auth";
import { rateLimit } from "../lib/rate-limit";

export const agentsRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
const AGENT_STATUS_STALE_MS = 2 * 60_000;
type AgentStatus = "online" | "sleeping" | "offline";
type AgentRuntimeMode = "bridge" | "raltic" | "claude" | "codex" | "openclaw" | "hermes";

function computedAgentStatus<T extends {
  status: AgentStatus;
  updatedAt: Date | number | string;
  runtimeMode?: AgentRuntimeMode;
}>(agent: T): Omit<T, "status"> & { status: AgentStatus } {
  // Cloud-native runtimes (raltic + sidecar variants) live on our
  // Workers; the DO is always reachable on demand. The legacy
  // bridge-only "is the local daemon connected" semantics don't apply.
  if (agent.runtimeMode && agent.runtimeMode !== "bridge") {
    return { ...agent, status: "online" };
  }
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
// /api/v1/agents — list mine, with each row's DM channel id (if any) so
// the sidebar can link agents directly to their DM. SQL subquery picks
// the DM channel that has both the user AND this agent as members.
// ---------------------------------------------------------------------------
agentsRoutes.get("/api/v1/agents", requireAuth, async (c) => {
  const subject = c.get("subject");
  const db = drizzle(c.env.DB);
  const where = subject.kind === "machine"
    ? and(eq(agents.ownerId, subject.userId), eq(agents.serverId, subject.serverId))
    : eq(agents.ownerId, subject.userId);

  // Fetch agents + DM channel id in two cheap queries (D1 doesn't optimize
  // correlated subqueries well).
  const rows = await db.select().from(agents).where(where);
  if (rows.length === 0) return c.json({ agents: [] });

  // For each agent, find the DM channel that has BOTH the user AND the
  // agent as members. There's typically exactly one (created by POST /agents).
  const ids = rows.map(r => r.id);
  const dmRows = await db
    .select({ agentId: channelMembers.memberId, channelId: channels.id })
    .from(channels)
    .innerJoin(channelMembers, and(
      eq(channelMembers.channelId, channels.id),
      eq(channelMembers.memberType, "agent"),
    ))
    .where(and(
      eq(channels.type, "dm"),
      sqlFn`${channels.id} IN (
        SELECT channel_id FROM channel_members
        WHERE member_id = ${subject.userId} AND member_type = 'human'
      )`,
    ));
  const dmByAgent = new Map<string, string>();
  for (const r of dmRows) {
    if (ids.includes(r.agentId)) dmByAgent.set(r.agentId, r.channelId);
  }

  // Lazy backfill — agents created before the auto-DM feature shipped
  // (e.g. via early POST /agents or the legacy onboarding row) have no
  // DM channel, so the sidebar shows them as un-clickable. Create one
  // now so a refresh "just works" without requiring the user to do
  // anything. Best-effort: failures here are swallowed and surfaced as
  // null dmChannelId (legacy behavior), so the rest of the response
  // still ships.
  if (subject.kind === "user") {
    for (const r of rows) {
      if (dmByAgent.has(r.id)) continue;
      const newChannelId = crypto.randomUUID();
      const now = new Date();
      try {
        await db.batch([
          db.insert(channels).values({
            id: newChannelId,
            serverId: r.serverId,
            name: r.displayName,
            description: `Direct messages with ${r.displayName}`,
            type: "dm",
            createdBy: subject.userId,
            createdAt: now,
          }),
          db.insert(channelMembers).values([
            { channelId: newChannelId, memberId: subject.userId, memberType: "human", joinedAt: now },
            { channelId: newChannelId, memberId: r.id, memberType: "agent", joinedAt: now },
          ]),
        ]);
        dmByAgent.set(r.id, newChannelId);
      } catch (e) {
        // Most likely a race: a concurrent /agents request also tried to
        // backfill. Re-query for the existing row instead of creating a
        // duplicate.
        const existing = await db.select({ id: channels.id })
          .from(channels)
          .innerJoin(channelMembers, and(
            eq(channelMembers.channelId, channels.id),
            eq(channelMembers.memberId, r.id),
            eq(channelMembers.memberType, "agent"),
          ))
          .where(eq(channels.type, "dm"))
          .limit(1);
        if (existing[0]) dmByAgent.set(r.id, existing[0].id);
        else console.warn("[agents.list] DM backfill failed", { agentId: r.id, error: String(e) });
      }
    }
  }

  return c.json({
    agents: rows.map(r => ({ ...computedAgentStatus(r), dmChannelId: dmByAgent.get(r.id) ?? null })),
  });
});

// ---------------------------------------------------------------------------
// /api/v1/agents
// ---------------------------------------------------------------------------
agentsRoutes.post("/api/v1/agents", requireAuth, async (c) => {
  const subject = c.get("subject");
  // 20/hour/user — enough for healthy onboarding bursts (each workspace
  // ships with 0 agents; new users tend to create 3-5 quickly) and
  // tight enough that a compromised cookie can't farm thousands.
  const limited = await rateLimit(c, "agent_create", subject.userId, 20, 3600);
  if (limited) return limited;
  const body = createAgentRequest.parse(await c.req.json());
  const ctx = ctxFor(c);
  await requirePolicy(policy.agents.canCreate(ctx, body.serverId));
  // Workspace-aggregate cap — keeps a 50-member workspace from
  // legitimately spawning 1000 agents/hour collectively. Checked AFTER
  // policy so unauthorized callers can't probe limits.
  const wsLimited = await rateLimit(c, "agent_create_ws", body.serverId, 100, 3600);
  if (wsLimited) return wsLimited;
  const db = drizzle(c.env.DB);
  const id = crypto.randomUUID();
  const dmChannelId = crypto.randomUUID();
  const now = new Date();
  // Atomic batch: create the agent + a DM channel with user+agent as
  // members. Without the DM channel users have nowhere to talk to a new
  // agent until they manually add it to some other channel.
  await db.batch([
    db.insert(agents).values({
      id, serverId: body.serverId, ownerId: subject.userId,
      name: body.name, displayName: body.displayName,
      description: body.description ?? null,
      systemPrompt: body.systemPrompt ?? null,
      model: body.model,
      runtime: body.runtime,
      // P1 W7: persist user's runtime-mode choice. Defaults to 'raltic'
      // (cloud) on the protocol layer; users can still pick 'bridge'.
      runtimeMode: body.runtimeMode,
      status: "offline",
      createdAt: now, updatedAt: now,
    }),
    db.insert(channels).values({
      id: dmChannelId,
      serverId: body.serverId,
      name: body.displayName,           // sidebar label = agent's display name
      description: `Direct messages with ${body.displayName}`,
      type: "dm",
      createdBy: subject.userId,
      createdAt: now,
    }),
    db.insert(channelMembers).values([
      { channelId: dmChannelId, memberId: subject.userId, memberType: "human", joinedAt: now },
      { channelId: dmChannelId, memberId: id, memberType: "agent", joinedAt: now },
    ]),
  ]);

  // Auto-intro — drop a personalized greeting from the agent into the
  // fresh DM channel so users see something the first time they open it,
  // rather than an empty thread that requires them to "say hi first".
  // Fire-and-forget via waitUntil: a DO transient failure shouldn't fail
  // agent creation (the DM still works, just without the intro).
  c.executionCtx.waitUntil(postAutoIntro(c.env, {
    channelId: dmChannelId,
    agentId: id,
    agentDisplayName: body.displayName,
    agentDescription: body.description ?? null,
  }).catch((e) => {
    console.error(JSON.stringify({
      ts: new Date().toISOString(), level: "warn",
      msg: "agent.create.auto_intro_failed",
      agentId: id, channelId: dmChannelId,
      error: e instanceof Error ? e.message : String(e),
    }));
  }));

  return c.json({ id, dmChannelId });
});

/**
 * Compose a short, on-brand intro the agent posts into its own DM so the
 * first thing the user sees is welcoming + actionable. Two paragraphs max
 * — anything longer feels like a wall of marketing copy.
 */
function buildAutoIntro(displayName: string, description: string | null): string {
  const purpose = description?.trim()
    ? description.trim().replace(/[.!?]+$/, "")
    : "help you ship faster";
  return [
    `Hi — I'm ${displayName}. I'm here to ${purpose}.`,
    `Send me a message any time and I'll get to work. You can also @-mention me from any channel I'm in.`,
  ].join("\n\n");
}

async function postAutoIntro(env: Env, opts: {
  channelId: string;
  agentId: string;
  agentDisplayName: string;
  agentDescription: string | null;
}): Promise<void> {
  const stub = env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName(opts.channelId));
  const res = await stub.fetch("https://chat-room/internal/send", {
    method: "POST",
    headers: { "x-internal-secret": env.CHAT_ROOM_AUTH_SECRET, "content-type": "application/json" },
    body: JSON.stringify({
      channelId: opts.channelId,
      senderId: opts.agentId,
      senderType: "agent",
      content: buildAutoIntro(opts.agentDisplayName, opts.agentDescription),
      threadParentId: null,
      // Stable key so the cron-style retry of a flaky DO call doesn't
      // double-post if the same agent creation gets replayed.
      idempotencyKey: `agent-intro:${opts.agentId}`,
    }),
  });
  if (!res.ok) {
    throw new Error(`auto-intro DO returned ${res.status}`);
  }
}

agentsRoutes.patch("/api/v1/agents/:id", requireAuth, async (c) => {
  const id = c.req.param("id");
  const ctx = ctxFor(c);
  await requirePolicy(policy.agents.canUpdate(ctx, id));
  const body = updateAgentBody.parse(await c.req.json());
  const db = drizzle(c.env.DB);

  // Runtime/model whitelist validation — same gate as createAgent
  // applies on PATCH. Otherwise a client flipping `runtime` to gemini
  // (scaffold; spawn throws) or supplying a Claude model string while
  // changing runtime to codex writes an unrunnable combo to DB. We
  // resolve the FINAL combo by reading the current row first when only
  // one of (runtime, model) is in the patch.
  if (body.runtime !== undefined || body.model !== undefined) {
    let finalRuntime = body.runtime;
    let finalModel = body.model;
    if (finalRuntime === undefined || finalModel === undefined) {
      const current = await db.select({ runtime: agents.runtime, model: agents.model })
        .from(agents).where(eq(agents.id, id)).limit(1);
      if (current.length === 0) {
        return c.json({ error: { code: "NOT_FOUND", message: "no such agent" } }, 404);
      }
      // current[0].runtime is plain TEXT after S2 — cast to the
      // narrow request union. Legacy gemini/copilot rows will fall
      // through to the RUNTIME_MODELS lookup below and get a clean
      // 400 INVALID_RUNTIME_MODEL.
      finalRuntime = finalRuntime ?? (current[0].runtime as unknown as typeof finalRuntime);
      finalModel = finalModel ?? current[0].model;
    }
    // Narrow finalRuntime (string from DB after the S2 enum drop) to
    // a known RuntimeId key before indexing RUNTIME_MODELS. An older
    // gemini/copilot row would land in the `!allowed` branch and 400
    // — the only safe behaviour, since those runtimes were removed.
    const runtimeKey = finalRuntime as keyof typeof RUNTIME_MODELS;
    const allowed = RUNTIME_MODELS[runtimeKey];
    if (!allowed || finalModel === undefined || !allowed.includes(finalModel)) {
      return c.json({
        error: {
          code: "INVALID_RUNTIME_MODEL",
          message: `model "${finalModel}" is not valid for runtime "${finalRuntime}" (allowed: ${allowed?.join(", ") ?? "none"})`,
        },
      }, 400);
    }
  }

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (body.displayName !== undefined) patch.displayName = body.displayName;
  if (body.description !== undefined) patch.description = body.description;
  if (body.systemPrompt !== undefined) patch.systemPrompt = body.systemPrompt;
  if (body.model !== undefined) patch.model = body.model;
  if (body.runtime !== undefined) patch.runtime = body.runtime;
  if (body.avatarSeed !== undefined) {
    // Cap to 64 chars — anything longer is unintentional.
    patch.avatarSeed = body.avatarSeed === null ? null : String(body.avatarSeed).slice(0, 64);
  }
  await db.update(agents).set(patch).where(eq(agents.id, id));
  return c.json({ ok: true });
});

agentsRoutes.delete("/api/v1/agents/:id", requireAuth, async (c) => {
  const id = c.req.param("id");
  const ctx = ctxFor(c);
  await requirePolicy(policy.agents.canDelete(ctx, id));
  const db = drizzle(c.env.DB);

  // Find the DM channel(s) this agent was a member of — those are now
  // orphaned (a single-human DM with no peer). Drop them so the sidebar
  // doesn't show dead "Direct messages with <agent>" entries.
  const dmRows = await db
    .select({ channelId: channels.id })
    .from(channels)
    .innerJoin(channelMembers, and(
      eq(channelMembers.channelId, channels.id),
      eq(channelMembers.memberId, id),
      eq(channelMembers.memberType, "agent"),
    ))
    .where(eq(channels.type, "dm"));
  const dmChannelIds = dmRows.map(r => r.channelId);

  // Two sequential awaits — D1 has no transaction across batched
  // statements anyway, and we don't need atomicity here (a partial
  // failure leaves orphan rows that a re-run cleans up).
  await db.delete(channelMembers).where(and(
    eq(channelMembers.memberId, id), eq(channelMembers.memberType, "agent"),
  ));
  for (const cid of dmChannelIds) {
    // FK cascade on channel_members.channelId handles its own membership rows.
    await db.delete(channels).where(eq(channels.id, cid));
  }
  await db.delete(agents).where(eq(agents.id, id));
  return c.json({ ok: true, removedDmChannels: dmChannelIds.length });
});
