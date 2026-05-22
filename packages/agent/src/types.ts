/**
 * RalticAgent type surface.
 *
 * The shapes here are the contract between:
 *   - AgentDispatcher (in apps/api) — what it passes via DO RPC
 *   - RalticAgent DO   — what it persists in state
 *   - useAgentChat hook (web) — what frames the WS streams back
 *
 * Keep this file narrow. Anything that grows should split into a
 * sub-module under src/types/.
 */

import type { LanguageModel } from "ai";

/** Bindings the RalticAgent DO needs at runtime (set in wrangler.jsonc). */
export interface AgentEnv {
  /** D1 binding (shared with apps/api). */
  DB: D1Database;
  /** R2 bucket for workspace persistence (per-agent prefix). */
  WORKSPACES: R2Bucket;
  /** Workers AI for embeddings / Free-tier inference. */
  AI: Ai;
  /** Vectorize binding for semantic message search (D8: one global index). */
  VECTORIZE: VectorizeIndex;
  /** Per-Agent sandbox container, addressed by Agent ID. */
  SANDBOX: DurableObjectNamespace;
  /** ChatRoom DO — agent posts replies via RPC. */
  CHAT_ROOM: DurableObjectNamespace;
  /** UserGateway DO — agent notifies user of cross-channel events. */
  USER_GATEWAY: DurableObjectNamespace;
  /** LLM endpoint base — points at the OpenAI-compatible upstream
   *  (currently easyrouter.io). Per D7 this can later become a CF AI
   *  Gateway URL that proxies to easyrouter, transparently to the agent. */
  AI_GATEWAY_BASE: string;
  /** Optional CF AI Gateway protect-token. Sent as cf-aig-authorization
   *  when AI_GATEWAY_BASE is a gateway URL; ignored by direct routers. */
  AI_GATEWAY_TOKEN?: string;
  /** Platform-side LLM router key (easyrouter, OpenRouter, etc.).
   *  BYO users override this per-request and we pass theirs upstream. */
  LLM_API_KEY?: string;
  /** Pre-shared secret for inter-DO RPC (ChatRoom expects it on the
   *  x-internal-secret header). Wrangler provides this as a secret;
   *  same value shared with apps/api. */
  CHAT_ROOM_AUTH_SECRET: string;
  /** Envelope-encryption KEK for stored connector tokens (P2). 32-byte
   *  AES-GCM key, base64. Used by connector tools to decrypt PATs at
   *  call time. Missing = connector tools refuse to run with a clear
   *  "not configured" error. */
  CONNECTOR_TOKEN_KEY?: string;
}

/** Incoming dispatch from ChatRoom DO (or scheduler). */
export interface AgentInvocation {
  /** Trigger source — affects how we treat the input. */
  source: "channel_mention" | "dm" | "scheduled" | "agent_to_agent";
  channelId: string;
  /** Message id that triggered us (null for scheduled). */
  messageId: string | null;
  /** User-visible text to feed the model. */
  text: string;
  /** Caller identity for ACL checks (was the @-mention by the agent's owner? a stranger? another agent?). */
  callerId: string;
  callerType: "human" | "agent";
}

/** Persistent per-agent state (lives in DO storage). */
export interface AgentState {
  agentId: string;
  workspaceId: string;
  ownerId: string;
  runtime: "raltic";
  /** Conversation history window (compacted when total tokens > 70% context). */
  history: ChatTurn[];
  /** Plan mode: structured todo list the agent edits over multiple turns. */
  todoList: TodoItem[];
  /** Whether this agent has been allocated a sandbox container yet. Lazily
   *  set on first FS/Bash tool call to avoid paying compute cost for
   *  Connector-only agents. */
  workspaceContainerId: string | null;
  /** Per-container bearer the sandbox daemon expects on every RPC.
   *  Generated at container provisioning time and stored alongside the
   *  container id so subsequent invocations re-use the same auth. */
  workspaceContainerBearer: string | null;
  /** Token usage rollup since the agent's plan period started. Reset by
   *  billing worker monthly; used for in-DO quota short-circuit before
   *  we hit AI Gateway. */
  totalTokensThisPeriod: number;
  /** Wall-clock start of the currently-running long task (D3 enforcement).
   *  null = no active task. */
  taskStartedAt: number | null;
  /** Last user-visible activity, for UX "Last active 3m ago" labels. */
  lastActiveAt: number;
  /** Scheduled self-invocations queued via schedule_self tool. The DO's
   *  alarm() handler pops due entries and invokes the agent loop with the
   *  saved prompt. */
  schedules?: ScheduledJob[];
  /** Ring buffer of recent bash output (most-recent ~4 KiB). Written
   *  to by the bash_exec tool wrapper; rendered by the Workspace pane's
   *  "Recent terminal output" surface. Separate from `history` because
   *  the streamText loop emits tool turns that aren't persisted to
   *  history (we keep history as user/assistant only). */
  terminalRing?: string;
  /** Counter of completed onInvoke calls since the last reflection
   *  pass. When it crosses REFLECTION_THRESHOLD, the next invocation's
   *  cleanup schedules a Haiku reflection that consolidates recent
   *  history into long-term memory (memory_remember calls). Reset to 0
   *  after each reflection. Optional + default 0 so pre-P3 state docs
   *  hydrate cleanly. */
  invocationsSinceReflection?: number;
}

export interface ScheduledJob {
  id: string;
  /** Wall-clock ms when the alarm should fire. */
  fireAt: number;
  /** What the agent should do (treated as a user message). */
  prompt: string;
  /** Channel id where the resulting reply gets posted. */
  channelId: string;
  /** Optional UI label for "agent has scheduled this" indicator. */
  label: string;
}

export interface ChatTurn {
  role: "user" | "assistant" | "tool";
  content: string;
  /** Tool call/result wire format aligns with ai SDK v6. */
  toolCalls?: ToolCallRecord[];
  toolResult?: { toolCallId: string; result: unknown };
  /** Approximate token count for this turn (set by streamCompletion onTokenUsage). */
  tokens?: number;
  ts: number;
}

export interface ToolCallRecord {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface TodoItem {
  id: string;
  title: string;
  status: "pending" | "in_progress" | "completed" | "abandoned";
  createdAt: number;
  completedAt?: number;
}

/** Tier policy table — drives D1 quota / D2 sandbox size / D3 task duration. */
export interface AgentTierPolicy {
  plan: "free" | "pro" | "team" | "enterprise";
  /** Max wall-clock seconds for a single task (D3). null = unlimited. */
  maxTaskSeconds: number | null;
  /** Container memory tier (D2), passed to CF Containers binding. */
  sandboxMemoryMb: 512 | 1024 | 2048 | 4096;
  /** Allowed models (free tier locked to Haiku/Flash per D1). */
  allowedModels: readonly string[];
  /** Monthly token quota — agent refuses to call AI Gateway past this. */
  monthlyTokenQuota: number;
}

export const TIER_POLICIES: Record<AgentTierPolicy["plan"], AgentTierPolicy> = {
  free: {
    plan: "free",
    maxTaskSeconds: 5 * 60,             // D3
    sandboxMemoryMb: 512,                // D2
    allowedModels: ["claude-haiku-4-5", "gemini-2.5-flash"],  // D1
    monthlyTokenQuota: 200_000,         // D1
  },
  pro: {
    plan: "pro",
    maxTaskSeconds: 30 * 60,            // D3
    sandboxMemoryMb: 512,                // D2
    allowedModels: ["claude-haiku-4-5", "claude-sonnet-4-6", "gpt-5.4", "gpt-5.5", "gemini-2.5-flash", "gemini-2.5-pro"],
    monthlyTokenQuota: 5_000_000,
  },
  team: {
    plan: "team",
    maxTaskSeconds: 4 * 60 * 60,        // D3
    sandboxMemoryMb: 1024,               // D2
    allowedModels: ["claude-haiku-4-5", "claude-sonnet-4-6", "claude-opus-4-7", "gpt-5.4", "gpt-5.5", "gemini-2.5-flash", "gemini-2.5-pro"],
    monthlyTokenQuota: 20_000_000,
  },
  enterprise: {
    plan: "enterprise",
    maxTaskSeconds: null,               // D3: unlimited
    sandboxMemoryMb: 2048,               // D2
    allowedModels: ["claude-haiku-4-5", "claude-sonnet-4-6", "claude-opus-4-7", "gpt-5.4", "gpt-5.5", "gemini-2.5-flash", "gemini-2.5-pro"],
    monthlyTokenQuota: 100_000_000,
  },
};

/** Re-exported for convenience so consumers don't double-import. */
export type { LanguageModel };
