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
  /** Stable per-machine hash (hostname + first MAC), so a single key
   *  used on multiple laptops doesn't overwrite each other's snapshot.
   *  Falls back to "default" if bridge can't compute one. */
  machineFingerprint: z.string().max(64).optional(),
  /** Runtimes detected on the bridge host at boot. API zod-validates
   *  this against `bridgeConnectRuntimes` before persisting. */
  runtimes: z.array(z.object({
    id: z.enum(["claude", "codex", "openclaw", "hermes"]),
    detected: z.boolean(),
    version: z.string().max(64).regex(/^[\w.\-+ ()/]+$/).nullable(),
    authed: z.boolean().nullable(),
    authMethod: z.enum(["oauth", "env", "none"]).nullable(),
    error: z.string().max(512).nullable(),
  })).max(8).optional(),
});
export type BridgeConnectRequest = z.infer<typeof bridgeConnectRequest>;

/** Runtime detection snapshot — written by bridge per `/connect`, persisted
 *  on machineKeys row, surfaced to the UI via /api/v1/me/machine-keys/runtimes.
 *  Server-side zod-validated BEFORE persistence to defend against bridge
 *  sending arbitrary JSON (XSS surface via `error` field). */
export const detectedRuntimeSnapshot = z.object({
  id: z.enum(["claude", "codex", "openclaw", "hermes"]),
  detected: z.boolean(),
  // CLI version strings vary wildly — `claude --version` returns
  // "2.1.143 (Claude Code)", `codex --version` returns "codex-cli 0.130.0".
  // Allow word chars + common punctuation. Length cap is the real
  // safety; the regex just bars control chars / HTML.
  version: z.string().max(64).regex(/^[\w.\-+ ()/]+$/).nullable(),
  authed: z.boolean().nullable(),
  authMethod: z.enum(["oauth", "env", "none"]).nullable(),
  error: z.string().max(512).nullable(),
});
export type DetectedRuntimeSnapshot = z.infer<typeof detectedRuntimeSnapshot>;

export const bridgeConnectRuntimes = z.array(detectedRuntimeSnapshot).max(8);

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
    // Free-form text (was z.enum) — each runtime has its own model namespace.
    // Cross-validated against runtime.capabilities.models at the API boundary.
    model: z.string().min(1).max(64),
    // NEW: which AI runtime backs this agent. Default "claude" for agents
    // created before multi-runtime shipped.
    runtime: z.enum(["claude", "codex", "openclaw", "hermes"]).default("claude"),
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

/** Model whitelists per runtime — kept in sync with `RuntimeCapabilities.models`
 *  in `@raltic/agent-runtime`. Listed here too because zod cross-validation
 *  in `createAgentRequest.superRefine` needs them at the API boundary. */
export const RUNTIME_MODELS: Record<"claude" | "codex" | "openclaw" | "hermes", readonly string[]> = {
  claude:  ["sonnet", "opus", "haiku"],
  codex:   ["gpt-5.5", "gpt-5.4", "gpt-5.3-codex-spark"],
  // openclaw + hermes are external-daemon runtimes (user installs
  // them; their daemon routes to whatever providers it's configured
  // with). "auto" means "let the daemon's router pick"; the other
  // entries pin a specific upstream when the user wants determinism.
  openclaw: ["auto", "claude-sonnet-4-6", "gpt-5.4", "gemini-2.5-pro"],
  // Hermes' router is the only thing the user controls — provider
  // selection is daemon-side. Keep two labels so the edit-agent
  // dialog's `.join(" / ")` rendering doesn't look like a stub.
  // Detected by review (wizard M3). The second entry is purely cosmetic;
  // the daemon ignores model strings and routes via its own config.
  hermes:   ["auto", "router-default"],
};

export const createAgentRequest = z.object({
  serverId: z.string(),
  name: z.string().regex(/^[a-z0-9_-]+$/i).min(1).max(64),
  displayName: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  systemPrompt: z.string().max(50_000).optional(),
  runtime: z.enum(["claude", "codex", "openclaw", "hermes"]).default("claude"),
  // P1 W7: cloud-native runtime mode. 'raltic' runs the agent on our
  // Worker DO + sandbox container (zero local install for the user).
  // 'bridge' is the legacy path: agent runs as a spawned process on the
  // user's local bridge daemon. Defaults to 'raltic' so new agents are
  // cloud-native; users can still pick 'bridge' for privacy / quota.
  runtimeMode: z.enum(["raltic", "bridge"]).default("raltic"),
  // Free-form text — model namespace differs per runtime. Validated
  // against RUNTIME_MODELS[runtime] below so user can't post a Codex
  // model with runtime=claude and get a silent failure at spawn time.
  model: z.string().min(1).max(64),
}).superRefine((data, ctx) => {
  const allowed = RUNTIME_MODELS[data.runtime];
  if (!allowed.includes(data.model)) {
    ctx.addIssue({
      code: "custom",
      path: ["model"],
      message: `Model "${data.model}" is not valid for runtime "${data.runtime}". Valid: ${allowed.join(", ")}`,
    });
  }
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

// ---- POST /api/v1/channels/:id/members ----
//
// Bulk-add members to an existing channel. Either list can be empty
// but not both — sending an empty body is a no-op masquerading as an
// API call, which is almost always a UI bug worth surfacing.
export const addChannelMembersRequest = z
  .object({
    memberIds: z.array(z.string()).max(100).optional(),
    agentIds: z.array(z.string()).max(50).optional(),
  })
  .refine((b) => (b.memberIds?.length ?? 0) + (b.agentIds?.length ?? 0) > 0, {
    message: "must add at least one member or agent",
  });
export type AddChannelMembersRequest = z.infer<typeof addChannelMembersRequest>;

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
// `purpose` distinguishes namespaces:
//   • "avatar" (default) → personal user avatar; PUT handler updates user.image
//   • "server_icon"      → workspace icon; PUT handler skips user.image side
//     effect (was a critical bug: uploading a workspace icon used to
//     clobber the uploader's personal avatar because both flows pointed
//     at the same handler that always wrote user.image).
export const uploadAvatarRequest = z.object({
  contentType: z.string().regex(/^image\/(png|jpe?g|gif|webp)$/),
  purpose: z.enum(["avatar", "server_icon"]).default("avatar"),
});
export type UploadAvatarRequest = z.infer<typeof uploadAvatarRequest>;

export const uploadAvatarResponse = z.object({
  uploadUrl: z.string().url(),
  publicUrl: z.string().url(),
  key: z.string(),
});
export type UploadAvatarResponse = z.infer<typeof uploadAvatarResponse>;

// ---- PATCH /api/v1/servers/:id ----
// Day-to-day workspace edits (rename, description, icon). Slug is
// intentionally not in this surface — link-breaking and warrants a
// dedicated UI with a redirect-old-slug story. Add a separate endpoint
// when we tackle that.
// Slug must be URL-safe + reasonably memorable. min(6) avoids collisions
// with reserved single-word routes (login, signup, settings, etc.) and
// matches what we ask of new workspace names; max(48) keeps URLs human.
// Lowercase enforced at the schema layer so two workspaces don't differ
// only in case ("acme" vs "Acme") — confusing for links and uniqueness.
export const SERVER_SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]{4,46}[a-z0-9])$/;

export const updateServerRequest = z.object({
  // Trim + require non-empty after trim. zod's min(1) only catches "" — a
  // body of "   " would otherwise pass and write a whitespace-only name.
  name: z.string().min(1).max(120).transform((s) => s.trim()).refine((s) => s.length > 0, "name cannot be empty").optional(),
  description: z.string().max(2000).nullable().optional(),
  // iconUrl is host-validated at the API layer (must match the same-origin
  // upload URL we issued). We can't validate origin here without knowing
  // the env URL, so the schema just enforces shape; route handler does
  // the host check.
  iconUrl: z.string().url().max(2048).nullable().optional(),
  // Slug change is risky — old links die. Route handler returns the new
  // slug so the UI can re-route after a successful change. UNIQUE
  // constraint at the DB layer catches collisions; route maps to 409.
  slug: z.string().regex(SERVER_SLUG_REGEX, "slug must be 6-48 chars, lowercase letters/digits/hyphens, no leading/trailing hyphen").optional(),
}).strict().refine(
  (v) => v.name !== undefined || v.description !== undefined || v.iconUrl !== undefined || v.slug !== undefined,
  { message: "at least one field is required" },
);
export type UpdateServerRequest = z.infer<typeof updateServerRequest>;

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
