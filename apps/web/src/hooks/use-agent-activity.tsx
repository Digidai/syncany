"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { authClient, apiOrigin } from "@/lib/auth-client";
import { decodeServer, encode, PROTOCOL_VERSION } from "@raltic/protocol";

const wsOrigin = apiOrigin.replace(/^http/, "ws");

export interface AgentActivity {
  status: "idle" | "thinking" | "working" | "error";
  label?: string;
  detail?: string;
  updatedAt: number;
}

/** Per-user online state piped from the WorkspacePresence DO.
 *  `lastSeenAt = 0` means "never seen" (e.g. a brand-new workspace
 *  member who hasn't opened their browser yet). */
export interface UserPresence {
  online: boolean;
  lastSeenAt: number;
}

interface GatewayValue {
  activities: Record<string, AgentActivity>;
  /** Live cross-channel state: per-channel max(seq) the gateway has heard about. */
  channelMaxSeq: Record<string, number>;
  /** Per-channel last-read marker, mirrored from server-side updates and local actions. */
  channelLastRead: Record<string, number>;
  /** Workspace-wide presence: serverId → userId → state. Populated by
   *  presence_snapshot on subscribe + maintained by presence_update
   *  deltas. Empty for any workspace nobody's subscribed to yet. */
  presenceByServer: Record<string, Record<string, UserPresence>>;
  /** Imperative: notify the local store that a channel was just opened/marked-read. */
  bumpRead: (channelId: string, seq: number) => void;
  /** Imperative: seed initial state from a server fetch (avoids n+1 round-trips). */
  seedChannel: (channelId: string, maxSeq: number, lastReadSeq: number) => void;
  /** Imperative: opt this gateway into presence updates for `serverId`.
   *  Idempotent — multiple callers for the same serverId share one
   *  subscription. The provider re-issues on every WS reconnect. */
  subscribePresence: (serverId: string) => void;
  /** Imperative: opt out. Only sends presence_unsubscribe when refcount
   *  hits zero — components that mount the same hook on different DM
   *  pages don't fight each other. */
  unsubscribePresence: (serverId: string) => void;
  /** Phase F HIGH (codex G2) — sidebar publishes the set of muted
   *  channel ids so the channel_new Notification gate can suppress
   *  toasts for muted channels. */
  setMutedChannelIds: (ids: Set<string>) => void;
}

const Ctx = createContext<GatewayValue>({
  activities: {},
  channelMaxSeq: {},
  channelLastRead: {},
  presenceByServer: {},
  bumpRead: () => {},
  seedChannel: () => {},
  subscribePresence: () => {},
  unsubscribePresence: () => {},
  setMutedChannelIds: () => {},
});

export function useAgentActivities(): Record<string, AgentActivity> {
  return useContext(Ctx).activities;
}

export function useAgentActivity(agentId: string): AgentActivity | undefined {
  return useAgentActivities()[agentId];
}

export function useChannelUnread(channelId: string | undefined): number {
  const { channelMaxSeq, channelLastRead } = useContext(Ctx);
  if (!channelId) return 0;
  const max = channelMaxSeq[channelId] ?? 0;
  const read = channelLastRead[channelId] ?? 0;
  return Math.max(0, max - read);
}

/**
 * Subscribe this React tree to workspace-wide presence for `serverId`
 * and return the live map of userId → {online, lastSeenAt}.
 *
 * Self (currently signed-in user) is intentionally NOT included in the
 * server's broadcast — your own tab being open trivially means you're
 * online, and including it would double-count refs. UI shows the user's
 * own dot as always-green when at least one tab is open (this fn).
 *
 * Reference-counted: multiple components calling this for the same
 * serverId share one subscription. WS reconnect re-issues the
 * subscribe automatically.
 */
export function useWorkspacePresence(serverId: string | undefined): Record<string, UserPresence> {
  const { presenceByServer, subscribePresence, unsubscribePresence } = useContext(Ctx);
  useEffect(() => {
    if (!serverId) return;
    subscribePresence(serverId);
    return () => unsubscribePresence(serverId);
  }, [serverId, subscribePresence, unsubscribePresence]);
  return (serverId ? presenceByServer[serverId] : undefined) ?? {};
}

export function useGateway() {
  return useContext(Ctx);
}

/**
 * Mounts a long-lived WebSocket to the user's UserGateway DO and exposes a
 * context with: agent activity, per-channel max(seq), per-channel last-read.
 *
 * Wrap any tree that needs cross-channel state (sidebar, channel header).
 */
export function AgentActivityProvider({ children }: { children: React.ReactNode }) {
  const session = authClient.useSession();
  const userId = session.data?.user?.id ?? null;
  const [activities, setActivities] = useState<Record<string, AgentActivity>>({});
  const [channelMaxSeq, setChannelMaxSeq] = useState<Record<string, number>>({});
  const [channelLastRead, setChannelLastRead] = useState<Record<string, number>>({});
  const [presenceByServer, setPresenceByServer] = useState<Record<string, Record<string, UserPresence>>>({});
  // Phase F HIGH fix (codex G2) — sidebar publishes the set of muted
  // channel ids here so the channel_new Notification gate can suppress
  // toasts for muted channels. Ref so the check inside the WS handler
  // sees the latest set without depending on stale closure state.
  const mutedChannelIdsRef = useRef<Set<string>>(new Set());
  const wsRef = useRef<WebSocket | null>(null);
  /** serverId → reference count. Mounted hook = +1, unmount = -1.
   *  Send presence_subscribe on 0→1 transition; presence_unsubscribe
   *  on 1→0. Re-issued on every WS reconnect. */
  const presenceSubsRef = useRef<Map<string, number>>(new Map());
  const wsReadyRef = useRef(false);

  function sendOnSocket(payload: unknown): void {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try { ws.send(encode(payload as Parameters<typeof encode>[0])); } catch { /* dropped */ }
  }

  const subscribePresence = useCallback((serverId: string) => {
    const cur = presenceSubsRef.current.get(serverId) ?? 0;
    presenceSubsRef.current.set(serverId, cur + 1);
    if (cur === 0 && wsReadyRef.current) {
      sendOnSocket({
        v: PROTOCOL_VERSION, t: "presence_subscribe",
        id: crypto.randomUUID(), serverId,
      });
    }
  }, []);

  const unsubscribePresence = useCallback((serverId: string) => {
    const cur = presenceSubsRef.current.get(serverId) ?? 0;
    if (cur <= 1) {
      presenceSubsRef.current.delete(serverId);
      if (wsReadyRef.current) {
        sendOnSocket({
          v: PROTOCOL_VERSION, t: "presence_unsubscribe",
          id: crypto.randomUUID(), serverId,
        });
      }
      // Drop the cached map for that workspace — leaving stale data
      // around would mislead the next subscriber until snapshot lands.
      setPresenceByServer((prev) => {
        if (!(serverId in prev)) return prev;
        const next = { ...prev };
        delete next[serverId];
        return next;
      });
    } else {
      presenceSubsRef.current.set(serverId, cur - 1);
    }
  }, []);

  const bumpRead = useCallback((channelId: string, seq: number) => {
    setChannelLastRead((prev) => ({
      ...prev,
      [channelId]: Math.max(prev[channelId] ?? 0, seq),
    }));
  }, []);

  const seedChannel = useCallback((channelId: string, maxSeq: number, lastReadSeq: number) => {
    setChannelMaxSeq((prev) => ({ ...prev, [channelId]: Math.max(prev[channelId] ?? 0, maxSeq) }));
    setChannelLastRead((prev) => ({ ...prev, [channelId]: Math.max(prev[channelId] ?? 0, lastReadSeq) }));
  }, []);

  /** Sidebar pushes the set of currently-muted channel ids here so
   *  the channel_new Notification gate can suppress muted-channel
   *  toasts (codex G2 HIGH). Called every getServerBySlug reload. */
  const setMutedChannelIds = useCallback((ids: Set<string>) => {
    mutedChannelIdsRef.current = ids;
  }, []);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    async function connect() {
      if (cancelled) return;
      try {
        const apiTokRes = await fetch(`/api/me/api-token`, { credentials: "include" });
        if (!apiTokRes.ok) { reconnectTimer = setTimeout(connect, 30_000); return; }
        const { token: apiToken } = (await apiTokRes.json()) as { token: string };
        const tokRes = await fetch(`${apiOrigin}/api/v1/ws/token`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer sy_api_${apiToken}` },
          body: JSON.stringify({ scope: "gateway" }),
        }).catch(() => null);
        if (!tokRes || !tokRes.ok) { reconnectTimer = setTimeout(connect, 30_000); return; }
        const { token } = (await tokRes.json()) as { token: string };
        const ws = new WebSocket(`${wsOrigin}/ws/user/${userId}`, [token]);
        wsRef.current = ws;
        ws.onopen = () => {
          ws.send(encode({ v: PROTOCOL_VERSION, t: "hello", id: crypto.randomUUID() }));
          wsReadyRef.current = true;
          // Re-issue every active presence subscription. Critical for
          // reconnect: without this, the WS comes back but
          // WorkspacePresence has us at conns=0 (decremented on close)
          // and the sidebar dots stay frozen at the pre-reconnect
          // state until something else triggers a fresh subscribe.
          for (const serverId of presenceSubsRef.current.keys()) {
            ws.send(encode({
              v: PROTOCOL_VERSION, t: "presence_subscribe",
              id: crypto.randomUUID(), serverId,
            }));
          }
        };
        ws.onmessage = (e) => {
          try {
            const msg = decodeServer(e.data as string);
            if (msg.t === "activity") {
              setActivities((prev) => ({
                ...prev,
                [msg.agentId]: {
                  status: msg.status as AgentActivity["status"],
                  label: msg.label, detail: msg.detail,
                  updatedAt: Date.now(),
                },
              }));
            } else if (msg.t === "channel_new") {
              setChannelMaxSeq((prev) => ({
                ...prev,
                [msg.channelId]: Math.max(prev[msg.channelId] ?? 0, msg.seq),
              }));
              // Phase F minimum-viable browser notification: when this
              // tab is hidden AND the user previously granted Notification
              // permission, surface a soft system toast for the new
              // message. No content here — channel id only — because the
              // gateway event payload doesn't include message text and
              // we don't want to fetch the body just to title a toast.
              // Click-through routing is a follow-up (would need router
              // access inside this provider); a click-to-focus alone
              // covers most "I missed it" cases.
              try {
                if (typeof window !== "undefined"
                    && typeof Notification !== "undefined"
                    && Notification.permission === "granted"
                    && document.visibilityState === "hidden"
                    // Codex G2 HIGH — respect per-user channel mute.
                    // mutedChannelIdsRef is maintained by the sidebar
                    // off the latest getServerBySlug response.
                    && !mutedChannelIdsRef.current.has(msg.channelId)) {
                  const n = new Notification("Raltic", {
                    body: "New message in a channel",
                    tag: `ch:${msg.channelId}`, // collapse runs of messages
                    silent: false,
                  });
                  n.onclick = () => { window.focus(); n.close(); };
                }
              } catch { /* notification denied / iOS Safari quirks — silent fallback */ }
            } else if (msg.t === "read") {
              setChannelLastRead((prev) => ({
                ...prev,
                [msg.channelId]: Math.max(prev[msg.channelId] ?? 0, msg.seq),
              }));
            } else if (msg.t === "presence_snapshot") {
              setPresenceByServer((prev) => ({
                ...prev,
                [msg.serverId]: Object.fromEntries(
                  msg.users.map((u) => [u.userId, { online: u.online, lastSeenAt: u.lastSeenAt }]),
                ),
              }));
            } else if (msg.t === "presence_update") {
              setPresenceByServer((prev) => ({
                ...prev,
                [msg.serverId]: {
                  ...(prev[msg.serverId] ?? {}),
                  [msg.userId]: { online: msg.online, lastSeenAt: msg.lastSeenAt },
                },
              }));
            } else if (msg.t === "member_add" || msg.t === "member_remove") {
              // Cross-tab + cross-device sidebar refresh. The acting
              // tab dispatches this locally too via "raltic:channels-changed",
              // so this path is for OTHER tabs/devices of the same user.
              // We just nudge — sidebar refetches getServerBySlug from
              // its own listener and gets the truth.
              //
              // On member_remove, also clear cached unread/maxSeq for
              // the dropped channel so a future rejoin doesn't carry
              // stale seqs (codex C4 MED — seedChannel merges with
              // Math.max, otherwise the old marker would stick).
              if (msg.t === "member_remove") {
                setChannelMaxSeq((prev) => {
                  if (!(msg.channelId in prev)) return prev;
                  const next = { ...prev };
                  delete next[msg.channelId];
                  return next;
                });
                setChannelLastRead((prev) => {
                  if (!(msg.channelId in prev)) return prev;
                  const next = { ...prev };
                  delete next[msg.channelId];
                  return next;
                });
              }
              if (typeof window !== "undefined") {
                window.dispatchEvent(new CustomEvent("raltic:channels-changed"));
              }
            }
          } catch { /* ignore decode errors */ }
        };
        ws.onclose = () => {
          wsReadyRef.current = false;
          if (!cancelled) reconnectTimer = setTimeout(connect, 3000);
        };
      } catch {
        reconnectTimer = setTimeout(connect, 5000);
      }
    }
    connect();
    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try { wsRef.current?.close(); } catch { /* ignore */ }
    };
  }, [userId]);

  return (
    <Ctx.Provider value={{
      activities, channelMaxSeq, channelLastRead, presenceByServer,
      bumpRead, seedChannel,
      subscribePresence, unsubscribePresence,
      setMutedChannelIds,
    }}>
      {children}
    </Ctx.Provider>
  );
}
