# Workspace-wide presence — design

Status: **PROPOSAL — awaiting codex review + user approval before build**
Author: design pass following the "Olivia 在线状态不准" feedback
Last updated: 2026-05-23

---

## 0. TL;DR

Today:
- Human presence is **fake** (sidebar + user-pill show a hardcoded
  green dot per the existing inline comments).
- Channel-header `Live` pill reflects **the viewer's own** WS
  connection state — not the peer's.
- Per-channel `presence` events ARE broadcast by `ChatRoom` DO
  (`packages/chat-room/src/chat-room.ts:177, 418`), and
  `useChannelSocket` already forwards them via `onPresence`
  (`apps/web/src/hooks/use-channel-socket.ts:102`) — but no UI
  consumes them, and they're scoped to "people inside this channel
  right now", so the sidebar (which renders ALL DM peers, not just
  the one whose channel is open) couldn't use them anyway.

Target:
- **Workspace-wide presence**: every human in a workspace can see
  every other human's online state in the sidebar, the DM list, and
  inside any channel.
- Per-DM channel header shows the peer's presence ("Olivia · Online"
  / "Last seen 5m").
- Regular channel header shows live online-member count ("3 online").
- Real-time updates (sub-second from heartbeat to peer's UI), not
  poll-based.
- Agent presence already works — this design doesn't change that,
  but reuses the same UI surface so humans + agents look consistent.

---

## 1. Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  Web client (browser)                                            │
│                                                                  │
│  - opens UserGateway WS at /ws/user/:userId (already exists)     │
│  - on connect: sends {t:"presence_subscribe", serverId} for each │
│    workspace it has visible                                       │
│  - subscribes to presence_workspace events                        │
└──────────────────────────────────────────────────────────────────┘
                            │
                            │ WSS
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│  UserGateway DO (per user, id from name = userId)                │
│                                                                  │
│  - existing: per-channel unread fanout                            │
│  - NEW: routes presence_subscribe → WorkspacePresence(serverId)  │
│  - NEW: relays presence_workspace events back to this user's WS  │
└──────────────────────────────────────────────────────────────────┘
                            │
                            │ DO-to-DO RPC
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│  WorkspacePresence DO (per server, id from name = serverId)      │
│                                                                  │
│  - state: Map<userId, { lastSeenAt: number,                       │
│                          activeConnections: number }>             │
│  - subscriber tracking: which UserGateway DOs want updates        │
│  - on subscribe: emit current snapshot to subscriber              │
│  - on user connect/disconnect: broadcast delta to subscribers     │
│  - alarm every 30s: prune users whose lastSeenAt > 60s            │
└──────────────────────────────────────────────────────────────────┘
```

Key properties:
- **No per-client polling.** State changes flow over the same
  UserGateway WS the client already keeps open.
- **No new auth surface.** UserGateway already authenticates the user
  via the existing WS token; WorkspacePresence trusts UserGateway
  as a same-Cloudflare-Worker peer (internal secret pattern,
  identical to ChatRoom).
- **Multi-tab safe.** `activeConnections` counter increments per WS;
  user goes offline only when last tab closes (counter → 0).
- **Multi-workspace safe.** A user in 3 workspaces holds 1
  UserGateway WS, sends `presence_subscribe` for each serverId.
- **Server-side authoritative.** Heartbeat is the WS itself —
  alive WS = alive user. No separate heartbeat message.

---

## 2. Wire protocol additions

`packages/protocol/src/socket.ts` adds three message types under
the existing `userGatewayMessage` union.

### Client → server

```ts
// Tell UserGateway "I want presence updates for this workspace's members"
{ v: 1, t: "presence_subscribe", serverId: string }

// Tell UserGateway "stop sending presence for this workspace"
{ v: 1, t: "presence_unsubscribe", serverId: string }
```

### Server → client

```ts
// Snapshot delivered immediately after presence_subscribe; also after
// reconnect so client doesn't have to re-resolve.
{ v: 1, t: "presence_snapshot",
  serverId: string,
  users: Array<{ userId: string, online: boolean, lastSeenAt: number }> }

// Delta for a single user's state change. Pushed whenever a peer
// joins / leaves the workspace, or their lastSeenAt updates.
{ v: 1, t: "presence_update",
  serverId: string,
  userId: string,
  online: boolean,
  lastSeenAt: number }
```

The existing per-channel `t: "presence"` event stays (it's a
channel-level affordance: typing, "is this person reading right
now"). New types don't collide.

---

## 3. DO implementations

### 3.1 `WorkspacePresence` (new — `packages/chat-room/src/workspace-presence.ts`)

```ts
export class WorkspacePresence extends DurableObject<Env> {
  // Per-user reference count + lastSeen
  private users = new Map<string, { conns: number; lastSeenAt: number }>();

  // Which UserGateway DOs want updates for this workspace.
  // Stored as { userId, stub } so we can fanout. Tracked here, not
  // in storage — subscribers re-subscribe on reconnect.
  private subscribers = new Set<string /* userId */>();

  // RPC: a user opened/closed a WS, or pinged
  async noteConnection(userId: string, delta: 1 | -1): Promise<void> {
    const cur = this.users.get(userId) ?? { conns: 0, lastSeenAt: 0 };
    cur.conns = Math.max(0, cur.conns + delta);
    cur.lastSeenAt = Date.now();
    const wasOnline = cur.conns - delta > 0;
    const isOnline = cur.conns > 0;
    this.users.set(userId, cur);
    if (wasOnline !== isOnline) {
      await this.broadcast({
        t: "presence_update",
        serverId: this.serverId,
        userId,
        online: isOnline,
        lastSeenAt: cur.lastSeenAt,
      });
    }
  }

  async subscribe(userId: string): Promise<PresenceSnapshot> {
    this.subscribers.add(userId);
    return {
      users: [...this.users.entries()].map(([uid, v]) => ({
        userId: uid,
        online: v.conns > 0,
        lastSeenAt: v.lastSeenAt,
      })),
    };
  }

  async unsubscribe(userId: string): Promise<void> {
    this.subscribers.delete(userId);
  }

  private async broadcast(msg: object): Promise<void> {
    for (const subUserId of this.subscribers) {
      const stub = this.env.USER_GATEWAY.get(this.env.USER_GATEWAY.idFromName(subUserId));
      // fire-and-forget; UserGateway will drop on its own end if user disconnected
      void stub.fetch("https://user-gateway/internal/presence", {
        method: "POST",
        headers: { "x-internal-secret": this.env.CHAT_ROOM_AUTH_SECRET, "content-type": "application/json" },
        body: JSON.stringify(msg),
      });
    }
  }

  // Alarm: prune stale subscribers + reap users with conns=0 for >60s
  async alarm(): Promise<void> {
    const now = Date.now();
    for (const [uid, v] of this.users) {
      if (v.conns === 0 && now - v.lastSeenAt > 60_000) {
        this.users.delete(uid);
      }
    }
    // Re-arm
    await this.ctx.storage.setAlarm(now + 30_000);
  }
}
```

### 3.2 `UserGateway` additions (`packages/chat-room/src/user-gateway.ts`)

```ts
// On WS open: track which serverIds this client is subscribed to
// in the session attachment.
attached.presenceSubs = new Set<string>();

// New ws message handler:
case "presence_subscribe": {
  const stub = this.env.WORKSPACE_PRESENCE.get(
    this.env.WORKSPACE_PRESENCE.idFromName(msg.serverId)
  );
  // Tell WorkspacePresence "I'm one more connection here"
  await stub.noteConnection(attached.userId, +1);
  // Subscribe THIS user for updates from that workspace
  await stub.subscribe(attached.userId);
  // Send snapshot back
  const snapshot = await stub.subscribe(attached.userId);
  ws.send(JSON.stringify({ t: "presence_snapshot", serverId: msg.serverId, users: snapshot }));
  attached.presenceSubs.add(msg.serverId);
  ws.serializeAttachment(attached);
  break;
}

case "presence_unsubscribe": {
  const stub = this.env.WORKSPACE_PRESENCE.get(
    this.env.WORKSPACE_PRESENCE.idFromName(msg.serverId)
  );
  await stub.noteConnection(attached.userId, -1);
  await stub.unsubscribe(attached.userId);
  attached.presenceSubs.delete(msg.serverId);
  ws.serializeAttachment(attached);
  break;
}

// On WS close: noteConnection(-1) + unsubscribe for every subbed server
async webSocketClose(ws: WebSocket) {
  const attached = ws.deserializeAttachment() as Attached;
  for (const serverId of attached.presenceSubs ?? []) {
    const stub = this.env.WORKSPACE_PRESENCE.get(this.env.WORKSPACE_PRESENCE.idFromName(serverId));
    void stub.noteConnection(attached.userId, -1).catch(() => {});
    void stub.unsubscribe(attached.userId).catch(() => {});
  }
}

// New internal endpoint: WorkspacePresence pushes broadcasts here
async fetch(req: Request) {
  if (url.pathname === "/internal/presence") {
    // Forward to all live WS sessions for this user
    const msg = await req.text();
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(msg); } catch { /* socket closing */ }
    }
    return new Response(null, { status: 204 });
  }
  ...
}
```

---

## 4. Web client integration

### 4.1 `useWorkspacePresence(serverId)` hook (new)

```ts
// apps/web/src/hooks/use-workspace-presence.ts
export function useWorkspacePresence(serverId: string): Map<string, PresenceState> {
  const presence = useRef(new Map<string, PresenceState>());
  const [version, bump] = useState(0);

  useEffect(() => {
    if (!serverId) return;
    const ws = getUserGatewayWs(); // existing singleton
    ws.send(JSON.stringify({ t: "presence_subscribe", serverId }));

    const onMsg = (m: any) => {
      if (m.serverId !== serverId) return;
      if (m.t === "presence_snapshot") {
        presence.current.clear();
        for (const u of m.users) presence.current.set(u.userId, { online: u.online, lastSeenAt: u.lastSeenAt });
        bump(v => v + 1);
      } else if (m.t === "presence_update") {
        presence.current.set(m.userId, { online: m.online, lastSeenAt: m.lastSeenAt });
        bump(v => v + 1);
      }
    };
    onUserGatewayMessage(onMsg);

    return () => {
      ws.send(JSON.stringify({ t: "presence_unsubscribe", serverId }));
      offUserGatewayMessage(onMsg);
    };
  }, [serverId]);

  return presence.current;
}
```

### 4.2 UI integration points

| File | Change |
|---|---|
| `apps/web/src/components/user-pill.tsx:81-86` | Replace hardcoded green dot with `useWorkspacePresence(serverId).get(myUserId)?.online` — but always show green for self (assumption: if your tab is open, you're online). |
| `apps/web/src/components/sidebar.tsx` (DM list) | For each `channel.peer.type === "human"`, look up `presence.get(channel.peer.id)`. Render `bg-emerald-500` if online, neutral zinc if offline. Keep the hardcoded green ONLY for self. |
| `apps/web/src/components/sidebar.tsx` (Direct messages section) | Optionally sort online humans above offline ones. |
| `apps/web/src/components/message-area.tsx:521-532` (header pill) | For DM channels: show peer presence ("Olivia · Online" / "Last seen 5m ago"). For non-DM: show "N online" computed from members ∩ presence. Keep the existing "Connecting…" amber state as a fallback when WS is dead (so debug signal isn't lost). |
| `apps/web/src/app/s/[slug]/agents/page.tsx` | No change — agents already render real status via `agent.status` + `useAgentActivity`. |

### 4.3 "Last seen" formatting

`5s` / `1m ago` / `12m ago` / `2h ago` / `yesterday` / `2d ago` /
`3w ago`. Helper goes in `apps/web/src/lib/format-time.ts`.

---

## 5. Wrangler bindings

`apps/web/wrangler.jsonc` + `apps/api/wrangler.jsonc`:

```jsonc
"durable_objects": {
  "bindings": [
    // ... existing CHAT_ROOM, USER_GATEWAY, RALTIC_AGENT
    { "name": "WORKSPACE_PRESENCE", "class_name": "WorkspacePresence" }
  ]
},
"migrations": [
  // ... existing
  { "tag": "v?", "new_classes": ["WorkspacePresence"] }
]
```

No D1 schema change. Presence is ephemeral — losing it on DO restart
is acceptable (clients re-subscribe on reconnect with a fresh
snapshot).

---

## 6. Edge cases + answers

**Q: What about a user who's signed in but has no tabs open right now?**
A: They show as "Online" until WS close fires. After last tab closes,
UserGateway WS terminates within seconds; WorkspacePresence decrements
conn count to 0; broadcasts offline. Sidebar updates within ~1s.

**Q: What if the WorkspacePresence DO restarts (deploys)?**
A: State is in-memory only. After restart, conn-count map is empty.
Clients re-subscribe on next message (they hold the
`presence_subscribe` intent in `presenceSubs` and re-issue on
reconnect). Within a few seconds presence converges.

**Q: What if a user is in 50 workspaces?**
A: 50 `presence_subscribe` messages on UserGateway WS open.
WorkspacePresence DOs are cheap (1 DO per server, 1 small map).
Linear in number of memberships, which is bounded.

**Q: How big can the snapshot get?**
A: A workspace with 1000 humans, full snapshot is 1000 × ~80 bytes =
80KB. Fine for the rare "I just subscribed" moment; deltas are
~80 bytes per message after that.

**Q: Multi-tab in the SAME browser?**
A: Each tab opens its own UserGateway WS (they're independent — no
SharedWorker / cross-tab coordination today). Each tab increments the
conn count. Closing one tab leaves you online if other tabs open.

**Q: What about agent presence?**
A: Agents have their own status (online/sleeping/offline) computed
server-side from bridge heartbeats; this design doesn't change that.
UI integration: sidebar's existing `a.status === "online"` check
stays; the new `useWorkspacePresence` hook only governs human peers.

**Q: Privacy — can I hide my online state?**
A: Not in v1. If demand surfaces, add `users.presenceVisibility = "all" | "workspace" | "none"` and filter at WorkspacePresence broadcast time.

---

## 7. Failure modes

| Failure | Behavior |
|---|---|
| UserGateway WS reconnect | Client re-issues `presence_subscribe` for each server in its session list. Brief flicker possible. |
| WorkspacePresence DO unreachable | UserGateway forward returns 5xx; client never gets snapshot. Sidebar dots stay neutral. UI doesn't crash; the dots just aren't real. |
| Internal secret rotation | UserGateway + WorkspacePresence read the same env secret; rotate together. |
| Subscriber leak (UserGateway dies without `unsubscribe`) | WorkspacePresence's alarm reaps subscribers when broadcast attempts return 4xx repeatedly (track failure count per subscriber). |

---

## 8. Test plan

Unit:
- `WorkspacePresence.noteConnection(+1)` then `(-1)` → final state empty + 1 transition each direction
- `subscribe()` returns current snapshot
- Alarm prunes stale users
- Two simultaneous `noteConnection(+1)` increment correctly

Integration (Workers test harness):
- Open 2 WS as user A → A is online once (not twice)
- Close 1 WS → still online
- Close 2nd WS → goes offline within 1s
- User B subscribes → sees A's state
- A toggles → B receives `presence_update` within 100ms

Manual smoke:
- 2 browsers, 2 users, 1 workspace. Each sees the other's dot.
- Close one tab → other side flips to offline within a second.
- Open second tab → flips back to online.

---

## 9. Out of scope (v2 candidates)

- "Last active in #engineering 5m ago" (per-channel last-active, not just workspace)
- "Do not disturb" / status messages ("In a meeting until 3pm")
- Idle detection (window blur, mouse-still) — currently "open tab = online"
- Cross-tab dedupe via SharedWorker
- Presence-visibility privacy controls

---

## 10. Open questions for codex review

1. Is the `presence_subscribe` → `subscribe()` then `subscribe()`
   pattern in §3.2 a typo (called twice)? Yes — clean it up to:
   `noteConnection(+1); snapshot = await subscribe()`. Fixed before build.
2. Should the WorkspacePresence DO live in the API Worker or the web
   Worker? Recommendation: API Worker (where UserGateway already is).
3. Multi-tab counter race: two near-simultaneous `noteConnection(+1)`
   calls could lose an event if Hono dispatches them out of order on
   the DO. DOs serialize incoming RPC by default — verify this isn't
   a regression vs the current per-channel presence which doesn't
   ref-count.
4. Should presence updates be batched (debounced 100ms)? A user
   switching tabs rapidly could spam updates. Add coalescing if so.
5. Schema for `lastSeenAt` when a user has NEVER connected: omit from
   snapshot vs return `lastSeenAt: 0` with `online: false`? Affects
   sidebar render of brand-new workspace members.
