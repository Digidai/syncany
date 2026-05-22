/**
 * Linear connector tools (P2-D4).
 *
 * Auth: per-user API key (Linear "Personal API Key"). Same envelope-
 * encryption + per-agent grant model as github.ts. Linear uses GraphQL
 * exclusively — every tool is one POST to /graphql.
 *
 * Why not the official Linear SDK: 200KB+, depends on graphql-js. For
 * a handful of operations, hand-writing GraphQL keeps the agent bundle
 * lean.
 */
import { tool } from "ai";
import { z } from "zod";
import type { ToolDispatchCtx, ToolRegistry } from "../registry.js";

const LINEAR_GRAPHQL = "https://api.linear.app/graphql";

async function resolveLinearConnector(ctx: ToolDispatchCtx): Promise<{ token: string } | null> {
  const sql = `
    SELECT uc.encrypted_token AS encrypted_token
    FROM agent_connectors ac
    INNER JOIN user_connectors uc ON uc.id = ac.connector_id
    WHERE ac.agent_id = ?1 AND uc.kind = 'linear'
    ORDER BY uc.created_at ASC
    LIMIT 1
  `;
  const { results } = await ctx.env.DB.prepare(sql).bind(ctx.state.agentId).all<{ encrypted_token: string }>();
  if (!results || results.length === 0) return null;
  const { decryptConnectorToken } = await import("./decrypt.js");
  const kek = (ctx.env as unknown as { CONNECTOR_TOKEN_KEY?: string }).CONNECTOR_TOKEN_KEY;
  if (!kek) throw new Error("CONNECTOR_TOKEN_KEY not configured on agent env");
  return { token: await decryptConnectorToken(results[0]!.encrypted_token, kek) };
}

async function linearGraphql<T>(token: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(LINEAR_GRAPHQL, {
    method: "POST",
    headers: {
      authorization: token,             // Linear convention: bare token, no "Bearer"
      "content-type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (res.status === 401) throw new Error(`linear 401 (token invalid) — needs:reauth`);
    throw new Error(`linear ${res.status}: ${text.slice(0, 400)}`);
  }
  const body = await res.json() as { data?: T; errors?: Array<{ message: string }> };
  if (body.errors && body.errors.length > 0) {
    throw new Error(`linear graphql error: ${body.errors.map(e => e.message).join("; ")}`);
  }
  if (!body.data) throw new Error("linear graphql: empty data");
  return body.data;
}

export function linearTools(ctx: ToolDispatchCtx): ToolRegistry {
  return {
    linear_list_issues: tool({
      description:
        "List recent Linear issues you have access to. Filter by team key, state, or assignee. Returns id, identifier, title, state.",
      inputSchema: z.object({
        teamKey: z.string().min(1).max(20).optional(),    // e.g. "ENG"
        state: z.enum(["backlog", "unstarted", "started", "completed", "canceled"]).optional(),
        limit: z.number().int().positive().max(50).optional(),
      }),
      execute: async ({ teamKey, state, limit }) => {
        const c = await resolveLinearConnector(ctx);
        if (!c) return { error: "no Linear connector enabled for this agent" };
        const filterParts: string[] = [];
        if (teamKey) filterParts.push(`team: { key: { eq: "${teamKey.replace(/"/g, "")}" } }`);
        if (state) filterParts.push(`state: { type: { eq: "${state}" } }`);
        const filter = filterParts.length > 0 ? `filter: { ${filterParts.join(", ")} },` : "";
        const q = `query Issues { issues(${filter} first: ${Math.min(limit ?? 20, 50)}) { nodes { id identifier title state { name type } } } }`;
        const data = await linearGraphql<{ issues: { nodes: Array<{ id: string; identifier: string; title: string; state: { name: string; type: string } }> } }>(
          c.token, q,
        );
        return { issues: data.issues.nodes };
      },
    }),

    linear_create_issue: tool({
      description:
        "Create a new Linear issue. Requires teamId (use linear_list_issues to discover one).",
      inputSchema: z.object({
        teamId: z.string().min(1).max(64),
        title: z.string().min(1).max(256),
        description: z.string().max(64_000).optional(),
        priority: z.number().int().min(0).max(4).optional(),   // 0=none .. 4=low/urgent (Linear)
      }),
      execute: async ({ teamId, title, description, priority }) => {
        const c = await resolveLinearConnector(ctx);
        if (!c) return { error: "no Linear connector enabled for this agent" };
        const m = `mutation Create($i: IssueCreateInput!) { issueCreate(input: $i) { success issue { id identifier url } } }`;
        const data = await linearGraphql<{ issueCreate: { success: boolean; issue: { id: string; identifier: string; url: string } | null } }>(
          c.token, m, { i: { teamId, title, description, priority } },
        );
        if (!data.issueCreate.success || !data.issueCreate.issue) {
          return { error: "issueCreate returned success=false" };
        }
        return data.issueCreate.issue;
      },
    }),

    linear_comment_issue: tool({
      description: "Add a comment to an existing Linear issue.",
      inputSchema: z.object({
        issueId: z.string().min(1).max(64),
        body: z.string().min(1).max(64_000),
      }),
      execute: async ({ issueId, body }) => {
        const c = await resolveLinearConnector(ctx);
        if (!c) return { error: "no Linear connector enabled for this agent" };
        const m = `mutation Comment($c: CommentCreateInput!) { commentCreate(input: $c) { success comment { id url } } }`;
        const data = await linearGraphql<{ commentCreate: { success: boolean; comment: { id: string; url: string } | null } }>(
          c.token, m, { c: { issueId, body } },
        );
        if (!data.commentCreate.success || !data.commentCreate.comment) {
          return { error: "commentCreate returned success=false" };
        }
        return data.commentCreate.comment;
      },
    }),
  };
}
