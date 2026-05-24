import type { Env } from "./env";

interface MessageRowLike {
  id: string;
  channelId: string;
  senderId: string;
  senderType: string;
  content: string;
  seq: number;
  threadParentId: string | null;
  createdAt: Date | number;
  updatedAt: Date | number;
  editedAt?: Date | number | null;
  deletedAt?: Date | number | null;
  // Phase A — pin marker on the message; null = not pinned.
  pinnedAt?: Date | number | null;
  pinnedBy?: string | null;
  attachments?: Array<{
    id: string;
    filename: string;
    contentType: string;
    sizeBytes: number;
    url: string;
    width?: number | null;
    height?: number | null;
  }>;
}

/** Tell every channel WS subscriber that a message was edited or deleted. */
export async function broadcastMessageUpdate(env: Env, channelId: string, m: MessageRowLike): Promise<void> {
  try {
    const stub = env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName(channelId));
    await stub.fetch("https://chat-room/internal/notify", {
      method: "POST",
      headers: { "x-internal-secret": env.CHAT_ROOM_AUTH_SECRET, "content-type": "application/json" },
      body: JSON.stringify({
        v: 1,
        t: "message_update",
        message: {
          ...m,
          createdAt: m.createdAt instanceof Date ? m.createdAt.getTime() : Number(m.createdAt),
          updatedAt: m.updatedAt instanceof Date ? m.updatedAt.getTime() : Number(m.updatedAt),
          editedAt: m.editedAt ? (m.editedAt instanceof Date ? m.editedAt.getTime() : Number(m.editedAt)) : null,
          deletedAt: m.deletedAt ? (m.deletedAt instanceof Date ? m.deletedAt.getTime() : Number(m.deletedAt)) : null,
          pinnedAt: m.pinnedAt ? (m.pinnedAt instanceof Date ? m.pinnedAt.getTime() : Number(m.pinnedAt)) : null,
          pinnedBy: m.pinnedBy ?? null,
        },
      }),
    });
  } catch (e) { console.warn("broadcastMessageUpdate failed", e); }
}

/** Tell every channel WS subscriber about a reaction add/remove. */
export async function broadcastReaction(
  env: Env,
  channelId: string,
  payload: { messageId: string; emoji: string; reactorId: string; added: boolean },
): Promise<void> {
  try {
    const stub = env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName(channelId));
    await stub.fetch("https://chat-room/internal/notify", {
      method: "POST",
      headers: { "x-internal-secret": env.CHAT_ROOM_AUTH_SECRET, "content-type": "application/json" },
      body: JSON.stringify({ v: 1, t: "reaction", ...payload }),
    });
  } catch (e) { console.warn("broadcastReaction failed", e); }
}

/** Tell a user's UserGateway DO about a cross-channel notification. */
export async function notifyGateway(env: Env, userId: string, msg: unknown): Promise<void> {
  try {
    const stub = env.USER_GATEWAY.get(env.USER_GATEWAY.idFromName(userId));
    await stub.fetch("https://user-gateway/internal/notify", {
      method: "POST",
      headers: { "x-internal-secret": env.CHAT_ROOM_AUTH_SECRET, "content-type": "application/json" },
      body: JSON.stringify(msg),
    });
  } catch (e) { console.warn("notifyGateway failed", userId, e); }
}

/**
 * Phase D — close any live ChatRoom WS sessions held by a removed
 * member. Best-effort: a fanout miss must NOT 500 the parent endpoint
 * (delete/leave/archive); the kicked party falls back to "stops
 * receiving on reload" if the kick fetch errors.
 */
export async function kickFromChannel(
  env: Env,
  channelId: string,
  memberId: string,
  memberType: "human" | "agent",
): Promise<void> {
  try {
    const stub = env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName(channelId));
    const res = await stub.fetch("https://chat-room/internal/kick", {
      method: "POST",
      headers: { "x-internal-secret": env.CHAT_ROOM_AUTH_SECRET, "content-type": "application/json" },
      body: JSON.stringify({ memberId, memberType }),
    });
    // Codex G1 MED 4 — failure to kick is a real security issue
    // (removed user keeps receiving). Log loudly so a misconfigured
    // secret surfaces fast instead of silently leaking.
    if (!res.ok) {
      console.error("kickFromChannel non-ok", channelId, memberId, res.status, await res.text().catch(() => ""));
    }
  } catch (e) { console.warn("kickFromChannel failed", channelId, memberId, e); }
}

/**
 * Phase D + codex G1 HIGH 2 — drop every WS session NOT in the
 * provided allow lists. Used by visibility convert public→private to
 * disconnect prior public-channel readers who are no longer entitled.
 */
export async function kickNonMembers(
  env: Env,
  channelId: string,
  allowedUserIds: string[],
  allowedAgentIds: string[],
): Promise<void> {
  try {
    const stub = env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName(channelId));
    const res = await stub.fetch("https://chat-room/internal/kick", {
      method: "POST",
      headers: { "x-internal-secret": env.CHAT_ROOM_AUTH_SECRET, "content-type": "application/json" },
      body: JSON.stringify({ mode: "retain-only", allowedUserIds, allowedAgentIds }),
    });
    if (!res.ok) {
      console.error("kickNonMembers non-ok", channelId, res.status, await res.text().catch(() => ""));
    }
  } catch (e) { console.warn("kickNonMembers failed", channelId, e); }
}
