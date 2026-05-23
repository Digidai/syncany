import { DurableObject } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { inArray } from "drizzle-orm";
import { agents } from "@raltic/db";
import {
  type ClientMessage,
  type ServerMessage,
  decodeClient,
  encode,
  PROTOCOL_VERSION,
} from "@raltic/protocol";
import { verifyWsToken } from "@raltic/auth-core";

export interface UserGatewayEnv {
  DB: D1Database;
  CHAT_ROOM_AUTH_SECRET: string;
  /** WorkspacePresence DO namespace. Bound by apps/api/wrangler.jsonc.
   *  UserGateway forwards client presence_subscribe / _unsubscribe
   *  intents here and receives broadcast deltas back over
   *  /internal/presence. */
  WORKSPACE_PRESENCE: DurableObjectNamespace;
}

interface AttachedSession {
  userId: string;
  agentIds: string[];
  bridgeId?: string;            // present for bridge connections (machine-key sessions)
  connectedAt: number;          // ms epoch — used for "latest bridge wins" leader election
  isBridge: boolean;            // true if this socket has a bridgeId
  lastHeartbeatAt?: number;     // ms epoch — bumped on every clientHeartbeat
  /** serverIds this socket is currently subscribed to for workspace
   *  presence updates. Survives hibernation via serializeAttachment so
   *  the gateway can decrement the right WorkspacePresence DOs on
   *  webSocketClose. */
  presenceSubs?: string[];
}

/** Bridge sockets older than this with no heartbeat are excluded from
 *  leader election. The bridge sends one every 15s; we tolerate ~2 misses. */
const BRIDGE_LIVENESS_WINDOW_MS = 45_000;

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
  /**
   * Per-serverId broadcast-subscription refcount across all of THIS
   * user's active tabs/sessions. WorkspacePresence DO only needs to
   * know this user once for fanout purposes — we tell it /presence/sub
   * on the FIRST tab and /presence/unsub on the LAST tab. Individual
   * tab opens still bump /presence/note (that's the per-tab ref-count
   * used for online/offline detection).
   *
   * Earlier draft sent unsub on every tab close, which removed the
   * userId from WorkspacePresence.subscribers → other tabs of the
   * same user stopped getting deltas (codex 2 HIGH).
   *
   * Rehydrate on DO restart from persisted session attachments so
   * the count survives eviction.
   */
  private presenceSubCounts = new Map<string, number>();

  constructor(ctx: DurableObjectState, env: UserGatewayEnv) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as AttachedSession | null;
      if (a) {
        this.sessions.set(ws, a);
        // Rebuild presence sub-counts from each session's recorded
        // serverIds so a DO restart doesn't lose multi-tab state.
        for (const sid of a.presenceSubs ?? []) {
          this.presenceSubCounts.set(sid, (this.presenceSubCounts.get(sid) ?? 0) + 1);
        }
      }
    }
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.endsWith("/ws")) return this.handleUpgrade(req);
    if (url.pathname.endsWith("/internal/notify")) return this.handleNotify(req);
    if (url.pathname.endsWith("/internal/presence")) return this.handlePresenceBroadcast(req);
    return new Response("not found", { status: 404 });
  }

  /** Called by WorkspacePresence DO when a peer's online state flips.
   *  Forwards the JSON payload to every live WS owned by this user. */
  private async handlePresenceBroadcast(req: Request): Promise<Response> {
    const s = this.env.CHAT_ROOM_AUTH_SECRET;
    if (!s || typeof s !== "string" || s.length < 16) return new Response("forbidden", { status: 403 });
    if (req.headers.get("x-internal-secret") !== s) return new Response("forbidden", { status: 403 });
    const text = await req.text();
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(text); } catch { /* socket closing */ }
    }
    return new Response(null, { status: 204 });
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

    // Cross-user subscription guard: the api Worker forwards the URL
    // userId as expectedUserId. The token's `sub` claim MUST match.
    // expectedUserId is REQUIRED — codex review caught the prior
    // conditional check, which let an attacker reach this DO by
    // omitting the query param and present any valid token they could
    // mint (e.g. for a workspace they DO own) into another user's
    // gateway instance. Treat the omitted param as a routing bug, not
    // permission to elide the check.
    const expected = new URL(req.url).searchParams.get("expectedUserId");
    if (!expected) {
      return new Response("forbidden: expectedUserId required", { status: 403 });
    }
    if (expected !== claims.userId) {
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
      lastHeartbeatAt: Date.now(),  // initial — bridge will refresh every 15s
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

  /** Tells every bridge socket whether it is currently the leader.
   *  Stale bridges (no heartbeat in BRIDGE_LIVENESS_WINDOW_MS) are
   *  excluded — they may be in a half-open TCP state and would silently
   *  swallow channel_new dispatches if elected. */
  private broadcastLeaderStatus(): void {
    const now = Date.now();
    let leaderWs: WebSocket | null = null;
    let best = -1;
    const bridgeSockets: { ws: WebSocket; a: AttachedSession; live: boolean }[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      const a = this.sessions.get(ws) ?? (ws.deserializeAttachment() as AttachedSession | null);
      if (!a?.isBridge) continue;
      const lastBeat = a.lastHeartbeatAt ?? a.connectedAt;
      const live = now - lastBeat < BRIDGE_LIVENESS_WINDOW_MS;
      bridgeSockets.push({ ws, a, live });
      if (live && a.connectedAt > best) { best = a.connectedAt; leaderWs = ws; }
    }
    for (const { ws, live } of bridgeSockets) {
      const isLeader = live && ws === leaderWs;
      try {
        ws.send(encode({ v: PROTOCOL_VERSION, t: "leader_status", isLeader }));
      } catch { /* ignore */ }
    }
  }

  private async handleNotify(req: Request): Promise<Response> {
    const s = this.env.CHAT_ROOM_AUTH_SECRET;
    // Fail-closed: undefined or short secret denies all callers.
    if (!s || typeof s !== "string" || s.length < 16) return new Response("forbidden", { status: 403 });
    if (req.headers.get("x-internal-secret") !== s) {
      return new Response("forbidden", { status: 403 });
    }
    const body = await req.json() as ServerMessage;
    this.broadcast(body);
    return Response.json({ ok: true });
  }

  async webSocketMessage(ws: WebSocket, raw: ArrayBuffer | string): Promise<void> {
    // Outer try — any unexpected exception logs but doesn't drop the WS.
    try {
      await this.dispatchMessage(ws, raw);
    } catch (e) {
      console.error("[UserGateway] webSocketMessage failed", { error: String(e) });
      this.sendErr(ws, "x", "INTERNAL", "internal error");
    }
  }

  private async dispatchMessage(ws: WebSocket, raw: ArrayBuffer | string): Promise<void> {
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
    if (msg.t === "heartbeat") {
      // Track liveness for stale-bridge detection in leader election.
      // serializeAttachment so post-hibernation rehydrate sees the fresh
      // timestamp — without it, a hibernated leader gets demoted on next
      // election even though it's healthy.
      const now = Date.now();
      sess.lastHeartbeatAt = now;
      this.sessions.set(ws, sess);
      ws.serializeAttachment(sess);
      if (sess.isBridge && sess.agentIds.length > 0) {
        this.ctx.waitUntil(this.persistBridgeHeartbeat(sess.agentIds).catch((e) => {
          console.warn("[UserGateway] agent heartbeat persist failed", { error: String(e) });
        }));
      }
      this.send(ws, { v: PROTOCOL_VERSION, t: "ack", id: msg.id });
      return;
    }
    if (msg.t === "rpc") {
      // Forward RPC to the matching peer (web → bridge or bridge → web).
      // TODO: route by `params.targetUserId` once we have multi-recipient RPC.
      this.broadcast({ v: PROTOCOL_VERSION, t: "rpc", id: msg.id, result: msg.params }, ws);
      return;
    }
    if (msg.t === "presence_subscribe") {
      await this.handlePresenceSubscribe(ws, sess, msg.id, msg.serverId);
      return;
    }
    if (msg.t === "presence_unsubscribe") {
      await this.handlePresenceUnsubscribe(ws, sess, msg.id, msg.serverId);
      return;
    }
    this.sendErr(ws, msg.id, "UNSUPPORTED", `gateway DO does not handle ${msg.t}`);
  }

  /** WorkspacePresence subscribe path. Per-tab semantics:
   *   - /presence/note +1 fires on EVERY tab subscribe (tab-level
   *     ref-count for the online/offline detection in the DO).
   *   - /presence/sub fires only on the FIRST tab for this user
   *     (broadcast registration is per-user, not per-tab — codex 2 HIGH).
   *   - On partial failure (note succeeded, sub failed), roll back
   *     note(-1) so we don't leak online state (codex 2 HIGH).
   *   - Idempotent — re-subscribing from the same already-subbed tab
   *     just refreshes the snapshot.
   */
  private async handlePresenceSubscribe(
    ws: WebSocket, sess: AttachedSession, id: string, serverId: string,
  ): Promise<void> {
    const stub = this.env.WORKSPACE_PRESENCE.get(
      this.env.WORKSPACE_PRESENCE.idFromName(serverId)
    );
    const subs = sess.presenceSubs ?? [];

    // Re-subscribe from same tab: idempotent snapshot refresh, no ref change.
    if (subs.includes(serverId)) {
      try {
        const snapRes = await this.callPresence(stub, "/presence/sub", { userId: sess.userId, serverId });
        const snap = await snapRes.json() as { users: { userId: string; online: boolean; lastSeenAt: number }[] };
        this.send(ws, { v: PROTOCOL_VERSION, t: "presence_snapshot", serverId, users: snap.users ?? [] });
        this.send(ws, { v: PROTOCOL_VERSION, t: "ack", id });
      } catch (e) {
        console.warn("[UserGateway] presence_subscribe re-snapshot failed", { serverId, error: String(e) });
        this.sendErr(ws, id, "INTERNAL", "presence subscribe failed");
      }
      return;
    }

    // First subscribe for THIS tab.
    let noted = false;
    try {
      await this.callPresence(stub, "/presence/note", { userId: sess.userId, serverId, delta: 1 });
      noted = true;
      // /presence/sub registers this user for broadcasts on the DO.
      // The DO's subscribers is a Set<userId>, so it's idempotent —
      // safe to call from every tab. But we only NEED to call it on
      // first tab; subsequent tabs piggyback on the user's existing
      // registration. We call anyway (cheap) to also get the snapshot
      // back, but track refcount locally so unsubscribe can fan-in.
      const snapRes = await this.callPresence(stub, "/presence/sub", { userId: sess.userId, serverId });
      const snap = await snapRes.json() as { users: { userId: string; online: boolean; lastSeenAt: number }[] };
      sess.presenceSubs = [...subs, serverId];
      this.sessions.set(ws, sess);
      ws.serializeAttachment(sess);
      this.presenceSubCounts.set(serverId, (this.presenceSubCounts.get(serverId) ?? 0) + 1);
      this.send(ws, { v: PROTOCOL_VERSION, t: "presence_snapshot", serverId, users: snap.users ?? [] });
      this.send(ws, { v: PROTOCOL_VERSION, t: "ack", id });
    } catch (e) {
      console.warn("[UserGateway] presence_subscribe failed", { serverId, error: String(e) });
      if (noted) {
        // Roll back the +1 so we don't leak online state on partial failure.
        await this.callPresence(stub, "/presence/note", { userId: sess.userId, serverId, delta: -1 })
          .catch(() => { /* logged once is enough */ });
      }
      this.sendErr(ws, id, "INTERNAL", "presence subscribe failed");
    }
  }

  /**
   * Per-tab unsubscribe. Sends /presence/note -1 to drop this tab's
   * online ref-count, but only sends /presence/unsub when this is the
   * LAST tab of THIS user subscribed to this server — otherwise we'd
   * wipe broadcast delivery for the user's other open tabs (codex 2 HIGH).
   *
   * Idempotent: if this tab isn't actually subscribed, ack and return.
   */
  private async handlePresenceUnsubscribe(
    ws: WebSocket, sess: AttachedSession, id: string, serverId: string,
  ): Promise<void> {
    const subs = sess.presenceSubs ?? [];
    if (!subs.includes(serverId)) {
      // Codex 2 HIGH: pre-fix, repeat unsubscribe would still send -1
      // and corrupt another tab's ref count. Now: ack noop.
      this.send(ws, { v: PROTOCOL_VERSION, t: "ack", id });
      return;
    }
    const stub = this.env.WORKSPACE_PRESENCE.get(
      this.env.WORKSPACE_PRESENCE.idFromName(serverId)
    );
    try {
      await this.callPresence(stub, "/presence/note", { userId: sess.userId, serverId, delta: -1 });
      const nextCount = Math.max(0, (this.presenceSubCounts.get(serverId) ?? 1) - 1);
      this.presenceSubCounts.set(serverId, nextCount);
      // Only tell the DO to drop broadcast registration when this was
      // the user's last subscribed tab on this server.
      if (nextCount === 0) {
        await this.callPresence(stub, "/presence/unsub", { userId: sess.userId, serverId });
        this.presenceSubCounts.delete(serverId);
      }
      sess.presenceSubs = subs.filter(s => s !== serverId);
      this.sessions.set(ws, sess);
      ws.serializeAttachment(sess);
      this.send(ws, { v: PROTOCOL_VERSION, t: "ack", id });
    } catch (e) {
      console.warn("[UserGateway] presence_unsubscribe failed", { serverId, error: String(e) });
      this.sendErr(ws, id, "INTERNAL", "presence unsubscribe failed");
    }
  }

  private async callPresence(
    stub: DurableObjectStub, path: string, body: Record<string, unknown>,
  ): Promise<Response> {
    return stub.fetch(`https://workspace-presence${path}`, {
      method: "POST",
      headers: {
        "x-internal-secret": this.env.CHAT_ROOM_AUTH_SECRET,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const sess = this.sessions.get(ws) ?? (ws.deserializeAttachment() as AttachedSession | null);
    const wasBridge = sess?.isBridge ?? false;
    // AWAIT the presence cleanup so the DO runtime keeps this handler
    // alive until decrement HTTPs complete. Earlier draft used void
    // fire-and-forget which could exit before the decrement fired,
    // leaving WorkspacePresence with stale +1 refs (codex 2 HIGH).
    if (sess?.presenceSubs?.length) {
      const userId = sess.userId;
      const cleanups = sess.presenceSubs.map((serverId) => this.decrementPresenceOnClose(userId, serverId));
      await Promise.allSettled(cleanups);
    }
    this.sessions.delete(ws);
    if (wasBridge) this.broadcastLeaderStatus();
  }
  async webSocketError(ws: WebSocket): Promise<void> {
    const sess = this.sessions.get(ws) ?? (ws.deserializeAttachment() as AttachedSession | null);
    const wasBridge = sess?.isBridge ?? false;
    if (sess?.presenceSubs?.length) {
      const userId = sess.userId;
      const cleanups = sess.presenceSubs.map((serverId) => this.decrementPresenceOnClose(userId, serverId));
      await Promise.allSettled(cleanups);
    }
    this.sessions.delete(ws);
    if (wasBridge) this.broadcastLeaderStatus();
  }

  /**
   * Called on WS close/error per subscribed serverId. Mirrors
   * handlePresenceUnsubscribe's last-tab semantics so we don't wipe
   * broadcast delivery for the user's still-open tabs.
   */
  private async decrementPresenceOnClose(userId: string, serverId: string): Promise<void> {
    const stub = this.env.WORKSPACE_PRESENCE.get(
      this.env.WORKSPACE_PRESENCE.idFromName(serverId)
    );
    try {
      await this.callPresence(stub, "/presence/note", { userId, serverId, delta: -1 });
      const nextCount = Math.max(0, (this.presenceSubCounts.get(serverId) ?? 1) - 1);
      this.presenceSubCounts.set(serverId, nextCount);
      if (nextCount === 0) {
        await this.callPresence(stub, "/presence/unsub", { userId, serverId });
        this.presenceSubCounts.delete(serverId);
      }
    } catch (e) {
      console.warn("[UserGateway] presence cleanup on close failed", { serverId, error: String(e) });
    }
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

  private async persistBridgeHeartbeat(agentIds: string[]): Promise<void> {
    const unique = Array.from(new Set(agentIds));
    if (unique.length === 0) return;
    const db = drizzle(this.env.DB);
    await db.update(agents)
      .set({ status: "online", updatedAt: new Date() })
      .where(inArray(agents.id, unique));
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

    // Determine the leader bridge socket (latest LIVE connectedAt wins).
    // Stale bridges (no heartbeat in window) are excluded — same liveness
    // gate as broadcastLeaderStatus, otherwise channel_new could be sent
    // to a half-dead bridge whose ws.send swallows the bytes.
    const isLeaderEligible = (msg as { t?: string }).t === "channel_new";
    let leaderBridgeWs: WebSocket | null = null;
    if (isLeaderEligible) {
      const now = Date.now();
      let best = -1;
      for (const ws of this.ctx.getWebSockets()) {
        const a = this.sessions.get(ws) ?? (ws.deserializeAttachment() as AttachedSession | null);
        if (!a?.isBridge) continue;
        const lastBeat = a.lastHeartbeatAt ?? a.connectedAt;
        if (now - lastBeat >= BRIDGE_LIVENESS_WINDOW_MS) continue;
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
