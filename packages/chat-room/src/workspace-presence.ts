import { DurableObject } from "cloudflare:workers";

export interface WorkspacePresenceEnv {
  /** Same secret the ChatRoom + UserGateway use for DO↔DO HTTP auth. */
  CHAT_ROOM_AUTH_SECRET: string;
  /** UserGateway DO namespace — used to fanout presence updates back to
   *  subscribed users. Bound in apps/api/wrangler.jsonc as USER_GATEWAY. */
  USER_GATEWAY: DurableObjectNamespace;
}

/** Per-user state — in memory only. Lost on DO restart; subscribers
 *  re-subscribe on reconnect to repopulate. */
interface UserEntry {
  /** Active WebSocket count across all of this user's tabs/devices.
   *  Reaches 0 when last tab closes → user goes offline. */
  conns: number;
  /** Wall-clock ms of the last connect/disconnect event for this user.
   *  Used by alarm to prune long-offline users + by clients to show
   *  "last seen 5m ago". */
  lastSeenAt: number;
}

/** RPC argument shape — narrow union so a typo at the call site fails
 *  the typecheck instead of arriving as a 500 at runtime. */
type Delta = 1 | -1;

/**
 * Per-server (`id from name = serverId`) DO that tracks who's online
 * in this workspace and broadcasts state changes to other workspace
 * members in real time. See docs/DESIGN_workspace_presence.md.
 *
 * Connection model:
 *   - UserGateway calls noteConnection(userId, +1) when a user opens
 *     a presence_subscribe for this serverId. Multiple tabs → multiple +1.
 *   - noteConnection(userId, -1) on each tab close / presence_unsubscribe.
 *   - Only the 0↔positive boundary triggers a presence_update broadcast
 *     to subscribers.
 *
 * Subscriber model:
 *   - subscribers is a Set<userId> — every user currently observing
 *     this workspace's presence stream.
 *   - On state change, WorkspacePresence iterates subscribers and pushes
 *     to each one's UserGateway DO via /internal/presence (HTTP).
 *   - UserGateway then fans out to the subscriber's open WebSockets.
 *
 * State is in-memory only — workspace presence is ephemeral and a
 * DO restart is OK (clients re-subscribe on reconnect and repopulate
 * within a second or two). Persisting would add D1 cost for no
 * durability benefit.
 */
export class WorkspacePresence extends DurableObject<WorkspacePresenceEnv> {
  private users = new Map<string, UserEntry>();
  /** UserGateway IDs (= userIds) currently subscribed for updates. */
  private subscribers = new Set<string>();

  constructor(ctx: DurableObjectState, env: WorkspacePresenceEnv) {
    super(ctx, env);
    // Self-heal alarm: every 60s, prune users who've been offline for
    // a while + retry-broken subscribers (those whose UserGateway
    // returned 4xx/5xx repeatedly). Re-arm in alarm() handler.
    void this.scheduleAlarm();
  }

  /** Single entry point — apps/api routes /presence/* requests here.
   *  Routes:
   *    POST /presence/note  body: {userId, delta, serverId}
   *    POST /presence/sub   body: {userId, serverId}
   *    POST /presence/unsub body: {userId, serverId}
   */
  async fetch(req: Request): Promise<Response> {
    if (!this.checkSecret(req)) return new Response("forbidden", { status: 403 });
    const url = new URL(req.url);
    if (req.method !== "POST") return new Response("method", { status: 405 });

    const body = await req.json() as { userId?: unknown; delta?: unknown; serverId?: unknown };
    const userId = typeof body.userId === "string" && body.userId.length > 0 ? body.userId : null;
    if (!userId) return new Response("userId required", { status: 400 });
    const serverId = typeof body.serverId === "string" ? body.serverId : "";
    if (!serverId) return new Response("serverId required", { status: 400 });

    if (url.pathname.endsWith("/presence/note")) {
      const delta: Delta = body.delta === 1 ? 1 : body.delta === -1 ? -1 : 0 as never;
      if (delta !== 1 && delta !== -1) return new Response("delta must be ±1", { status: 400 });
      this.noteConnection(userId, delta, serverId);
      return new Response(null, { status: 204 });
    }
    if (url.pathname.endsWith("/presence/sub")) {
      const snapshot = this.subscribe(userId);
      return Response.json({ users: snapshot });
    }
    if (url.pathname.endsWith("/presence/unsub")) {
      this.unsubscribe(userId);
      return new Response(null, { status: 204 });
    }
    return new Response("not found", { status: 404 });
  }

  private noteConnection(userId: string, delta: Delta, serverId: string): void {
    const cur = this.users.get(userId) ?? { conns: 0, lastSeenAt: 0 };
    const wasOnline = cur.conns > 0;
    cur.conns = Math.max(0, cur.conns + delta);
    cur.lastSeenAt = Date.now();
    this.users.set(userId, cur);
    const isOnline = cur.conns > 0;
    if (wasOnline !== isOnline) {
      void this.broadcast({
        v: 1, t: "presence_update",
        serverId, userId,
        online: isOnline,
        lastSeenAt: cur.lastSeenAt,
      });
    }
  }

  private subscribe(userId: string): { userId: string; online: boolean; lastSeenAt: number }[] {
    this.subscribers.add(userId);
    return [...this.users.entries()].map(([uid, v]) => ({
      userId: uid,
      online: v.conns > 0,
      lastSeenAt: v.lastSeenAt,
    }));
  }

  private unsubscribe(userId: string): void {
    this.subscribers.delete(userId);
  }

  /** Fan a single presence_update out to every subscriber's
   *  UserGateway DO. Each gateway's /internal/presence handler
   *  forwards to the user's open WebSockets. Best-effort —
   *  failures are logged and the broadcast doesn't fail. */
  private async broadcast(msg: object): Promise<void> {
    const text = JSON.stringify(msg);
    const failures: { userId: string; reason: string }[] = [];
    const tasks: Promise<unknown>[] = [];
    for (const subUserId of this.subscribers) {
      const stub = this.env.USER_GATEWAY.get(this.env.USER_GATEWAY.idFromName(subUserId));
      tasks.push(
        stub.fetch("https://user-gateway/internal/presence", {
          method: "POST",
          headers: {
            "x-internal-secret": this.env.CHAT_ROOM_AUTH_SECRET,
            "content-type": "application/json",
          },
          body: text,
        }).then(r => {
          if (!r.ok) failures.push({ userId: subUserId, reason: `${r.status}` });
        }).catch(e => {
          failures.push({ userId: subUserId, reason: String(e) });
        })
      );
    }
    await Promise.allSettled(tasks);
    // Drop subscribers we couldn't reach after a single failure.
    // They'll re-subscribe on reconnect; keeping a phantom subscriber
    // wastes broadcast cycles forever.
    for (const f of failures) this.subscribers.delete(f.userId);
  }

  /** Alarm: prune users offline > 60s. Re-arm in 60s. */
  async alarm(): Promise<void> {
    const now = Date.now();
    for (const [uid, v] of this.users) {
      if (v.conns === 0 && now - v.lastSeenAt > 60_000) {
        this.users.delete(uid);
      }
    }
    await this.scheduleAlarm();
  }

  /** Set the alarm only if it isn't already pending earlier — never
   *  push it further into the future. Standard DO alarm hygiene. */
  private async scheduleAlarm(): Promise<void> {
    const current = await this.ctx.storage.getAlarm();
    const target = Date.now() + 60_000;
    if (current === null || current > target) {
      await this.ctx.storage.setAlarm(target);
    }
  }

  private checkSecret(req: Request): boolean {
    const s = this.env.CHAT_ROOM_AUTH_SECRET;
    if (!s || typeof s !== "string" || s.length < 16) return false;
    return req.headers.get("x-internal-secret") === s;
  }
}
