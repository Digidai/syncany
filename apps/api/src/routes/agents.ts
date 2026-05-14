import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { requirePolicy, policy } from "@syncany/auth-core";
import { createAgentRequest } from "@syncany/protocol";
import { agents, channelMembers } from "@syncany/db";
import { and, eq } from "drizzle-orm";
import type { Env, Variables } from "../lib/env";
import { requireAuth, ctxFor } from "../lib/auth";

export const agentsRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---------------------------------------------------------------------------
// /api/v1/agents — list mine
// ---------------------------------------------------------------------------
agentsRoutes.get("/api/v1/agents", requireAuth, async (c) => {
  const subject = c.get("subject");
  const db = drizzle(c.env.DB);
  const rows = await db.select().from(agents).where(eq(agents.ownerId, subject.userId));
  return c.json({ agents: rows });
});

// ---------------------------------------------------------------------------
// /api/v1/agents
// ---------------------------------------------------------------------------
agentsRoutes.post("/api/v1/agents", requireAuth, async (c) => {
  const body = createAgentRequest.parse(await c.req.json());
  const ctx = ctxFor(c);
  const subject = c.get("subject");
  await requirePolicy(policy.agents.canCreate(ctx, body.serverId));
  const db = drizzle(c.env.DB);
  const id = crypto.randomUUID();
  const now = new Date();
  await db.insert(agents).values({
    id, serverId: body.serverId, ownerId: subject.userId,
    name: body.name, displayName: body.displayName,
    description: body.description ?? null,
    systemPrompt: body.systemPrompt ?? null,
    model: body.model, status: "offline",
    createdAt: now, updatedAt: now,
  });
  return c.json({ id });
});

agentsRoutes.patch("/api/v1/agents/:id", requireAuth, async (c) => {
  const id = c.req.param("id");
  const ctx = ctxFor(c);
  await requirePolicy(policy.agents.canUpdate(ctx, id));
  const body = await c.req.json() as Partial<{ displayName: string; description: string | null; systemPrompt: string | null; model: "opus" | "sonnet" | "haiku" }>;
  const db = drizzle(c.env.DB);
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (body.displayName !== undefined) patch.displayName = body.displayName;
  if (body.description !== undefined) patch.description = body.description;
  if (body.systemPrompt !== undefined) patch.systemPrompt = body.systemPrompt;
  if (body.model !== undefined) patch.model = body.model;
  await db.update(agents).set(patch).where(eq(agents.id, id));
  return c.json({ ok: true });
});

agentsRoutes.delete("/api/v1/agents/:id", requireAuth, async (c) => {
  const id = c.req.param("id");
  const ctx = ctxFor(c);
  await requirePolicy(policy.agents.canDelete(ctx, id));
  const db = drizzle(c.env.DB);
  await db.batch([
    db.delete(channelMembers).where(and(eq(channelMembers.memberId, id), eq(channelMembers.memberType, "agent"))),
    db.delete(agents).where(eq(agents.id, id)),
  ]);
  return c.json({ ok: true });
});
