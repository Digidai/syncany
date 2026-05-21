#!/usr/bin/env node

/**
 * Raltic CLI — agents call this to talk to raltic-api.
 *
 * Auth via env vars (set by the bridge when spawning Claude Code):
 *   RALTIC_AGENT_ID    — UUID of the agent
 *   RALTIC_API_URL     — e.g. https://api.raltic.com
 *   RALTIC_AGENT_TOKEN — bridge's session token (HMAC JWT)
 *
 * Usage:
 *   raltic message send --target "#general" <<EOF
 *   Hello everyone!
 *   EOF
 *   raltic message check
 *   raltic message read --channel <channelId> [--limit 50]
 *   raltic server info
 */

const AGENT_ID = process.env.RALTIC_AGENT_ID;
const API_URL = process.env.RALTIC_API_URL;
const TOKEN = process.env.RALTIC_AGENT_TOKEN;

function fail(code: string, message: string): never {
  process.stderr.write(JSON.stringify({ ok: false, code, message }) + "\n");
  process.exit(1);
}

if (!AGENT_ID) fail("MISSING_AGENT_ID", "RALTIC_AGENT_ID is not set");
if (!API_URL) fail("MISSING_API_URL", "RALTIC_API_URL is not set");
if (!TOKEN) fail("MISSING_AGENT_TOKEN", "RALTIC_AGENT_TOKEN is not set");

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    if (process.stdin.isTTY) { resolve(""); return; }
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data.trim()));
  });
}

function parseArgs(args: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const k = args[i].slice(2);
      const v = args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : "true";
      out[k] = v;
    }
  }
  return out;
}

async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer sy_bridge_${TOKEN}`,
      ...init?.headers,
    },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const code = body?.error?.code ?? "HTTP_" + res.status;
    const message = body?.error?.message ?? res.statusText;
    fail(code, message);
  }
  return body as T;
}

// ---------------------------------------------------------------------------
// Resolve --target ("#name" / "channel-id" / "@user-name") to a channelId.
// ---------------------------------------------------------------------------
async function resolveTargetChannelId(target: string): Promise<string> {
  if (!target) fail("BAD_TARGET", "missing target");
  // Plain UUID-looking string → use as channel id.
  if (/^[0-9a-f-]{36}$/i.test(target)) return target;

  // We need agent's server context to look up by name. Use /me-style endpoint.
  const me = await api<{ servers: any[] }>(`/api/v1/servers`);
  if (me.servers.length === 0) fail("NO_SERVER", "agent has no server");
  // Look up channels in first server (TODO: support cross-server when needed).
  const slug = me.servers[0].slug;
  const data = await api<{ channels: { id: string; name: string; type: string }[] }>(
    `/api/v1/servers/by-slug/${encodeURIComponent(slug)}`,
  );
  const trimmed = target.replace(/^[#@]/, "");
  const found = data.channels.find((c) => c.name === trimmed);
  if (!found) fail("CHANNEL_NOT_FOUND", `no channel named ${target}`);
  return found.id;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------
async function cmdMessageSend(flags: Record<string, string>): Promise<void> {
  const target = flags.target;
  if (!target) fail("INVALID_ARG", "missing --target");
  const content = await readStdin();
  if (!content) fail("INVALID_ARG", "message content must be supplied via stdin");
  const channelId = await resolveTargetChannelId(target);
  // Stable idempotency: same agent + same channel + same content within a
  // 60-second window dedupes. CLI retries don't double-post.
  const slot = Math.floor(Date.now() / 60_000);
  const idempotencyKey = await sha256Hex(`${AGENT_ID}:${channelId}:${slot}:${content}`);
  await api(`/api/v1/messages`, {
    method: "POST",
    body: JSON.stringify({ channelId, content, as: AGENT_ID, idempotencyKey }),
  });
  console.log(`Message sent to ${target}.`);
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function cmdMessageCheck(): Promise<void> {
  const data = await api<{ messages: any[] }>(`/api/v1/agent/messages/check?agentId=${AGENT_ID}`);
  if (data.messages.length === 0) { console.log("No messages."); return; }
  for (const r of data.messages.slice(0, 20)) {
    const m = r.m ?? r;
    const when = new Date(m.createdAt).toISOString();
    console.log(`[${when}] [${r.channel ?? m.channelId}] ${m.senderType}/${m.senderId.slice(0, 8)}: ${String(m.content).slice(0, 200)}`);
  }
}

async function cmdMessageRead(flags: Record<string, string>): Promise<void> {
  const channelId = flags.channel ?? flags.target ?? fail("INVALID_ARG", "missing --channel");
  const limit = Number(flags.limit ?? 50);
  const id = await resolveTargetChannelId(channelId as string);
  const data = await api<{ messages: any[] }>(`/api/v1/channels/${id}/messages?limit=${limit}`);
  for (const m of data.messages) {
    console.log(`[seq ${m.seq}] ${m.senderType}/${m.senderId.slice(0, 8)}: ${String(m.content).slice(0, 200)}`);
  }
}

async function cmdServerInfo(): Promise<void> {
  const data = await api<{ servers: any[] }>(`/api/v1/servers`);
  for (const s of data.servers) {
    console.log(`server ${s.id} slug=${s.slug} name=${s.name} role=${s.role}`);
  }
}

async function cmdTaskList(flags: Record<string, string>): Promise<void> {
  const params = new URLSearchParams();
  if (flags.channel) params.set("channelId", await resolveTargetChannelId(flags.channel));
  if (flags.status) params.set("status", flags.status);
  if (flags.assignee) params.set("assigneeId", flags.assignee);
  const data = await api<{ tasks: any[] }>(`/api/v1/tasks?${params}`);
  if (data.tasks.length === 0) { console.log("No tasks."); return; }
  for (const t of data.tasks) {
    const who = t.assigneeId ? `${t.assigneeType}/${String(t.assigneeId).slice(0, 8)}` : "(unassigned)";
    console.log(`#${t.taskNumber} [${t.status}] ${who} — task=${t.id.slice(0, 8)} channel=${t.channelId.slice(0, 8)}`);
  }
}

async function cmdTaskCreate(flags: Record<string, string>): Promise<void> {
  const target = flags.channel ?? fail("INVALID_ARG", "missing --channel");
  const title = flags.title ?? (await readStdin());
  if (!title) fail("INVALID_ARG", "missing --title or stdin body");
  const channelId = await resolveTargetChannelId(target as string);
  const data = await api<{ id: string; taskNumber: number }>(`/api/v1/tasks`, {
    method: "POST",
    body: JSON.stringify({ channelId, title, assigneeId: flags.assignee, assigneeType: flags.assigneeType }),
  });
  console.log(`Created task #${data.taskNumber} (${data.id.slice(0, 8)}).`);
}

async function cmdTaskUpdate(flags: Record<string, string>): Promise<void> {
  const id = flags.id ?? flags.task ?? fail("INVALID_ARG", "missing --id");
  const body: Record<string, unknown> = {};
  if (flags.status) body.status = flags.status;
  if (flags.assignee) { body.assigneeId = flags.assignee; body.assigneeType = flags.assigneeType ?? "agent"; }
  await api(`/api/v1/tasks/${id}`, { method: "PATCH", body: JSON.stringify(body) });
  console.log(`Updated task ${id.slice(0, 8)}.`);
}

async function cmdTaskClaim(flags: Record<string, string>): Promise<void> {
  const id = flags.id ?? flags.task ?? fail("INVALID_ARG", "missing --id");
  await api(`/api/v1/tasks/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "in_progress", assigneeId: AGENT_ID, assigneeType: "agent" }),
  });
  console.log(`Claimed task ${id.slice(0, 8)}.`);
}

async function cmdTaskUnclaim(flags: Record<string, string>): Promise<void> {
  const id = flags.id ?? flags.task ?? fail("INVALID_ARG", "missing --id");
  await api(`/api/v1/tasks/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "todo", assigneeId: null, assigneeType: null }),
  });
  console.log(`Unclaimed task ${id.slice(0, 8)}.`);
}

async function cmdNotImplemented(name: string): Promise<void> {
  fail("NOT_IMPLEMENTED", `'${name}' is being ported to the Cloudflare-native API. Use raltic message send / check / read in the meantime.`);
}

function cryptoRandomId(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))]
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv.slice(0, 2).join(" ");
  const flags = parseArgs(argv.slice(2));
  switch (cmd) {
    case "message send":   return cmdMessageSend(flags);
    case "message check":  return cmdMessageCheck();
    case "message read":   return cmdMessageRead(flags);
    case "message search": return cmdNotImplemented("message search");
    case "server info":    return cmdServerInfo();
    case "task list":      return cmdTaskList(flags);
    case "task create":    return cmdTaskCreate(flags);
    case "task claim":     return cmdTaskClaim(flags);
    case "task unclaim":   return cmdTaskUnclaim(flags);
    case "task update":    return cmdTaskUpdate(flags);
    default:
      fail("UNKNOWN_CMD", `unknown command: ${cmd || "(none)"}\n` +
        `Try: message send | message check | message read | server info`);
  }
}

main().catch((e) => fail("CLI_CRASH", e?.message ?? String(e)));
