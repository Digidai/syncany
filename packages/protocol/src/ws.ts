import { z } from "zod";

// ---------------------------------------------------------------------------
// WebSocket protocol shared between web client, bridge client, and ChatRoom DO.
// All messages carry { v, t } discriminator. Client→Server messages additionally
// carry an `id` for request/response correlation.
// ---------------------------------------------------------------------------

export const PROTOCOL_VERSION = 1 as const;

// ---------- Common ----------

export const messageRow = z.object({
  id: z.string(),
  channelId: z.string(),
  senderId: z.string(),
  senderType: z.enum(["human", "agent", "system"]),
  content: z.string(),
  seq: z.number().int().nonnegative(),
  threadParentId: z.string().nullable(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  editedAt: z.number().int().nullable().optional(),
  deletedAt: z.number().int().nullable().optional(),
  reactions: z.array(z.object({ emoji: z.string(), reactorIds: z.array(z.string()) })).optional(),
});
export type MessageRow = z.infer<typeof messageRow>;

// ---------- Client → Server ----------

export const clientHello = z.object({
  v: z.literal(1), t: z.literal("hello"), id: z.string(),
  // Bridge-only: the agents this connection represents on this user's behalf.
  agentIds: z.array(z.string()).optional(),
});

export const clientSend = z.object({
  v: z.literal(1), t: z.literal("send"), id: z.string(),
  content: z.string().min(1).max(64_000),
  threadParentId: z.string().nullable().optional(),
  // If `as` matches one of the connection's agentIds, message is sent as agent.
  // Otherwise sent as the human user.
  as: z.string().optional(),
  idempotencyKey: z.string().min(1).max(128),
});

export const clientTyping = z.object({
  v: z.literal(1), t: z.literal("typing"), id: z.string(), on: z.boolean(),
});

export const clientPresence = z.object({
  v: z.literal(1), t: z.literal("presence"), id: z.string(),
  status: z.enum(["active", "away"]),
});

export const clientHistory = z.object({
  v: z.literal(1), t: z.literal("history"), id: z.string(),
  before: z.number().int().optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

export const clientRpc = z.object({
  v: z.literal(1), t: z.literal("rpc"), id: z.string(),
  method: z.string(),
  params: z.unknown(),
});

export const clientMessage = z.discriminatedUnion("t", [
  clientHello, clientSend, clientTyping, clientPresence, clientHistory, clientRpc,
]);
export type ClientMessage = z.infer<typeof clientMessage>;

// ---------- Server → Client ----------

export const serverAck = z.object({
  v: z.literal(1), t: z.literal("ack"), id: z.string(),
  seq: z.number().int().optional(),
  messageId: z.string().optional(),
});

export const serverErr = z.object({
  v: z.literal(1), t: z.literal("err"), id: z.string(),
  code: z.string(), message: z.string(),
});

export const serverMessageEvent = z.object({
  v: z.literal(1), t: z.literal("message"),
  seq: z.number().int(),
  message: messageRow,
});

export const serverTyping = z.object({
  v: z.literal(1), t: z.literal("typing"),
  userId: z.string(), on: z.boolean(),
});

export const serverPresence = z.object({
  v: z.literal(1), t: z.literal("presence"),
  userId: z.string(),
  status: z.enum(["active", "away", "offline"]),
});

export const serverMemberAdd = z.object({
  v: z.literal(1), t: z.literal("member_add"),
  channelId: z.string(),
  memberId: z.string(),
  memberType: z.enum(["human", "agent"]),
});

export const serverActivity = z.object({
  v: z.literal(1), t: z.literal("activity"),
  agentId: z.string(),
  status: z.enum(["idle", "thinking", "working", "error"]),
  label: z.string().optional(),
  detail: z.string().optional(),
});

export const serverMessageUpdate = z.object({
  v: z.literal(1), t: z.literal("message_update"),
  message: messageRow,
});

export const serverReaction = z.object({
  v: z.literal(1), t: z.literal("reaction"),
  messageId: z.string(),
  emoji: z.string(),
  reactorId: z.string(),
  added: z.boolean(),                     // true=add, false=remove
});

/** Sent over UserGateway DO when a new message lands in a channel the user
 *  is a member of. Lets the sidebar bump unread badges without re-fetching. */
export const serverChannelNew = z.object({
  v: z.literal(1), t: z.literal("channel_new"),
  channelId: z.string(),
  seq: z.number().int(),
});

/** Sent over UserGateway DO when *this user* marks a channel as read on
 *  another tab/device — so other tabs can clear their badges instantly. */
export const serverRead = z.object({
  v: z.literal(1), t: z.literal("read"),
  channelId: z.string(),
  seq: z.number().int(),
});

/** UserGateway DO informs each connected bridge whether it is currently
 *  the LEADER for this user. Only the leader bridge dispatches inbound
 *  channel messages to its local Claude Code process — non-leader bridges
 *  observe but stay silent, preventing double-reply when one user runs the
 *  bridge on multiple machines. Sent on every gateway connect AND whenever
 *  leadership changes (e.g. another bridge connects later). */
export const serverLeaderStatus = z.object({
  v: z.literal(1), t: z.literal("leader_status"),
  isLeader: z.boolean(),
});

export const serverHistory = z.object({
  v: z.literal(1), t: z.literal("history"), id: z.string(),
  messages: z.array(messageRow),
});

export const serverRpc = z.object({
  v: z.literal(1), t: z.literal("rpc"), id: z.string(),
  result: z.unknown().optional(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
});

export const serverMessage = z.discriminatedUnion("t", [
  serverAck, serverErr, serverMessageEvent, serverTyping, serverPresence,
  serverMemberAdd, serverHistory, serverRpc, serverActivity,
  serverMessageUpdate, serverReaction, serverChannelNew, serverRead,
  serverLeaderStatus,
]);
export type ServerMessage = z.infer<typeof serverMessage>;

// ---------- Helpers ----------

export function encode(msg: ClientMessage | ServerMessage): string {
  return JSON.stringify(msg);
}

export function decodeClient(raw: string | ArrayBuffer): ClientMessage {
  const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
  return clientMessage.parse(JSON.parse(text));
}

export function decodeServer(raw: string | ArrayBuffer): ServerMessage {
  const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
  return serverMessage.parse(JSON.parse(text));
}
