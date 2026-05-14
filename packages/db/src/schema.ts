import { sqliteTable, text, integer, primaryKey, index, uniqueIndex } from "drizzle-orm/sqlite-core";

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
}, (t) => [
  index("ix_user_email").on(t.email),
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
// Syncany domain tables
// ---------------------------------------------------------------------------

export const servers = sqliteTable("servers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
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
  model: text("model", { enum: ["opus", "sonnet", "haiku"] }).notNull().default("sonnet"),
  status: text("status", { enum: ["online", "sleeping", "offline"] }).notNull().default("offline"),
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
}, (t) => [
  uniqueIndex("ux_messages_channel_seq").on(t.channelId, t.seq),
  index("ix_messages_channel_created").on(t.channelId, t.createdAt),
  index("ix_messages_thread").on(t.threadParentId, t.createdAt),
  index("ix_messages_sender").on(t.senderId, t.createdAt),
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
  index("ix_tasks_assignee").on(t.assigneeId, t.status),
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
}, (t) => [
  index("ix_mk_user").on(t.userId),
  index("ix_mk_server").on(t.serverId),
  index("ix_mk_hash").on(t.keyHash),
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
