/**
 * Thin typed fetch client for the syncany-api Worker.
 *
 * All requests forward cookies (better-auth session) via `credentials: "include"`.
 * On 4xx/5xx the server returns `{ error: { code, message } }` — we throw
 * an `ApiError` so callers can branch on `err.code`.
 */
import type {
  CreateAgentRequest,
  CreateChannelRequest,
  CreateMachineKeyRequest,
  CreateMachineKeyResponse,
  SendMessageRequest,
  MessageRow,
} from "@syncany/protocol";
import { apiOrigin } from "./auth-client";

export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message);
    this.name = "ApiError";
  }
}

// Short-lived HMAC token from /api/me/api-token. We refresh ~30s before
// expiry. Never expose the long-lived session cookie to JS.
let cachedToken: { value: string; expiresAt: number } | null = null;

async function getApiToken(): Promise<string | null> {
  if (cachedToken && cachedToken.expiresAt - Date.now() > 30_000) {
    return cachedToken.value;
  }
  try {
    const res = await fetch(`/api/me/api-token`, { credentials: "include" });
    if (!res.ok) { cachedToken = null; return null; }
    const body = await res.json() as { token: string; expiresIn: number };
    cachedToken = { value: body.token, expiresAt: Date.now() + body.expiresIn * 1000 };
    return cachedToken.value;
  } catch {
    return null;
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getApiToken();
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(token ? { authorization: `Bearer sy_api_${token}` } : {}),
    ...(init?.headers as Record<string, string> | undefined),
  };
  const res = await fetch(`${apiOrigin}${path}`, { ...init, headers });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (res.status === 401) cachedToken = null;
    const code = body?.error?.code ?? "HTTP_" + res.status;
    const message = body?.error?.message ?? res.statusText;
    throw new ApiError(code, message, res.status);
  }
  return body as T;
}

export interface Server {
  id: string; name: string; slug: string; description: string | null;
  ownerId: string; createdAt: number; role?: "owner" | "admin" | "member";
}
export interface Channel {
  id: string; serverId: string; name: string; description: string | null;
  type: "public" | "private" | "dm"; createdBy: string | null; createdAt: number;
  unread?: number;
}
export interface ChannelMember {
  channelId: string; memberId: string; memberType: "human" | "agent"; joinedAt: number;
}
export interface Agent {
  id: string; serverId: string; ownerId: string; name: string; displayName: string;
  description: string | null; systemPrompt: string | null;
  model: "opus" | "sonnet" | "haiku"; status: "online" | "sleeping" | "offline";
  isDefault: boolean; createdAt: number; updatedAt: number;
}

export const api = {
  me: () => call<{
    subject: { kind: "user"; userId: string };
    servers: any[];
    hasConnectedBridge: boolean;
  }>("/api/v1/me"),
  listServers: () => call<{ servers: Server[] }>("/api/v1/servers"),
  getServerBySlug: (slug: string) =>
    call<{ server: Server; channels: Channel[]; agents: Agent[] }>(`/api/v1/servers/by-slug/${encodeURIComponent(slug)}`),
  getChannel: (id: string) =>
    call<{ channel: Channel; members: ChannelMember[] }>(`/api/v1/channels/${encodeURIComponent(id)}`),
  listAgents: () => call<{ agents: Agent[] }>("/api/v1/agents"),
  mintWsToken: (channelId: string) =>
    call<{ token: string; wsUrl: string }>("/api/v1/ws/token", {
      method: "POST", body: JSON.stringify({ channelId }),
    }),

  // ---- messages ----
  sendMessage: (req: SendMessageRequest) =>
    call<{ ok: true }>("/api/v1/messages", { method: "POST", body: JSON.stringify(req) }),

  listMessages: (channelId: string, opts?: { before?: number; limit?: number }) => {
    const q = new URLSearchParams();
    if (opts?.before != null) q.set("before", String(opts.before));
    if (opts?.limit != null) q.set("limit", String(opts.limit));
    return call<{ messages: MessageRow[] }>(`/api/v1/channels/${channelId}/messages?${q}`);
  },

  // ---- agents ----
  createAgent: (req: CreateAgentRequest) =>
    call<{ id: string }>("/api/v1/agents", { method: "POST", body: JSON.stringify(req) }),

  // ---- channels ----
  createChannel: (req: CreateChannelRequest) =>
    call<{ id: string }>("/api/v1/channels", { method: "POST", body: JSON.stringify(req) }),

  // ---- machine keys ----
  createMachineKey: (req: CreateMachineKeyRequest) =>
    call<CreateMachineKeyResponse>("/api/v1/machine-keys", { method: "POST", body: JSON.stringify(req) }),

  listMachineKeys: () =>
    call<{ keys: Array<{ id: string; prefix: string; name: string; createdAt: number; lastUsedAt: number | null; revokedAt: number | null }> }>("/api/v1/machine-keys"),

  revokeMachineKey: (id: string) =>
    call<{ ok: true }>(`/api/v1/machine-keys/${encodeURIComponent(id)}`, { method: "DELETE" }),

  // ---- tasks ----
  listTasks: (opts?: { channelId?: string; status?: string }) => {
    const q = new URLSearchParams();
    if (opts?.channelId) q.set("channelId", opts.channelId);
    if (opts?.status) q.set("status", opts.status);
    return call<{ tasks: Array<{ id: string; channelId: string; messageId: string; taskNumber: number; title?: string; status: "todo" | "in_progress" | "in_review" | "done"; assigneeId: string | null; assigneeType: "human" | "agent" | null; createdAt: number; updatedAt: number }> }>(`/api/v1/tasks?${q}`);
  },

  createTask: (body: { channelId: string; title: string; assigneeId?: string; assigneeType?: "human" | "agent" }) =>
    call<{ id: string; taskNumber: number }>("/api/v1/tasks", { method: "POST", body: JSON.stringify(body) }),

  updateTask: (id: string, patch: { status?: "todo" | "in_progress" | "in_review" | "done"; assigneeId?: string | null; assigneeType?: "human" | "agent" | null }) =>
    call<{ ok: true }>(`/api/v1/tasks/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) }),

  // ---- message edit / delete / react / mark-read ----
  editMessage: (id: string, content: string) =>
    call<{ ok: true }>(`/api/v1/messages/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ content }) }),

  deleteMessage: (id: string) =>
    call<{ ok: true }>(`/api/v1/messages/${encodeURIComponent(id)}`, { method: "DELETE" }),

  toggleReaction: (messageId: string, emoji: string, opts?: { reactorId?: string; reactorType?: "human" | "agent" }) =>
    call<{ ok: true; added: boolean }>(`/api/v1/messages/${encodeURIComponent(messageId)}/reactions`, {
      method: "POST", body: JSON.stringify({ emoji, ...opts }),
    }),

  markRead: (channelId: string, seq: number) =>
    call<{ ok: true }>(`/api/v1/channels/${encodeURIComponent(channelId)}/read`, {
      method: "POST", body: JSON.stringify({ seq }),
    }),

  // ---- invites ----
  createInvite: (body: { serverId: string; role?: "member" | "admin"; maxUses?: number; ttlHours?: number }) =>
    call<{ id: string; url: string }>("/api/v1/invites", { method: "POST", body: JSON.stringify({ role: "member", maxUses: 0, ...body }) }),

  listInvites: (serverId: string) =>
    call<{ invites: Array<{ id: string; serverId: string; role: string; maxUses: number; uses: number; expiresAt: number | null; revokedAt: number | null; createdAt: number }> }>(`/api/v1/invites?serverId=${encodeURIComponent(serverId)}`),

  revokeInvite: (id: string) =>
    call<{ ok: true }>(`/api/v1/invites/${encodeURIComponent(id)}`, { method: "DELETE" }),

  previewInvite: (id: string) =>
    call<{ server: { id: string; name: string; slug: string; description: string | null }; role: string }>(`/api/v1/invites/${encodeURIComponent(id)}/preview`),

  acceptInvite: (id: string) =>
    call<{ ok: true; serverSlug: string }>(`/api/v1/invites/${encodeURIComponent(id)}/accept`, { method: "POST", body: JSON.stringify({ inviteId: id }) }),

  inviteByEmail: (body: { serverId: string; email: string; role?: "member" | "admin"; ttlHours?: number }) =>
    call<{ id: string; url: string; sentTo: string }>("/api/v1/invites/email", {
      method: "POST", body: JSON.stringify({ role: "member", ttlHours: 24 * 7, ...body }),
    }),

  // ---- workspace members ----
  listMembers: (serverId: string) =>
    call<{ members: Array<{ userId: string; role: string; joinedAt: number; name: string; email: string; image: string | null }> }>(
      `/api/v1/servers/${encodeURIComponent(serverId)}/members`,
    ),

  removeMember: (serverId: string, userId: string) =>
    call<{ ok: true }>(`/api/v1/servers/${encodeURIComponent(serverId)}/members/${encodeURIComponent(userId)}`, { method: "DELETE" }),

  // ---- search ----
  search: (q: string, channelId?: string) => {
    const p = new URLSearchParams({ q });
    if (channelId) p.set("channelId", channelId);
    return call<{ messages: MessageRow[] }>(`/api/v1/search?${p}`);
  },

  // ---- avatar upload ----
  startAvatarUpload: (contentType: string) =>
    call<{ uploadUrl: string; publicUrl: string; key: string }>(`/api/v1/uploads/avatar`, {
      method: "POST", body: JSON.stringify({ contentType }),
    }),

  // ---- updates / deletes ----
  updateAgent: (id: string, patch: Partial<{ displayName: string; description: string | null; systemPrompt: string | null; model: "opus" | "sonnet" | "haiku" }>) =>
    call<{ ok: true }>(`/api/v1/agents/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) }),

  deleteAgent: (id: string) =>
    call<{ ok: true }>(`/api/v1/agents/${encodeURIComponent(id)}`, { method: "DELETE" }),

  updateChannel: (id: string, patch: Partial<{ name: string; description: string | null }>) =>
    call<{ ok: true }>(`/api/v1/channels/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) }),

  deleteChannel: (id: string) =>
    call<{ ok: true }>(`/api/v1/channels/${encodeURIComponent(id)}`, { method: "DELETE" }),
};

export type { MessageRow };
