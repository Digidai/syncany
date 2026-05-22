/**
 * /api/v1/connectors — manage external-service credentials (P2).
 *
 * Per-user, not per-agent: a user adds a PAT once at the workspace
 * level, then can grant it to specific agents via
 * /api/v1/agents/:id/connectors. Tokens are envelope-encrypted at rest
 * with env.CONNECTOR_TOKEN_KEY (set via `wrangler secret put`).
 *
 * Security model:
 *   - User can only read/write their own connectors (subject.userId).
 *   - Token NEVER leaves the server in plaintext after creation.
 *     GET responses redact the encrypted blob and just surface
 *     {id, kind, label, scopes, createdAt, lastUsedAt}.
 *   - Agents read the decrypted token internally (server-side) when
 *     building tool requests; the token never crosses to the agent's
 *     sandbox container.
 */
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { userConnectors, agentConnectors, agents } from "@raltic/db";
import { encryptToken } from "@raltic/auth-core";
import { requireAuth, requireUser } from "../lib/auth";
import type { Env, Variables } from "../lib/env";

export const connectorsRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const CONNECTOR_KINDS = ["github", "linear", "notion"] as const;

/**
 * Per-kind minimum token length. Real PATs are well above these floors;
 * we reject obviously-bogus shorter values to prevent accidental misuse
 * (codex P2 MED). Generous upper bound — Notion and Linear tokens are
 * comfortably under 200 chars; GitHub fine-grained PATs are ~70 but
 * legacy classic ones can be 40.
 */
const MIN_TOKEN_LEN_BY_KIND: Record<typeof CONNECTOR_KINDS[number], number> = {
  github: 30,    // PATs are ≥40 in practice; 30 leaves headroom for new formats
  linear: 32,    // lin_api_xxxxxxxxxxxxxxxx (≥36)
  notion: 40,    // secret_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx (50)
};

const createBody = z.object({
  kind: z.enum(CONNECTOR_KINDS),
  label: z.string().min(1).max(120),
  token: z.string().min(16).max(1024),     // floor-of-floors; per-kind check below
  scopes: z.array(z.string().min(1).max(64)).max(32).default([]),
}).refine(
  (v) => v.token.length >= MIN_TOKEN_LEN_BY_KIND[v.kind],
  (v) => ({
    message: `token too short for ${v.kind} (need ≥${MIN_TOKEN_LEN_BY_KIND[v.kind]} chars)`,
    path: ["token"],
  }),
);

const linkBody = z.object({
  connectorId: z.string().min(1).max(64),
});

connectorsRoutes.post("/api/v1/connectors", requireAuth, requireUser, async (c) => {
  const subject = c.get("subject");
  const body = createBody.parse(await c.req.json());
  const kek = (c.env as unknown as { CONNECTOR_TOKEN_KEY?: string }).CONNECTOR_TOKEN_KEY;
  if (!kek) {
    // Don't leak the literal secret name to clients (codex Final
    // observability LOW). The operator can grep server logs to see
    // the underlying var.
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      level: "error",
      msg: "connector.kek_missing",
      hint: "set CONNECTOR_TOKEN_KEY via `wrangler secret put`",
    }));
    return c.json({
      error: { code: "NOT_CONFIGURED", message: "connector storage is not configured on this server" },
    }, 503);
  }
  const encryptedToken = await encryptToken(body.token, kek);
  const db = drizzle(c.env.DB);
  const id = crypto.randomUUID();
  await db.insert(userConnectors).values({
    id,
    userId: subject.userId,
    kind: body.kind,
    label: body.label,
    encryptedToken,
    scopes: body.scopes,
    lastUsedAt: null,
  });
  return c.json({
    id, kind: body.kind, label: body.label, scopes: body.scopes,
  });
});

connectorsRoutes.get("/api/v1/connectors", requireAuth, requireUser, async (c) => {
  const subject = c.get("subject");
  const db = drizzle(c.env.DB);
  const rows = await db.select({
    id: userConnectors.id,
    kind: userConnectors.kind,
    label: userConnectors.label,
    scopes: userConnectors.scopes,
    createdAt: userConnectors.createdAt,
    lastUsedAt: userConnectors.lastUsedAt,
  })
    .from(userConnectors)
    .where(eq(userConnectors.userId, subject.userId));
  // Never include encryptedToken in API responses — even ciphertext
  // could aid an offline attacker if the KEK ever leaked.
  return c.json({ connectors: rows });
});

connectorsRoutes.delete("/api/v1/connectors/:id", requireAuth, requireUser, async (c) => {
  const subject = c.get("subject");
  const id = c.req.param("id");
  const db = drizzle(c.env.DB);
  const owned = await db.select({ id: userConnectors.id })
    .from(userConnectors)
    .where(and(eq(userConnectors.id, id), eq(userConnectors.userId, subject.userId)))
    .limit(1);
  if (owned.length === 0) {
    return c.json({ error: { code: "NOT_FOUND", message: "no such connector" } }, 404);
  }
  // Belt-and-suspenders: re-assert ownership in the DELETE WHERE. The
  // pre-check above prevents the path from ever firing for non-owners,
  // but a TOCTOU between the select and the delete (or a future
  // refactor that drops the select) shouldn't expand the blast radius
  // (codex Final review permission MED).
  await db.delete(userConnectors).where(and(
    eq(userConnectors.id, id),
    eq(userConnectors.userId, subject.userId),
  ));
  return c.json({ ok: true });
});

connectorsRoutes.post("/api/v1/agents/:agentId/connectors", requireAuth, requireUser, async (c) => {
  const subject = c.get("subject");
  const agentId = c.req.param("agentId");
  const body = linkBody.parse(await c.req.json());
  const db = drizzle(c.env.DB);
  // Ownership: both records must belong to the caller. Prevents user
  // A from granting user B's agent access to user A's GitHub by
  // colluding URLs.
  const ok = await db.select({ id: agents.id })
    .from(agents)
    .innerJoin(userConnectors, eq(userConnectors.userId, agents.ownerId))
    .where(and(
      eq(agents.id, agentId),
      eq(agents.ownerId, subject.userId),
      eq(userConnectors.id, body.connectorId),
    )).limit(1);
  if (ok.length === 0) {
    return c.json({ error: { code: "NOT_FOUND", message: "agent or connector not found, or not yours" } }, 404);
  }
  try {
    await db.insert(agentConnectors).values({
      agentId,
      connectorId: body.connectorId,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/UNIQUE|already/i.test(msg)) throw e;
  }
  return c.json({ ok: true });
});

connectorsRoutes.delete("/api/v1/agents/:agentId/connectors/:connectorId", requireAuth, requireUser, async (c) => {
  const subject = c.get("subject");
  const agentId = c.req.param("agentId");
  const connectorId = c.req.param("connectorId");
  const db = drizzle(c.env.DB);
  // Verify BOTH the agent AND the connector belong to caller. Before
  // this fix the delete only joined on agent ownership — meaning user A
  // could unlink user B's connector from user A's agent (low-impact
  // but still wrong; codex Final review permission MED).
  const owned = await db.select({ id: agents.id })
    .from(agents)
    .innerJoin(userConnectors, eq(userConnectors.userId, agents.ownerId))
    .where(and(
      eq(agents.id, agentId),
      eq(agents.ownerId, subject.userId),
      eq(userConnectors.id, connectorId),
    ))
    .limit(1);
  if (owned.length === 0) {
    return c.json({ error: { code: "NOT_FOUND", message: "agent or connector not found, or not yours" } }, 404);
  }
  await db.delete(agentConnectors).where(and(
    eq(agentConnectors.agentId, agentId),
    eq(agentConnectors.connectorId, connectorId),
  ));
  return c.json({ ok: true });
});

connectorsRoutes.get("/api/v1/agents/:agentId/connectors", requireAuth, requireUser, async (c) => {
  const subject = c.get("subject");
  const agentId = c.req.param("agentId");
  const db = drizzle(c.env.DB);
  const owned = await db.select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.ownerId, subject.userId)))
    .limit(1);
  if (owned.length === 0) {
    return c.json({ error: { code: "NOT_FOUND", message: "agent not found" } }, 404);
  }
  const linked = await db.select({
    id: userConnectors.id,
    kind: userConnectors.kind,
    label: userConnectors.label,
    scopes: userConnectors.scopes,
  })
    .from(agentConnectors)
    .innerJoin(userConnectors, eq(userConnectors.id, agentConnectors.connectorId))
    .where(eq(agentConnectors.agentId, agentId));
  return c.json({ connectors: linked });
});
