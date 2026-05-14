// ============================================================
// Syncany — Shared Types
// ============================================================

// --- Users & Agents ---

export interface User {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  created_at: string;
}

export type AgentModel = "opus" | "sonnet" | "haiku";
export type AgentStatus = "online" | "sleeping" | "offline";
export type AgentActivity = "idle" | "thinking" | "working" | "error";

export interface AgentActivityEvent {
  agentId: string;
  activity: AgentActivity;
  /** Human-readable label: "Thinking", "Reading file", "Sending message", etc. */
  label?: string;
  /** Specific detail: file path, command, message target, or agent text output */
  detail?: string;
}

export interface Agent {
  id: string;
  name: string;
  display_name: string;
  description: string | null;
  system_prompt: string | null;
  model: AgentModel;
  status: AgentStatus;
  owner_id: string;
  server_id: string;
  created_at: string;
}

// --- Servers ---

export interface Server {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  owner_id: string;
  created_at: string;
}

export interface ServerMember {
  server_id: string;
  member_id: string;
  member_type: "human" | "agent";
  role: "owner" | "admin" | "member";
  joined_at: string;
}

// --- Channels ---

export type ChannelType = "public" | "private" | "dm";

export interface Channel {
  id: string;
  name: string;
  description: string | null;
  type: ChannelType;
  server_id: string;
  created_by: string;
  created_at: string;
}

export interface ChannelMember {
  channel_id: string;
  member_id: string;
  member_type: "human" | "agent";
  joined_at: string;
}

// --- Messages ---

export type SenderType = "human" | "agent" | "system";

export interface Message {
  id: string;
  channel_id: string;
  sender_id: string;
  sender_type: SenderType;
  content: string;
  seq: number | null;
  thread_parent_id: string | null;
  created_at: string;
  updated_at: string;
}

// --- Tasks ---

export type TaskStatus = "todo" | "in_progress" | "in_review" | "done";

export interface Task {
  id: string;
  message_id: string;
  channel_id: string;
  task_number: number;
  status: TaskStatus;
  assignee_id: string | null;
  assignee_type: "human" | "agent" | null;
  created_at: string;
  updated_at: string;
}

// --- Bridge Protocol (WebSocket messages between Server <-> Bridge) ---

export type ServerToBridgeMessage =
  | { type: "new_message"; agentId: string; message: Message; channel: Channel }
  | { type: "start_agent"; agentConfig: AgentConfig }
  | { type: "stop_agent"; agentId: string }
  | { type: "ping" };

export type BridgeToServerMessage =
  | { type: "agent_response"; agentId: string; channelId: string; content: string; threadParentId?: string }
  | { type: "agent_status"; agentId: string; status: Agent["status"] }
  | { type: "cli_command"; agentId: string; command: CliCommand }
  | { type: "pong" };

export interface AgentConfig {
  id: string;
  name: string;
  display_name: string;
  description: string;
  system_prompt: string;
  work_dir: string;
}

// --- CLI Commands (what agents can invoke) ---

export type CliCommand =
  | { action: "message_send"; target: string; content: string }
  | { action: "message_check" }
  | { action: "message_read"; channel: string; limit?: number; before?: string; after?: string }
  | { action: "task_list"; channel: string }
  | { action: "task_claim"; taskNumber?: number; messageId?: string }
  | { action: "task_update"; taskNumber: number; status: TaskStatus }
  | { action: "server_info" };
