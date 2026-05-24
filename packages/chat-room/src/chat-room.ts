import { DurableObject } from "cloudflare:workers";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { messages, channelMembers, agents, channels, type Message } from "@raltic/db";
import {
  type ClientMessage,
  type ServerMessage,
  type MessageRow,
  decodeClient,
  encode,
  PROTOCOL_VERSION,
} from "@raltic/protocol";
import { verifyWsToken, isTokenRevoked } from "@raltic/auth-core";

export interface ChatRoomEnv {
  DB: D1Database;
  CHAT_ROOM_AUTH_SECRET: string;
  /** UserGateway DO — used to fanout new-message events for sidebar unread badges. */
  USER_GATEWAY?: DurableObjectNamespace;
  /** KV deny-list for revoked tokens (jti + bridgeId). Optional in dev. */
  RATE_LIMITS?: KVNamespace;
  /** RalticAgent DO binding — used to dispatch human messages to cloud
   *  agents that are members of this channel. Optional so test envs
   *  without the binding still boot. */
  RALTIC_AGENT?: DurableObjectNamespace;
  /** Workers AI binding — for embedding messages into VECTORIZE on
   *  persist. Optional; missing = indexing is a no-op (search_messages
   *  just won't return results for un-indexed channels). */
  AI?: Ai;
  /** Vectorize binding — semantic message index queried via the
   *  search_messages agent tool. Index dimensions must match the
   *  embedding model (bge-m3 = 1024). Optional for the same reason. */
  VECTORIZE?: VectorizeIndex;
}

interface AttachedSession {
  userId: string;
  agentIds: string[];
  channelId: string;
  /** Bridge id from sy_bridge_ token — used for membership re-checks +
   *  revocation across the WS lifetime. */
  bridgeId?: string;
}

interface VerifiedToken {
  userId: string;
  agentIds: string[];
  channelId: string;
  bridgeId?: string;
  exp: number;
}

const MAX_PENDING_BATCH = 50;
const ALARM_DELAY_MS = 250;
const MAX_FLUSH_ATTEMPTS = 5;
const ALARM_BACKOFF_MS = 5_000;

/**
 * One DO per channel. The DO is the seq oracle for its channel and the
 * fan-out point for all WebSocket clients (web users + bridges).
 *
 * Durability:
 *   - DO SQLite holds counters (`meta`), idempotency dedupe (`idem`), and
 *     a write-buffer (`pending_writes`) that drains to D1 via alarm.
 *   - D1 is the long-term store; queries for history go through D1.
 *   - The UNIQUE(channel_id, seq) index in D1 is the safety net.
 */
export class ChatRoom extends DurableObject<ChatRoomEnv> {
  private sessions = new Map<WebSocket, AttachedSession>();
  private nextSeq = 0;
  private channelId = "";

  constructor(ctx: DurableObjectState, env: ChatRoomEnv) {
    super(ctx, env);

    // Auto-reply to ping frames without waking the DO.
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair("ping", "pong"),
    );

    // Restore in-memory session map from any hibernated WebSockets.
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as AttachedSession | null;
      if (a) {
        this.sessions.set(ws, a);
        this.channelId = a.channelId;
      }
    }

    // Restore counters + ensure schema.
    ctx.blockConcurrencyWhile(async () => {
      const sql = ctx.storage.sql;
      sql.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
      sql.exec(`CREATE TABLE IF NOT EXISTS idem (
        user_id TEXT NOT NULL,
        key     TEXT NOT NULL,
        seq     INTEGER NOT NULL,
        PRIMARY KEY (user_id, key)
      )`);
      sql.exec(`CREATE TABLE IF NOT EXISTS pending_writes (
        seq          INTEGER PRIMARY KEY,
        message_json TEXT NOT NULL,
        attempts     INTEGER NOT NULL DEFAULT 0
      )`);
      const seqRow = sql.exec(`SELECT value FROM meta WHERE key='next_seq'`).toArray()[0];
      this.nextSeq = seqRow ? Number(seqRow.value) : 0;
    });
  }

  // -------------------------------------------------------------------------
  // Worker → DO entry point
  // -------------------------------------------------------------------------
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.endsWith("/ws")) return this.handleUpgrade(req);
    if (url.pathname.endsWith("/internal/seed")) return this.handleSeed(req);
    if (url.pathname.endsWith("/internal/send")) return this.handleInternalSend(req);
    if (url.pathname.endsWith("/internal/notify")) return this.handleNotify(req);
    if (url.pathname.endsWith("/internal/kick")) return this.handleKick(req);
    // P0 W2: RalticAgent DO → ChatRoom DO streaming partial. Broadcasts
    // an agent_text_delta WS frame WITHOUT persisting (final post goes
    // through /internal/send with senderType=agent).
    if (url.pathname.endsWith("/internal/agent-partial")) return this.handleAgentPartial(req);
    return new Response("not found", { status: 404 });
  }

  /**
   * Phase D — drop all live WebSocket sessions owned by a removed
   * member (human or agent). Called from the api Worker on successful
   * channel_remove_member / leave / archive so the kicked party stops
   * receiving live broadcasts immediately, not "until they reload".
   *
   * Body: { memberId, memberType }. We walk every accepted WS, read
   * its serialized attachment, and close the ones that match.
   * - human kick: close sessions where attached.userId === memberId
   * - agent kick: close sessions where attached.agentIds includes memberId
   *
   * Close code 4001 is custom-defined as "kicked from channel" — the
   * bridge consumes this code to skip auto-reconnect for that channel
   * (auto-reconnect on 1006 / 1011 stays normal).
   */
  private async handleKick(req: Request): Promise<Response> {
    if (!checkInternalSecret(req, this.env.CHAT_ROOM_AUTH_SECRET)) {
      return new Response("forbidden", { status: 403 });
    }
    const body = await req.json() as { memberId: string; memberType: "human" | "agent" };
    let closed = 0;
    for (const ws of this.ctx.getWebSockets()) {
      try {
        const att = ws.deserializeAttachment() as AttachedSession | null;
        if (!att) continue;
        const isMatch =
          (body.memberType === "human" && att.userId === body.memberId)
          || (body.memberType === "agent" && att.agentIds?.includes(body.memberId));
        if (!isMatch) continue;
        // 4001 = custom "kicked from channel". Bridge should NOT
        // auto-reconnect on this code; web tabs will fall through to
        // standard reconnect-after-3s, but the next mintWsToken call
        // will fail because the user is no longer a channel member.
        ws.close(4001, "removed from channel");
        this.sessions.delete(ws);
        closed += 1;
      } catch { /* socket already gone — counts toward "closed" semantically */ }
    }
    return Response.json({ ok: true, closed });
  }

  /** Server-to-server fanout (message edits, deletes, reactions). */
  private async handleNotify(req: Request): Promise<Response> {
    if (!checkInternalSecret(req, this.env.CHAT_ROOM_AUTH_SECRET)) {
      return new Response("forbidden", { status: 403 });
    }
    const body = await req.json() as ServerMessage;
    this.broadcast(body);
    return Response.json({ ok: true });
  }

  private async handleUpgrade(req: Request): Promise<Response> {
    if (req.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }

    // Browsers can't set custom headers on a WS handshake; the token is
    // passed in the Sec-WebSocket-Protocol header and we echo it back.
    const protocol = req.headers.get("sec-websocket-protocol") ?? "";
    const token = protocol.split(",")[0]?.trim() ?? "";
    let claims: VerifiedToken;
    try {
      claims = await this.verifyToken(token);
    } catch (e) {
      return new Response("unauthorized", { status: 401 });
    }

    const channelId = new URL(req.url).searchParams.get("channelId");
    if (!channelId) return new Response("channel param required", { status: 400 });
    // claims.channelId is set for web-issued tokens (channel-scoped) but is
    // omitted for bridge tokens (which cover all channels the bridge's agents
    // are members of). For bridge tokens we accept any channelId — the api
    // Worker only routes bridges to channels they've been listed in by
    // /api/v1/bridge/connect, which itself enforces ownership.
    if (claims.channelId && claims.channelId !== channelId) {
      return new Response("channel mismatch", { status: 403 });
    }
    this.channelId = channelId;

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    const attached: AttachedSession = {
      userId: claims.userId,
      agentIds: claims.agentIds,
      channelId,
      bridgeId: claims.bridgeId,
    };
    server.serializeAttachment(attached);
    this.ctx.acceptWebSocket(server, [`u:${claims.userId}`, `c:${channelId}`]);
    this.sessions.set(server, attached);

    // Notify peers
    this.broadcast({
      v: PROTOCOL_VERSION,
      t: "presence",
      userId: claims.userId,
      status: "active",
    }, server);

    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { "Sec-WebSocket-Protocol": token },
    });
  }

  /**
   * Server-to-server message send invoked from the api Worker on POST
   * /api/v1/messages. Allocates seq, persists, broadcasts to live WS
   * subscribers, AND honours an idempotency key so retries don't double-post.
   */
  private async handleInternalSend(req: Request): Promise<Response> {
    if (!checkInternalSecret(req, this.env.CHAT_ROOM_AUTH_SECRET)) {
      return new Response("forbidden", { status: 403 });
    }
    const body = await req.json() as {
      channelId: string; senderId: string;
      senderType: "human" | "agent" | "system";
      content: string; threadParentId: string | null;
      idempotencyKey: string;
    };
    // Agent posts MUST be by an agent that is a member of this channel.
    // The internal secret only proves the caller is our own Worker
    // (or RalticAgent DO) — it doesn't prove the senderId is authorised.
    // Without this, a compromised tool could set senderId to any agent.
    if (body.senderType === "agent") {
      if (!(await this.isCurrentMember(body.senderId, "agent"))) {
        return new Response(
          JSON.stringify({ error: { code: "FORBIDDEN", message: "agent not in this channel" } }),
          { status: 403, headers: { "content-type": "application/json" } },
        );
      }
    }
    this.channelId = body.channelId;
    const sql = this.ctx.storage.sql;

    const dup = sql.exec(
      `SELECT seq FROM idem WHERE user_id=? AND key=?`, body.senderId, body.idempotencyKey,
    ).toArray()[0];
    if (dup) {
      return Response.json({ ok: true, seq: Number(dup.seq), deduped: true });
    }

    // Persist next_seq BEFORE bumping in-memory so a SQL failure doesn't
    // leave nextSeq ahead of storage (would create a gap in broadcast seqs).
    const seq = this.nextSeq + 1;
    sql.exec(`INSERT OR REPLACE INTO meta(key,value) VALUES('next_seq',?)`, String(seq));
    this.nextSeq = seq;
    const now = Date.now();
    const messageId = crypto.randomUUID();
    const row: MessageRow = {
      id: messageId,
      channelId: body.channelId,
      senderId: body.senderId,
      senderType: body.senderType,
      content: body.content,
      seq,
      threadParentId: body.threadParentId,
      createdAt: now,
      updatedAt: now,
    };
    sql.exec(`INSERT INTO pending_writes(seq, message_json) VALUES(?, ?)`, seq, JSON.stringify(row));
    sql.exec(`INSERT INTO idem(user_id, key, seq) VALUES(?, ?, ?)`, body.senderId, body.idempotencyKey, seq);
    await this.scheduleFlush();

    this.broadcast({ v: PROTOCOL_VERSION, t: "message", seq, message: row });
    // Fanout to every channel member's UserGateway so sidebar unread badges
    // can update without re-fetching. Don't await — best-effort.
    // ctx.waitUntil keeps the fanout Promise alive even if the DO is
    // evicted immediately after we respond — without it, sidebar unread
    // bumps could go missing under high pressure.
    this.ctx.waitUntil(this.fanoutToGateways(body.channelId, seq, body.senderId).catch(() => {}));
    return Response.json({ ok: true, seq, messageId });
  }

  /**
   * Tell every human member of this channel (other than the sender) about
   * the new max(seq) so their sidebars can bump unread counts live.
   */
  private async fanoutToGateways(channelId: string, seq: number, senderId: string): Promise<void> {
    if (!this.env.USER_GATEWAY) return;
    try {
      const db = drizzle(this.env.DB);
      const rows = await db
        .select({ memberId: channelMembers.memberId })
        .from(channelMembers)
        .where(and(
          eq(channelMembers.channelId, channelId),
          eq(channelMembers.memberType, "human"),
        ));
      const targets = rows.map(r => r.memberId).filter(id => id !== senderId);
      await Promise.all(targets.map(uid => {
        const stub = this.env.USER_GATEWAY!.get(this.env.USER_GATEWAY!.idFromName(uid));
        return stub.fetch("https://user-gateway/internal/notify", {
          method: "POST",
          headers: { "x-internal-secret": this.env.CHAT_ROOM_AUTH_SECRET, "content-type": "application/json" },
          body: JSON.stringify({ v: 1, t: "channel_new", channelId, seq } as any),
        }).catch(() => {});
      }));
    } catch (e) {
      console.warn("[ChatRoom fanoutToGateways]", e);
    }
  }

  /**
   * Partial-text streaming from RalticAgent DO. The agent loop emits
   * tokens as they come in; we forward to all connected WS clients as
   * `agent_text_delta` frames with REPLACE semantics (each frame holds
   * the full text so far). No persistence — only the final
   * /internal/send call writes to D1.
   *
   * We throttle nothing here — the DO upstream is the rate limiter.
   * Worst case agent emits 100 tokens/s, fanout to ~10 clients = 1k
   * msg/s which is well below CF Workers / DO budgets.
   */
  private async handleAgentPartial(req: Request): Promise<Response> {
    if (!checkInternalSecret(req, this.env.CHAT_ROOM_AUTH_SECRET)) {
      return new Response("forbidden", { status: 403 });
    }
    const body = await req.json() as { agentId: string; text: string };
    if (!body.agentId || typeof body.text !== "string") {
      return new Response("bad request", { status: 400 });
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.broadcast({
      v: PROTOCOL_VERSION,
      t: "agent_text_delta" as never,
      agentId: body.agentId,
      text: body.text,
    } as any);
    return Response.json({ ok: true });
  }

  private async handleSeed(req: Request): Promise<Response> {
    // Internal-only endpoint used by onboarding / system flows.
    if (!checkInternalSecret(req, this.env.CHAT_ROOM_AUTH_SECRET)) {
      return new Response("forbidden", { status: 403 });
    }
    const body = await req.json() as { channelId: string; messages: Array<Omit<MessageRow, "seq" | "createdAt" | "updatedAt">> };
    this.channelId = body.channelId;
    const sql = this.ctx.storage.sql;
    const now = Date.now();
    const persisted: MessageRow[] = [];
    for (const m of body.messages) {
      const seq = this.nextSeq + 1;
      sql.exec(`INSERT OR REPLACE INTO meta(key,value) VALUES('next_seq',?)`, String(seq));
      this.nextSeq = seq;
      // Always overwrite channelId from body (caller passes "" placeholder).
      const row: MessageRow = { ...m, channelId: body.channelId, seq, createdAt: now, updatedAt: now };
      sql.exec(`INSERT INTO pending_writes(seq, message_json) VALUES(?, ?)`, seq, JSON.stringify(row));
      persisted.push(row);
    }
    await this.scheduleFlush();
    // Broadcast newly-seeded messages too, so live tabs see them without refresh.
    for (const r of persisted) {
      this.broadcast({ v: PROTOCOL_VERSION, t: "message", seq: r.seq, message: r });
    }
    return Response.json({ ok: true, seqs: persisted.map(p => p.seq) });
  }

  // -------------------------------------------------------------------------
  // WebSocket handlers
  // -------------------------------------------------------------------------
  async webSocketMessage(ws: WebSocket, raw: ArrayBuffer | string): Promise<void> {
    // Outer try keeps an unexpected exception in any handler from dropping
    // the WS — clients see an INTERNAL err frame instead of a closed socket.
    try {
      await this.dispatchMessage(ws, raw);
    } catch (e) {
      console.error("[ChatRoom] webSocketMessage failed", { channelId: this.channelId, error: String(e) });
      this.sendErr(ws, "x", "INTERNAL", "internal error");
    }
  }

  private async dispatchMessage(ws: WebSocket, raw: ArrayBuffer | string): Promise<void> {
    let msg: ClientMessage;
    try {
      msg = decodeClient(raw);
    } catch (e) {
      this.sendErr(ws, "x", "BAD_MESSAGE", String(e));
      return;
    }

    let sess = this.sessions.get(ws);
    if (!sess) {
      const attached = ws.deserializeAttachment() as AttachedSession | null;
      if (!attached) { this.sendErr(ws, msg.id, "NO_SESSION", "session lost"); return; }
      this.sessions.set(ws, attached);
      sess = attached;
    }

    switch (msg.t) {
      case "hello":
        this.send(ws, { v: PROTOCOL_VERSION, t: "ack", id: msg.id });
        return;
      case "send":
        return this.handleSend(ws, sess, msg);
      case "typing":
      case "presence": {
        // Same removal-after-connect concern as send/history: a removed
        // member must not keep broadcasting typing/presence. Single
        // membership probe; if it fails, drop the message and ack-fail.
        if (!(await this.isCurrentMember(sess.userId, "human"))) {
          this.sendErr(ws, msg.id, "FORBIDDEN", "not a member of this channel");
          return;
        }
        if (msg.t === "typing") {
          this.broadcast({ v: PROTOCOL_VERSION, t: "typing", userId: sess.userId, on: msg.on }, ws);
        } else {
          this.broadcast({ v: PROTOCOL_VERSION, t: "presence", userId: sess.userId, status: msg.status }, ws);
        }
        this.send(ws, { v: PROTOCOL_VERSION, t: "ack", id: msg.id });
        return;
      }
      case "history":
        return this.handleHistory(ws, sess, msg);
      case "heartbeat":
        // ChatRoom DO doesn't track liveness for leader election (that's
        // UserGateway), but it should still ack so the bridge can use the
        // same heartbeat for either socket type without special-casing.
        this.send(ws, { v: PROTOCOL_VERSION, t: "ack", id: msg.id });
        return;
      case "rpc":
        // RPC routing is owned by UserGateway DO; per-channel DO doesn't handle it.
        this.sendErr(ws, msg.id, "WRONG_DO", "RPC must go to user gateway");
        return;
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    const sess = this.sessions.get(ws);
    this.sessions.delete(ws);
    if (sess) {
      this.broadcast({ v: PROTOCOL_VERSION, t: "presence", userId: sess.userId, status: "offline" });
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.sessions.delete(ws);
  }

  // -------------------------------------------------------------------------
  // Send / receive
  // -------------------------------------------------------------------------
  /**
   * Single source of truth for "is this (sender, kind) currently in this
   * channel?" — called from send, history, typing, and presence so token
   * TTL never grants stale access. The lookup hits D1 every time (no
   * in-DO cache) because membership churn is rare relative to messages
   * and any cache would need invalidation on the same path that drives
   * the bug we're closing.
   */
  private async isCurrentMember(memberId: string, memberType: "human" | "agent"): Promise<boolean> {
    const db = drizzle(this.env.DB);
    const row = await db
      .select({ id: channelMembers.memberId })
      .from(channelMembers)
      .where(and(
        eq(channelMembers.channelId, this.channelId),
        eq(channelMembers.memberId, memberId),
        eq(channelMembers.memberType, memberType),
      ))
      .limit(1);
    return row.length > 0;
  }

  private async handleSend(ws: WebSocket, sess: AttachedSession, msg: Extract<ClientMessage, { t: "send" }>): Promise<void> {
    const sql = this.ctx.storage.sql;

    // Resolve sender first so the idempotency dedupe key is scoped to the
    // ACTUAL sender (human or agent), not just sess.userId — otherwise an
    // agent + human under the same session collide on dup keys.
    const senderType: "human" | "agent" =
      msg.as && sess.agentIds.includes(msg.as) ? "agent" : "human";
    const senderId = senderType === "agent" ? msg.as! : sess.userId;

    // Membership recheck. Token TTL can be up to 7d (bridge); a user removed
    // from the channel mid-session must not keep posting. (P1 from diag.)
    if (!(await this.isCurrentMember(senderId, senderType))) {
      this.sendErr(ws, msg.id, "FORBIDDEN", "not a member of this channel");
      return;
    }
    const db = drizzle(this.env.DB);

    // Idempotency keyed on actual sender, not session user.
    const dup = sql.exec(`SELECT seq FROM idem WHERE user_id=? AND key=?`, senderId, msg.idempotencyKey).toArray()[0];
    if (dup) {
      this.send(ws, { v: PROTOCOL_VERSION, t: "ack", id: msg.id, seq: Number(dup.seq) });
      return;
    }

    // Allocate seq AFTER persisting next_seq so a SQL failure doesn't leave
    // the in-memory counter ahead of storage (would create a gap in the
    // broadcast seq sequence). Same fix below.
    const seq = this.nextSeq + 1;
    sql.exec(`INSERT OR REPLACE INTO meta(key,value) VALUES('next_seq',?)`, String(seq));
    this.nextSeq = seq;

    const messageId = crypto.randomUUID();
    const now = Date.now();
    const row: MessageRow = {
      id: messageId,
      channelId: this.channelId,
      senderId,
      senderType,
      content: msg.content,
      seq,
      threadParentId: msg.threadParentId ?? null,
      createdAt: now,
      updatedAt: now,
    };

    sql.exec(`INSERT INTO pending_writes(seq, message_json) VALUES(?, ?)`, seq, JSON.stringify(row));
    sql.exec(`INSERT INTO idem(user_id, key, seq) VALUES(?, ?, ?)`, senderId, msg.idempotencyKey, seq);

    await this.scheduleFlush();

    // Broadcast then ack (durability is from DO SQLite buffer, not D1 write)
    this.broadcast({ v: PROTOCOL_VERSION, t: "message", seq, message: row });
    this.ctx.waitUntil(this.fanoutToGateways(this.channelId, seq, senderId).catch(() => {}));
    this.send(ws, { v: PROTOCOL_VERSION, t: "ack", id: msg.id, seq, messageId });

    // Dispatch to cloud agents (runtime_mode='raltic') after ack — humans
    // only. The web client sends messages over WS, so dispatch MUST be
    // wired here (not just in /api/v1/messages REST handler) for cloud
    // agents to receive @-mentions and DM auto-dispatch. Best-effort:
    // waitUntil keeps the DO alive until the agent reply posts back.
    if (senderType === "human") {
      this.ctx.waitUntil(this.dispatchToCloudAgents({
        channelId: this.channelId,
        messageId,
        text: msg.content,
        callerId: senderId,
      }).catch((e) => {
        console.error("[ChatRoom dispatch] failed:", e);
      }));
    }
  }

  /**
   * Find cloud agents (runtime_mode='raltic') that should reply to this
   * channel message. Dispatch via RALTIC_AGENT DO binding.
   *
   * Triggers:
   *   1. Explicit @-mention (UUID or agent name) in content
   *   2. DM channel with exactly one agent member — auto-dispatch every
   *      human message in that DM, no @-mention needed.
   */
  private async dispatchToCloudAgents(input: {
    channelId: string;
    messageId: string;
    text: string;
    callerId: string;
  }): Promise<void> {
    if (!this.env.RALTIC_AGENT) return;
    const db = drizzle(this.env.DB);
    // Channel-member agents (id + name + runtime_mode + serverId + ownerId).
    const memberAgents = await db.select({
      id: agents.id,
      name: agents.name,
      serverId: agents.serverId,
      ownerId: agents.ownerId,
      runtimeMode: agents.runtimeMode,
    })
      .from(channelMembers)
      .innerJoin(agents, eq(agents.id, channelMembers.memberId))
      .where(and(
        eq(channelMembers.channelId, input.channelId),
        eq(channelMembers.memberType, "agent"),
      ));
    if (memberAgents.length === 0) return;

    // Mention extraction — same as apps/api lib/agent-dispatch.
    const byId = new Map(memberAgents.map(a => [a.id, a.id] as const));
    const byName = new Map(memberAgents.map(a => [a.name.toLowerCase(), a.id] as const));
    const mentioned = new Set<string>();
    const uuidRe = /@([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/g;
    let m: RegExpExecArray | null;
    while ((m = uuidRe.exec(input.text)) !== null) {
      const id = m[1];
      if (id && byId.has(id)) mentioned.add(id);
    }
    const nameRe = /(^|[^A-Za-z0-9_])@([a-z0-9_-]{1,64})\b/g;
    while ((m = nameRe.exec(input.text)) !== null) {
      const name = m[2]?.toLowerCase();
      if (!name) continue;
      const id = byName.get(name);
      if (id) mentioned.add(id);
    }
    // DM fallback: single agent member, no explicit mention → auto-dispatch.
    if (mentioned.size === 0) {
      const ch = await db.select({ type: channels.type })
        .from(channels)
        .where(eq(channels.id, input.channelId))
        .limit(1);
      if (ch[0]?.type === "dm" && memberAgents.length === 1) {
        const onlyId = memberAgents[0]?.id;
        if (onlyId) mentioned.add(onlyId);
      }
    }
    if (mentioned.size === 0) return;

    // Route to cloud-mode agents only. Bridge-mode agents will receive
    // this message via their own WS subscription to ChatRoom.
    for (const a of memberAgents) {
      if (!mentioned.has(a.id)) continue;
      if (a.runtimeMode !== "raltic") continue;
      // Use loose typing — chat-room can't import @raltic/agent without a
      // circular dep (agent → db, chat-room → db, both → protocol).
      // The contract is enforced at the call site in api/lib/agent-dispatch.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stub: any = this.env.RALTIC_AGENT!.get(this.env.RALTIC_AGENT!.idFromName(a.id));
      try {
        await stub.bind({ agentId: a.id, workspaceId: a.serverId, ownerId: a.ownerId });
        const result = await stub.onInvoke({
          source: "channel_mention",
          channelId: input.channelId,
          messageId: input.messageId,
          text: input.text,
          callerId: input.callerId,
          callerType: "human",
        });
        if (!result.ok) {
          console.error(`[ChatRoom dispatch] agent=${a.id} onInvoke error: ${result.error}`);
        }
      } catch (e) {
        console.error(`[ChatRoom dispatch] agent=${a.id} threw:`, e);
      }
    }
  }

  private async handleHistory(ws: WebSocket, sess: AttachedSession, msg: Extract<ClientMessage, { t: "history" }>): Promise<void> {
    const db = drizzle(this.env.DB);
    // Membership recheck — codex review caught the original "trust the
    // connect-time token" comment as a security gap. ws tokens TTL up
    // to 7d; a user removed from the channel mid-session could still
    // pull full message history (including content posted AFTER their
    // removal) until socket close. Treat history identically to send.
    if (!(await this.isCurrentMember(sess.userId, "human"))) {
      this.sendErr(ws, msg.id, "FORBIDDEN", "not a member of this channel");
      return;
    }
    const limit = msg.limit ?? 50;
    const rows = await db
      .select()
      .from(messages)
      .where(
        msg.before
          ? and(eq(messages.channelId, this.channelId), lt(messages.seq, msg.before))
          : eq(messages.channelId, this.channelId),
      )
      .orderBy(desc(messages.seq))
      .limit(limit);
    this.send(ws, {
      v: PROTOCOL_VERSION,
      t: "history",
      id: msg.id,
      messages: rows.reverse().map(toMessageRow),
    });
  }

  // -------------------------------------------------------------------------
  // D1 sync alarm
  // -------------------------------------------------------------------------
  private async scheduleFlush(): Promise<void> {
    const cur = await this.ctx.storage.getAlarm();
    const target = Date.now() + ALARM_DELAY_MS;
    if (cur === null || cur > target) {
      await this.ctx.storage.setAlarm(target);
    }
  }

  async alarm(): Promise<void> {
    const sql = this.ctx.storage.sql;
    // Skip rows that have already exceeded MAX_FLUSH_ATTEMPTS — they're
    // moved to a "dead-letter" zone (attempts column kept high) so the
    // queue keeps draining the live tail instead of blocking forever.
    const pending = sql.exec(
      `SELECT seq, message_json, attempts FROM pending_writes
       WHERE attempts < ?
       ORDER BY seq ASC LIMIT ?`,
      MAX_FLUSH_ATTEMPTS, MAX_PENDING_BATCH,
    ).toArray();
    if (pending.length === 0) return;

    const db = drizzle(this.env.DB);
    const rows: Message[] = pending.map(p => deserializeMessage(p.message_json as string));

    // Drop poison rows from earlier bug versions where channelId was never
    // populated. They will fail FK constraint forever otherwise.
    const poisonSeqs: number[] = [];
    const goodRows = rows.filter((r, i) => {
      if (!r.channelId) { poisonSeqs.push(pending[i].seq as number); return false; }
      return true;
    });
    if (poisonSeqs.length > 0) {
      console.warn(`[ChatRoom alarm] dropping ${poisonSeqs.length} poison rows from pending_writes`);
      for (const s of poisonSeqs) sql.exec(`DELETE FROM pending_writes WHERE seq = ?`, s);
    }
    if (goodRows.length === 0) return;

    try {
      // Use onConflictDoNothing — if a previous alarm crashed mid-flight,
      // the rows may already be in D1 by the time we retry.
      await db.insert(messages).values(goodRows).onConflictDoNothing();
      const goodSeqs = goodRows.map(r => r.seq);
      sql.exec(`DELETE FROM pending_writes WHERE seq IN (${goodSeqs.map(() => "?").join(",")})`, ...goodSeqs);
      // Vectorize indexing (P3-W2). Fire-and-forget — search index is
      // best-effort; if AI / Vectorize is missing or rate-limited we
      // simply don't index this batch. Worst case: the messages won't
      // appear in search_messages results until a future backfill.
      if (this.env.AI && this.env.VECTORIZE && goodRows.length > 0) {
        this.ctx.waitUntil(this.indexMessageBatch(goodRows).catch(e => {
          console.warn("[ChatRoom] vectorize index failed", { channelId: this.channelId, error: String(e) });
        }));
      }
    } catch (e) {
      console.error("[ChatRoom alarm] D1 flush failed", { channelId: this.channelId, error: String(e) });
      const goodSeqs = goodRows.map(r => r.seq);
      sql.exec(
        `UPDATE pending_writes SET attempts = attempts + 1 WHERE seq IN (${goodSeqs.map(() => "?").join(",")})`,
        ...goodSeqs,
      );
      // Mark exhausted rows with a one-time error log so an operator can
      // grep for them and manually resolve. The row stays in pending_writes
      // (attempts >= MAX) so it doesn't block live traffic but isn't lost
      // from the DO either — manual replay possible.
      const exhausted = sql.exec(
        `SELECT seq FROM pending_writes WHERE attempts >= ? LIMIT 10`,
        MAX_FLUSH_ATTEMPTS,
      ).toArray();
      for (const r of exhausted) {
        console.error("[ChatRoom alarm] DEAD_LETTER", {
          channelId: this.channelId, seq: r.seq, attempts: MAX_FLUSH_ATTEMPTS,
        });
      }
      await this.scheduleAlarm(Date.now() + ALARM_BACKOFF_MS);
      return;
    }

    if (sql.exec(`SELECT 1 FROM pending_writes WHERE attempts < ? LIMIT 1`, MAX_FLUSH_ATTEMPTS).toArray().length > 0) {
      await this.scheduleAlarm(Date.now() + ALARM_DELAY_MS);
    }
  }

  /**
   * Embed a batch of messages and upsert into Vectorize for P3 semantic
   * search. Called fire-and-forget after a successful D1 flush. We
   * embed all messages in ONE Workers AI call (the model accepts an
   * array input) and upsert all vectors in ONE Vectorize call to keep
   * per-message cost flat.
   *
   * Failure modes:
   *   - AI rate-limit → caller logs, batch is lost from the index.
   *     Backfill cron picks it up later by re-scanning messages without
   *     a `vector_indexed_at` marker. (P3-W2.D2)
   *   - Vectorize quota → same as above.
   *   - One message's content too long for embed → we truncate to ~6 KB
   *     so the whole batch doesn't fail.
   *
   * Metadata: keep small; only what we filter on (channelId, senderId,
   * senderType, ts, serverId). Body lives in D1 — Vectorize returns
   * just IDs which we hydrate.
   */
  private async indexMessageBatch(rows: Message[]): Promise<void> {
    if (!this.env.AI || !this.env.VECTORIZE) return;
    // Filter: only index messages with non-empty text content. System
    // events (typing, presence) don't have searchable bodies. Truncate
    // long ones — bge-m3 has 8k tokens, ~6KB is a safe byte budget.
    const indexable = rows
      .filter(r => typeof r.content === "string" && r.content.trim().length > 0)
      .map(r => ({ row: r, text: r.content.slice(0, 6_000) }));
    if (indexable.length === 0) return;
    // bge-m3 multilingual (covers EN + CJK well). 1024-d cosine.
    // Index must be created with dimensions=1024, metric=cosine.
    const aiRes = await this.env.AI.run("@cf/baai/bge-m3" as never, {
      text: indexable.map(x => x.text),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as never) as unknown as { data: number[][] };
    if (!aiRes?.data || !Array.isArray(aiRes.data)) {
      console.warn("[ChatRoom indexer] bge-m3 returned no vectors");
      return;
    }
    const vectors = indexable.map((x, i) => ({
      id: x.row.id,
      values: aiRes.data[i]!,
      metadata: {
        channelId: x.row.channelId,
        senderId: x.row.senderId,
        senderType: x.row.senderType,
        // Vectorize metadata only accepts string|number|boolean|array.
        // Store ts as unix ms (number) so range filters work later.
        ts: x.row.createdAt instanceof Date ? x.row.createdAt.getTime() : Number(x.row.createdAt),
      },
    }));
    await this.env.VECTORIZE.upsert(vectors);
    // Stamp vectorIndexedAt so the backfill cron skips these rows on
    // its next pass (codex P3-W2 HIGH: prevent double-embed spend).
    // Best-effort: a stamp failure just means backfill may re-index
    // — costs a few extra AI calls, never causes data loss.
    try {
      const db = drizzle(this.env.DB);
      const ids = vectors.map(v => v.id);
      await db.update(messages)
        .set({ vectorIndexedAt: new Date() })
        .where(inArray(messages.id, ids));
    } catch (e) {
      console.warn("[ChatRoom indexer] vectorIndexedAt stamp failed", { error: String(e) });
    }
  }

  /**
   * Idempotent alarm scheduler — never overwrites an earlier-firing alarm.
   * Naked storage.setAlarm pushes the next fire-time out even if one's
   * already imminent, which can stall pending-write flushes indefinitely
   * if alarms re-set on a tight loop. Always check current first.
   */
  private async scheduleAlarm(atMs: number): Promise<void> {
    const cur = await this.ctx.storage.getAlarm();
    if (cur != null && cur <= atMs) return;
    await this.ctx.storage.setAlarm(atMs);
  }

  // -------------------------------------------------------------------------
  // Token verification — delegates to the single auth-core implementation.
  // -------------------------------------------------------------------------
  private async verifyToken(token: string): Promise<VerifiedToken> {
    const payload = await verifyWsToken(token, this.env.CHAT_ROOM_AUTH_SECRET);
    if (!payload) throw new Error("invalid token");
    // KV deny-list check — same as REST resolveSubject. Without this, a
    // revoked machine key's still-open WS keeps working until the 7-day
    // token TTL elapses (P1 from 6-agent diagnostic).
    // FAIL-OPEN: KV transient errors must not drop a healthy WS. Worst
    // case a revoked token works for a few seconds during a KV outage —
    // way better than 100% of bridges flapping if KV blips.
    if (this.env.RATE_LIMITS) {
      try {
        if (payload.jti && await isTokenRevoked(this.env.RATE_LIMITS, payload.jti)) {
          throw new Error("token revoked");
        }
        if (payload.bridgeId && await isTokenRevoked(this.env.RATE_LIMITS, `bridge:${payload.bridgeId}`)) {
          throw new Error("bridge revoked");
        }
      } catch (e) {
        if (String(e).includes("revoked")) throw e;  // intentional revocation rejection
        console.warn("[ChatRoom] KV revocation lookup failed, allowing", { error: String(e) });
      }
    }
    return {
      userId: payload.sub,
      agentIds: Array.isArray(payload.agents) ? payload.agents : [],
      channelId: typeof payload.channelId === "string" ? payload.channelId : "",
      bridgeId: typeof payload.bridgeId === "string" ? payload.bridgeId : undefined,
      exp: payload.exp,
    };
  }

  // -------------------------------------------------------------------------
  // Broadcast helpers
  // -------------------------------------------------------------------------
  private broadcast(msg: ServerMessage, exclude?: WebSocket): void {
    const text = encode(msg);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === exclude) continue;
      try { ws.send(text); } catch { /* will GC on close */ }
    }
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    try { ws.send(encode(msg)); } catch { /* ignore */ }
  }

  private sendErr(ws: WebSocket, id: string, code: string, message: string): void {
    this.send(ws, { v: PROTOCOL_VERSION, t: "err", id, code, message });
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * Fail-closed internal-secret check. Plain `header !== env.SECRET` is unsafe
 * if the env var is undefined: `undefined === undefined` would let any
 * caller through. We require the secret to be a non-empty string.
 */
export function checkInternalSecret(req: Request, secret: string | undefined): boolean {
  if (!secret || typeof secret !== "string" || secret.length < 16) return false;
  const header = req.headers.get("x-internal-secret");
  if (!header) return false;
  return header === secret;
}

function deserializeMessage(json: string): Message {
  const parsed = JSON.parse(json);
  return {
    ...parsed,
    createdAt: new Date(parsed.createdAt),
    updatedAt: new Date(parsed.updatedAt),
  };
}

function toMessageRow(m: Message): MessageRow {
  return {
    id: m.id,
    channelId: m.channelId,
    senderId: m.senderId,
    senderType: m.senderType,
    content: m.content,
    seq: m.seq,
    threadParentId: m.threadParentId,
    createdAt: m.createdAt instanceof Date ? m.createdAt.getTime() : Number(m.createdAt),
    updatedAt: m.updatedAt instanceof Date ? m.updatedAt.getTime() : Number(m.updatedAt),
    editedAt: m.editedAt instanceof Date ? m.editedAt.getTime() : (m.editedAt == null ? null : Number(m.editedAt)),
    deletedAt: m.deletedAt instanceof Date ? m.deletedAt.getTime() : (m.deletedAt == null ? null : Number(m.deletedAt)),
  };
}


// drizzle-orm helpers — imported lazily here to avoid TS cycles
import { and, eq, lt, desc, inArray } from "drizzle-orm";
