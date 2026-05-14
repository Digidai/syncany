"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { authClient, apiOrigin } from "@/lib/auth-client";
import { decodeServer, encode, PROTOCOL_VERSION } from "@syncany/protocol";

const wsOrigin = apiOrigin.replace(/^http/, "ws");

export interface AgentActivity {
  status: "idle" | "thinking" | "working" | "error";
  label?: string;
  detail?: string;
  updatedAt: number;
}

interface GatewayValue {
  activities: Record<string, AgentActivity>;
  /** Live cross-channel state: per-channel max(seq) the gateway has heard about. */
  channelMaxSeq: Record<string, number>;
  /** Per-channel last-read marker, mirrored from server-side updates and local actions. */
  channelLastRead: Record<string, number>;
  /** Imperative: notify the local store that a channel was just opened/marked-read. */
  bumpRead: (channelId: string, seq: number) => void;
  /** Imperative: seed initial state from a server fetch (avoids n+1 round-trips). */
  seedChannel: (channelId: string, maxSeq: number, lastReadSeq: number) => void;
}

const Ctx = createContext<GatewayValue>({
  activities: {},
  channelMaxSeq: {},
  channelLastRead: {},
  bumpRead: () => {},
  seedChannel: () => {},
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
  const wsRef = useRef<WebSocket | null>(null);

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
          headers: { "content-type": "application/json", authorization: `Bearer cw_api_${apiToken}` },
          body: JSON.stringify({ scope: "gateway" }),
        }).catch(() => null);
        if (!tokRes || !tokRes.ok) { reconnectTimer = setTimeout(connect, 30_000); return; }
        const { token } = (await tokRes.json()) as { token: string };
        const ws = new WebSocket(`${wsOrigin}/ws/user/${userId}`, [token]);
        wsRef.current = ws;
        ws.onopen = () => {
          ws.send(encode({ v: PROTOCOL_VERSION, t: "hello", id: crypto.randomUUID() }));
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
            } else if (msg.t === "read") {
              setChannelLastRead((prev) => ({
                ...prev,
                [msg.channelId]: Math.max(prev[msg.channelId] ?? 0, msg.seq),
              }));
            }
          } catch { /* ignore decode errors */ }
        };
        ws.onclose = () => {
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
    <Ctx.Provider value={{ activities, channelMaxSeq, channelLastRead, bumpRead, seedChannel }}>
      {children}
    </Ctx.Provider>
  );
}
