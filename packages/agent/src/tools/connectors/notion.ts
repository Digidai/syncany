/**
 * Notion connector tools (P2-D5).
 *
 * Auth: per-user Notion "Internal Integration Token". The user creates
 * an internal integration at https://www.notion.so/my-integrations,
 * grants it access to the workspaces/pages they want, then pastes the
 * secret token into our connector form. Linear / Github model: stored
 * encrypted, decrypted per call.
 *
 * Notion API has rate limit ~3 req/s. We don't throttle here; the
 * agent's tier-policy max-tool-calls-per-turn keeps us in bounds.
 */
import { tool } from "ai";
import { z } from "zod";
import type { ToolDispatchCtx, ToolRegistry } from "../registry.js";

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

async function resolveNotionConnector(ctx: ToolDispatchCtx): Promise<{ token: string } | null> {
  const sql = `
    SELECT uc.encrypted_token AS encrypted_token
    FROM agent_connectors ac
    INNER JOIN user_connectors uc ON uc.id = ac.connector_id
    WHERE ac.agent_id = ?1 AND uc.kind = 'notion'
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

async function nFetch<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Notion-Version", NOTION_VERSION);
  if (!headers.has("Content-Type") && init.body) headers.set("Content-Type", "application/json");
  const res = await fetch(`${NOTION_API}${path}`, { ...init, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (res.status === 401) throw new Error(`notion 401 (token invalid) — needs:reauth`);
    if (res.status === 429) throw new Error(`notion 429 rate-limited`);
    throw new Error(`notion ${res.status}: ${text.slice(0, 400)}`);
  }
  return res.json() as Promise<T>;
}

/** Strip Notion's rich text blocks to plain string — easier for the
 *  agent to consume than the full nested JSON. */
function richTextToPlain(rt: Array<{ plain_text?: string }> | undefined): string {
  if (!rt) return "";
  return rt.map(r => r.plain_text ?? "").join("");
}

export function notionTools(ctx: ToolDispatchCtx): ToolRegistry {
  return {
    notion_search: tool({
      description:
        "Search Notion pages and databases the connected integration has access to. Returns title, id, and URL of each match.",
      inputSchema: z.object({
        query: z.string().min(1).max(500),
        limit: z.number().int().positive().max(50).optional(),
      }),
      execute: async ({ query, limit }) => {
        const c = await resolveNotionConnector(ctx);
        if (!c) return { error: "no Notion connector enabled for this agent" };
        const r = await nFetch<{ results: Array<{
          id: string; object: string; url: string;
          properties?: Record<string, { title?: Array<{ plain_text?: string }> }>;
          title?: Array<{ plain_text?: string }>;
        }> }>(c.token, "/search", {
          method: "POST",
          body: JSON.stringify({ query, page_size: Math.min(limit ?? 20, 50) }),
        });
        return {
          results: r.results.map(p => {
            // Pages have title under properties; databases have it at top level.
            const titleProp = p.properties && Object.values(p.properties).find(v => v.title);
            const title = richTextToPlain(p.title) || richTextToPlain(titleProp?.title) || "(untitled)";
            return { id: p.id, kind: p.object, title, url: p.url };
          }),
        };
      },
    }),

    notion_read_page: tool({
      description:
        "Fetch the contents of a Notion page as plain markdown-ish text. Returns top-level block text concatenated; nested children are noted but not expanded (use repeated calls for deep pages).",
      inputSchema: z.object({
        // Notion ids are UUIDs — accept both hyphenated and stripped
        // forms. Restrict character set so the value can't escape into
        // another path segment (codex P2 SSRF HIGH finding).
        pageId: z.string().regex(/^[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12}$/, "expected Notion UUID"),
      }),
      execute: async ({ pageId }) => {
        const c = await resolveNotionConnector(ctx);
        if (!c) return { error: "no Notion connector enabled for this agent" };
        const r = await nFetch<{ results: Array<{
          type: string;
          has_children: boolean;
          // Each block type has its own shape; we only sniff text-like ones.
          paragraph?: { rich_text: Array<{ plain_text?: string }> };
          heading_1?: { rich_text: Array<{ plain_text?: string }> };
          heading_2?: { rich_text: Array<{ plain_text?: string }> };
          heading_3?: { rich_text: Array<{ plain_text?: string }> };
          bulleted_list_item?: { rich_text: Array<{ plain_text?: string }> };
          numbered_list_item?: { rich_text: Array<{ plain_text?: string }> };
          to_do?: { rich_text: Array<{ plain_text?: string }>; checked: boolean };
          code?: { rich_text: Array<{ plain_text?: string }>; language: string };
        }> }>(c.token, `/blocks/${pageId}/children?page_size=100`);

        const lines: string[] = [];
        for (const b of r.results) {
          switch (b.type) {
            case "paragraph": lines.push(richTextToPlain(b.paragraph?.rich_text)); break;
            case "heading_1": lines.push(`# ${richTextToPlain(b.heading_1?.rich_text)}`); break;
            case "heading_2": lines.push(`## ${richTextToPlain(b.heading_2?.rich_text)}`); break;
            case "heading_3": lines.push(`### ${richTextToPlain(b.heading_3?.rich_text)}`); break;
            case "bulleted_list_item": lines.push(`- ${richTextToPlain(b.bulleted_list_item?.rich_text)}`); break;
            case "numbered_list_item": lines.push(`1. ${richTextToPlain(b.numbered_list_item?.rich_text)}`); break;
            case "to_do": lines.push(`- [${b.to_do?.checked ? "x" : " "}] ${richTextToPlain(b.to_do?.rich_text)}`); break;
            case "code": lines.push(`\`\`\`${b.code?.language ?? ""}\n${richTextToPlain(b.code?.rich_text)}\n\`\`\``); break;
            default: lines.push(`[${b.type}${b.has_children ? " has children" : ""}]`); break;
          }
        }
        return { text: lines.join("\n\n"), blockCount: r.results.length };
      },
    }),

    notion_create_page: tool({
      description:
        "Create a new Notion page under a parent page. Body is plain text — split into paragraph blocks at newlines.",
      inputSchema: z.object({
        parentPageId: z.string().regex(/^[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12}$/, "expected Notion UUID"),
        title: z.string().min(1).max(256),
        body: z.string().max(64_000).optional(),
      }),
      execute: async ({ parentPageId, title, body }) => {
        const c = await resolveNotionConnector(ctx);
        if (!c) return { error: "no Notion connector enabled for this agent" };
        // Build minimal children blocks from body. Paragraphs per
        // newline; for fancier formatting agents can call notion_append_block.
        const children = body
          ? body.split(/\n+/).filter(s => s.trim()).map(s => ({
            object: "block",
            type: "paragraph",
            paragraph: { rich_text: [{ type: "text", text: { content: s.slice(0, 2_000) } }] },
          }))
          : [];
        const r = await nFetch<{ id: string; url: string }>(c.token, "/pages", {
          method: "POST",
          body: JSON.stringify({
            parent: { page_id: parentPageId },
            properties: {
              title: { title: [{ type: "text", text: { content: title } }] },
            },
            children,
          }),
        });
        return { pageId: r.id, url: r.url };
      },
    }),
  };
}
