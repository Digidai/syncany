"use client";

import { useEffect, useRef, useState } from "react";
import {
  type MessageRow,
  type ServerMessage,
  decodeServer,
  encode,
  PROTOCOL_VERSION,
} from "@syncany/protocol";
import { apiOrigin } from "@/lib/auth-client";

const wsOrigin = apiOrigin.replace(/^http/, "ws");

interface UseChannelSocketOpts {
  channelId: string | null;
  /** Optional initial token; if absent or expired we mint a fresh one on (re)connect. */
  token: string | null;
  onMessage?: (msg: MessageRow) => void;
  onMessageUpdate?: (msg: MessageRow) => void;
  onReaction?: (ev: { messageId: string; emoji: string; reactorId: string; added: boolean }) => void;
  onPresence?: (userId: string, status: "active" | "away" | "offline") => void;
  onTyping?: (userId: string, on: boolean) => void;
}

async function mintWsToken(channelId: string): Promise<string | null> {
  try {
    const apiTokRes = await fetch(`/api/me/api-token`, { credentials: "include" });
    if (!apiTokRes.ok) return null;
    const { token: apiToken } = (await apiTokRes.json()) as { token: string };
    const res = await fetch(`${apiOrigin}/api/v1/ws/token`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer sy_api_${apiToken}` },
      body: JSON.stringify({ channelId }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { token: string };
    return data.token;
  } catch { return null; }
}

export function useChannelSocket({ channelId, token, onMessage, onMessageUpdate, onReaction, onPresence, onTyping }: UseChannelSocketOpts) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const reconnectAttempt = useRef(0);
  const initialTokenRef = useRef(token);

  useEffect(() => { initialTokenRef.current = token; }, [token]);

  useEffect(() => {
    if (!channelId) return;
    let cancelled = false;

    const open = async () => {
      if (cancelled) return;
      // Always mint a fresh token on (re)connect — initial token may have
      // expired (10 min TTL) by the time the socket drops + retries.
      let useToken = initialTokenRef.current;
      if (!useToken || reconnectAttempt.current > 0) {
        useToken = await mintWsToken(channelId);
        if (cancelled) return;
        if (!useToken) {
          const delay = Math.min(30_000, 1000 * Math.pow(2, reconnectAttempt.current++));
          setTimeout(open, delay);
          return;
        }
      }
      initialTokenRef.current = useToken; // remember for next reconnect

      const ws = new WebSocket(
        `${wsOrigin}/ws/channel/${channelId}?channelId=${channelId}`,
        [useToken],
      );
      wsRef.current = ws;
      ws.onopen = () => {
        setConnected(true);
        reconnectAttempt.current = 0;
        ws.send(encode({ v: PROTOCOL_VERSION, t: "hello", id: crypto.randomUUID() }));
      };
      ws.onmessage = (e) => {
        let msg: ServerMessage;
        try { msg = decodeServer(e.data as string); }
        catch { return; }
        if (msg.t === "message" && onMessage) onMessage(msg.message);
        else if (msg.t === "message_update" && onMessageUpdate) onMessageUpdate(msg.message);
        else if (msg.t === "reaction" && onReaction) onReaction({ messageId: msg.messageId, emoji: msg.emoji, reactorId: msg.reactorId, added: msg.added });
        else if (msg.t === "presence" && onPresence) onPresence(msg.userId, msg.status);
        else if (msg.t === "typing" && onTyping) onTyping(msg.userId, msg.on);
      };
      ws.onclose = () => {
        setConnected(false);
        if (cancelled) return;
        const delay = Math.min(30_000, 500 * Math.pow(2, reconnectAttempt.current++));
        // Clear the cached token if we've been disconnected long enough that
        // it's likely expired; min(30s) for fast cycles, full re-mint for slow.
        if (delay > 5000) initialTokenRef.current = null;
        setTimeout(open, delay);
      };
      ws.onerror = () => { try { ws.close(); } catch { /* ignore */ } };
    };
    open();
    return () => {
      cancelled = true;
      try { wsRef.current?.close(); } catch { /* ignore */ }
    };
  }, [channelId, onMessage, onMessageUpdate, onReaction, onPresence, onTyping]);

  function send(content: string, opts?: { threadParentId?: string; as?: string }) {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(encode({
      v: PROTOCOL_VERSION,
      t: "send",
      id: crypto.randomUUID(),
      content,
      threadParentId: opts?.threadParentId ?? null,
      as: opts?.as,
      idempotencyKey: crypto.randomUUID(),
    }));
    return true;
  }

  return { connected, send };
}
