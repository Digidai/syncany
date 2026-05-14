import { z } from "zod";

// ---------------------------------------------------------------------------
// REST API request/response schemas. Used by web client, bridge, and CLI.
// All endpoints return JSON; errors carry { error: { code, message } }.
// ---------------------------------------------------------------------------

export const errorBody = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
export type ErrorBody = z.infer<typeof errorBody>;

// ---- POST /api/v1/bridge/connect ----
// Bridge sends machine API key, gets back ws URL + scoped session token.

export const bridgeConnectRequest = z.object({
  apiKey: z.string().regex(/^ck_[A-Za-z0-9]{32,}$/),
  hostname: z.string().optional(),
  platform: z.string().optional(),
  arch: z.string().optional(),
});
export type BridgeConnectRequest = z.infer<typeof bridgeConnectRequest>;

export const bridgeConnectResponse = z.object({
  wsUrl: z.string().url(),
  token: z.string(),
  userId: z.string(),
  serverId: z.string(),
  agents: z.array(z.object({
    id: z.string(),
    name: z.string(),
    displayName: z.string(),
    systemPrompt: z.string().nullable(),
    model: z.enum(["opus", "sonnet", "haiku"]),
  })),
  channels: z.array(z.object({
    id: z.string(),
    name: z.string(),
    type: z.enum(["public", "private", "dm"]),
    agentIds: z.array(z.string()), // which of our agents are members
  })),
});
export type BridgeConnectResponse = z.infer<typeof bridgeConnectResponse>;

// ---- POST /api/v1/messages ----

export const sendMessageRequest = z.object({
  channelId: z.string(),
  content: z.string().min(1).max(64_000),
  threadParentId: z.string().nullable().optional(),
  as: z.string().optional(),
  idempotencyKey: z.string().min(1).max(128),
});
export type SendMessageRequest = z.infer<typeof sendMessageRequest>;

// ---- GET /api/v1/channels/:id/messages?before=&limit= ----

export const listMessagesQuery = z.object({
  before: z.coerce.number().int().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListMessagesQuery = z.infer<typeof listMessagesQuery>;

// ---- POST /api/v1/agents ----

export const createAgentRequest = z.object({
  serverId: z.string(),
  name: z.string().regex(/^[a-z0-9_-]+$/i).min(1).max(64),
  displayName: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  systemPrompt: z.string().max(50_000).optional(),
  model: z.enum(["opus", "sonnet", "haiku"]).default("sonnet"),
});
export type CreateAgentRequest = z.infer<typeof createAgentRequest>;

// ---- POST /api/v1/channels ----

export const createChannelRequest = z.object({
  serverId: z.string(),
  name: z.string().regex(/^[a-z0-9_-]+$/i).min(1).max(64),
  description: z.string().max(2000).optional(),
  type: z.enum(["public", "private", "dm"]).default("public"),
  initialMemberIds: z.array(z.string()).optional(),
  initialAgentIds: z.array(z.string()).optional(),
});
export type CreateChannelRequest = z.infer<typeof createChannelRequest>;

// ---- PATCH /api/v1/messages/:id (edit) ----

export const editMessageRequest = z.object({
  content: z.string().min(1).max(64_000),
});
export type EditMessageRequest = z.infer<typeof editMessageRequest>;

// ---- POST /api/v1/messages/:id/reactions  +  DELETE same ----

export const toggleReactionRequest = z.object({
  emoji: z.string().min(1).max(32),
  reactorId: z.string().optional(),     // for agents — defaults to authenticated user
  reactorType: z.enum(["human", "agent"]).optional(),
});
export type ToggleReactionRequest = z.infer<typeof toggleReactionRequest>;

// ---- POST /api/v1/channels/:id/read ----

export const markReadRequest = z.object({
  seq: z.number().int().nonnegative(),
});
export type MarkReadRequest = z.infer<typeof markReadRequest>;

// ---- POST /api/v1/tasks ----

export const createTaskRequest = z.object({
  channelId: z.string(),
  title: z.string().min(1).max(2000),
  assigneeId: z.string().optional(),
  assigneeType: z.enum(["human", "agent"]).optional(),
});
export type CreateTaskRequest = z.infer<typeof createTaskRequest>;

export const updateTaskRequest = z.object({
  status: z.enum(["todo", "in_progress", "in_review", "done"]).optional(),
  assigneeId: z.string().nullable().optional(),
  assigneeType: z.enum(["human", "agent"]).nullable().optional(),
});
export type UpdateTaskRequest = z.infer<typeof updateTaskRequest>;

export const listTasksQuery = z.object({
  channelId: z.string().optional(),
  status: z.enum(["todo", "in_progress", "in_review", "done"]).optional(),
  assigneeId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListTasksQuery = z.infer<typeof listTasksQuery>;

// ---- POST /api/v1/invites ----

export const createInviteRequest = z.object({
  serverId: z.string(),
  role: z.enum(["member", "admin"]).default("member"),
  maxUses: z.number().int().min(0).max(1000).default(0),
  ttlHours: z.number().int().min(1).max(24 * 365).optional(),
});
export type CreateInviteRequest = z.infer<typeof createInviteRequest>;

export const acceptInviteRequest = z.object({
  inviteId: z.string(),
});
export type AcceptInviteRequest = z.infer<typeof acceptInviteRequest>;

// ---- GET /api/v1/search?q=&channelId= ----

export const searchQuery = z.object({
  q: z.string().min(1).max(200),
  channelId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type SearchQuery = z.infer<typeof searchQuery>;

// ---- POST /api/v1/uploads/avatar (returns presigned PUT URL) ----

export const uploadAvatarRequest = z.object({
  contentType: z.string().regex(/^image\/(png|jpe?g|gif|webp)$/),
});
export type UploadAvatarRequest = z.infer<typeof uploadAvatarRequest>;

export const uploadAvatarResponse = z.object({
  uploadUrl: z.string().url(),
  publicUrl: z.string().url(),
  key: z.string(),
});
export type UploadAvatarResponse = z.infer<typeof uploadAvatarResponse>;

// ---- POST /api/v1/machine-keys ----

export const createMachineKeyRequest = z.object({
  serverId: z.string(),
  name: z.string().min(1).max(120),
});
export type CreateMachineKeyRequest = z.infer<typeof createMachineKeyRequest>;

export const createMachineKeyResponse = z.object({
  id: z.string(),
  // Plaintext returned ONCE on create. Never stored.
  apiKey: z.string(),
  name: z.string(),
  createdAt: z.number().int(),
});
export type CreateMachineKeyResponse = z.infer<typeof createMachineKeyResponse>;
