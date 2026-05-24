import { and, eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import {
  servers,
  serverMembers,
  channels,
  channelMembers,
  agents,
  user,
} from "@raltic/db";

/**
 * The acting subject for any data access. Either a logged-in user or a bridge
 * connected with a machine API key (which is scoped to one userId + serverId).
 */
/**
 * Authenticated subject. Three resolution paths produce a Subject;
 * `via` discriminates them so middlewares like `requireUser` can refuse
 * subjects whose token type shouldn't reach a given surface.
 *
 *   - via: "cookie" — better-auth session cookie. Full human user; the
 *     ONLY one allowed to mutate identity-level state (default
 *     workspace, profile fields).
 *   - via: "api_token" — short-lived `sy_api_` JWT minted from the
 *     cookie by web for cross-origin fetches. Functionally equivalent
 *     to cookie for most routes; treat as a cookie.
 *   - via: "bridge_token" — `sy_bridge_` JWT minted from a machine key
 *     for WS upgrades + activity POSTs. MUST NOT be allowed to call
 *     /me/default-server, change profile, etc — codex review caught a
 *     bypass where requireUser accepted bridge tokens as user sessions.
 */
export type Subject =
  | { kind: "user"; userId: string; via: "cookie" | "api_token" | "bridge_token" }
  | { kind: "machine"; userId: string; serverId: string; keyId: string };

type DB = DrizzleD1Database<Record<string, unknown>>;

// ---------------------------------------------------------------------------
// Per-request memoization. Pass a fresh AuthCtx per HTTP request.
// ---------------------------------------------------------------------------
export interface AuthCtx {
  db: DB;
  subject: Subject;
  cache: Map<string, Promise<boolean>>;
}

export function newAuthCtx(db: DB, subject: Subject): AuthCtx {
  return { db, subject, cache: new Map() };
}

function memo(ctx: AuthCtx, key: string, fn: () => Promise<boolean>): Promise<boolean> {
  const hit = ctx.cache.get(key);
  if (hit) return hit;
  const p = fn();
  ctx.cache.set(key, p);
  return p;
}

// ---------------------------------------------------------------------------
// Atomic membership checks (RLS helper equivalents)
// ---------------------------------------------------------------------------

export async function userIsServerMember(ctx: AuthCtx, serverId: string): Promise<boolean> {
  return memo(ctx, `sm:${serverId}`, async () => {
    const rows = await ctx.db
      .select({ id: serverMembers.serverId })
      .from(serverMembers)
      .where(and(
        eq(serverMembers.serverId, serverId),
        eq(serverMembers.memberId, ctx.subject.userId),
        eq(serverMembers.memberType, "human"),
      ))
      .limit(1);
    return rows.length > 0;
  });
}

export async function userIsServerOwner(ctx: AuthCtx, serverId: string): Promise<boolean> {
  return memo(ctx, `so:${serverId}`, async () => {
    const rows = await ctx.db
      .select({ id: servers.id })
      .from(servers)
      .where(and(eq(servers.id, serverId), eq(servers.ownerId, ctx.subject.userId)))
      .limit(1);
    return rows.length > 0;
  });
}

/** Resolves the subject's role in a server, if any. Returns null when the
 *  subject is not a member. Not cached (ctx.cache stores boolean promises
 *  only) — the query is index-backed and rarely repeated per request. */
export async function userServerRole(
  ctx: AuthCtx,
  serverId: string,
): Promise<"owner" | "admin" | "member" | null> {
  const rows = await ctx.db
    .select({ role: serverMembers.role })
    .from(serverMembers)
    .where(and(
      eq(serverMembers.serverId, serverId),
      eq(serverMembers.memberId, ctx.subject.userId),
      eq(serverMembers.memberType, "human"),
    ))
    .limit(1);
  return rows[0]?.role ?? null;
}

/** Owner OR admin — for rename, icon change, member removal. Stricter than
 *  read but looser than delete/transfer. */
export async function userIsServerAdminOrOwner(ctx: AuthCtx, serverId: string): Promise<boolean> {
  return memo(ctx, `sao:${serverId}`, async () => {
    const role = await userServerRole(ctx, serverId);
    return role === "owner" || role === "admin";
  });
}

export async function userOwnsAgent(ctx: AuthCtx, agentId: string): Promise<boolean> {
  return memo(ctx, `oa:${agentId}`, async () => {
    const rows = await ctx.db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.ownerId, ctx.subject.userId)))
      .limit(1);
    return rows.length > 0;
  });
}

export async function agentBelongsToVisibleServer(ctx: AuthCtx, agentId: string): Promise<boolean> {
  return memo(ctx, `avs:${agentId}`, async () => {
    const rows = await ctx.db
      .select({ id: agents.id })
      .from(agents)
      .innerJoin(serverMembers, and(
        eq(serverMembers.serverId, agents.serverId),
        eq(serverMembers.memberId, ctx.subject.userId),
        eq(serverMembers.memberType, "human"),
      ))
      .where(eq(agents.id, agentId))
      .limit(1);
    return rows.length > 0;
  });
}

export async function userIsChannelMember(ctx: AuthCtx, channelId: string): Promise<boolean> {
  return memo(ctx, `cm:${channelId}`, async () => {
    const rows = await ctx.db
      .select({ id: channelMembers.channelId })
      .from(channelMembers)
      .where(and(
        eq(channelMembers.channelId, channelId),
        eq(channelMembers.memberId, ctx.subject.userId),
        eq(channelMembers.memberType, "human"),
      ))
      .limit(1);
    return rows.length > 0;
  });
}

export async function userHasAgentInChannel(ctx: AuthCtx, channelId: string): Promise<boolean> {
  return memo(ctx, `uac:${channelId}`, async () => {
    const rows = await ctx.db
      .select({ id: agents.id })
      .from(channelMembers)
      .innerJoin(agents, eq(agents.id, channelMembers.memberId))
      .where(and(
        eq(channelMembers.channelId, channelId),
        eq(channelMembers.memberType, "agent"),
        eq(agents.ownerId, ctx.subject.userId),
      ))
      .limit(1);
    return rows.length > 0;
  });
}

export async function agentIsChannelMember(ctx: AuthCtx, agentId: string, channelId: string): Promise<boolean> {
  return memo(ctx, `acm:${agentId}:${channelId}`, async () => {
    const rows = await ctx.db
      .select({ id: channelMembers.channelId })
      .from(channelMembers)
      .where(and(
        eq(channelMembers.channelId, channelId),
        eq(channelMembers.memberId, agentId),
        eq(channelMembers.memberType, "agent"),
      ))
      .limit(1);
    return rows.length > 0;
  });
}

export async function channelIsPublic(ctx: AuthCtx, channelId: string): Promise<boolean> {
  return memo(ctx, `cpub:${channelId}`, async () => {
    const rows = await ctx.db
      .select({ type: channels.type })
      .from(channels)
      .where(eq(channels.id, channelId))
      .limit(1);
    return rows.length > 0 && rows[0].type === "public";
  });
}

/** Channel belongs to the given server. Cheap lookup, memoized. */
export async function channelInServer(ctx: AuthCtx, channelId: string, serverId: string): Promise<boolean> {
  return memo(ctx, `cis:${channelId}:${serverId}`, async () => {
    const rows = await ctx.db
      .select({ id: channels.id })
      .from(channels)
      .where(and(eq(channels.id, channelId), eq(channels.serverId, serverId)))
      .limit(1);
    return rows.length > 0;
  });
}

/** Public channels still require server membership — closes the public-IDOR
 *  hole where anyone with a UUID could read/rename a public channel of a
 *  server they don't belong to. */
async function publicAndServerMember(ctx: AuthCtx, channelId: string): Promise<boolean> {
  if (!(await channelIsPublic(ctx, channelId))) return false;
  // Find the channel's server and check membership.
  const rows = await ctx.db
    .select({ serverId: channels.serverId })
    .from(channels)
    .where(eq(channels.id, channelId))
    .limit(1);
  if (rows.length === 0) return false;
  return userIsServerMember(ctx, rows[0].serverId);
}

/** Machine subjects must operate ONLY within their bound server. Always-true
 *  for user subjects; for machine subjects checks that the target server
 *  matches subject.serverId. Use this before any server-scoped read/write
 *  whose `serverId` we know directly. */
function machineScoped(ctx: AuthCtx, targetServerId: string): boolean {
  if (ctx.subject.kind !== "machine") return true;
  return ctx.subject.serverId === targetServerId;
}

/** Same idea but `targetServerId` is derived from a channelId; defers to the
 *  channels table. Returns true when subject is a user OR when the bound
 *  server contains this channel. */
async function machineScopedByChannel(ctx: AuthCtx, channelId: string): Promise<boolean> {
  if (ctx.subject.kind !== "machine") return true;
  return channelInServer(ctx, channelId, ctx.subject.serverId);
}

/** Same for an agentId. */
async function machineScopedByAgent(ctx: AuthCtx, agentId: string): Promise<boolean> {
  if (ctx.subject.kind !== "machine") return true;
  const rows = await ctx.db
    .select({ serverId: agents.serverId })
    .from(agents).where(eq(agents.id, agentId)).limit(1);
  if (rows.length === 0) return false;
  return rows[0].serverId === ctx.subject.serverId;
}

// ---------------------------------------------------------------------------
// Composite policies — these are the call sites the API uses.
// All return Promise<boolean>. Throw 403 in the route handler if false.
// ---------------------------------------------------------------------------
export const policy = {
  servers: {
    canRead:   async (ctx: AuthCtx, id: string) =>
      machineScoped(ctx, id) && (await userIsServerMember(ctx, id)),
    canCreate: (ctx: AuthCtx) =>
      // Machine keys cannot create new servers — that's a human-only action.
      Promise.resolve(ctx.subject.kind === "user"),
    /** Highest-trust mutations: owner only. Used for slug change (link-
     *  breaking) and any policy/billing changes if we add them later. */
    canUpdate: async (ctx: AuthCtx, id: string) =>
      machineScoped(ctx, id) && (await userIsServerOwner(ctx, id)),
    canDelete: async (ctx: AuthCtx, id: string) =>
      machineScoped(ctx, id) && (await userIsServerOwner(ctx, id)),
    /** Day-to-day workspace mgmt: rename, set icon, remove members. Owner
     *  OR admin. Machine subjects always denied (this is human-initiated). */
    canEdit: async (ctx: AuthCtx, id: string) => {
      if (ctx.subject.kind !== "user") return false;
      return machineScoped(ctx, id) && (await userIsServerAdminOrOwner(ctx, id));
    },
    /** Self-leave a workspace. Permitted for any non-owner member. The
     *  owner must transfer ownership first (or delete the workspace). */
    canLeave: async (ctx: AuthCtx, id: string) => {
      if (ctx.subject.kind !== "user") return false;
      if (!(await userIsServerMember(ctx, id))) return false;
      return !(await userIsServerOwner(ctx, id));
    },
  },
  agents: {
    canRead:   async (ctx: AuthCtx, id: string) =>
      (await machineScopedByAgent(ctx, id))
        && (await agentBelongsToVisibleServer(ctx, id)),
    canCreate: async (ctx: AuthCtx, serverId: string) =>
      machineScoped(ctx, serverId) && (await userIsServerMember(ctx, serverId)),
    canUpdate: async (ctx: AuthCtx, id: string) =>
      (await machineScopedByAgent(ctx, id)) && (await userOwnsAgent(ctx, id)),
    canDelete: async (ctx: AuthCtx, id: string) =>
      (await machineScopedByAgent(ctx, id)) && (await userOwnsAgent(ctx, id)),
  },
  channels: {
    /** Read = member of the channel OR has an owned agent in the channel OR
     *  member of the channel's server AND the channel is public. Closes the
     *  pre-fix hole where `channelIsPublic` short-circuited server scoping. */
    canRead: async (ctx: AuthCtx, id: string) => {
      if (!(await machineScopedByChannel(ctx, id))) return false;
      return (await userIsChannelMember(ctx, id))
        || (await userHasAgentInChannel(ctx, id))
        || (await publicAndServerMember(ctx, id));
    },
    canCreate: async (ctx: AuthCtx, serverId: string) =>
      machineScoped(ctx, serverId) && (await userIsServerMember(ctx, serverId)),
    /** Write metadata (rename, description). Tighter than read: must be the
     *  channel creator OR the server owner. Replaces the old reuse-of-canRead. */
    canUpdate: async (ctx: AuthCtx, channelId: string) => {
      if (!(await machineScopedByChannel(ctx, channelId))) return false;
      const rows = await ctx.db
        .select({ createdBy: channels.createdBy, serverId: channels.serverId })
        .from(channels).where(eq(channels.id, channelId)).limit(1);
      if (rows.length === 0) return false;
      if (rows[0].createdBy === ctx.subject.userId) return true;
      return userIsServerOwner(ctx, rows[0].serverId);
    },
    canDelete: async (ctx: AuthCtx, channelId: string) =>
      policy.channels.canUpdate(ctx, channelId),
    /**
     * Add new members (humans or agents) to a channel.
     *
     * Rule: caller must already be a member of the channel. This is the
     * Slack model for private channels, and it scales to public too —
     * if you're not in the room, you're not pulling people into it.
     * For public channels, anyone who wants in can self-join via
     * `/channels/:id/join`, so there's no exclusion problem.
     *
     * Side benefit: keeps the "outsider can't add themselves to a
     * private channel" invariant — they're not a member, so this gate
     * fails before any DB write.
     *
     * DM channels are special-cased at the route layer (always 2
     * fixed members); this gate doesn't see them.
     */
    canAddMember: async (ctx: AuthCtx, channelId: string): Promise<boolean> => {
      if (!(await machineScopedByChannel(ctx, channelId))) return false;
      return (await userIsChannelMember(ctx, channelId))
        || (await userHasAgentInChannel(ctx, channelId));
    },
    /**
     * Remove another member (human or agent) from a channel.
     *
     * Tighter than add: only the channel creator OR the server owner.
     * Avoids member-vs-member kick-fights; reuses the same gate as
     * rename/delete so anyone who can mutate channel metadata can also
     * mutate its membership.
     *
     * Self-leave goes through `canLeave` (always true for members) —
     * this gate is for removing SOMEONE ELSE.
     */
    canRemoveMember: async (ctx: AuthCtx, channelId: string): Promise<boolean> =>
      policy.channels.canUpdate(ctx, channelId),
    /**
     * Leave the channel yourself. Only check: you have to be a member
     * (or own an agent that's a member, for the agent self-leave path).
     * No "last admin" lock — abandoned channels can be cleaned up by
     * the server owner via DELETE. Keeps the gate dumb + predictable.
     */
    canLeave: async (ctx: AuthCtx, channelId: string): Promise<boolean> => {
      if (!(await machineScopedByChannel(ctx, channelId))) return false;
      return (await userIsChannelMember(ctx, channelId))
        || (await userHasAgentInChannel(ctx, channelId));
    },
  },
  messages: {
    canRead: (ctx: AuthCtx, channelId: string) => policy.channels.canRead(ctx, channelId),
    canSendAs: async (ctx: AuthCtx, args: {
      channelId: string;
      senderId: string;
      senderType: "human" | "agent" | "system";
    }): Promise<boolean> => {
      if (!(await machineScopedByChannel(ctx, args.channelId))) return false;
      if (args.senderType === "human") {
        return args.senderId === ctx.subject.userId
          && (await userIsChannelMember(ctx, args.channelId));
      }
      if (args.senderType === "agent") {
        return (await machineScopedByAgent(ctx, args.senderId))
          && (await userOwnsAgent(ctx, args.senderId))
          && (await agentIsChannelMember(ctx, args.senderId, args.channelId));
      }
      // system messages only via internal seed handler — never via public API
      return false;
    },
    /** Edit/delete a specific message — only the original sender (or the
     *  agent's owner) can touch it. */
    canEdit: async (ctx: AuthCtx, args: {
      senderId: string; senderType: "human" | "agent" | "system";
    }): Promise<boolean> => {
      if (args.senderType === "human") return args.senderId === ctx.subject.userId;
      if (args.senderType === "agent") return userOwnsAgent(ctx, args.senderId);
      return false;
    },
  },
  tasks: {
    canRead: (ctx: AuthCtx, channelId: string) => policy.channels.canRead(ctx, channelId),
    /** Tighter than read. To create or update a task you must either be
     *  a channel member yourself or own an agent that's a member; public-
     *  channel readers can't manage tasks anymore. */
    canManage: async (ctx: AuthCtx, channelId: string) => {
      if (!(await machineScopedByChannel(ctx, channelId))) return false;
      return (await userIsChannelMember(ctx, channelId))
        || (await userHasAgentInChannel(ctx, channelId));
    },
  },
  machineKeys: {
    canRead: (ctx: AuthCtx, ownerId: string) =>
      Promise.resolve(ctx.subject.kind === "user" && ctx.subject.userId === ownerId),
    /** Issue a machine key for a workspace. SECURITY: must require server
     *  membership — without this check any signed-in user could mint a key
     *  for any known serverId (machine keys are bridge-scoped to that
     *  server, so a leaked key for someone else's workspace would let
     *  them spawn agents and read/write messages in that workspace). */
    canCreate: async (ctx: AuthCtx, serverId: string) => {
      if (ctx.subject.kind !== "user") return false;
      return userIsServerMember(ctx, serverId);
    },
    canRevoke: (ctx: AuthCtx, ownerId: string) =>
      Promise.resolve(ctx.subject.kind === "user" && ctx.subject.userId === ownerId),
  },
} as const;

export class AuthorizationError extends Error {
  constructor(message: string) { super(message); this.name = "AuthorizationError"; }
}

export async function requirePolicy(check: Promise<boolean>, message = "forbidden"): Promise<void> {
  const ok = await check;
  if (!ok) throw new AuthorizationError(message);
}
