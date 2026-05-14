import { DurableObject } from "cloudflare:workers";
import {
  type ClientMessage,
  type ServerMessage,
  decodeClient,
  encode,
  PROTOCOL_VERSION,
} from "@syncany/protocol";
import { verifyWsToken } from "@syncany/auth-core";

export interface UserGatewayEnv {
  DB: D1Database;
  CHAT_ROOM_AUTH_SECRET: string;
}

interface AttachedSession {
  userId: string;
  agentIds: string[];
  bridgeId?: string;            // present for bridge connections (machine-key sessions)
  connectedAt: number;          // ms epoch — used for "latest bridge wins" leader election
  isBridge: boolean;            // true if this socket has a bridgeId
}

/**
 * One DO per user. Carries cross-channel concerns:
 *   - presence broadcasts that aren't tied to a specific channel
 *   - server-wide notifications (agent_added, channel_member_added, …)
 *   - workspace RPC channel for the bridge (file/skills RPCs)
 *
 * Connections come in two shapes:
 *   - browser: subscribes to "what channels appear in my sidebar"
 *   - bridge: subscribes to agent/channel membership changes for its agents
 */
export class UserGateway extends DurableObject<UserGatewayEnv> {
  private sessions = new Map<WebSocket, AttachedSession>();

  constructor(ctx: DurableObjectState, env: UserGatewayEnv) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as AttachedSession | null;
      if (a) this.sessions.set(ws, a);
    }
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.endsWith("/ws")) return this.handleUpgrade(req);
    if (url.pathname.endsWith("/internal/notify")) return this.handleNotify(req);
    return new Response("not found", { status: 404 });
  }

  private async handleUpgrade(req: Request): Promise<Response> {
    if (req.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }
    const protocol = req.headers.get("sec-websocket-protocol") ?? "";
    const token = protocol.split(",")[0]?.trim() ?? "";

    let claims: { userId: string; agentIds: string[]; bridgeId?: string };
    try {
      claims = await this.verify(token);
    } catch {
      return new Response("unauthorized", { status: 401 });
    }

    // Cross-user subscription guard: the api Worker forwarded the URL userId
    // as expectedUserId. The token's `sub` claim MUST match. Without this an
    // attacker could open wss://.../ws/user/<victim> with their own token and
    // join the victim's DO.
    const expected = new URL(req.url).searchParams.get("expectedUserId");
    if (expected && expected !== claims.userId) {
      return new Response("forbidden: token does not match path userId", { status: 403 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    const attached: AttachedSession = {
      userId: claims.userId,
      agentIds: claims.agentIds,
      bridgeId: claims.bridgeId,
      connectedAt: Date.now(),
      isBridge: !!claims.bridgeId,
    };
    server.serializeAttachment(attached);
    this.ctx.acceptWebSocket(server, [`u:${claims.userId}`]);
    this.sessions.set(server, attached);

    // If this is a bridge connection, broadcast leader status to ALL bridges
    // for this user (newly-connected bridge becomes leader; others demote).
    // We can't send on `server` until after the response, so schedule via
    // microtask after returning.
    if (attached.isBridge) {
      queueMicrotask(() => this.broadcastLeaderStatus());
    }

    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { "Sec-WebSocket-Protocol": token },
    });
  }

  /** Tells every bridge socket whether it is currently the leader. */
  private broadcastLeaderStatus(): void {
    let leaderWs: WebSocket | null = null;
    let best = -1;
    const bridgeSockets: { ws: WebSocket; a: AttachedSession }[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      const a = this.sessions.get(ws) ?? (ws.deserializeAttachment() as AttachedSession | null);
      if (!a?.isBridge) continue;
      bridgeSockets.push({ ws, a });
      if (a.connectedAt > best) { best = a.connectedAt; leaderWs = ws; }
    }
    for (const { ws } of bridgeSockets) {
      const isLeader = ws === leaderWs;
      try {
        ws.send(encode({ v: PROTOCOL_VERSION, t: "leader_status", isLeader }));
      } catch { /* ignore */ }
    }
  }

  private async handleNotify(req: Request): Promise<Response> {
    if (req.headers.get("x-internal-secret") !== this.env.CHAT_ROOM_AUTH_SECRET) {
      return new Response("forbidden", { status: 403 });
    }
    const body = await req.json() as ServerMessage;
    this.broadcast(body);
    return Response.json({ ok: true });
  }

  async webSocketMessage(ws: WebSocket, raw: ArrayBuffer | string): Promise<void> {
    let msg: ClientMessage;
    try { msg = decodeClient(raw); }
    catch (e) { this.sendErr(ws, "x", "BAD_MESSAGE", String(e)); return; }

    let sess = this.sessions.get(ws);
    if (!sess) {
      const attached = ws.deserializeAttachment() as AttachedSession | null;
      if (!attached) { this.sendErr(ws, msg.id, "NO_SESSION", "session lost"); return; }
      this.sessions.set(ws, attached);
      sess = attached;
    }

    if (msg.t === "hello") {
      this.send(ws, { v: PROTOCOL_VERSION, t: "ack", id: msg.id });
      return;
    }
    if (msg.t === "rpc") {
      // Forward RPC to the matching peer (web → bridge or bridge → web).
      // TODO: route by `params.targetUserId` once we have multi-recipient RPC.
      this.broadcast({ v: PROTOCOL_VERSION, t: "rpc", id: msg.id, result: msg.params }, ws);
      return;
    }
    this.sendErr(ws, msg.id, "UNSUPPORTED", `gateway DO does not handle ${msg.t}`);
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const wasBridge = this.sessions.get(ws)?.isBridge ?? false;
    this.sessions.delete(ws);
    if (wasBridge) this.broadcastLeaderStatus();
  }
  async webSocketError(ws: WebSocket): Promise<void> {
    const wasBridge = this.sessions.get(ws)?.isBridge ?? false;
    this.sessions.delete(ws);
    if (wasBridge) this.broadcastLeaderStatus();
  }

  /** Delegates to auth-core's single canonical HS256 verifier. */
  private async verify(token: string): Promise<{ userId: string; agentIds: string[]; bridgeId?: string }> {
    const payload = await verifyWsToken(token, this.env.CHAT_ROOM_AUTH_SECRET);
    if (!payload) throw new Error("invalid token");
    return {
      userId: payload.sub,
      agentIds: Array.isArray(payload.agents) ? payload.agents : [],
      bridgeId: payload.bridgeId,
    };
  }

  /** UserGateway DO is per-user (id from name = userId). Every socket here
   *  should belong to the same user, but we still filter by attached userId
   *  as defense-in-depth.
   *
   *  Leader election: if more than one bridge is connected for the same user
   *  (e.g. laptop + desktop), only the most-recently-connected bridge gets
   *  `channel_new` events. Otherwise both bridges would dispatch the same
   *  inbound message to their local Claude Code subprocesses → double reply.
   *  Browser sockets always receive — they don't dispatch agent work.
   */
  private broadcast(msg: ServerMessage, exclude?: WebSocket): void {
    const text = encode(msg);
    const sample = this.sessions.values().next().value as AttachedSession | undefined;
    const ownerId = sample?.userId;

    // Determine the leader bridge socket (latest connectedAt wins).
    const isLeaderEligible = (msg as { t?: string }).t === "channel_new";
    let leaderBridgeWs: WebSocket | null = null;
    if (isLeaderEligible) {
      let best = -1;
      for (const ws of this.ctx.getWebSockets()) {
        const a = this.sessions.get(ws) ?? (ws.deserializeAttachment() as AttachedSession | null);
        if (!a?.isBridge) continue;
        if (a.connectedAt > best) { best = a.connectedAt; leaderBridgeWs = ws; }
      }
    }

    for (const ws of this.ctx.getWebSockets()) {
      if (ws === exclude) continue;
      const a = this.sessions.get(ws) ?? (ws.deserializeAttachment() as AttachedSession | null);
      if (ownerId && a && a.userId !== ownerId) continue;
      // Leader-only routing for channel_new: skip non-leader bridges.
      if (isLeaderEligible && a?.isBridge && ws !== leaderBridgeWs) continue;
      try { ws.send(text); } catch { /* ignore */ }
    }
  }
  private send(ws: WebSocket, msg: ServerMessage): void {
    try { ws.send(encode(msg)); } catch { /* ignore */ }
  }
  private sendErr(ws: WebSocket, id: string, code: string, message: string): void {
    this.send(ws, { v: PROTOCOL_VERSION, t: "err", id, code, message });
  }
}
