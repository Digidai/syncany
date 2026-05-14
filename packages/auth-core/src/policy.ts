import { and, eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import {
  servers,
  serverMembers,
  channels,
  channelMembers,
  agents,
  user,
} from "@syncany/db";

/**
 * The acting subject for any data access. Either a logged-in user or a bridge
 * connected with a machine API key (which is scoped to one userId + serverId).
 */
export type Subject =
  | { kind: "user"; userId: string }
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
    canUpdate: async (ctx: AuthCtx, id: string) =>
      machineScoped(ctx, id) && (await userIsServerOwner(ctx, id)),
    canDelete: async (ctx: AuthCtx, id: string) =>
      machineScoped(ctx, id) && (await userIsServerOwner(ctx, id)),
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
    canCreate: (ctx: AuthCtx) =>
      Promise.resolve(ctx.subject.kind === "user"),
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
