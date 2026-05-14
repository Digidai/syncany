import { drizzle } from "drizzle-orm/d1";
import { and, eq, isNull } from "drizzle-orm";
import { machineKeys } from "@syncany/db";

const KEY_PREFIX = "ck_";
const KEY_BYTES = 24;     // base62-ish length ~32 chars after encoding

export interface MachineKeyEnv {
  DB: D1Database;
  MACHINE_KEY_PEPPER: string;
}

export interface IssuedKey {
  id: string;
  apiKey: string;          // returned ONCE on create
  prefix: string;          // "ck_a1b2c3d4"
}

/**
 * Generate a fresh machine key + persist its hash.
 * Plaintext is returned only once; never persisted.
 */
export async function issueMachineKey(env: MachineKeyEnv, args: {
  userId: string;
  serverId: string;
  name: string;
}): Promise<IssuedKey> {
  const random = new Uint8Array(KEY_BYTES);
  crypto.getRandomValues(random);
  const keyBody = base62(random);
  const apiKey = KEY_PREFIX + keyBody;
  const prefix = apiKey.slice(0, KEY_PREFIX.length + 8); // ck_a1b2c3d4
  const hash = await pepperedHash(apiKey, env.MACHINE_KEY_PEPPER);

  const id = crypto.randomUUID();
  const db = drizzle(env.DB);
  await db.insert(machineKeys).values({
    id,
    keyPrefix: prefix,
    keyHash: hash,
    userId: args.userId,
    serverId: args.serverId,
    name: args.name,
    createdAt: new Date(),
  });

  return { id, apiKey, prefix };
}

/**
 * Look up a machine key by its plaintext (constant-time).
 * Returns null if missing or revoked.
 */
export async function resolveMachineKey(env: MachineKeyEnv, apiKey: string): Promise<{
  id: string; userId: string; serverId: string;
} | null> {
  if (!apiKey.startsWith(KEY_PREFIX)) return null;
  const hash = await pepperedHash(apiKey, env.MACHINE_KEY_PEPPER);
  const db = drizzle(env.DB);
  const rows = await db
    .select({ id: machineKeys.id, userId: machineKeys.userId, serverId: machineKeys.serverId, revokedAt: machineKeys.revokedAt })
    .from(machineKeys)
    .where(and(eq(machineKeys.keyHash, hash), isNull(machineKeys.revokedAt)))
    .limit(1);
  if (rows.length === 0) return null;
  // Touch lastUsedAt asynchronously; do not await to keep hot path fast.
  db.update(machineKeys).set({ lastUsedAt: new Date() }).where(eq(machineKeys.id, rows[0].id))
    .run().catch(() => {});
  return { id: rows[0].id, userId: rows[0].userId, serverId: rows[0].serverId };
}

export async function revokeMachineKey(env: MachineKeyEnv, args: { id: string; ownerId: string }): Promise<boolean> {
  const db = drizzle(env.DB);
  const res = await db.update(machineKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(machineKeys.id, args.id), eq(machineKeys.userId, args.ownerId)))
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

// ---------------------------------------------------------------------------
async function pepperedHash(input: string, pepper: string): Promise<string> {
  const data = new TextEncoder().encode(pepper + ":" + input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return toHex(new Uint8Array(digest));
}

function toHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
function base62(bytes: Uint8Array): string {
  // Simple base-62 encoding sufficient for opaque tokens.
  let n = 0n;
  for (const b of bytes) n = (n << 8n) + BigInt(b);
  let out = "";
  while (n > 0n) {
    out = ALPHABET[Number(n % 62n)] + out;
    n /= 62n;
  }
  return out || "0";
}
