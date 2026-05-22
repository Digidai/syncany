/**
 * AgentDispatcher — routes a channel message at an @mentioned agent to
 * the right runtime (cloud RalticAgent DO, or skip if 'bridge'/'archived').
 *
 * Called from messages.ts after a successful POST /messages/. Best-effort:
 * a dispatch failure must NOT fail the original message write.
 */
import { drizzle } from "drizzle-orm/d1";
import { eq, inArray, and } from "drizzle-orm";
import { agents, channelMembers } from "@raltic/db";
import type { RalticAgent } from "@raltic/agent";
import type { Env } from "./env";

interface DispatchInput {
  channelId: string;
  messageId: string;
  text: string;
  callerId: string;
  callerType: "human" | "agent";
  /** Set of agentIds @-mentioned in the message (extracted by the caller). */
  mentionedAgentIds: string[];
}

/**
 * Dispatch one message to all mentioned agents.
 *
 * Routing per agent.runtime_mode:
 *   'raltic'  → RalticAgent DO (this Worker)
 *   'bridge'  → no-op (the local bridge subscribes to ChatRoom WS directly)
 *   'claude' | 'codex' | 'gemini' | 'copilot' → reserved for sidecar runtimes (P2)
 *
 * Returns successfully even if some agents fail — the caller logs but
 * never rolls back the channel post.
 */
export async function dispatchToAgents(env: Env, input: DispatchInput): Promise<void> {
  console.log(`[agent-dispatch] start channelId=${input.channelId} mentioned=${input.mentionedAgentIds.join(",")}`);
  if (input.mentionedAgentIds.length === 0) {
    console.log(`[agent-dispatch] no mentions; nothing to do`);
    return;
  }
  if (!env.RALTIC_AGENT) {
    console.warn("[agent-dispatch] RALTIC_AGENT binding missing; skipping cloud dispatch");
    return;
  }
  const db = drizzle(env.DB);
  const rows = await db.select({
    id: agents.id,
    serverId: agents.serverId,
    ownerId: agents.ownerId,
    runtimeMode: agents.runtimeMode,
  }).from(agents).where(inArray(agents.id, input.mentionedAgentIds));
  console.log(`[agent-dispatch] resolved ${rows.length} agents; runtimes=${rows.map(r => r.runtimeMode).join(",")}`);

  for (const a of rows) {
    if (a.runtimeMode !== "raltic") continue;   // bridge / sidecar handled elsewhere
    // Use Workers DO native RPC (direct method call) rather than fetch()
    // — the CF Agents SDK base class doesn't auto-route arbitrary URL
    // paths, so the prior fetch("/bind") and fetch("/invoke") landed on
    // Server's default handler which 404'd silently.
    const stub = env.RALTIC_AGENT.get(env.RALTIC_AGENT.idFromName(a.id)) as unknown as DurableObjectStub<RalticAgent>;
    try {
      console.log(`[agent-dispatch] agent=${a.id} bind start`);
      // 1. Bind (idempotent — DO ignores if already bound to this agent).
      await stub.bind({
        agentId: a.id,
        workspaceId: a.serverId,
        ownerId: a.ownerId,
      });
      console.log(`[agent-dispatch] agent=${a.id} bind ok, invoking`);
      // 2. Invoke. Wait for the result so we surface errors instead of
      //    losing them to a dropped fetch promise. The DO posts the
      //    actual reply via ChatRoom internal/send during this call.
      const result = await stub.onInvoke({
        source: "channel_mention",
        channelId: input.channelId,
        messageId: input.messageId,
        text: input.text,
        callerId: input.callerId,
        callerType: input.callerType,
      });
      console.log(`[agent-dispatch] agent=${a.id} onInvoke result=${JSON.stringify(result)}`);
      if (!result.ok) {
        console.error(`[agent-dispatch] agent=${a.id} onInvoke returned error: ${result.error}`);
      }
    } catch (e) {
      console.error(`[agent-dispatch] agent=${a.id} dispatch failed:`, e instanceof Error ? `${e.message}\n${e.stack}` : String(e));
    }
  }
}

/**
 * Extract @-mentioned agent ids from a message body. Accepts two forms:
 *   `@<UUID>`             — literal agent id (web client emits this form)
 *   `@<agent-name>`       — agent slug (humans typing in the composer)
 *
 * Name resolution requires the candidate set keyed by both id and name,
 * which `resolveChannelAgents` builds from the channel's agent members.
 * Returns deduped agent ids.
 */
export interface ChannelAgentRef {
  id: string;
  name: string;        // slug from agents.name
}

export function extractAgentMentions(content: string, candidates: ReadonlyArray<ChannelAgentRef>): string[] {
  const byId = new Map<string, string>(candidates.map(a => [a.id, a.id]));
  const byName = new Map<string, string>(candidates.map(a => [a.name.toLowerCase(), a.id]));
  const out = new Set<string>();
  // UUID form first.
  const uuidRe = /@([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/g;
  let m: RegExpExecArray | null;
  while ((m = uuidRe.exec(content)) !== null) {
    const id = m[1];
    if (id && byId.has(id)) out.add(id);
  }
  // @<name> form — narrower charset to avoid swallowing punctuation.
  // Agent names follow ^[a-z0-9_-]{1,64}$ per existing schema convention.
  // Accept upper-case input though (users type @Code-Reviewer often);
  // we lower-case the captured name before the byName lookup.
  const nameRe = /(^|[^A-Za-z0-9_])@([A-Za-z0-9_-]{1,64})\b/g;
  while ((m = nameRe.exec(content)) !== null) {
    const name = m[2]?.toLowerCase();
    if (!name) continue;
    const id = byName.get(name);
    if (id) out.add(id);
  }
  return [...out];
}

/** Resolve agents that are members of a channel (P0 W3 dispatcher helper).
 *  Returns id + name so name-form mentions resolve. */
export async function resolveChannelAgents(env: Env, channelId: string): Promise<ChannelAgentRef[]> {
  const db = drizzle(env.DB);
  const rows = await db.select({
    id: agents.id,
    name: agents.name,
  })
    .from(channelMembers)
    .innerJoin(agents, eq(agents.id, channelMembers.memberId))
    .where(and(
      eq(channelMembers.channelId, channelId),
      eq(channelMembers.memberType, "agent"),
    ));
  return rows;
}
