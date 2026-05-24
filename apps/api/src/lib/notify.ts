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
    await stub.fetch("https://chat-room/internal/kick", {
      method: "POST",
      headers: { "x-internal-secret": env.CHAT_ROOM_AUTH_SECRET, "content-type": "application/json" },
      body: JSON.stringify({ memberId, memberType }),
    });
  } catch (e) { console.warn("kickFromChannel failed", channelId, memberId, e); }
}
