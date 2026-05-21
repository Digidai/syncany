/**
 * RalticAgent — Durable Object class extending CF Agents SDK's Agent base.
 *
 * One instance per Agent record (DO id = agentId). Owns:
 *   - Conversation history (auto-persisted via `setState`)
 *   - Plan / todo list
 *   - Lazy sandbox container allocation
 *   - Tier-policy enforcement (D1, D2, D3)
 *   - AI Gateway model selection + streaming
 *
 * Wire-in:
 *   apps/api/src/index.ts: `export { RalticAgent } from "@raltic/agent"`
 *   apps/api/wrangler.jsonc: durable_objects.bindings + migrations
 *   apps/api/src/routes/messages.ts: on @mention, dispatch via RPC
 */

import { Agent } from "agents";
import { streamText, stepCountIs } from "ai";
import type { ModelMessage } from "ai";
import { SandboxClient } from "./sandbox-client.js";
import { resolveModel } from "./ai-gateway.js";
import { buildToolRegistry } from "./tools/registry.js";
import { TIER_POLICIES, type AgentEnv, type AgentInvocation, type AgentState, type AgentTierPolicy, type ChatTurn, type TodoItem } from "./types.js";

/** Per-DO mutex so two concurrent invokes serialize their setState calls.
 *  CF Agents SDK doesn't guarantee single-flight invocation; concurrent
 *  @-mentions to the same agent must not race on history append. */
class StateMutex {
  private chain: Promise<void> = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.chain.then(fn, fn);
    this.chain = result.then(() => undefined, () => undefined);
    return result;
  }
}

const INITIAL_STATE: AgentState = {
  agentId: "",
  workspaceId: "",
  ownerId: "",
  runtime: "raltic",
  history: [],
  todoList: [],
  workspaceContainerId: null,
  workspaceContainerBearer: null,
  totalTokensThisPeriod: 0,
  taskStartedAt: null,
  lastActiveAt: 0,
};

const HISTORY_TOKEN_BUDGET = 100_000;   // compaction trigger
const MAX_STEPS = 50;                    // hard cap on tool-call iterations per turn

export class RalticAgent extends Agent<AgentEnv, AgentState> {
  initialState = INITIAL_STATE;
  /** Serialize concurrent onInvoke calls per-DO so history/token state
   *  isn't clobbered when two @-mentions land in the same DO at once. */
  private mutex = new StateMutex();

  // ── Boot: bind identity on first call ──────────────────────────────────
  /**
   * Called by AgentDispatcher RIGHT after `idFromName(agentId)`. The DO
   * doesn't know its own agentId yet (DurableObject names aren't
   * round-trippable from the ctx). We persist the trio (agentId,
   * workspaceId, ownerId) the first time we see them so subsequent
   * calls can verify the caller targeted the right DO instance.
   */
  async bind(input: { agentId: string; workspaceId: string; ownerId: string }): Promise<void> {
    if (this.state.agentId && this.state.agentId !== input.agentId) {
      throw new Error("DO is already bound to a different agent");
    }
    if (!this.state.agentId) {
      await this.setState({
        ...this.state,
        agentId: input.agentId,
        workspaceId: input.workspaceId,
        ownerId: input.ownerId,
        lastActiveAt: Date.now(),
      });
    }
  }

  // ── Main entry: handle a message dispatched by ChatRoom DO ────────────
  async onInvoke(invocation: AgentInvocation): Promise<{ ok: true; messageId?: string } | { ok: false; error: string }> {
    // Boot guard: AI Gateway URL is required; fail fast with a clear
    // error message rather than crashing inside resolveModel.
    if (!this.env.AI_GATEWAY_BASE) {
      return { ok: false, error: "AI_GATEWAY_BASE not configured; set var in wrangler.jsonc" };
    }
    if (!this.state.agentId) {
      return { ok: false, error: "agent not bound — call bind() before onInvoke" };
    }
    // Serialize across concurrent invokes (e.g. two @-mentions land
    // back-to-back). The mutex is per-DO instance which equals per-agent.
    return this.mutex.run(() => this.runInvocation(invocation));
  }

  private async runInvocation(invocation: AgentInvocation): Promise<{ ok: true; messageId?: string } | { ok: false; error: string }> {
    const policy = await this.loadPolicy();

    // Quota check (D1) — short-circuit BEFORE hitting AI Gateway. Saves
    // round-trip + clearly distinguishes our 429 from provider 429.
    if (this.state.totalTokensThisPeriod >= policy.monthlyTokenQuota) {
      return { ok: false, error: "monthly token quota exhausted; upgrade plan or wait for reset" };
    }

    const userTurn: ChatTurn = {
      role: "user",
      content: invocation.text,
      ts: Date.now(),
    };
    const compactedHistory = this.compactIfNeeded([...this.state.history, userTurn]);

    await this.setState({
      ...this.state,
      history: compactedHistory,
      taskStartedAt: Date.now(),
      lastActiveAt: Date.now(),
    });

    // Resolve tools (only sandbox-aware ones touch the container lazily).
    // We pass the agent itself as `agent` so tools can call:
    //   - `agent.ensureSandbox()` to lazy-allocate on first FS/Bash use
    //   - `agent.updateTodo()` to mutate state through the persistence path
    const tools = buildToolRegistry({
      state: this.state,
      env: this.env,
      sandbox: this.currentSandboxClient(),
      ensureSandbox: () => this.ensureSandboxClient(),
      updateTodo: async (next) => { await this.setState({ ...this.state, todoList: next }); },
    });

    // Model selection — first allowed model in the user's tier; the agent
    // creation form will let users pick within their tier later.
    const model = resolveModel({
      env: this.env,
      model: policy.allowedModels[0] ?? "claude-haiku-4-5",
    });

    // Wall-clock task timeout (D3) — drive via an AbortController so the
    // SDK cleanly cancels in-flight HTTP requests.
    const ac = new AbortController();
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    if (policy.maxTaskSeconds !== null) {
      timeoutHandle = setTimeout(() => ac.abort("task timeout"), policy.maxTaskSeconds * 1000);
    }

    let assistantText = "";
    let tokensUsed = 0;
    try {
      const result = streamText({
        model,
        messages: toAiSdkMessages(compactedHistory),
        system: this.systemPrompt(),
        tools,
        // v6 replaced `maxSteps` with stopWhen + stepCountIs.
        stopWhen: stepCountIs(MAX_STEPS),
        abortSignal: ac.signal,
      });

      for await (const delta of result.textStream) {
        assistantText += delta;
        // Stream partial text to ChatRoom DO so the UI sees the agent
        // typing in real time. We don't await — fire-and-forget is fine,
        // any single dropped delta is recovered on the next chunk (the
        // ChatRoom protocol uses replace-semantics, not delta-append).
        void this.postPartial(invocation.channelId, assistantText).catch(() => {});
      }
      const usage = await result.usage;
      tokensUsed = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // Task-timeout: tell the user gracefully instead of dropping.
      const final = ac.signal.aborted
        ? `_Task exceeded ${policy.maxTaskSeconds}s budget for ${policy.plan} plan and was paused. Ask me again to continue._`
        : `_Agent error: ${message}_`;
      assistantText = (assistantText ? assistantText + "\n\n" : "") + final;
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }

    // Final post (full text, replaces the streaming partial).
    let messageId: string | undefined;
    try {
      const posted = await this.postFinal(invocation.channelId, assistantText);
      messageId = posted.messageId;
    } catch (e) {
      console.error("[raltic-agent] postFinal failed:", e);
    }

    // Re-read current state BEFORE final setState so any concurrent
    // tool-level mutations (e.g. todo list updates that landed mid-stream)
    // aren't clobbered. The mutex around onInvoke prevents concurrent
    // *invocations*, but in-flight tool execute() callbacks call setState
    // through updateTodo() which may have advanced state under us.
    const latest = this.state;
    await this.setState({
      ...latest,
      history: [...latest.history.slice(0, compactedHistory.length), ...compactedHistory, {
        role: "assistant",
        content: assistantText,
        ts: Date.now(),
        tokens: tokensUsed,
      }],
      totalTokensThisPeriod: latest.totalTokensThisPeriod + tokensUsed,
      taskStartedAt: null,
      lastActiveAt: Date.now(),
    });

    return messageId ? { ok: true, messageId } : { ok: true };
  }

  // ── Sandbox provisioning ──────────────────────────────────────────────
  /**
   * Lazy allocation: tool execute() handlers call this on first invocation.
   * Generates a per-container bearer the daemon will accept and persists
   * both into DO state so re-invocations re-use the same container.
   *
   * P0 stub note: full CF Containers provisioning RPC lands in P1 W4.
   * For now we derive a stable container id from the agent id; bearer is
   * a fresh nonce. The agent → container WS routing already targets the
   * Container DO via `idFromName`, so the wiring carries over unchanged.
   */
  async ensureSandbox(): Promise<{ containerId: string; bearer: string }> {
    if (this.state.workspaceContainerId && this.state.workspaceContainerBearer) {
      return {
        containerId: this.state.workspaceContainerId,
        bearer: this.state.workspaceContainerBearer,
      };
    }
    const containerId = `sbx-${this.state.agentId.slice(0, 12)}`;
    // 32 random bytes → URL-safe base64. Container start-up reads this from
    // a CF Containers config secret (P1 W4) before spawning the daemon.
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const bearer = btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    await this.setState({
      ...this.state,
      workspaceContainerId: containerId,
      workspaceContainerBearer: bearer,
    });
    return { containerId, bearer };
  }

  private async ensureSandboxClient(): Promise<SandboxClient> {
    const { containerId, bearer } = await this.ensureSandbox();
    if (!this.env.SANDBOX) {
      throw new Error("SANDBOX binding missing — set in wrangler.jsonc (P1 W4)");
    }
    const stub = this.env.SANDBOX.get(this.env.SANDBOX.idFromName(containerId));
    return new SandboxClient(stub, bearer);
  }

  /** Synchronous accessor — returns null when container hasn't been
   *  allocated yet. Tools that need the sandbox should call
   *  `ensureSandbox()` (provided in the tool dispatch ctx) instead. */
  private currentSandboxClient(): SandboxClient | null {
    if (!this.state.workspaceContainerId || !this.state.workspaceContainerBearer) return null;
    if (!this.env.SANDBOX) return null;
    const stub = this.env.SANDBOX.get(this.env.SANDBOX.idFromName(this.state.workspaceContainerId));
    return new SandboxClient(stub, this.state.workspaceContainerBearer);
  }

  private async loadPolicy(): Promise<AgentTierPolicy> {
    // P0 stub: always return free policy. P4 reads billing_plans table.
    return TIER_POLICIES.free;
  }

  private systemPrompt(): string {
    return [
      "You are a Raltic Agent — a long-running AI assistant embedded in the user's workspace.",
      "You can use the provided tools to read/write files, run shell commands, search messages, and post replies.",
      "Prefer the `search_messages` tool over guessing what was said earlier in this workspace.",
      "Use `set_todo` to break multi-step tasks into trackable items; mark them done as you go.",
      "Respond in the language the user used.",
    ].join("\n");
  }

  /** Stream partial assistant text into the channel via ChatRoom DO. */
  private async postPartial(channelId: string, text: string): Promise<void> {
    const stub = this.env.CHAT_ROOM.get(this.env.CHAT_ROOM.idFromName(channelId));
    await stub.fetch("https://chat-room/internal/agent-partial", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // chat-room's checkInternalSecret expects this header. Worker
        // injects CHAT_ROOM_AUTH_SECRET into our env at boot.
        "x-internal-secret": this.env.CHAT_ROOM_AUTH_SECRET,
      },
      body: JSON.stringify({
        agentId: this.state.agentId,
        text,
      }),
    });
  }

  /** Final post — replaces partial, allocates seq, persists to D1. */
  private async postFinal(channelId: string, text: string): Promise<{ messageId: string; seq: number }> {
    const stub = this.env.CHAT_ROOM.get(this.env.CHAT_ROOM.idFromName(channelId));
    // Reuse the existing /internal/send handler. Agent posts MUST go
    // through this path (not /internal/agent-post) so they share
    // dedupe + seq allocation + fanout with all other writes.
    const idempotencyKey = `agent:${this.state.agentId}:${Date.now()}:${crypto.randomUUID().slice(0, 8)}`;
    const res = await stub.fetch("https://chat-room/internal/send", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-secret": this.env.CHAT_ROOM_AUTH_SECRET,
      },
      body: JSON.stringify({
        channelId,
        senderId: this.state.agentId,
        senderType: "agent",
        content: text,
        threadParentId: null,
        idempotencyKey,
      }),
    });
    if (!res.ok) throw new Error(`postFinal: HTTP ${res.status}`);
    return res.json() as Promise<{ messageId: string; seq: number }>;
  }

  /**
   * Trim history when the rolling token estimate crosses
   * HISTORY_TOKEN_BUDGET. Naive strategy for P0: drop the oldest pairs
   * until we're back under budget. P1 W5 swaps in Haiku-based
   * summarization that preserves topical context.
   */
  private compactIfNeeded(history: ChatTurn[]): ChatTurn[] {
    let estTokens = history.reduce((s, m) => s + (m.tokens ?? Math.ceil(m.content.length / 4)), 0);
    if (estTokens < HISTORY_TOKEN_BUDGET) return history;
    const trimmed = [...history];
    while (estTokens > HISTORY_TOKEN_BUDGET * 0.7 && trimmed.length > 4) {
      const dropped = trimmed.shift();
      if (!dropped) break;
      estTokens -= dropped.tokens ?? Math.ceil(dropped.content.length / 4);
    }
    return trimmed;
  }
}

/** Convert our internal ChatTurn[] to ai SDK's CoreMessage[]. Tool
 *  call / result frames in `history` are flattened into their text
 *  form for P0 — full structured replay lands in P1 W5 when we wire
 *  multi-turn tool conversations into the resumable history.
 */
function toAiSdkMessages(history: ChatTurn[]): ModelMessage[] {
  const msgs: ModelMessage[] = [];
  for (const t of history) {
    if (t.role === "tool") continue;     // P0: collapse, see P1 W5
    msgs.push({ role: t.role, content: t.content });
  }
  return msgs;
}
