/**
 * /api/v1/agents/:id/workspace/* — agent workspace browser endpoints.
 *
 * Read-only for P1 (write-via-tools only; users edit through agent
 * conversation, not direct file edit). Routes through the RalticAgent
 * DO → sandbox container so we don't double-implement the security
 * checks (sandbox-daemon already enforces path-escape, size caps, etc).
 *
 * Auth: requireUser (cookie / sy_api_ token). Agent ownership is verified
 * per request. Bridge-mode agents return 400 — their workspace lives on
 * the user's local disk, not in our cloud.
 */
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { agents } from "@raltic/db";
import { requireAuth, requireUser } from "../lib/auth";
import type { Env, Variables } from "../lib/env";

export const agentWorkspaceRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const listQuery = z.object({
  path: z.string().min(1).max(4096).default("."),
});

const readQuery = z.object({
  path: z.string().min(1).max(4096),
  encoding: z.enum(["utf-8", "base64"]).optional(),
});

/**
 * GET /api/v1/agents/:id/workspace/list?path=.
 * Returns directory entries.
 */
agentWorkspaceRoutes.get("/api/v1/agents/:id/workspace/list", requireAuth, requireUser, async (c) => {
  const subject = c.get("subject");
  const agentId = c.req.param("id");
  const { path } = listQuery.parse({ path: c.req.query("path") ?? "." });

  const agent = await assertCloudAgentOwnership(c.env, agentId, subject.userId);
  if ("error" in agent) return c.json({ error: agent.error }, agent.status);

  const result = await proxyToSandbox(c.env, agentId, "/file/list", { path });
  return c.json(result);
});

/**
 * GET /api/v1/agents/:id/workspace/read?path=foo.txt
 * Returns file content (utf-8 or base64).
 */
agentWorkspaceRoutes.get("/api/v1/agents/:id/workspace/read", requireAuth, requireUser, async (c) => {
  const subject = c.get("subject");
  const agentId = c.req.param("id");
  const { path, encoding } = readQuery.parse({
    path: c.req.query("path") ?? "",
    encoding: c.req.query("encoding") ?? undefined,
  });

  const agent = await assertCloudAgentOwnership(c.env, agentId, subject.userId);
  if ("error" in agent) return c.json({ error: agent.error }, agent.status);

  const result = await proxyToSandbox(c.env, agentId, "/file/read", {
    path,
    encoding: encoding ?? "utf-8",
  });
  return c.json(result);
});

/**
 * GET /api/v1/agents/:id/workspace/terminal
 * Returns recent bash output tail captured by the DO (P1+ enhancement
 * adds a proper ring buffer). For now this calls a debug RPC on the
 * agent DO that returns the last lines from state.
 *
 * Returns `{ tail: string }` — empty string if no recent activity.
 */
agentWorkspaceRoutes.get("/api/v1/agents/:id/workspace/terminal", requireAuth, requireUser, async (c) => {
  const subject = c.get("subject");
  const agentId = c.req.param("id");
  const agent = await assertCloudAgentOwnership(c.env, agentId, subject.userId);
  if ("error" in agent) return c.json({ error: agent.error }, agent.status);

  if (!c.env.RALTIC_AGENT) return c.json({ tail: "" });
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stub: any = c.env.RALTIC_AGENT.get(c.env.RALTIC_AGENT.idFromName(agentId));
    if (typeof stub.getTerminalTail === "function") {
      const tail = await stub.getTerminalTail();
      return c.json({ tail: typeof tail === "string" ? tail : "" });
    }
  } catch (e) {
    console.warn("[agent-workspace.terminal]", e);
  }
  return c.json({ tail: "" });
});

// ─── helpers ───────────────────────────────────────────────────────────

async function assertCloudAgentOwnership(env: Env, agentId: string, userId: string): Promise<
  | { agent: { id: string; runtimeMode: string } }
  | { error: { code: string; message: string }; status: 400 | 403 | 404 }
> {
  const db = drizzle(env.DB);
  const rows = await db.select({
    id: agents.id,
    ownerId: agents.ownerId,
    runtimeMode: agents.runtimeMode,
  }).from(agents).where(and(eq(agents.id, agentId), eq(agents.ownerId, userId))).limit(1);
  if (rows.length === 0) {
    return { error: { code: "NOT_FOUND", message: "no such agent (or not yours)" }, status: 404 };
  }
  const row = rows[0]!;
  if (row.runtimeMode === "bridge") {
    return {
      error: {
        code: "BRIDGE_AGENT",
        message: "this agent runs on your local bridge; workspace lives on your disk",
      },
      status: 400,
    };
  }
  return { agent: { id: row.id, runtimeMode: row.runtimeMode } };
}

async function proxyToSandbox(env: Env, agentId: string, path: string, body: unknown): Promise<unknown> {
  if (!env.RALTIC_AGENT) {
    return { error: { code: "NO_AGENT_BINDING", message: "RALTIC_AGENT not configured" } };
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stub: any = env.RALTIC_AGENT.get(env.RALTIC_AGENT.idFromName(agentId));
    if (typeof stub.proxySandbox !== "function") {
      return { error: { code: "SANDBOX_UNAVAILABLE", message: "sandbox not provisioned (P1 W4 pending)" } };
    }
    return await stub.proxySandbox(path, body);
  } catch (e) {
    return { error: { code: "SANDBOX_RPC", message: e instanceof Error ? e.message : String(e) } };
  }
}
