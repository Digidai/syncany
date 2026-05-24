import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAuth, signWsToken } from "@raltic/auth-core";

/**
 * Mints a short-lived HMAC-signed JWT bound to the current user, used as
 * Bearer auth when the web client calls cross-origin raltic-api.
 *
 * Why not the better-auth session token directly?
 *   - The session cookie is HttpOnly. Exposing it to JS via a fetch
 *     endpoint defeats the HttpOnly protection — a single XSS would
 *     hand attackers a 30-day takeover token.
 *   - This api-token is scoped to "data API access for userId X" and
 *     expires in 5 minutes. XSS leak window is bounded; rotating
 *     CHAT_ROOM_AUTH_SECRET invalidates outstanding tokens immediately.
 *
 * The session cookie itself remains the only thing that can extend a
 * session, change auth state, or sign in.
 */
export async function GET(req: Request): Promise<Response> {
  const { env } = getCloudflareContext();
  const auth = createAuth(env as never);
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session?.user) {
    return Response.json({ error: { code: "UNAUTHENTICATED" } }, { status: 401 });
  }
  const ttl = 60 * 5; // 5 minutes
  const token = await signWsToken((env as { CHAT_ROOM_AUTH_SECRET: string }).CHAT_ROOM_AUTH_SECRET, {
    sub: session.user.id,
    aud: "api",
    agents: [],
    ttlSeconds: ttl,
  });
  return Response.json({ token, expiresIn: ttl });
}
