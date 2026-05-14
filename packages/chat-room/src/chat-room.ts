import { DurableObject } from "cloudflare:workers";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { messages, channelMembers, type Message } from "@syncany/db";
import {
  type ClientMessage,
  type ServerMessage,
  type MessageRow,
  decodeClient,
  encode,
  PROTOCOL_VERSION,
} from "@syncany/protocol";
import { verifyWsToken } from "@syncany/auth-core";

export interface ChatRoomEnv {
  DB: D1Database;
  CHAT_ROOM_AUTH_SECRET: string;
  /** UserGateway DO — used to fanout new-message events for sidebar unread badges. */
  USER_GATEWAY?: DurableObjectNamespace;
}

interface AttachedSession {
  userId: string;
  agentIds: string[];
  channelId: string;
}

interface VerifiedToken {
  userId: string;
  agentIds: string[];
  channelId: string;
  exp: number;
}

const MAX_PENDING_BATCH = 50;
const ALARM_DELAY_MS = 250;
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
    return new Response("not found", { status: 404 });
  }

  /** Server-to-server fanout (message edits, deletes, reactions). */
  private async handleNotify(req: Request): Promise<Response> {
    if (req.headers.get("x-internal-secret") !== this.env.CHAT_ROOM_AUTH_SECRET) {
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
    if (req.headers.get("x-internal-secret") !== this.env.CHAT_ROOM_AUTH_SECRET) {
      return new Response("forbidden", { status: 403 });
    }
    const body = await req.json() as {
      channelId: string; senderId: string;
      senderType: "human" | "agent" | "system";
      content: string; threadParentId: string | null;
      idempotencyKey: string;
    };
    this.channelId = body.channelId;
    const sql = this.ctx.storage.sql;

    const dup = sql.exec(
      `SELECT seq FROM idem WHERE user_id=? AND key=?`, body.senderId, body.idempotencyKey,
    ).toArray()[0];
    if (dup) {
      return Response.json({ ok: true, seq: Number(dup.seq), deduped: true });
    }

    const seq = ++this.nextSeq;
    sql.exec(`INSERT OR REPLACE INTO meta(key,value) VALUES('next_seq',?)`, String(this.nextSeq));
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
    this.fanoutToGateways(body.channelId, seq, body.senderId).catch(() => {});
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

  private async handleSeed(req: Request): Promise<Response> {
    // Internal-only endpoint used by onboarding / system flows.
    if (req.headers.get("x-internal-secret") !== this.env.CHAT_ROOM_AUTH_SECRET) {
      return new Response("forbidden", { status: 403 });
    }
    const body = await req.json() as { channelId: string; messages: Array<Omit<MessageRow, "seq" | "createdAt" | "updatedAt">> };
    this.channelId = body.channelId;
    const sql = this.ctx.storage.sql;
    const now = Date.now();
    const persisted: MessageRow[] = [];
    for (const m of body.messages) {
      const seq = ++this.nextSeq;
      sql.exec(`INSERT OR REPLACE INTO meta(key,value) VALUES('next_seq',?)`, String(this.nextSeq));
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
        this.broadcast({ v: PROTOCOL_VERSION, t: "typing", userId: sess.userId, on: msg.on }, ws);
        this.send(ws, { v: PROTOCOL_VERSION, t: "ack", id: msg.id });
        return;
      case "presence":
        this.broadcast({ v: PROTOCOL_VERSION, t: "presence", userId: sess.userId, status: msg.status }, ws);
        this.send(ws, { v: PROTOCOL_VERSION, t: "ack", id: msg.id });
        return;
      case "history":
        return this.handleHistory(ws, sess, msg);
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
  private async handleSend(ws: WebSocket, sess: AttachedSession, msg: Extract<ClientMessage, { t: "send" }>): Promise<void> {
    const sql = this.ctx.storage.sql;

    // Idempotency
    const dup = sql.exec(`SELECT seq FROM idem WHERE user_id=? AND key=?`, sess.userId, msg.idempotencyKey).toArray()[0];
    if (dup) {
      this.send(ws, { v: PROTOCOL_VERSION, t: "ack", id: msg.id, seq: Number(dup.seq) });
      return;
    }

    // Resolve sender
    const senderType: "human" | "agent" =
      msg.as && sess.agentIds.includes(msg.as) ? "agent" : "human";
    const senderId = senderType === "agent" ? msg.as! : sess.userId;

    // Allocate seq
    const seq = ++this.nextSeq;
    sql.exec(`INSERT OR REPLACE INTO meta(key,value) VALUES('next_seq',?)`, String(this.nextSeq));

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
    sql.exec(`INSERT INTO idem(user_id, key, seq) VALUES(?, ?, ?)`, sess.userId, msg.idempotencyKey, seq);

    await this.scheduleFlush();

    // Broadcast then ack (durability is from DO SQLite buffer, not D1 write)
    this.broadcast({ v: PROTOCOL_VERSION, t: "message", seq, message: row });
    this.send(ws, { v: PROTOCOL_VERSION, t: "ack", id: msg.id, seq, messageId });
  }

  private async handleHistory(ws: WebSocket, sess: AttachedSession, msg: Extract<ClientMessage, { t: "history" }>): Promise<void> {
    const db = drizzle(this.env.DB);
    // Note: we do NOT re-check membership here because the DO upgrade already
    // verified the token's channelId. Token expiry is the only revocation.
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
    const pending = sql.exec(
      `SELECT seq, message_json FROM pending_writes ORDER BY seq ASC LIMIT ?`,
      MAX_PENDING_BATCH,
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
      const maxSeq = pending[pending.length - 1].seq as number;
      sql.exec(`DELETE FROM pending_writes WHERE seq <= ?`, maxSeq);
    } catch (e) {
      console.error("[ChatRoom alarm] D1 flush failed", { channelId: this.channelId, error: String(e) });
      sql.exec(`UPDATE pending_writes SET attempts = attempts + 1 WHERE seq <= ?`,
        pending[pending.length - 1].seq as number);
      await this.ctx.storage.setAlarm(Date.now() + ALARM_BACKOFF_MS);
      return;
    }

    if (sql.exec(`SELECT 1 FROM pending_writes LIMIT 1`).toArray().length > 0) {
      await this.ctx.storage.setAlarm(Date.now() + ALARM_DELAY_MS);
    }
  }

  // -------------------------------------------------------------------------
  // Token verification — delegates to the single auth-core implementation.
  // -------------------------------------------------------------------------
  private async verifyToken(token: string): Promise<VerifiedToken> {
    const payload = await verifyWsToken(token, this.env.CHAT_ROOM_AUTH_SECRET);
    if (!payload) throw new Error("invalid token");
    return {
      userId: payload.sub,
      agentIds: Array.isArray(payload.agents) ? payload.agents : [],
      channelId: typeof payload.channelId === "string" ? payload.channelId : "",
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
  };
}


// drizzle-orm helpers — imported lazily here to avoid TS cycles
import { and, eq, lt, desc } from "drizzle-orm";
