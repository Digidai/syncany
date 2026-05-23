import { sqliteTable, text, integer, real, primaryKey, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { desc, sql as sqlFn } from "drizzle-orm";

// ---------------------------------------------------------------------------
// better-auth tables (user / session / account / verification)
// ---------------------------------------------------------------------------

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  name: text("name").notNull(),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  // The workspace `/` redirects to and that the setup wizard targets.
  // Set by runOnboarding to the personal workspace it auto-creates;
  // user can change in Settings → Account. Nullable so users from
  // before this column existed still work — read paths must fall back
  // (see /api/v1/me).
  // FK with ON DELETE SET NULL — declared here so Drizzle's introspection
  // and the runtime schema match what migration 0008 actually applied. The
  // lazy `() => servers.id` arrow defers resolution past the forward
  // reference (servers is declared further down this file).
  defaultServerId: text("default_server_id").references((): import("drizzle-orm/sqlite-core").AnySQLiteColumn => servers.id, { onDelete: "set null" }),
}, (t) => [
  index("ix_user_email").on(t.email),
  index("ix_user_default_server").on(t.defaultServerId),
]);

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (t) => [
  index("ix_session_user").on(t.userId),
  index("ix_session_expires").on(t.expiresAt),
]);

export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
  scope: text("scope"),
  idToken: text("id_token"),
  password: text("password"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (t) => [
  uniqueIndex("ux_account_provider_account").on(t.providerId, t.accountId),
  index("ix_account_user").on(t.userId),
]);

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (t) => [
  index("ix_verification_identifier").on(t.identifier),
  index("ix_verification_expires").on(t.expiresAt),
]);

// ---------------------------------------------------------------------------
// Raltic domain tables
// ---------------------------------------------------------------------------

export const servers = sqliteTable("servers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  iconUrl: text("icon_url"),
  ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  // Lazy-seed flag for personal workspaces created via the invite-
  // flow signup path. 1 = onboarding agent + welcome channels +
  // welcome messages are present (or were always present, for pre-
  // 0009 rows). 0 = bare workspace; first owner GET or explicit
  // POST /api/v1/servers/:id/seed runs seedPersonalDefaults and flips
  // to 1 via a conditional UPDATE (WHERE seeded=0) — race-safe.
  seeded: integer("seeded", { mode: "boolean" }).notNull().default(true),
}, (t) => [
  index("ix_servers_owner").on(t.ownerId),
  index("ix_servers_slug").on(t.slug),
  index("ix_servers_created").on(t.createdAt),
]);

export const serverMembers = sqliteTable("server_members", {
  serverId: text("server_id").notNull().references(() => servers.id, { onDelete: "cascade" }),
  memberId: text("member_id").notNull(),                          // user.id OR agent.id
  memberType: text("member_type", { enum: ["human", "agent"] }).notNull(),
  role: text("role", { enum: ["owner", "admin", "member"] }).notNull().default("member"),
  joinedAt: integer("joined_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (t) => [
  primaryKey({ columns: [t.serverId, t.memberId] }),
  index("ix_sm_member").on(t.memberId),
  index("ix_sm_server_role").on(t.serverId, t.role),
  index("ix_sm_type").on(t.serverId, t.memberType),
]);

export const agents = sqliteTable("agents", {
  id: text("id").primaryKey(),
  serverId: text("server_id").notNull().references(() => servers.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  displayName: text("display_name").notNull(),
  description: text("description"),
  systemPrompt: text("system_prompt"),
  // Model identifier — free-form string because each runtime has its own
  // namespace ("sonnet"/"opus"/"haiku" for Claude, "gpt-5.5"/etc for
  // Codex). Cross-validated against runtime.capabilities.models at the
  // API boundary (see protocol/rest.ts createAgentRequest.superRefine).
  model: text("model").notNull().default("sonnet"),
  // Which AI runtime backs this agent. Each runtime has its own model
  // list, permission semantics, and CLI. Defaults to "claude" so
  // existing pre-multi-runtime rows are stable.
  // runtime: the AI CLI that backs this agent. Currently shipped:
  // claude, codex, openclaw, hermes. Stored as plain text — the same
  // pattern as `runtime_mode` (validation lives in zod at the API
  // boundary, not the DB), so adding/removing runtimes doesn't need
  // a table rebuild. Drizzle's enum metadata only generates a CHECK
  // constraint when used at create-table time, so dropping enum here
  // doesn't break existing rows.
  runtime: text("runtime").notNull().default("claude"),
  // P0 W2: where this agent's runtime executes.
  //   'bridge'  → user's local bridge process (existing path, default for
  //                back-compat with pre-cloud agents).
  //   'raltic'  → RalticAgent DO in our Worker + sandbox container (cloud).
  //   'claude' | 'codex' | 'gemini' | 'copilot' → reserved for sidecar
  //                runtimes (P2): cloud sandbox with the respective CLI
  //                pre-attached. Same DO routes them; sandbox composition
  //                differs.
  //
  // 'bridge' is the only mode that does NOT use a DO — the local bridge
  // subscribes to ChatRoom WS directly. AgentDispatcher (apps/api/lib/
  // agent-dispatch.ts) skips dispatch for bridge agents because the
  // bridge sees the message via its own WS subscription.
  runtimeMode: text("runtime_mode", {
    enum: ["bridge", "raltic", "claude", "codex", "gemini", "copilot"],
  }).notNull().default("bridge"),
  /** Migration safety (D6): exactly one runtime per agent at a time.
   *  When user clicks "Move to Cloud", we set 'in_progress' before the
   *  bridge snapshot, then 'completed' when DO is ready. Dispatcher
   *  drops messages for 'in_progress' agents to avoid races. */
  migrationStatus: text("migration_status", {
    enum: ["stable", "in_progress", "archived"],
  }).notNull().default("stable"),
  status: text("status", { enum: ["online", "sleeping", "offline"] }).notNull().default("offline"),
  // Optional override for the deterministic gradient avatar. Null → derive
  // from `id`. Set via the "shuffle" UI in agent settings.
  avatarSeed: text("avatar_seed"),
  isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (t) => [
  uniqueIndex("ux_agents_server_name").on(t.serverId, t.name),
  index("ix_agents_owner").on(t.ownerId),
  index("ix_agents_status").on(t.status),
]);

export const channels = sqliteTable("channels", {
  id: text("id").primaryKey(),
  serverId: text("server_id").notNull().references(() => servers.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  type: text("type", { enum: ["public", "private", "dm"] }).notNull().default("public"),
  createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (t) => [
  uniqueIndex("ux_channels_server_name").on(t.serverId, t.name),
  index("ix_channels_server_type").on(t.serverId, t.type),
  index("ix_channels_created_by").on(t.createdBy),
]);

export const channelMembers = sqliteTable("channel_members", {
  channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
  memberId: text("member_id").notNull(),
  memberType: text("member_type", { enum: ["human", "agent"] }).notNull(),
  joinedAt: integer("joined_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  // Highest message.seq this member has read in this channel — drives unread badges.
  lastReadSeq: integer("last_read_seq").notNull().default(0),
}, (t) => [
  primaryKey({ columns: [t.channelId, t.memberId] }),
  index("ix_cm_member").on(t.memberId),
  index("ix_cm_member_type").on(t.memberId, t.memberType),
  index("ix_cm_channel_type").on(t.channelId, t.memberType),
]);

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
  senderId: text("sender_id").notNull(),
  senderType: text("sender_type", { enum: ["human", "agent", "system"] }).notNull(),
  content: text("content").notNull(),
  // seq is allocated by the channel's ChatRoom DO, never by D1.
  seq: integer("seq").notNull(),
  threadParentId: text("thread_parent_id"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  editedAt: integer("edited_at", { mode: "timestamp_ms" }),
  deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  // P3-W2: stamped by either the inline ChatRoom indexer or the
  // backfill cron once the row's vector lands in Vectorize. Backfill
  // gates on `vectorIndexedAt IS NULL` to avoid double-spend on
  // embeddings (codex P3-W2 HIGH finding). Nullable + indexed for the
  // partial-index scan pattern.
  vectorIndexedAt: integer("vector_indexed_at", { mode: "timestamp_ms" }),
}, (t) => [
  uniqueIndex("ux_messages_channel_seq").on(t.channelId, t.seq),
  index("ix_messages_channel_created").on(t.channelId, t.createdAt),
  index("ix_messages_thread").on(t.threadParentId, t.createdAt),
  index("ix_messages_sender").on(t.senderId, t.createdAt),
  // Partial index — the only access pattern is "find un-indexed rows".
  index("ix_messages_unindexed").on(t.createdAt).where(sqlFn`vector_indexed_at IS NULL`),
]);

export const reactions = sqliteTable("reactions", {
  messageId: text("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
  reactorId: text("reactor_id").notNull(),
  reactorType: text("reactor_type", { enum: ["human", "agent"] }).notNull(),
  emoji: text("emoji").notNull(),                         // unicode emoji, e.g. "👍"
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (t) => [
  primaryKey({ columns: [t.messageId, t.reactorId, t.emoji] }),
  index("ix_reactions_message").on(t.messageId),
]);

export type Reaction = typeof reactions.$inferSelect;

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  // Nullable so the row is inserted FIRST (atomic UNIQUE on
  // (channel_id, task_number)), then the chat message is posted with the
  // correct number, then this column gets back-filled. Avoids the race
  // where a retry-on-UNIQUE-collision posted duplicate user-visible chat
  // messages with diverging numbers.
  messageId: text("message_id").unique().references(() => messages.id, { onDelete: "cascade" }),
  channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
  taskNumber: integer("task_number").notNull(),
  status: text("status", { enum: ["todo", "in_progress", "in_review", "done"] }).notNull().default("todo"),
  assigneeId: text("assignee_id"),
  assigneeType: text("assignee_type", { enum: ["human", "agent"] }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (t) => [
  uniqueIndex("ux_tasks_channel_num").on(t.channelId, t.taskNumber),
  // Composite index added by 0007_task_inbox_index.sql and confirmed in
  // remote D1. The 4-column composite (assignee_id, assignee_type,
  // status, created_at DESC) strictly dominates the prior 2-column
  // (assignee_id, status) — the planner uses this for the per-assignee
  // task-inbox query in inbox.ts. Drizzle's snapshot for 0006 still
  // references the old index; this entry reconciles src/schema.ts to
  // the actually-applied DB state.
  index("ix_tasks_assignee_kind_status_created").on(t.assigneeId, t.assigneeType, t.status, desc(t.createdAt)),
  index("ix_tasks_status").on(t.channelId, t.status),
]);

export const invites = sqliteTable("invites", {
  id: text("id").primaryKey(),                                    // public token in URL
  serverId: text("server_id").notNull().references(() => servers.id, { onDelete: "cascade" }),
  invitedBy: text("invited_by").notNull().references(() => user.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["member", "admin"] }).notNull().default("member"),
  maxUses: integer("max_uses").notNull().default(0),              // 0 = unlimited
  uses: integer("uses").notNull().default(0),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }),     // null = never
  revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  // P3 audit security HIGH (codex 4 + UX angle 5): email-pinned invites.
  // When set, accept refuses any subject whose email != this value
  // (case-insensitive). NULL = shareable link (any authenticated user
  // can accept up to maxUses). Always populated by /invites/email so
  // forwarded/leaked links from the email path can't be used by a
  // stranger. Stored lowercased server-side for case-insensitive compare.
  email: text("email"),
}, (t) => [
  index("ix_invites_server").on(t.serverId),
  index("ix_invites_invited_by").on(t.invitedBy),
]);
export type Invite = typeof invites.$inferSelect;

export const machineKeys = sqliteTable("machine_keys", {
  id: text("id").primaryKey(),
  keyPrefix: text("key_prefix").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  serverId: text("server_id").notNull().references(() => servers.id, { onDelete: "cascade" }),
  name: text("name").notNull().default("Default"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
  revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
  // Per-machine-fingerprint snapshot of runtimes detected on the bridge
  // that holds this key. Written on every POST /api/v1/bridge/connect.
  // Read for Settings → Machine API keys + Setup Wizard step 3 — also
  // works offline (last-known state preserved across bridge restarts).
  // Shape: Record<machineFingerprint, { runtimes, detectedAt, hostname? }>.
  // Read code MUST safeParse — older bridge versions may have written
  // older shapes.
  lastDetectedRuntimes: text("last_detected_runtimes", { mode: "json" }),
  lastDetectedAt: integer("last_detected_at", { mode: "timestamp_ms" }),
}, (t) => [
  index("ix_mk_user").on(t.userId),
  index("ix_mk_server").on(t.serverId),
  index("ix_mk_hash").on(t.keyHash),
]);

// ---------------------------------------------------------------------------
// user_connectors — external-service credentials (P2).
//
// Per-user, not per-agent: a user pastes a PAT once, then can grant any
// of their agents access via agent.enabled_connectors. Token stored
// envelope-encrypted (AES-GCM with a Worker secret as KEK) so a D1
// dump alone doesn't leak credentials. Encryption helpers live in
// packages/auth-core/src/encrypt.ts.
//
// kind enum: limited to v1 services. Add a new kind requires:
//   1. Append to enum here + migration
//   2. Add a tool group under packages/agent/src/tools/connectors/<kind>.ts
//   3. Wire it into buildToolRegistry conditionally on agent has this connector enabled
// ---------------------------------------------------------------------------
export const userConnectors = sqliteTable("user_connectors", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["github", "linear", "notion"] }).notNull(),
  // User-chosen label so a person can have e.g. "personal" + "work"
  // GitHub PATs without confusing them in the UI.
  label: text("label").notNull(),
  // Envelope-encrypted token blob. Format: base64(iv || ciphertext || authTag).
  // Decrypted via the same Worker secret in env.CONNECTOR_TOKEN_KEY.
  encryptedToken: text("encrypted_token").notNull(),
  // JSON array of scopes the agent loop should treat as available.
  // e.g. ["repo", "issues"] for GitHub. Honor system: if the underlying
  // PAT was issued narrower than this claim, the connector tool will
  // fail at the API call with 403 — we don't double-check at storage time.
  scopes: text("scopes", { mode: "json" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
}, (t) => [
  index("idx_uc_user").on(t.userId),
  // Lookup pattern: "give me this user's GitHub connector(s)".
  index("idx_uc_user_kind").on(t.userId, t.kind),
]);

// Junction: which connectors an agent is allowed to use. Distinct from
// userConnectors because the same user can have multiple agents and
// each may have different toolsets. Owner-only mutation gated at the
// API layer.
export const agentConnectors = sqliteTable("agent_connectors", {
  agentId: text("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  connectorId: text("connector_id").notNull().references(() => userConnectors.id, { onDelete: "cascade" }),
  enabledAt: integer("enabled_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (t) => [
  primaryKey({ columns: [t.agentId, t.connectorId] }),
  index("idx_ac_agent").on(t.agentId),
]);

// ---------------------------------------------------------------------------
// agent_facts — semantic memory layer (P3-W2).
//
// Triple store of structured facts the agent has learned. Distinct from
// /workspace/.memory/ filesystem notes (those are unstructured prose);
// this table is for things the agent should be able to QUERY:
//   "what timezone is Gene in?"
//   → SELECT object FROM agent_facts WHERE agent_id=? AND subject_id='gene' AND predicate='timezone'
//
// Mutability: when a fact is updated, we INSERT a new row + set
// superseded_by on the old row (rather than UPDATE in place) so we
// keep a confidence/history trail. Query for active facts uses the
// WHERE superseded_by IS NULL pattern (covered by idx_facts_active).
// ---------------------------------------------------------------------------
export const agentFacts = sqliteTable("agent_facts", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  // What KIND of thing the subject is. Enum is enforced at the
  // application layer (CHECK in migration) so we can grow it without
  // a schema migration just to add a value.
  subjectKind: text("subject_kind", {
    enum: ["user", "agent", "channel", "project", "concept"],
  }).notNull(),
  // Stable id of the subject. For 'user'/'agent' use user.id/agent.id;
  // for 'project'/'concept' it's an agent-chosen slug (matches the
  // memory/projects/<slug>.md file name when there is one).
  subjectId: text("subject_id").notNull(),
  // Whitelisted predicate vocabulary (see PREDICATE_WHITELIST in tools).
  // Keeping the schema open + enforcing at write-time gives us room to
  // expand without migrations.
  predicate: text("predicate").notNull(),
  object: text("object").notNull(),
  // Source provenance — the message that produced this fact (so a user
  // can audit why the agent "knows" something).
  sourceMessageId: text("source_message_id"),
  // Confidence 0..1. Reflection should set lower confidence on
  // inferences vs explicit user statements.
  confidence: real("confidence").notNull().default(0.8),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  // When set, this row is historical — superseded by the row with id=<this>.
  supersededBy: text("superseded_by"),
}, (t) => [
  index("idx_facts_agent_subject").on(t.agentId, t.subjectKind, t.subjectId),
  // Partial index for active-fact queries (the hot path).
  index("idx_facts_active").on(t.agentId).where(sqlFn`superseded_by IS NULL`),
]);

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type User = typeof user.$inferSelect;
export type Server = typeof servers.$inferSelect;
export type ServerMember = typeof serverMembers.$inferSelect;
export type Agent = typeof agents.$inferSelect;
export type Channel = typeof channels.$inferSelect;
export type ChannelMember = typeof channelMembers.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type MachineKey = typeof machineKeys.$inferSelect;
