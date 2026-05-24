/**
 * Raltic Bridge — local daemon that connects per-machine Claude Code agents to
 * the raltic-api Worker over HTTPS + WebSocket.
 *
 * Lifecycle:
 *   1. POST /api/v1/bridge/connect with the user's machine API key.
 *   2. Receive ws token + list of agents + channels they belong to.
 *   3. Open one WS per channel (so we observe real-time `message` events).
 *   4. On inbound `human` message → spawn / poke the matching Claude Code
 *      subprocess via AgentManager.
 */

import {
  type ClientMessage, type ServerMessage,
  type BridgeConnectResponse,
  decodeServer, encode, PROTOCOL_VERSION,
} from "@raltic/protocol";
import WebSocket from "ws";
import { AgentManager } from "./agent-manager.js";
import { hostname, networkInterfaces } from "os";
import { createHash } from "crypto";

/** Stable per-machine fingerprint = sha256(hostname + first MAC). Used
 *  by the api to keep per-laptop runtime snapshots from overwriting each
 *  other when one machine key is used on multiple machines. Falls back
 *  to "default" if we can't compute one (e.g. no NICs). */
function machineFingerprint(): string {
  try {
    const nics = networkInterfaces();
    const macs: string[] = [];
    for (const iface of Object.values(nics)) {
      for (const addr of iface ?? []) {
        if (addr.mac && addr.mac !== "00:00:00:00:00:00") macs.push(addr.mac);
      }
    }
    if (macs.length === 0) return "default";
    const h = createHash("sha256");
    h.update(hostname());
    h.update("|");
    h.update(macs.sort()[0]);
    return h.digest("hex").slice(0, 16);
  } catch {
    return "default";
  }
}

export interface BridgeOpts {
  serverUrl: string;
  apiKey: string;
  agentsDir: string;
}

const TOKEN_REFRESH_MS = 1000 * 60 * 60 * 6; // 6h
const HEARTBEAT_MS = 30_000;
// Liveness heartbeat to /api/v1/bridge/heartbeat — bumps the bridge's
// machine_keys.last_used_at so the Settings → Keys "Active" badge
// stays fresh. Independent of TOKEN_REFRESH (which is heavier and
// re-issues WS tokens). 60s is the sweet spot — fresh enough that the
// UI's stale-window threshold can be a generous 90s, sparse enough
// that 1000 idle bridges cost ~16 D1 writes/sec aggregate.
const BRIDGE_HEARTBEAT_MS = 60_000;

/**
 * undici's WebSocket emits an `ErrorEvent` whose `error` is an empty
 * `TypeError` whenever Cloudflare hibernates / restarts the Worker isolate
 * holding the socket — which happens routinely between requests, not just on
 * deploys. There's nothing actionable: bridge auto-reconnects in 1.5s.
 *
 * Detect this exact noise pattern (TypeError with empty message AND no
 * useful enumerable props) so we can skip logging it. Real errors —
 * connection refused, 401, frame parse failures — all carry message/code
 * fields and still get logged.
 */
function isHibernationNoise(e: unknown): boolean {
  const ev = e as { error?: unknown };
  const err = ev.error ?? e;
  if (!(err instanceof Error)) return false;
  if (err.name !== "TypeError") return false;
  if (err.message && err.message.length > 0) return false;
  const interesting = Object.getOwnPropertyNames(err).filter(
    (k) => k !== "stack" && k !== "message" && k !== "name",
  );
  return interesting.length === 0;
}

function describeWsError(e: unknown): string {
  const ev = e as { error?: unknown; message?: string; type?: string };
  const err = ev.error ?? e;
  if (err instanceof Error) {
    const props: Record<string, unknown> = {};
    for (const k of Object.getOwnPropertyNames(err)) {
      if (k === "stack") continue;
      props[k] = (err as unknown as Record<string, unknown>)[k];
    }
    const cause = (err as { cause?: unknown }).cause;
    const causeStr = cause instanceof Error
      ? `${cause.name}: ${cause.message}`
      : cause !== undefined ? String(cause) : null;
    const stackHead = err.stack?.split("\n").slice(0, 4).join(" | ");
    return [
      `${err.name}: ${err.message || "(empty)"}`,
      Object.keys(props).length ? `props=${JSON.stringify(props)}` : null,
      causeStr ? `cause=${causeStr}` : null,
      stackHead ? `stack=${stackHead}` : null,
    ].filter(Boolean).join(" ");
  }
  return `non-error event type=${ev.type ?? "?"} message=${ev.message ?? "?"}`;
}

export class Bridge {
  private boot?: BridgeConnectResponse;
  private channelSockets = new Map<string, WebSocket>();
  private gatewaySocket: WebSocket | null = null;
  private agentManager: AgentManager;
  private heartbeats = new Map<WebSocket, ReturnType<typeof setInterval>>();
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private gcTimer: ReturnType<typeof setInterval> | null = null;
  private refreshInFlight: Promise<void> | null = null;
  private stopped = false;
  /**
   * Set by the UserGateway DO via leader_status events. When false, this
   * bridge observes channel WS messages but does NOT dispatch them to its
   * local Claude Code subprocess — preventing double-reply when the same
   * user has multiple bridges running. Defaults to false until the DO
   * confirms leadership.
   */
  private isLeader = false;
  private leaderKnown = false;
  private pendingDispatches: Array<{ channelId: string; message: Extract<ServerMessage, { t: "message" }>["message"] }> = [];

  constructor(private opts: BridgeOpts) {
    this.agentManager = new AgentManager({
      apiUrl: opts.serverUrl,
      agentsDir: opts.agentsDir,
    });
  }

  async start(): Promise<void> {
    // Detect runtimes BEFORE /connect so we can include the snapshot
    // in the connect payload (lets the api persist per-machine
    // runtime availability for the Settings + Wizard surfaces).
    const runtimes = await this.agentManager.detectRuntimes();
    for (const r of runtimes) {
      if (r.detected) {
        console.log(`[bridge] runtime ${r.id} ${r.version ?? "?"} ${r.authed ? `(${r.authMethod})` : "(not authed)"}`);
      } else {
        console.log(`[bridge] runtime ${r.id} not available: ${r.error ?? "unknown"}`);
      }
    }

    this.boot = await this.connect(runtimes);
    console.log(`[bridge] connected as user=${this.boot.userId} server=${this.boot.serverId}`);
    console.log(`[bridge] tracking ${this.boot.agents.length} agents in ${this.boot.channels.length} channels`);

    this.agentManager.setBootContext(this.boot);
    this.agentManager.setDetectedRuntimes(runtimes);
    await this.agentManager.initAllAgents(this.boot.agents);

    this.openGatewayWs();
    for (const ch of this.boot.channels) this.openChannelWs(ch.id);

    // Tell the UI every tracked agent is online + ready, OR surface
    // per-agent "runtime not installed/authed" errors. Without the
    // per-agent runtime check, an agent with runtime=codex on a laptop
    // that only has Claude shows green-dot online but never replies —
    // confusing silent failure. broadcastLifecycle now consults the
    // detectedRuntimes snapshot and emits status=error for misaligned
    // agents with a label telling the user what to install.
    await this.agentManager.broadcastLifecycle("idle");

    this.refreshTimer = setInterval(() => this.refreshToken().catch(console.error), TOKEN_REFRESH_MS);
    // Heartbeat — /bridge/heartbeat bumps machine_keys.last_used_at so
    // the Settings → Keys page can render "Active <Nm ago>" liveness.
    // /connect already updates lastUsedAt but only fires every 6h; this
    // smaller ping fires every 60s. Best-effort: failure (offline,
    // 401, network) doesn't tear the bridge down — UI just sees a
    // stale timestamp.
    this.heartbeatTimer = setInterval(() => {
      void this.sendHeartbeat().catch(() => { /* silent */ });
    }, BRIDGE_HEARTBEAT_MS);

    // Periodic workdir GC: agent dirs whose owning agent no longer
    // exists in boot.agents get reclaimed after 72h. Fires once at
    // boot (catches recent stale dirs) and then hourly. Best-effort —
    // errors are logged but never abort bridge run.
    void this.agentManager.gcOrphanWorkdirs().catch((e) => {
      console.warn("[gc] initial sweep failed:", e instanceof Error ? e.message : e);
    });
    this.gcTimer = setInterval(() => {
      void this.agentManager.gcOrphanWorkdirs().catch(() => { /* silent */ });
    }, 60 * 60 * 1000);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    // Tell the UI agents are going offline BEFORE we tear down the WS
    // (otherwise the activity POST may race the WS close).
    await this.agentManager.broadcastLifecycle("error");
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.gcTimer) clearInterval(this.gcTimer);
    for (const t of this.heartbeats.values()) clearInterval(t);
    for (const ws of this.channelSockets.values()) try { ws.close(); } catch { /* ignore */ }
    if (this.gatewaySocket) try { this.gatewaySocket.close(); } catch { /* ignore */ }
    await this.agentManager.shutdown();
  }

  private async connect(
    runtimes?: Array<{
      id: import("@raltic/agent-runtime").RuntimeId;
      detected: boolean;
      version: string | null;
      authed: boolean | null;
      authMethod: "oauth" | "env" | "none" | null;
      error: string | null;
    }>,
  ): Promise<BridgeConnectResponse> {
    const res = await fetch(`${this.opts.serverUrl}/api/v1/bridge/connect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        apiKey: this.opts.apiKey,
        hostname: process.env.HOSTNAME || undefined,
        platform: process.platform,
        arch: process.arch,
        machineFingerprint: machineFingerprint(),
        runtimes,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`bridge connect failed: ${res.status} ${text}`);
    }
    return res.json() as Promise<BridgeConnectResponse>;
  }

  /** Best-effort heartbeat — keeps the Settings → Keys "Active" badge
   *  truthful without re-running the full /connect cost. Errors are
   *  swallowed: a transient network blip shouldn't churn logs every
   *  minute; the user will see staleness in the badge if the bridge
   *  really is down. */
  private async sendHeartbeat(): Promise<void> {
    if (this.stopped) return;
    try {
      await fetch(`${this.opts.serverUrl}/api/v1/bridge/heartbeat`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.opts.apiKey}`,
        },
      });
    } catch {
      // Silent — see comment above.
    }
  }

  private async refreshToken(): Promise<void> {
    if (this.refreshInFlight) return this.refreshInFlight;
    this.refreshInFlight = this.doRefreshToken().finally(() => {
      this.refreshInFlight = null;
    });
    return this.refreshInFlight;
  }

  private async doRefreshToken(): Promise<void> {
    if (this.stopped) return;
    // Re-detect runtimes too — bridge has been up for hours, the user
    // may have installed/uninstalled/logged-in to Codex in the meantime.
    const runtimes = await this.agentManager.detectRuntimes();
    const fresh = await this.connect(runtimes);
    if (this.stopped) return;
    this.boot = fresh;
    this.agentManager.setBootContext(fresh);
    this.agentManager.setDetectedRuntimes(runtimes);
    await this.agentManager.reconcileAgents(fresh.agents);
    await this.agentManager.broadcastLifecycle("idle");
    for (const ws of this.channelSockets.values()) try { ws.close(); } catch { /* ignore */ }
    this.channelSockets.clear();
    if (this.gatewaySocket) try { this.gatewaySocket.close(); } catch { /* ignore */ }
    this.openGatewayWs();
    for (const ch of fresh.channels) this.openChannelWs(ch.id);
  }

  private openChannelWs(channelId: string): void {
    if (!this.boot) return;
    const wsUrl = `${this.boot.wsUrl}/ws/channel/${channelId}?channelId=${channelId}`;
    const ws = new WebSocket(wsUrl, [this.boot.token]);
    this.channelSockets.set(channelId, ws);

    ws.addEventListener("open", () => {
      this.send(ws, { v: PROTOCOL_VERSION, t: "hello", id: crypto.randomUUID() });
      this.startHeartbeat(ws);
    });
    ws.addEventListener("message", (ev) => {
      let msg: ServerMessage;
      try { msg = decodeServer(typeof ev.data === "string" ? ev.data : new TextDecoder().decode(ev.data as ArrayBuffer)); }
      catch { return; }
      if (msg.t === "message") {
        if (msg.message.senderType !== "human") return;
        if (!this.leaderKnown) {
          if (this.pendingDispatches.length < 100) {
            this.pendingDispatches.push({ channelId, message: msg.message });
          }
          return;
        }
        // Multi-bridge leader election: only the leader dispatches to local
        // Claude Code; others observe but stay silent. Prevents double-reply
        // when one user runs the bridge on more than one machine.
        if (!this.isLeader) {
          if (process.env.RALTIC_BRIDGE_VERBOSE) {
            console.log(`[bridge] not leader — skipping dispatch for channel ${channelId.slice(0, 8)}`);
          }
          return;
        }
        this.agentManager.dispatchInboundMessage(channelId, msg.message).catch(console.error);
      }
    });
    ws.addEventListener("close", (e) => {
      const ce = e as { code?: number };
      this.stopHeartbeat(ws);
      if (this.channelSockets.get(channelId) !== ws) return;
      this.channelSockets.delete(channelId);
      if (!this.stopped && ce.code !== 4001 && this.agentManager.hasAgentsForChannel(channelId)) {
        setTimeout(() => this.openChannelWs(channelId), 1500);
      }
    });
    ws.addEventListener("error", (e) => {
      if (isHibernationNoise(e)) return;
      console.error(`[bridge] channel ws error (${channelId}) — ${describeWsError(e)}`);
    });
    ws.addEventListener("close", (e) => {
      const ce = e as { code?: number; reason?: string; wasClean?: boolean };
      // 1006 = abnormal close, almost always an isolate hibernation cycle —
      // bridge will reconnect in 1.5s, no need to log the noise.
      if (ce.code === 4001) return;
      if (ce.code === 1006 && (!ce.reason || ce.reason.length === 0)) return;
      console.error(`[bridge] channel ws close (${channelId}) code=${ce.code} reason=${JSON.stringify(ce.reason ?? "")} clean=${ce.wasClean}`);
    });
  }

  private openGatewayWs(): void {
    if (!this.boot) return;
    const wsUrl = `${this.boot.wsUrl}/ws/user/${this.boot.userId}`;
    const ws = new WebSocket(wsUrl, [this.boot.token]);
    this.gatewaySocket = ws;

    ws.addEventListener("open", () => {
      this.send(ws, {
        v: PROTOCOL_VERSION, t: "hello", id: crypto.randomUUID(),
        agentIds: this.boot!.agents.map((a) => a.id),
      });
      // Gateway socket needs APPLICATION-level heartbeat (vs the raw "ping"
      // for transport keep-alive) so UserGateway DO can detect a half-open
      // bridge socket and exclude it from leader election. Send every 15s.
      this.startGatewayHeartbeat(ws);
    });
    ws.addEventListener("message", (ev) => {
      let msg: ServerMessage;
      try { msg = decodeServer(typeof ev.data === "string" ? ev.data : new TextDecoder().decode(ev.data as ArrayBuffer)); }
      catch { return; }
      if (msg.t === "member_add") {
        if (msg.memberType === "agent") {
          if (this.agentManager.addAgentToChannel(msg.channelId, msg.memberId)) {
            if (!this.channelSockets.has(msg.channelId)) this.openChannelWs(msg.channelId);
          } else {
            this.refreshToken().catch(console.error);
          }
        }
      } else if (msg.t === "member_remove") {
        if (msg.memberType === "agent") {
          this.agentManager.removeAgentFromChannel(msg.channelId, msg.memberId);
          if (!this.agentManager.hasAgentsForChannel(msg.channelId)) {
            const sock = this.channelSockets.get(msg.channelId);
            if (sock) {
              this.channelSockets.delete(msg.channelId);
              try { sock.close(4001, "removed from channel"); } catch { /* ignore */ }
            }
          }
        }
      } else if (msg.t === "leader_status") {
        const wasLeader = this.isLeader;
        const wasKnown = this.leaderKnown;
        this.leaderKnown = true;
        this.isLeader = msg.isLeader;
        if (wasLeader !== this.isLeader) {
          console.log(`[bridge] leader_status: ${this.isLeader ? "I AM leader (will dispatch)" : "NOT leader (observing)"}`);
        }
        if (!wasKnown && this.isLeader && this.pendingDispatches.length > 0) {
          const pending = this.pendingDispatches.splice(0);
          for (const p of pending) {
            this.agentManager.dispatchInboundMessage(p.channelId, p.message).catch(console.error);
          }
        } else if (!this.isLeader) {
          this.pendingDispatches = [];
        }
      }
    });
    ws.addEventListener("close", () => {
      this.stopHeartbeat(ws);
      if (this.gatewaySocket !== ws) return;
      this.gatewaySocket = null;
      this.leaderKnown = false;
      this.isLeader = false;
      this.pendingDispatches = [];
      if (!this.stopped) setTimeout(() => this.openGatewayWs(), 1500);
    });
    ws.addEventListener("error", (e) => {
      if (isHibernationNoise(e)) return;
      console.error(`[bridge] gateway ws error — ${describeWsError(e)}`);
    });
    ws.addEventListener("close", (e) => {
      const ce = e as { code?: number; reason?: string; wasClean?: boolean };
      if (ce.code === 1006 && (!ce.reason || ce.reason.length === 0)) return;
      console.error(`[bridge] gateway ws close code=${ce.code} reason=${JSON.stringify(ce.reason ?? "")} clean=${ce.wasClean}`);
    });
  }

  private startHeartbeat(ws: WebSocket): void {
    const t = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;
      try { ws.send("ping"); } catch { /* ignore */ }
    }, HEARTBEAT_MS);
    this.heartbeats.set(ws, t);
  }
  /** Like startHeartbeat but sends an application-level `heartbeat` so the
   *  UserGateway DO can track liveness for stale-bridge eviction. 15s. */
  private startGatewayHeartbeat(ws: WebSocket): void {
    const t = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;
      try {
        ws.send(encode({ v: PROTOCOL_VERSION, t: "heartbeat", id: crypto.randomUUID() }));
      } catch { /* ignore */ }
    }, 15_000);
    this.heartbeats.set(ws, t);
  }
  private stopHeartbeat(ws: WebSocket): void {
    const t = this.heartbeats.get(ws);
    if (t) { clearInterval(t); this.heartbeats.delete(ws); }
  }
  private send(ws: WebSocket, msg: ClientMessage): void {
    try { ws.send(encode(msg)); } catch { /* ignore */ }
  }
}
