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
import { generateText, streamText, stepCountIs } from "ai";
import type { ModelMessage } from "ai";
import { SandboxClient } from "./sandbox-client.js";
import { resolveModel } from "./ai-gateway.js";
import { buildToolRegistry } from "./tools/registry.js";
import { TIER_POLICIES, type AgentEnv, type AgentInvocation, type AgentState, type AgentTierPolicy, type ChatTurn, type ScheduledJob, type TodoItem } from "./types.js";

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
  schedules: [],
};

const HISTORY_TOKEN_BUDGET = 100_000;   // compaction trigger
const MAX_STEPS = 50;                    // hard cap on tool-call iterations per turn

export class RalticAgent extends Agent<AgentEnv, AgentState> {
  initialState = INITIAL_STATE;
  /** Serialize concurrent onInvoke calls per-DO so history/token state
   *  isn't clobbered when two @-mentions land in the same DO at once. */
  private mutex = new StateMutex();
  /** Serialize ALL schedule reads/writes including the alarm handler's
   *  pop+re-arm. Without this, alarm() can snapshot schedules, then a
   *  concurrent schedule_self appends, then alarm()'s write overwrites
   *  with `remaining` (codex HIGH). */
  private scheduleLock = new StateMutex();

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
    const compactedHistory = await this.compactIfNeeded([...this.state.history, userTurn]);

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
      updateSchedules: async (updater) => {
        // Compute against the freshest state at write time and serialize
        // through scheduleLock so concurrent tool calls (and the alarm
        // handler) can't lose each other's mutations (codex HIGH x2).
        return this.scheduleLock.run(async () => {
          const next = updater(this.state.schedules ?? []);
          await this.setState({ ...this.state, schedules: next });
          await this.refreshAlarm();
          return next;
        });
      },
      appendTerminal: async (chunk) => {
        // Best-effort ring buffer write. Caps at 4 KiB so the Workspace
        // pane's pane doesn't render megabytes of bash output. Codex
        // round 3 MED — getTerminalTail used to read `tool` history
        // turns that were never persisted.
        const RING_CAP = 4_000;
        const combined = ((this.state.terminalRing ?? "") + chunk).slice(-RING_CAP);
        try {
          await this.setState({ ...this.state, terminalRing: combined });
        } catch (e) {
          console.warn("[raltic-agent] appendTerminal failed:", e);
        }
      },
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
    // tool-level mutations (e.g. todoList / schedules updates that landed
    // mid-stream) aren't clobbered. The mutex around onInvoke prevents
    // concurrent *invocations*, but in-flight tool execute() callbacks
    // call setState through updateTodo()/updateSchedules() which advance
    // state under us. We preserve everything EXCEPT history (which we
    // own this turn), then overwrite history with the canonical chain:
    // compactedHistory (which already includes the user turn) + the
    // assistant turn we just produced.
    //
    // Earlier draft accidentally concatenated `latest.history.slice(0,
    // compactedHistory.length)` AS A PREFIX to compactedHistory — that
    // duplicated every existing turn and made the history grow
    // quadratically across turns (codex caught this).
    const latest = this.state;
    await this.setState({
      ...latest,
      history: [...compactedHistory, {
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

  /**
   * Proxy a single RPC call to this agent's sandbox container. Used by
   * /api/v1/agents/:id/workspace/* endpoints (file list, file read,
   * etc.) so the workspace pane can view what the agent has built
   * without us re-implementing the sandbox RPC client at the api
   * Worker layer.
   *
   * P1 stub: if the sandbox isn't allocated yet, allocates lazily.
   * Returns the sandbox response verbatim.
   */
  async proxySandbox(path: string, body: unknown): Promise<unknown> {
    if (!this.state.agentId) {
      return { error: { code: "NOT_BOUND", message: "agent not bound; cannot proxy sandbox" } };
    }
    if (!this.env.SANDBOX) {
      return { error: { code: "NO_SANDBOX", message: "SANDBOX binding missing" } };
    }
    // Use the values from ensureSandbox() return DIRECTLY — re-reading
    // this.state.workspaceContainerId after the await re-introduces a
    // race where a concurrent state update overwrites under us (codex
    // architecture HIGH).
    const { containerId, bearer } = await this.ensureSandbox();
    const stub = this.env.SANDBOX.get(this.env.SANDBOX.idFromName(containerId));
    const res = await stub.fetch(`https://sandbox${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${bearer}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      // Surface the sandbox's structured error body verbatim.
      try { return await res.json(); }
      catch { return { error: { code: "SANDBOX_HTTP", message: `HTTP ${res.status}` } }; }
    }
    return res.json();
  }

  /**
   * Recent terminal tail — the running ring buffer written by the
   * bash_exec tool wrapper via ctx.appendTerminal. Returns at most 4 KiB
   * of recent stdout/stderr; empty string if no bash has run yet on this
   * agent. The Workspace pane polls /workspace/terminal periodically.
   */
  async getTerminalTail(): Promise<string> {
    return (this.state.terminalRing ?? "").trim();
  }

  // ── Sandbox provisioning ──────────────────────────────────────────────
  /**
   * In-flight provisioning promise so concurrent tool calls don't both
   * generate bearer / call container start (codex review caught the race).
   * Cleared when the underlying promise settles; subsequent calls
   * fast-path on the persisted state.
   */
  private sandboxProvisioning: Promise<{ containerId: string; bearer: string }> | null = null;

  /**
   * Lazy allocation: tool execute() handlers call this on first invocation.
   * Generates a per-container bearer the daemon will accept and persists
   * both into DO state so re-invocations re-use the same container.
   *
   * Concurrency: returns the same in-flight promise to all concurrent
   * callers, so two simultaneous first-tool-call paths produce ONE
   * container with ONE bearer (codex review HIGH).
   *
   * Container env: passes the bearer in via `envVars` so the container's
   * @raltic/sandbox-daemon reads RALTIC_SANDBOX_TOKEN at boot (codex
   * infra HIGH — without this the daemon exits at startup).
   */
  async ensureSandbox(): Promise<{ containerId: string; bearer: string }> {
    if (!this.state.agentId) {
      throw new Error("ensureSandbox called before bind() — agent identity unknown");
    }
    if (this.state.workspaceContainerId && this.state.workspaceContainerBearer) {
      return {
        containerId: this.state.workspaceContainerId,
        bearer: this.state.workspaceContainerBearer,
      };
    }
    if (this.sandboxProvisioning) return this.sandboxProvisioning;
    this.sandboxProvisioning = (async () => {
      try {
        // Double-check after acquiring the lock — another caller may have
        // completed provisioning while we were waiting.
        if (this.state.workspaceContainerId && this.state.workspaceContainerBearer) {
          return {
            containerId: this.state.workspaceContainerId,
            bearer: this.state.workspaceContainerBearer,
          };
        }
        const containerId = `sbx-${this.state.agentId.slice(0, 12)}`;
        // 32 random bytes → URL-safe base64. Container start-up reads this from
        // RALTIC_SANDBOX_TOKEN env via the start() envVars we pass below.
        const bytes = new Uint8Array(32);
        crypto.getRandomValues(bytes);
        const bearer = btoa(String.fromCharCode(...bytes))
          .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
        // Start the container with the bearer injected. SandboxContainer
        // class exposes `start({ envVars })` from @cloudflare/containers.
        // Narrow type local to this call so we don't sprinkle `any`
        // across the file — refactor of @cloudflare/containers API
        // would surface here (codex round 3 LOW).
        if (this.env.SANDBOX) {
          type StartCapable = {
            start?: (opts: { envVars?: Record<string, string> }) => Promise<unknown>;
          };
          const stub = this.env.SANDBOX.get(this.env.SANDBOX.idFromName(containerId)) as unknown as StartCapable;
          if (typeof stub.start === "function") {
            try {
              await stub.start({
                envVars: {
                  RALTIC_SANDBOX_TOKEN: bearer,
                  RALTIC_SANDBOX_WORKSPACE: "/workspace",
                  RALTIC_SANDBOX_PORT: "8080",
                },
              });
            } catch (e) {
              // Start is idempotent in CF Containers; failures here are
              // logged but not fatal (the first containerFetch will
              // retry-start as needed).
              console.warn("[raltic-agent] container start hint failed:", e);
            }
          }
        }
        await this.setState({
          ...this.state,
          workspaceContainerId: containerId,
          workspaceContainerBearer: bearer,
        });
        return { containerId, bearer };
      } finally {
        this.sandboxProvisioning = null;
      }
    })();
    return this.sandboxProvisioning;
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
   * Compact history when the rolling token estimate crosses
   * HISTORY_TOKEN_BUDGET. P1 strategy: summarize the OLDEST half via
   * Haiku into a single compact "memory" turn, keep the most recent
   * half verbatim. P0 used naive truncation which dropped context.
   *
   * Falls back to truncation if the Haiku call fails (network blip,
   * over-quota) so a compaction failure never blocks the agent.
   */
  private async compactIfNeeded(history: ChatTurn[]): Promise<ChatTurn[]> {
    const estTokens = (h: ChatTurn[]) =>
      h.reduce((s, m) => s + (m.tokens ?? Math.ceil(m.content.length / 4)), 0);
    if (estTokens(history) < HISTORY_TOKEN_BUDGET) return history;

    // Split: oldest half summarized, newest half kept verbatim.
    const splitAt = Math.floor(history.length / 2);
    const toSummarize = history.slice(0, splitAt);
    const keep = history.slice(splitAt);
    if (toSummarize.length === 0) return history;

    try {
      const summaryModel = resolveModel({
        env: this.env,
        model: "claude-haiku-4-5",
      });
      const formatted = toSummarize
        .map(t => `${t.role.toUpperCase()}: ${t.content}`)
        .join("\n\n");
      const { text } = await generateText({
        model: summaryModel,
        system:
          "You compact long conversation history into a single dense summary. " +
          "Preserve: decisions made, key facts, names, urls, file paths, error messages. " +
          "Drop: pleasantries, redundant phrasing, intermediate thinking. " +
          "Output one paragraph (max ~500 tokens) starting with 'Earlier in this conversation: '.",
        prompt: formatted,
      });
      const summaryTurn: ChatTurn = {
        role: "user",   // assistant might re-quote; user role keeps it as context
        content: text,
        tokens: Math.ceil(text.length / 4),
        ts: Date.now(),
      };
      return [summaryTurn, ...keep];
    } catch (e) {
      console.warn("[raltic-agent] compaction summarize failed, falling back to truncation:", e);
      // Naive truncation fallback — drop oldest until under budget.
      let est = estTokens(history);
      const trimmed = [...history];
      while (est > HISTORY_TOKEN_BUDGET * 0.7 && trimmed.length > 4) {
        const dropped = trimmed.shift();
        if (!dropped) break;
        est -= dropped.tokens ?? Math.ceil(dropped.content.length / 4);
      }
      return trimmed;
    }
  }

  // ── DO Alarm: scheduled self-invocations (schedule_self tool) ────────
  /**
   * Set the DO alarm to the EARLIEST due fireAt across all pending
   * schedules. Caller is responsible for holding scheduleLock so this
   * doesn't race with concurrent updateSchedules or alarm() pop.
   *
   * Always reconciles to the COMPUTED earliest:
   *   - 0 schedules → deleteAlarm
   *   - n schedules → setAlarm(earliest) iff it differs from getAlarm
   * Codex MED: previous version only set when current > earliest, so
   * canceling the earliest job left a stale earlier alarm fire.
   */
  private async refreshAlarm(): Promise<void> {
    const schedules = this.state.schedules ?? [];
    if (schedules.length === 0) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    const earliest = schedules.reduce((min, j) => Math.min(min, j.fireAt), Infinity);
    const current = await this.ctx.storage.getAlarm();
    if (current !== earliest) {
      await this.ctx.storage.setAlarm(earliest);
    }
  }

  /**
   * DO alarm handler — pop all due jobs and run each as a fresh
   * invocation. Pop + write goes through scheduleLock so a concurrent
   * schedule_self append can't be lost (codex HIGH).
   *
   * Each fired job runs through the invocation mutex; multiple due
   * jobs serialize.
   */
  async alarm(): Promise<void> {
    const now = Date.now();
    const due = await this.scheduleLock.run(async () => {
      const schedules = this.state.schedules ?? [];
      const due = schedules.filter(j => j.fireAt <= now);
      if (due.length === 0) {
        await this.refreshAlarm();
        return [];
      }
      const remaining = schedules.filter(j => j.fireAt > now);
      await this.setState({ ...this.state, schedules: remaining });
      await this.refreshAlarm();
      return due;
    });
    for (const job of due) {
      try {
        await this.mutex.run(() => this.runInvocation({
          source: "scheduled",
          channelId: job.channelId,
          messageId: null,
          text: job.prompt,
          callerId: this.state.agentId,
          callerType: "agent",
        }));
      } catch (e) {
        console.error(`[raltic-agent] scheduled job ${job.id} failed:`, e);
      }
    }
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
