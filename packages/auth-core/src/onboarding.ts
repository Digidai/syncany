import { drizzle } from "drizzle-orm/d1";
import { and, eq } from "drizzle-orm";
import {
  user,
  servers,
  serverMembers,
  agents,
  channels,
  channelMembers,
  type User,
} from "@raltic/db";

export interface OnboardingEnv {
  DB: D1Database;
  /** Bound only on the api Worker. Web has it undefined. */
  CHAT_ROOM?: DurableObjectNamespace;
  CHAT_ROOM_AUTH_SECRET: string;
  /** Web-only: when CHAT_ROOM isn't bound, web posts seed requests here. */
  RALTIC_API_URL?: string;
  NEXT_PUBLIC_RALTIC_API_URL?: string;
}

// IMPORTANT: this prompt is read by Claude Code / Codex CLI agents that
// reply to humans in the Raltic web UI. The user is in a chat panel
// looking at YOU; they have no terminal open. If you tell them to run
// shell commands they can't follow, you've failed them.
//
// Hard rules baked in below:
//   1. NEVER instruct the user to run a `raltic` CLI command. Those tools
//      exist for YOU (the agent) to call, not them. Most users will never
//      open a terminal in their lives with this product.
//   2. ALL user-facing actions in Raltic are reachable from the sidebar
//      and Settings. Direct them there in plain language.
//   3. Bridge / machine keys / CLI only enter the conversation if the
//      user explicitly asks "why is my agent offline" or "how do I run
//      this myself" — then point them at Settings → "Machine API keys"
//      which has the wizard.
//   4. Match the user's language. Don't ask "English or 中文" — read their
//      first message. If it's Chinese, reply in Chinese.
//   5. Keep replies under 3 sentences when you can. No headings, no
//      numbered checklists, no fake CLI examples. **Bold** sparingly for
//      navigation hints like "click **Settings → Agents**".
const ONBOARDING_AGENT_PROMPT = `You are the Onboarding Assistant inside Raltic, a chat product where humans and AI agents share channels. The user is talking to you in the web UI — they type messages in a chat box. They do NOT have a terminal open.

Your job: make a brand-new user feel comfortable in 3-5 short messages. Be warm, concrete, and brief.

Language: reply in whatever language the user wrote in. Do not ask which language they prefer — infer it.

Things the user can do entirely in the web UI (always direct them here):
- Create a new agent: sidebar → **Settings** → **Agents** → **New agent**.
- Talk to an agent: click the agent's name in the sidebar under **Direct messages** and type.
- Invite a teammate: **Settings** → **Members** → **Invite**.
- Switch between workspaces: click the workspace name top-left.

If the user asks "why isn't my agent responding": their bridge for THIS workspace likely isn't running. Point them to **Settings → Machine API keys** which has a one-click setup wizard. Do NOT paste shell commands at them.

Never write \`raltic\` CLI commands in your reply. That's an internal tool YOU use, not them. If the user pastes a CLI command asking where to run it, kindly say "you don't need to run that — let me show you in the UI" and point them to the right Settings tab.

Stop when the user signals they're comfortable. Don't keep nudging.`;

/**
 * Called from better-auth's `user.create.after` hook. Creates a personal
 * server (always) and — depending on `mode` — either seeds the Onboarding
 * Assistant + welcome channels + welcome messages now, or defers that to
 * the first owner GET on the personal workspace ("lazy seed").
 *
 * mode:
 *   - "solo" (default): user signed up directly without an invite. They
 *     ARE going to land on their personal workspace next, so seed now
 *     so step-4 of the wizard ("send first message") has a target DM
 *     and an agent that's already in a channel ready to reply.
 *   - "invite-pending": user signed up via an invite link and will land
 *     on the inviter's workspace. They may never visit their personal
 *     workspace at all (e.g. employees of a company who only use the
 *     company workspace). Defer seeding so we don't burn D1 rows on
 *     workspaces nobody opens, and so the eventual first visit has
 *     fresh-feeling welcome content rather than weeks-old messages.
 *
 * If anything throws, better-auth surfaces FAILED_TO_CREATE_USER to the
 * client but does NOT roll back the user row it just inserted. We
 * compensate by deleting the user ourselves so the email is reusable.
 */
export async function runOnboarding(
  env: OnboardingEnv,
  newUser: User,
  mode: "solo" | "invite-pending" = "solo",
): Promise<void> {
  try {
    await runOnboardingInner(env, newUser, mode);
  } catch (e) {
    console.error("[onboarding] failed for", newUser.email, "— cleaning up user row:", e);
    try {
      const db = drizzle(env.DB);
      // FK cascades will take care of session/account/verification rows.
      await db.delete(user).where(eq(user.id, newUser.id));
    } catch (cleanupErr) {
      console.error("[onboarding] user cleanup also failed (orphan persists):", cleanupErr);
    }
    throw e;
  }
}

async function runOnboardingInner(env: OnboardingEnv, newUser: User, mode: "solo" | "invite-pending"): Promise<void> {
  const db = drizzle(env.DB);
  const serverId = crypto.randomUUID();
  const slug = slugify(newUser.name) + "-" + serverId.slice(0, 6);
  const now = new Date();

  // Always create the workspace + membership + default pointer. These
  // are cheap (~3 rows) and the user needs them to navigate.
  await db.batch([
    db.insert(servers).values({
      id: serverId,
      name: `${newUser.name}'s Workspace`,
      slug,
      ownerId: newUser.id,
      createdAt: now,
      // Solo path seeds inline below → 1. Invite-pending defers → 0.
      seeded: mode === "solo",
    }),
    db.insert(serverMembers).values({
      serverId, memberId: newUser.id, memberType: "human", role: "owner", joinedAt: now,
    }),
    db.update(user)
      .set({ defaultServerId: serverId })
      .where(eq(user.id, newUser.id)),
  ]);

  if (mode === "solo") {
    await seedPersonalDefaults(env, { id: serverId, ownerId: newUser.id, ownerName: newUser.name });
  }
}

/**
 * Insert the Onboarding Assistant agent + 2 welcome channels + welcome
 * messages for a personal workspace. Called inline by runOnboarding for
 * solo signups and lazily by the seed endpoint / first owner GET for
 * invite-pending workspaces. Idempotent at the agents/channels level
 * (uses unique IDs each call) but the caller MUST gate it with a
 * conditional `UPDATE servers SET seeded=1 WHERE seeded=0` so two
 * concurrent owner visits don't double-seed.
 *
 * Exposed for use by apps/api's seed endpoint + agent-restore flow.
 */
export async function seedPersonalDefaults(
  env: OnboardingEnv,
  opts: { id: string; ownerId: string; ownerName: string },
): Promise<void> {
  const db = drizzle(env.DB);

  // Idempotency probe — read existing rows BEFORE inserting. Two
  // historic failure modes get fixed by this:
  //   1. lazy-seed in getServerBySlug fires for owner, seedChannel
  //      throws after the agent/channel rows are inserted, handler
  //      rollback flips seeded=0; next visit retries, batch inserts a
  //      SECOND set of rows with fresh UUIDs → "Olivia has 2 Onboarding
  //      Assistants" support ticket.
  //   2. Restore Onboarding button (force=true): two clicks race past
  //      the handler's existence check, both call this fn, both insert.
  // The cheap fix is to make this fn self-idempotent: if a row that
  // would be created already exists, reuse it instead of duplicating.
  const existingAgent = await db.select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.serverId, opts.id), eq(agents.name, "onboarding")))
    .limit(1);
  const existingOnboardingCh = await db.select({ id: channels.id })
    .from(channels)
    .where(and(eq(channels.serverId, opts.id), eq(channels.name, "onboarding")))
    .limit(1);
  const existingDmCh = await db.select({ id: channels.id })
    .from(channels)
    .where(and(eq(channels.serverId, opts.id), eq(channels.name, "onboarding-assistant")))
    .limit(1);

  const agentId = existingAgent[0]?.id ?? crypto.randomUUID();
  const onboardingChannelId = existingOnboardingCh[0]?.id ?? crypto.randomUUID();
  const dmChannelId = existingDmCh[0]?.id ?? crypto.randomUUID();
  const now = new Date();

  // Build the batch conditionally — only INSERT rows that don't
  // already exist. Memberships are guarded by primary key (channelId,
  // memberId) so re-insert would conflict; we filter them too.
  // Drizzle's `db.batch` is typed as a non-empty readonly tuple at
  // compile time; at runtime it accepts a plain array. We use a
  // looser local type for build-up and pass through an opaque cast at
  // the call site (see below).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const batchOps: any[] = [];
  // Migration for pre-fix existing Onboarding Assistants (codex P3
  // final review HIGH): users who signed up BEFORE the runtime_mode
  // fix have an Onboarding Assistant with runtimeMode='bridge' (or
  // unset → schema default 'bridge'), model='sonnet', status='offline'
  // — silently dead air. When the existing-row branch is taken, also
  // queue an idempotent UPDATE that lifts those rows into the new
  // raltic-mode defaults. The cloud RalticAgent ignores the DB model
  // anyway and resolves via tier policy, but stamping 'claude-haiku-4-5'
  // here keeps the UI honest about what they're talking to.
  if (existingAgent[0]) {
    batchOps.push(
      db.update(agents)
        .set({
          runtimeMode: "raltic",
          model: "claude-haiku-4-5",
          status: "online",
          updatedAt: now,
        })
        .where(and(
          eq(agents.id, existingAgent[0].id),
          // Only touch rows still on the OLD seed shape — don't
          // clobber an agent the user has since edited.
          eq(agents.runtimeMode, "bridge"),
        )),
    );
  }
  if (!existingAgent[0]) {
    batchOps.push(db.insert(agents).values({
      id: agentId,
      serverId: opts.id,
      ownerId: opts.ownerId,
      name: "onboarding",
      displayName: "Onboarding Assistant",
      description: "Helps you get set up with Raltic",
      systemPrompt: ONBOARDING_AGENT_PROMPT,
      // P1+ ships a cloud sandbox; running the seeded assistant in
      // raltic-mode means a brand-new user can DM it and get a real
      // reply WITHOUT installing a local bridge first. Previously this
      // omitted runtimeMode → schema default 'bridge' → cloud-only
      // users saw dead air (4 independent reviewers flagged HIGH).
      // The cloud RalticAgent ignores the DB `model` field and
      // resolves to the first allowed model in its tier policy
      // (currently claude-haiku-4-5), which is correct for an
      // onboarding role.
      runtimeMode: "raltic",
      model: "claude-haiku-4-5",
      // status: "online" matches reality for raltic agents — they
      // don't require a local bridge to be running. Bridge agents
      // remain "offline" until the bridge connects.
      status: "online",
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    }));
  }
  const channelsToInsert = [];
  if (!existingOnboardingCh[0]) {
    channelsToInsert.push({
      id: onboardingChannelId,
      serverId: opts.id,
      name: "onboarding",
      description: "Get familiar with Raltic",
      type: "public" as const,
      createdBy: opts.ownerId,
      createdAt: now,
    });
  }
  if (!existingDmCh[0]) {
    channelsToInsert.push({
      id: dmChannelId,
      serverId: opts.id,
      name: "onboarding-assistant",
      description: "Direct messages with the Onboarding Assistant",
      type: "dm" as const,
      createdBy: opts.ownerId,
      createdAt: now,
    });
  }
  if (channelsToInsert.length > 0) {
    batchOps.push(db.insert(channels).values(channelsToInsert));
  }
  // Memberships — only insert rows whose corresponding channel didn't
  // already exist (assumption: if the channel pre-existed from a prior
  // partial run, its memberships were also created in that same batch).
  const memberRows: Array<{ channelId: string; memberId: string; memberType: "human" | "agent"; joinedAt: Date }> = [];
  if (!existingOnboardingCh[0]) {
    memberRows.push({ channelId: onboardingChannelId, memberId: opts.ownerId, memberType: "human", joinedAt: now });
    memberRows.push({ channelId: onboardingChannelId, memberId: agentId,      memberType: "agent", joinedAt: now });
  }
  if (!existingDmCh[0]) {
    memberRows.push({ channelId: dmChannelId,         memberId: opts.ownerId, memberType: "human", joinedAt: now });
    memberRows.push({ channelId: dmChannelId,         memberId: agentId,      memberType: "agent", joinedAt: now });
  }
  if (memberRows.length > 0) {
    batchOps.push(db.insert(channelMembers).values(memberRows));
  }

  if (batchOps.length > 0) {
    // d1 batch requires at least one statement; skip the call entirely
    // when there's nothing to insert (everything already existed —
    // perfect idempotent no-op, retry-safe).
    // SAFETY: drizzle types `batch` as a tuple but at runtime accepts
    // a regular array. Cast through the documented public signature.
    await (db.batch as unknown as (ops: typeof batchOps) => Promise<unknown>)(batchOps);
  }

  // Seed welcome messages via the channels' DOs so seq is allocated
  // correctly. Skip messages for channels that already existed — those
  // already received their welcome on the prior run.
  const seedTasks: Promise<unknown>[] = [];
  if (!existingOnboardingCh[0]) {
    // The #onboarding public channel is a tutorial transcript — three
    // staged messages the user can scroll. Distinct from the DM
    // (Q&A) so the public-channel feature itself is demonstrated.
    seedTasks.push(seedChannel(env, onboardingChannelId, [
      welcomeMessage(agentId,
        `👋 Welcome to Raltic, **${opts.ownerName}**!\n\nThis channel is a quick tour. Read top to bottom — should take 2 minutes.`),
      welcomeMessage(agentId,
        `**1. Talk to me anytime.**\n\nIn the sidebar under *Direct messages*, click **Onboarding Assistant**. I can help you set goals, draft messages, or just answer "what does X do".`),
      welcomeMessage(agentId,
        `**2. Bring your own agents.**\n\nWhen you're ready to run an agent on your laptop (Claude Code, Codex CLI, …), go to **Settings → Runtimes** for the 2-minute bridge setup. Until then, you can chat with me — I run in Raltic's cloud, no install needed.`),
    ]));
  }
  if (!existingDmCh[0]) {
    seedTasks.push(seedChannel(env, dmChannelId, [
      // First message in a DM should answer "what now?" — not a
      // generic greeting. The system prompt expects the assistant to
      // lead with concrete next-steps; mirror that here so the
      // user has something to react to BEFORE typing.
      welcomeMessage(agentId,
        `Hi **${opts.ownerName}** 👋 — I'm your Onboarding Assistant. I run in Raltic's cloud, so this works even before you set up anything else.\n\nTry asking me one of these:\n\n- "What can you do?"\n- "Help me create my first agent"\n- "How do I invite a teammate?"\n\nOr just tell me what you're trying to build and I'll suggest a path.`),
    ]));
  }
  if (seedTasks.length > 0) {
    await Promise.all(seedTasks);
  }
}

async function seedChannel(
  env: OnboardingEnv,
  channelId: string,
  msgs: Array<{ id: string; channelId: string; senderId: string; senderType: "human" | "agent" | "system"; content: string; threadParentId: string | null }>,
): Promise<void> {
  // If we have the DO bound (running inside the api Worker), call it directly.
  if (env.CHAT_ROOM && typeof env.CHAT_ROOM.idFromName === "function") {
    const stub = env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName(channelId));
    await stub.fetch("https://chat-room/internal/seed", {
      method: "POST",
      headers: { "x-internal-secret": env.CHAT_ROOM_AUTH_SECRET, "content-type": "application/json" },
      body: JSON.stringify({ channelId, messages: msgs }),
    });
    return;
  }
  // Otherwise (running in the web Worker), forward to api over HTTPS.
  const apiUrl = env.RALTIC_API_URL || env.NEXT_PUBLIC_RALTIC_API_URL;
  if (!apiUrl) {
    console.warn("[onboarding] no CHAT_ROOM and no RALTIC_API_URL — skipping seed");
    return;
  }
  const res = await fetch(`${apiUrl}/internal/seed-channel`, {
    method: "POST",
    headers: { "x-internal-secret": env.CHAT_ROOM_AUTH_SECRET, "content-type": "application/json" },
    body: JSON.stringify({ channelId, messages: msgs }),
  });
  if (!res.ok) {
    console.warn("[onboarding] seed via api failed", res.status, await res.text().catch(() => ""));
  }
}

function welcomeMessage(agentId: string, content: string) {
  return {
    id: crypto.randomUUID(),
    channelId: "",                  // overwritten by seed handler
    senderId: agentId,
    senderType: "agent" as const,
    content,
    threadParentId: null,
  };
}

function slugify(s: string): string {
  return s.toLowerCase().normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "workspace";
}
