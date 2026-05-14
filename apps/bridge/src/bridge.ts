/**
 * Syncany Bridge — local daemon that connects per-machine Claude Code agents to
 * the syncany-api Worker over HTTPS + WebSocket.
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
} from "@syncany/protocol";
import { AgentManager } from "./agent-manager.js";

interface BridgeOpts {
  serverUrl: string;
  apiKey: string;
  agentsDir: string;
}

const TOKEN_REFRESH_MS = 1000 * 60 * 60 * 6; // 6h
const HEARTBEAT_MS = 30_000;

export class Bridge {
  private boot?: BridgeConnectResponse;
  private channelSockets = new Map<string, WebSocket>();
  private gatewaySocket: WebSocket | null = null;
  private agentManager: AgentManager;
  private heartbeats = new Map<WebSocket, ReturnType<typeof setInterval>>();
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  /**
   * Set by the UserGateway DO via leader_status events. When false, this
   * bridge observes channel WS messages but does NOT dispatch them to its
   * local Claude Code subprocess — preventing double-reply when the same
   * user has multiple bridges running. Defaults to false until the DO
   * confirms leadership.
   */
  private isLeader = false;

  constructor(private opts: BridgeOpts) {
    this.agentManager = new AgentManager({
      apiUrl: opts.serverUrl,
      agentsDir: opts.agentsDir,
    });
  }

  async start(): Promise<void> {
    this.boot = await this.connect();
    console.log(`[bridge] connected as user=${this.boot.userId} server=${this.boot.serverId}`);
    console.log(`[bridge] tracking ${this.boot.agents.length} agents in ${this.boot.channels.length} channels`);

    this.agentManager.setBootContext(this.boot);
    await this.agentManager.initAllAgents(this.boot.agents);

    for (const ch of this.boot.channels) this.openChannelWs(ch.id);
    this.openGatewayWs();

    this.refreshTimer = setInterval(() => this.refreshToken().catch(console.error), TOKEN_REFRESH_MS);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    for (const t of this.heartbeats.values()) clearInterval(t);
    for (const ws of this.channelSockets.values()) try { ws.close(); } catch { /* ignore */ }
    if (this.gatewaySocket) try { this.gatewaySocket.close(); } catch { /* ignore */ }
    await this.agentManager.shutdown();
  }

  private async connect(): Promise<BridgeConnectResponse> {
    const res = await fetch(`${this.opts.serverUrl}/api/v1/bridge/connect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        apiKey: this.opts.apiKey,
        hostname: process.env.HOSTNAME || undefined,
        platform: process.platform,
        arch: process.arch,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`bridge connect failed: ${res.status} ${text}`);
    }
    return res.json() as Promise<BridgeConnectResponse>;
  }

  private async refreshToken(): Promise<void> {
    if (this.stopped) return;
    const fresh = await this.connect();
    this.boot = fresh;
    this.agentManager.setBootContext(fresh);
    for (const ws of this.channelSockets.values()) try { ws.close(); } catch { /* ignore */ }
    this.channelSockets.clear();
    if (this.gatewaySocket) try { this.gatewaySocket.close(); } catch { /* ignore */ }
    for (const ch of fresh.channels) this.openChannelWs(ch.id);
    this.openGatewayWs();
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
        // Multi-bridge leader election: only the leader dispatches to local
        // Claude Code; others observe but stay silent. Prevents double-reply
        // when one user runs the bridge on more than one machine.
        if (!this.isLeader) {
          if (process.env.SYNCANY_BRIDGE_VERBOSE) {
            console.log(`[bridge] not leader — skipping dispatch for channel ${channelId.slice(0, 8)}`);
          }
          return;
        }
        this.agentManager.dispatchInboundMessage(channelId, msg.message).catch(console.error);
      }
    });
    ws.addEventListener("close", () => {
      this.stopHeartbeat(ws);
      this.channelSockets.delete(channelId);
      if (!this.stopped) setTimeout(() => this.openChannelWs(channelId), 1500);
    });
    ws.addEventListener("error", (e) => {
      console.error(`[bridge] channel ws error (${channelId})`, (e as any).message ?? e);
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
      this.startHeartbeat(ws);
    });
    ws.addEventListener("message", (ev) => {
      let msg: ServerMessage;
      try { msg = decodeServer(typeof ev.data === "string" ? ev.data : new TextDecoder().decode(ev.data as ArrayBuffer)); }
      catch { return; }
      if (msg.t === "member_add") {
        if (!this.channelSockets.has(msg.channelId)) this.openChannelWs(msg.channelId);
      } else if (msg.t === "leader_status") {
        const wasLeader = this.isLeader;
        this.isLeader = msg.isLeader;
        if (wasLeader !== this.isLeader) {
          console.log(`[bridge] leader_status: ${this.isLeader ? "I AM leader (will dispatch)" : "NOT leader (observing)"}`);
        }
      }
    });
    ws.addEventListener("close", () => {
      this.stopHeartbeat(ws);
      this.gatewaySocket = null;
      if (!this.stopped) setTimeout(() => this.openGatewayWs(), 1500);
    });
    ws.addEventListener("error", (e) => {
      console.error("[bridge] gateway ws error", (e as any).message ?? e);
    });
  }

  private startHeartbeat(ws: WebSocket): void {
    const t = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;
      try { ws.send("ping"); } catch { /* ignore */ }
    }, HEARTBEAT_MS);
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
