/**
 * Shared test helpers — keep tests terse + DRY without hiding behaviour.
 *
 * `seedUser`/`seedServer`/`seedAgent` insert directly via drizzle to skip
 * better-auth's email-verification flow (which we can't run end-to-end
 * inside vitest because it requires a real SMTP send + the actual
 * verification link click). The shapes returned mirror what the API
 * would produce, so route tests look the same as production.
 */
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@raltic/db/schema";
import { issueMachineKey, signWsToken } from "@raltic/auth-core";

export type TestUser = {
  id: string;
  email: string;
  name: string;
};

export type TestServer = {
  id: string;
  slug: string;
  ownerId: string;
};

export function db() {
  return drizzle(env.DB, { schema });
}

export async function seedUser(opts: Partial<TestUser> = {}): Promise<TestUser> {
  const id = opts.id ?? crypto.randomUUID();
  const email = opts.email ?? `u-${id.slice(0, 8)}@test.local`;
  const name = opts.name ?? `User ${id.slice(0, 4)}`;
  const now = new Date();
  await db().insert(schema.user).values({
    id, email, name, emailVerified: true, createdAt: now, updatedAt: now,
  });
  return { id, email, name };
}

export async function seedServer(owner: TestUser, opts: Partial<TestServer> = {}): Promise<TestServer> {
  const id = opts.id ?? crypto.randomUUID();
  const slug = opts.slug ?? `srv-${id.slice(0, 8)}`;
  const now = new Date();
  await db().insert(schema.servers).values({
    id, name: `Test ${slug}`, slug, ownerId: owner.id, createdAt: now,
  });
  await db().insert(schema.serverMembers).values({
    serverId: id, memberId: owner.id, memberType: "human", role: "owner", joinedAt: now,
  });
  return { id, slug, ownerId: owner.id };
}

export async function seedChannel(
  server: TestServer,
  type: "public" | "private" | "dm" = "public",
  members: TestUser[] = [],
): Promise<{ id: string; serverId: string; type: typeof type }> {
  const id = crypto.randomUUID();
  const now = new Date();
  await db().insert(schema.channels).values({
    id, serverId: server.id, name: `ch-${id.slice(0, 6)}`,
    type, createdBy: members[0]?.id ?? server.ownerId, createdAt: now,
  });
  for (const m of members) {
    await db().insert(schema.channelMembers).values({
      channelId: id, memberId: m.id, memberType: "human", joinedAt: now, lastReadSeq: 0,
    });
  }
  return { id, serverId: server.id, type };
}

export async function seedAgent(
  server: TestServer,
  owner: TestUser,
): Promise<{ id: string; serverId: string; ownerId: string; dmChannelId: string }> {
  const id = crypto.randomUUID();
  const dmChannelId = crypto.randomUUID();
  const now = new Date();
  await db().batch([
    db().insert(schema.agents).values({
      id, serverId: server.id, ownerId: owner.id,
      name: `agent-${id.slice(0, 6)}`, displayName: `Agent ${id.slice(0, 4)}`,
      model: "sonnet", runtime: "claude", status: "offline",
      isDefault: false, createdAt: now, updatedAt: now,
    }),
    db().insert(schema.channels).values({
      id: dmChannelId, serverId: server.id, name: `dm-${id.slice(0, 6)}`,
      type: "dm", createdBy: owner.id, createdAt: now,
    }),
    db().insert(schema.channelMembers).values({
      channelId: dmChannelId, memberId: owner.id, memberType: "human", joinedAt: now, lastReadSeq: 0,
    }),
    db().insert(schema.channelMembers).values({
      channelId: dmChannelId, memberId: id, memberType: "agent", joinedAt: now, lastReadSeq: 0,
    }),
  ]);
  return { id, serverId: server.id, ownerId: owner.id, dmChannelId };
}

/**
 * Issue a session JWT for the given user. Mirrors what better-auth does
 * after signin, minus the email-verification dance. Returns a Bearer
 * value suitable for the `authorization` header on API requests.
 */
export async function userBearer(user: TestUser): Promise<string> {
  // Use the SAME secret the worker will verify against — no fallback.
  // The previous `?? "test-secret"` masked the case where
  // wrangler.test.toml forgot to declare the var, producing cryptic 401s
  // in unrelated test files. Now it fails loud at the setup boundary.
  if (!env.CHAT_ROOM_AUTH_SECRET) {
    throw new Error(
      "[test] CHAT_ROOM_AUTH_SECRET not bound — add it to wrangler.test.toml [vars]",
    );
  }
  const token = await signWsToken(env.CHAT_ROOM_AUTH_SECRET, {
    sub: user.id,
    aud: "api",
    ttlSeconds: 60 * 60,
  });
  return `Bearer sy_api_${token}`;
}

/**
 * Issue a bridge machine key (returns the plaintext key the bridge would
 * use). Useful for routes that accept `apiKey: ck_…`.
 */
export async function bridgeKey(user: TestUser, server: TestServer): Promise<string> {
  const issued = await issueMachineKey(env as never, {
    userId: user.id, serverId: server.id, name: "test-bridge",
  });
  return issued.apiKey;
}

/**
 * Invoke the Hono app's fetch handler directly. Bypasses network — same
 * as calling the production worker, but in-process so we can assert on
 * the Response object.
 */
export async function request(
  app: { fetch: (req: Request, env: unknown, ctx: ExecutionContext) => Response | Promise<Response> },
  input: RequestInfo,
  init?: RequestInit,
): Promise<Response> {
  const req = input instanceof Request ? input : new Request(input, init);
  // Cast to any to bypass the strict ExportedHandler vs functional signature
  // mismatch — runtime is identical.
  const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as ExecutionContext;
  return await app.fetch(req, env, ctx);
}
