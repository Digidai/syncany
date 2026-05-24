/**
 * Thin typed fetch client for the raltic-api Worker.
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
} from "@raltic/protocol";
import type { ZodTypeAny, infer as ZodInfer } from "zod";
import { apiOrigin } from "./auth-client";

/**
 * Parse an untyped JSON value through a zod schema; on parse failure
 * log + return the supplied fallback so the UI never white-screens on
 * server-side shape drift. Multica-inspired (their `parseWithFallback`
 * caught #2143/#2147/#2192 in production). We're a SaaS-only app today
 * but the desktop app (apps/desktop/) is installed-client and CAN run
 * older than the backend it talks to; this helper makes the desktop
 * surface robust without requiring a separate code path.
 *
 * Usage at the API boundary:
 *   const me = parseWithFallback(meSchema, EMPTY_ME, raw);
 *
 * Don't reach for this inside business logic — it's only for the bytes
 * coming OFF the wire.
 */
export function parseWithFallback<S extends ZodTypeAny>(
  schema: S,
  fallback: ZodInfer<S>,
  raw: unknown,
): ZodInfer<S> {
  const result = schema.safeParse(raw);
  if (result.success) return result.data;
  // Console warn (not throw) — the goal is graceful degrade, not crash.
  console.warn("[api] schema parse failed; using fallback", {
    issues: result.error.issues.slice(0, 3),
    rawPreview: JSON.stringify(raw).slice(0, 200),
  });
  return fallback;
}

export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message);
    this.name = "ApiError";
  }
  /** Caller can branch on the fault domain instead of memorising status codes. */
  get isUserFault(): boolean { return this.status >= 400 && this.status < 500; }
  get isServerFault(): boolean { return this.status >= 500; }
  get isAuthFault(): boolean {
    return this.status === 401 || this.code === "FORBIDDEN" || this.code === "NOT_A_MEMBER";
  }
}

/** Network-layer fault: fetch threw OR aborted by timeout. Distinct from
 *  ApiError (structured server response). UI can show "You're offline"
 *  vs "Server error" with appropriate copy. */
export class NetworkError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = "NetworkError";
  }
}

/** Per-request timeout. Cloudflare Worker cold-start budget is ~3-5s plus
 *  D1 budget; 15s is generous enough that healthy requests never trip it
 *  yet short enough that a hung worker doesn't spin the user's UI forever. */
const REQUEST_TIMEOUT_MS = 15_000;

/** Retry: one re-try on 5xx + NetworkError, 250ms backoff. Writes are only
 *  retried if the caller explicitly opts in via `opts.retry` — blindly
 *  retrying a POST can duplicate side effects. */
const DEFAULT_RETRIES_GET = 1;
const RETRY_BACKOFF_MS = 250;

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

async function call<T>(
  path: string,
  init?: RequestInit & {
    /** Force retry on 5xx + NetworkError even for non-GET. Default true for
     *  GET/HEAD, false for everything else. */
    retry?: boolean;
    /** Override the default timeout for this request. */
    timeoutMs?: number;
  },
): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const idempotent = method === "GET" || method === "HEAD";
  const shouldRetry = init?.retry ?? idempotent;
  const maxAttempts = 1 + (shouldRetry ? DEFAULT_RETRIES_GET : 0);
  const timeout = init?.timeoutMs ?? REQUEST_TIMEOUT_MS;

  let lastErr: unknown;
  // 401 deserves ONE transparent retry — the api-token is short-lived and
  // may have just expired between the cache hit and the actual request. We
  // already invalidate `cachedToken` on 401 inside doFetch, so the retry
  // will fetch a fresh token. Without this, every token expiry surfaces as
  // a visible "sign in" toast even though the session cookie is still valid.
  let refreshed401 = false;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await doFetch<T>(path, init, timeout);
    } catch (e) {
      lastErr = e;
      if (e instanceof ApiError && e.status === 401 && !refreshed401) {
        refreshed401 = true;
        continue;          // retry immediately with the freshly-fetched token
      }
      // Don't retry user-fault errors — they won't get better on the second try.
      if (e instanceof ApiError && e.isUserFault) throw e;
      // Last attempt: surface the error.
      if (attempt === maxAttempts - 1) throw e;
      // Otherwise back off and retry.
      await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS * (attempt + 1)));
    }
  }
  // unreachable — loop either returns or throws
  throw lastErr;
}

async function doFetch<T>(
  path: string,
  init: RequestInit | undefined,
  timeoutMs: number,
): Promise<T> {
  const token = await getApiToken();
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(token ? { authorization: `Bearer sy_api_${token}` } : {}),
    ...(init?.headers as Record<string, string> | undefined),
  };

  // AbortController for timeout. Caller's own signal (if any) is forwarded
  // — any of (caller abort, timeout, fetch error) cancels the request.
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const callerSignal = init?.signal;
  callerSignal?.addEventListener("abort", () => ctl.abort(), { once: true });

  let res: Response;
  try {
    res = await fetch(`${apiOrigin}${path}`, { ...init, headers, signal: ctl.signal });
  } catch (e) {
    if (ctl.signal.aborted && !callerSignal?.aborted) {
      throw new NetworkError(`Request to ${path} timed out after ${timeoutMs}ms`, e);
    }
    throw new NetworkError(`Network error calling ${path}`, e);
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  // Non-JSON bodies (HTML error pages from CF, gateway timeouts, etc)
  // would throw raw SyntaxError; wrap them as ApiError so callers don't
  // see a wildly different error shape depending on whether CF returned
  // a structured 5xx vs an edge HTML page.
  let body: { error?: { code?: string; message?: string } } | null = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      if (!res.ok) {
        throw new ApiError("BAD_RESPONSE", `Non-JSON ${res.status} response`, res.status);
      }
      // 2xx with non-JSON body shouldn't happen for our API, but if it
      // does we throw too so the caller doesn't silently cast garbage.
      throw new ApiError("BAD_RESPONSE", "Non-JSON 2xx response", res.status);
    }
  }
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
  iconUrl: string | null;
  ownerId: string; createdAt: number; role?: "owner" | "admin" | "member";
}
export interface Channel {
  id: string; serverId: string; name: string; description: string | null;
  type: "public" | "private" | "dm"; createdBy: string | null; createdAt: number;
  unread?: number; maxSeq?: number; lastReadSeq?: number;
  // Populated by /api/v1/servers/by-slug for DM channels — identifies
  // the OTHER party so the sidebar can render "Olivia" instead of the
  // raw channel.name (which is just a stable hex identifier for human
  // DMs). null for non-DM channels.
  peer?: {
    name: string;
    type: "human" | "agent";
    id: string;
    avatarSeed?: string | null;
    runtime?: RuntimeId | null;
  } | null;
}
export interface ChannelMember {
  channelId: string; memberId: string; memberType: "human" | "agent"; joinedAt: number;
}
// Keep in sync with packages/agent-runtime/src/types.ts RuntimeId and
// packages/protocol/src/rest.ts runtime enums.
//
// Lifecycle:
//   claude / codex     — per_turn_spawn (bridge owns the process)
//   openclaw / hermes  — external_daemon (user installs + runs daemon
//                         themselves; bridge shells out per turn)
export type RuntimeId = "claude" | "codex" | "openclaw" | "hermes";
export type AuthMethod = "oauth" | "env" | "none";

export interface Agent {
  id: string; serverId: string; ownerId: string; name: string; displayName: string;
  description: string | null; systemPrompt: string | null;
  /** Free-form model id — namespace differs per runtime (sonnet/opus/haiku
   *  for Claude, gpt-5.5/etc for Codex). UI filters via RUNTIME_MODELS. */
  model: string;
  /** Which AI runtime backs this agent. */
  runtime: RuntimeId;
  /** Where the agent's runtime executes (P1 W7).
   *  'bridge'  = user's local bridge daemon (legacy default)
   *  'raltic'  = our cloud Worker DO + sandbox container
   *  others    = reserved for sidecar runtimes (P2+) */
  runtimeMode?: "bridge" | "raltic" | "claude" | "codex" | "openclaw" | "hermes";
  status: "online" | "sleeping" | "offline";
  /** Optional override seed for the gradient avatar. Null → derive from `id`. */
  avatarSeed?: string | null;
  isDefault: boolean; createdAt: number; updatedAt: number;
  /** Direct-message channel id (sidebar links to this). Created automatically
   *  when the agent is created. May be null for agents created before the
   *  auto-DM feature shipped (legacy onboarding rows). */
  dmChannelId?: string | null;
}

/** Snapshot returned per-machine inside listMachineKeys() — populated
 *  from the bridge's last `/connect` for each fingerprint that's used
 *  this key. Empty array when key never connected. */
export interface MachineRuntimeRow {
  fingerprint: string;
  hostname: string | null;
  platform: string | null;
  arch: string | null;
  detectedAt: number;
  runtimes: Array<{
    id: RuntimeId;
    detected: boolean;
    version: string | null;
    authed: boolean | null;
    authMethod: AuthMethod | null;
    error: string | null;
  }>;
}

export const RUNTIME_LABEL: Record<RuntimeId, string> = {
  claude:   "Anthropic Claude Code",
  codex:    "OpenAI Codex",
  openclaw: "OpenClaw",
  hermes:   "Hermes Agent",
};
export const RUNTIME_MODELS: Record<RuntimeId, readonly string[]> = {
  claude:   ["sonnet", "opus", "haiku"],
  codex:    ["gpt-5.5", "gpt-5.4", "gpt-5.3-codex-spark"],
  // openclaw + hermes routes via the user's daemon configuration —
  // "auto" lets the daemon's router pick based on installed providers.
  openclaw: ["auto", "claude-sonnet-4-6", "gpt-5.4", "gemini-2.5-pro"],
  hermes:   ["auto"],
};

export const api = {
  // Optional `serverId` scopes `hasConnectedBridge` to ONE workspace
  // rather than "any workspace the user has ever bridged into". The
  // setup wizard auto-pop on /s/[slug] needs the scoped flavor so a
  // user who set up a bridge on workspace A still sees the wizard on
  // workspace B (until B itself has a connected bridge).
  //
  // `personalServerId/Slug` = the user's earliest owned workspace
  // (where wizard targets; where /` redirects to by default).
  // `defaultServerId/Slug` = user-chosen default, falls back to
  // personal, then to earliest-joined. Both nullable only for the
  // pathological "zero memberships" case.
  me: (opts?: { serverId?: string }) => call<{
    subject: { kind: "user"; userId: string };
    servers: Array<{
      id: string; slug: string; name: string;
      description: string | null; iconUrl: string | null;
      role: "owner" | "admin" | "member";
      joinedAt: number;
    }>;
    personalServerId: string | null;
    personalServerSlug: string | null;
    defaultServerId: string | null;
    defaultServerSlug: string | null;
    hasConnectedBridge: boolean;
  }>(opts?.serverId ? `/api/v1/me?serverId=${encodeURIComponent(opts.serverId)}` : "/api/v1/me"),

  // PATCH the user's default workspace. Pass `null` to clear (then /me
  // falls back to personal → earliest joined). 403 for machine keys.
  setDefaultServer: (serverId: string | null) =>
    call<{ ok: true; defaultServerId: string | null }>("/api/v1/me/default-server", {
      method: "PATCH",
      body: JSON.stringify({ serverId }),
    }),

  // Find-or-create a 1:1 DM with another workspace member (human OR
  // agent). Idempotent — second call with the same pair returns the
  // existing channel. Use this from the sidebar "+" picker and from
  // /s/[slug]/people row "Message" actions.
  openDm: (req: { serverId: string; peerType: "human" | "agent"; peerId: string }) =>
    call<{ channelId: string; created: boolean }>("/api/v1/dm", {
      method: "POST",
      body: JSON.stringify(req),
    }),

  // Owner-only: (re-)seed the personal workspace with the Onboarding
  // Assistant + welcome channels. Used by the "Restore Onboarding
  // Assistant" button in Settings → Agents when the owner has deleted
  // the original. {force: true} bypasses the seeded=0 gate so an owner
  // can intentionally re-add the agent in an already-seeded workspace.
  seedServer: (serverId: string, opts?: { force?: boolean }) =>
    call<{ ok: true; seeded: boolean; created: boolean }>(`/api/v1/servers/${encodeURIComponent(serverId)}/seed`, {
      method: "POST",
      body: JSON.stringify({ force: !!opts?.force }),
    }),

  // Browse all public channels in a workspace. Each row carries an
  // `isMember` flag so the UI can render Join only for not-yet-joined.
  browseChannels: (serverId: string) =>
    call<{ channels: Array<{ id: string; name: string; description: string | null; createdAt: number; isMember: boolean }> }>(
      `/api/v1/servers/${encodeURIComponent(serverId)}/channels/browse`,
    ),

  // Join a public channel. Idempotent — already-member call returns
  // 200 with alreadyMember=true.
  joinChannel: (channelId: string) =>
    call<{ ok: true; alreadyMember: boolean }>(`/api/v1/channels/${encodeURIComponent(channelId)}/join`, {
      method: "POST",
    }),
  /** Bulk-add members + agents to a channel. Server validates same-workspace
   *  for all ids and silently skips already-joined ones (returned in `skipped`). */
  addChannelMembers: (channelId: string, body: { memberIds?: string[]; agentIds?: string[] }) =>
    call<{
      ok: true;
      added: { humans: number; agents: number };
      skipped: { humans: number; agents: number };
    }>(`/api/v1/channels/${encodeURIComponent(channelId)}/members`, {
      method: "POST", body: JSON.stringify(body),
    }),
  /** Remove ONE member from a channel. Gated server-side to channel
   *  creator or workspace owner; self-remove rejected — use leaveChannel. */
  removeChannelMember: (channelId: string, memberType: "human" | "agent", memberId: string) =>
    call<{ ok: true }>(
      `/api/v1/channels/${encodeURIComponent(channelId)}/members/${memberType}/${encodeURIComponent(memberId)}`,
      { method: "DELETE" },
    ),
  /** Self-leave a channel. Always allowed for members; rejects on DMs. */
  leaveChannel: (channelId: string) =>
    call<{ ok: true }>(`/api/v1/channels/${encodeURIComponent(channelId)}/leave`, {
      method: "POST",
    }),
  listServers: () => call<{ servers: Server[] }>("/api/v1/servers"),
  getServerBySlug: (slug: string) =>
    call<{ server: Server; channels: Channel[]; agents: Agent[] }>(`/api/v1/servers/by-slug/${encodeURIComponent(slug)}`),
  getChannel: (id: string) =>
    call<{ channel: Channel; members: ChannelMember[]; peer: Channel["peer"]; viewerCanManage: boolean }>(`/api/v1/channels/${encodeURIComponent(id)}`),
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

  // ---- agent workspace (P1 W6 — cloud-mode only) ----
  listAgentWorkspace: (agentId: string, path: string) =>
    call<{ path: string; entries: Array<{ name: string; kind: "dir" | "file" | "symlink" | "other" }> }>(
      `/api/v1/agents/${encodeURIComponent(agentId)}/workspace/list?path=${encodeURIComponent(path)}`,
    ),
  readAgentFile: (agentId: string, path: string, encoding?: "utf-8" | "base64") => {
    const q = new URLSearchParams({ path });
    if (encoding) q.set("encoding", encoding);
    return call<{ path: string; content: string; encoding: "utf-8" | "base64"; bytes: number; truncated: boolean }>(
      `/api/v1/agents/${encodeURIComponent(agentId)}/workspace/read?${q}`,
    );
  },
  getAgentTerminal: (agentId: string) =>
    call<{ tail: string }>(`/api/v1/agents/${encodeURIComponent(agentId)}/workspace/terminal`),

  // ---- connectors (P2) ----
  listConnectors: () =>
    call<{ connectors: Array<{
      id: string; kind: "github" | "linear" | "notion"; label: string;
      scopes: string[]; createdAt: string; lastUsedAt: string | null;
    }> }>(`/api/v1/connectors`),
  createConnector: (req: { kind: "github" | "linear" | "notion"; label: string; token: string; scopes?: string[] }) =>
    call<{ id: string; kind: string; label: string; scopes: string[] }>(
      `/api/v1/connectors`,
      { method: "POST", body: JSON.stringify(req) },
    ),
  deleteConnector: (id: string) =>
    call<{ ok: true }>(`/api/v1/connectors/${encodeURIComponent(id)}`, { method: "DELETE" }),
  listAgentConnectors: (agentId: string) =>
    call<{ connectors: Array<{ id: string; kind: string; label: string; scopes: string[] }> }>(
      `/api/v1/agents/${encodeURIComponent(agentId)}/connectors`,
    ),
  linkAgentConnector: (agentId: string, connectorId: string) =>
    call<{ ok: true }>(
      `/api/v1/agents/${encodeURIComponent(agentId)}/connectors`,
      { method: "POST", body: JSON.stringify({ connectorId }) },
    ),
  unlinkAgentConnector: (agentId: string, connectorId: string) =>
    call<{ ok: true }>(
      `/api/v1/agents/${encodeURIComponent(agentId)}/connectors/${encodeURIComponent(connectorId)}`,
      { method: "DELETE" },
    ),

  // ---- channels ----
  createChannel: (req: CreateChannelRequest) =>
    call<{ id: string }>("/api/v1/channels", { method: "POST", body: JSON.stringify(req) }),

  // ---- machine keys ----
  createMachineKey: (req: CreateMachineKeyRequest) =>
    call<CreateMachineKeyResponse>("/api/v1/machine-keys", { method: "POST", body: JSON.stringify(req) }),

  listMachineKeys: (opts?: { serverId?: string }) =>
    call<{ keys: Array<{
      id: string;
      prefix: string;
      name: string;
      serverId: string;
      createdAt: number;
      lastUsedAt: number | null;
      revokedAt: number | null;
      lastDetectedAt: number | null;
      machines: MachineRuntimeRow[];
    }> }>(opts?.serverId ? `/api/v1/machine-keys?serverId=${encodeURIComponent(opts.serverId)}` : "/api/v1/machine-keys"),

  revokeMachineKey: (id: string) =>
    call<{ ok: true }>(`/api/v1/machine-keys/${encodeURIComponent(id)}`, { method: "DELETE" }),

  // ---- tasks ----
  listTasks: (opts?: { channelId?: string; status?: string }) => {
    const q = new URLSearchParams();
    if (opts?.channelId) q.set("channelId", opts.channelId);
    if (opts?.status) q.set("status", opts.status);
    return call<{ tasks: Array<{ id: string; channelId: string; messageId: string | null; taskNumber: number; title?: string; status: "todo" | "in_progress" | "in_review" | "done"; assigneeId: string | null; assigneeType: "human" | "agent" | null; createdAt: number; updatedAt: number }> }>(`/api/v1/tasks?${q}`);
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
    call<{ members: Array<{ userId: string; role: string; joinedAt: number; name: string; email: string | null; image: string | null }>; viewerRole: string }>(
      `/api/v1/servers/${encodeURIComponent(serverId)}/members`,
    ),

  removeMember: (serverId: string, userId: string) =>
    call<{ ok: true }>(`/api/v1/servers/${encodeURIComponent(serverId)}/members/${encodeURIComponent(userId)}`, { method: "DELETE" }),

  // ---- workspace lifecycle ----
  updateServer: (id: string, patch: { name?: string; description?: string | null; iconUrl?: string | null; slug?: string }) =>
    call<{ server: Server }>(`/api/v1/servers/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) }),

  deleteServer: (id: string) =>
    call<{ ok: true }>(`/api/v1/servers/${encodeURIComponent(id)}`, { method: "DELETE" }),

  leaveServer: (id: string) =>
    call<{ ok: true }>(`/api/v1/servers/${encodeURIComponent(id)}/leave`, { method: "POST" }),

  // ---- inbox (unified DMs + task assignments) ----
  getInbox: (serverId: string) =>
    call<{
      items: Array<{
        id: string;
        kind: "dm" | "task";
        createdAt: number;
        channelId: string;
        channelName: string;
        channelType: "public" | "private" | "dm";
        preview: string;
        href: string;
      }>;
      count: number;
    }>(`/api/v1/inbox?serverId=${encodeURIComponent(serverId)}`),

  // ---- search ----
  search: (q: string, channelId?: string) => {
    const p = new URLSearchParams({ q });
    if (channelId) p.set("channelId", channelId);
    return call<{ messages: MessageRow[] }>(`/api/v1/search?${p}`);
  },

  // ---- avatar upload ----
  // `purpose` selects the namespace: "avatar" (default) writes to
  // avatars/{userId}/ AND updates user.image on PUT; "server_icon" writes
  // to server-icons/{userId}/ and does NOT touch user.image — caller is
  // expected to follow up with updateServer({ iconUrl: publicUrl }).
  startAvatarUpload: (contentType: string, purpose: "avatar" | "server_icon" = "avatar") =>
    call<{ uploadUrl: string; publicUrl: string; key: string }>(`/api/v1/uploads/avatar`, {
      method: "POST", body: JSON.stringify({ contentType, purpose }),
    }),

  // ---- updates / deletes ----
  updateAgent: (id: string, patch: Partial<{ displayName: string; description: string | null; systemPrompt: string | null; model: string; runtime: RuntimeId; avatarSeed: string | null }>) =>
    call<{ ok: true }>(`/api/v1/agents/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) }),

  deleteAgent: (id: string) =>
    call<{ ok: true }>(`/api/v1/agents/${encodeURIComponent(id)}`, { method: "DELETE" }),

  updateChannel: (id: string, patch: Partial<{ name: string; description: string | null }>) =>
    call<{ ok: true }>(`/api/v1/channels/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) }),

  deleteChannel: (id: string) =>
    call<{ ok: true }>(`/api/v1/channels/${encodeURIComponent(id)}`, { method: "DELETE" }),
};

export type { MessageRow };
