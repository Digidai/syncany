/**
 * Short-lived JWTs handed to WebSocket clients (web + bridge) so the DOs can
 * verify them without an extra DB hit.
 *
 * Format: header.payload.sig (base64url HS256), matching what ChatRoom DO
 * expects in `verifyToken()`.
 */

export interface WsTokenPayload {
  sub: string;            // userId
  agents?: string[];      // bridge-only: agentIds this connection represents
  channelId?: string;     // ChatRoom DO requires this
  bridgeId?: string;      // UserGateway DO uses this for routing
  jti: string;            // per-token id used for KV deny-list revocation
  iat: number;
  exp: number;
}

export async function signWsToken(secret: string, payload: Omit<WsTokenPayload, "iat" | "exp" | "jti"> & { ttlSeconds: number; jti?: string }): Promise<string> {
  const { ttlSeconds, jti, ...rest } = payload;
  const now = Math.floor(Date.now() / 1000);
  const tokenId = jti ?? crypto.randomUUID();
  const full: WsTokenPayload = { ...rest, jti: tokenId, iat: now, exp: now + ttlSeconds };
  const headerB64 = b64url(new TextEncoder().encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const payloadB64 = b64url(new TextEncoder().encode(JSON.stringify(full)));
  const data = `${headerB64}.${payloadB64}`;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
  return `${data}.${b64url(sig)}`;
}

/** KV deny-list check. Returns true if the jti is revoked. */
export async function isTokenRevoked(kv: KVNamespace | undefined, jti: string): Promise<boolean> {
  if (!kv || !jti) return false;
  return (await kv.get(`revoked:${jti}`)) !== null;
}

/** Mark a jti as revoked. TTL = ws-token max TTL (≤7 days). */
export async function revokeToken(kv: KVNamespace | undefined, jti: string, ttlSeconds = 60 * 60 * 24 * 7): Promise<void> {
  if (!kv || !jti) return;
  await kv.put(`revoked:${jti}`, "1", { expirationTtl: ttlSeconds });
}

/**
 * Single canonical HS256 verifier — used by api Worker, ChatRoom DO, and
 * UserGateway DO. Replaces three near-identical copies.
 *
 * Returns the decoded payload on success, null on any failure (bad alg,
 * bad signature, expired, malformed). Uses constant-time signature compare.
 */
export async function verifyWsToken(token: string, secret: string): Promise<WsTokenPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;

  // Reject alg=none / RS256-confusion.
  try {
    const header = JSON.parse(atob(headerB64.replace(/-/g, "+").replace(/_/g, "/")));
    if (header.alg !== "HS256") return null;
  } catch { return null; }

  const data = `${headerB64}.${payloadB64}`;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const expected = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)),
  );
  if (!constantTimeEqual(b64url(expected), sigB64)) return null;

  let payload: WsTokenPayload;
  try { payload = JSON.parse(atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/"))); }
  catch { return null; }
  if (typeof payload.exp !== "number" || payload.exp * 1000 <= Date.now()) return null;
  if (typeof payload.sub !== "string") return null;
  return payload;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
