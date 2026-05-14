import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import {
  user,
  servers,
  serverMembers,
  agents,
  channels,
  channelMembers,
  type User,
} from "@syncany/db";

export interface OnboardingEnv {
  DB: D1Database;
  /** Bound only on the api Worker. Web has it undefined. */
  CHAT_ROOM?: DurableObjectNamespace;
  CHAT_ROOM_AUTH_SECRET: string;
  /** Web-only: when CHAT_ROOM isn't bound, web posts seed requests here. */
  SYNCANY_API_URL?: string;
  NEXT_PUBLIC_SYNCANY_API_URL?: string;
}

const ONBOARDING_AGENT_PROMPT = `You are the Onboarding Assistant for a new Syncany user.

Your job: greet them, ask which language they prefer (English / 中文), then walk
them through:
  1. Creating their first agent
  2. Inviting that agent into a public channel
  3. Sending the agent its first message

Keep messages short. Use the syncany CLI for everything you do. Stop when the
user is comfortable.`;

/**
 * Called from better-auth's `user.create.after` hook. Creates a personal
 * server, an Onboarding Assistant agent, and welcome channels in one batch.
 *
 * If anything in here throws, better-auth surfaces FAILED_TO_CREATE_USER
 * to the client but does NOT roll back the user row it just inserted.
 * We compensate by deleting the user ourselves so the email is reusable.
 */
export async function runOnboarding(env: OnboardingEnv, newUser: User): Promise<void> {
  try {
    await runOnboardingInner(env, newUser);
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

async function runOnboardingInner(env: OnboardingEnv, newUser: User): Promise<void> {
  const db = drizzle(env.DB);

  const serverId = crypto.randomUUID();
  const agentId = crypto.randomUUID();
  const onboardingChannelId = crypto.randomUUID();
  const dmChannelId = crypto.randomUUID();
  const slug = slugify(newUser.name) + "-" + serverId.slice(0, 6);
  const now = new Date();

  await db.batch([
    db.insert(servers).values({
      id: serverId,
      name: `${newUser.name}'s Workspace`,
      slug,
      ownerId: newUser.id,
      createdAt: now,
    }),
    db.insert(serverMembers).values({
      serverId, memberId: newUser.id, memberType: "human", role: "owner", joinedAt: now,
    }),
    db.insert(agents).values({
      id: agentId,
      serverId,
      ownerId: newUser.id,
      name: "onboarding",
      displayName: "Onboarding Assistant",
      description: "Helps you get set up with Syncany",
      systemPrompt: ONBOARDING_AGENT_PROMPT,
      model: "sonnet",
      status: "offline",
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    }),
    db.insert(channels).values([
      {
        id: onboardingChannelId,
        serverId,
        name: "onboarding",
        description: "Get familiar with Syncany",
        type: "public",
        createdBy: newUser.id,
        createdAt: now,
      },
      {
        id: dmChannelId,
        serverId,
        name: "onboarding-assistant",
        description: "Direct messages with the Onboarding Assistant",
        type: "dm",
        createdBy: newUser.id,
        createdAt: now,
      },
    ]),
    db.insert(channelMembers).values([
      { channelId: onboardingChannelId, memberId: newUser.id, memberType: "human", joinedAt: now },
      { channelId: onboardingChannelId, memberId: agentId,    memberType: "agent", joinedAt: now },
      { channelId: dmChannelId,         memberId: newUser.id, memberType: "human", joinedAt: now },
      { channelId: dmChannelId,         memberId: agentId,    memberType: "agent", joinedAt: now },
    ]),
  ]);

  // Seed welcome messages via the channels' DOs so seq is allocated correctly.
  await Promise.all([
    seedChannel(env, onboardingChannelId, [
      welcomeMessage(agentId,
        `👋 Welcome to Syncany, **${newUser.name}**! I'm your Onboarding Assistant.\n\nLet's get you set up. First — would you prefer to chat in English or 中文?`),
    ]),
    seedChannel(env, dmChannelId, [
      welcomeMessage(agentId, `Hi ${newUser.name}, you can DM me here anytime.`),
    ]),
  ]);
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
  const apiUrl = env.SYNCANY_API_URL || env.NEXT_PUBLIC_SYNCANY_API_URL;
  if (!apiUrl) {
    console.warn("[onboarding] no CHAT_ROOM and no SYNCANY_API_URL — skipping seed");
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
