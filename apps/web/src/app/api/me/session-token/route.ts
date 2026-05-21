import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAuth } from "@raltic/auth-core";

/**
 * Returns the current session token (the value of the better-auth session
 * cookie) so the web client can use it as Bearer auth when calling the
 * cross-origin raltic-api Worker.
 *
 * This is safe to expose to same-origin callers because they could already
 * read the cookie value via document.cookie if HttpOnly were off. We keep
 * the cookie HttpOnly and provide this endpoint as the controlled escape
 * hatch for cross-origin API calls.
 */
export async function GET(req: Request): Promise<Response> {
  const { env } = getCloudflareContext();
  const auth = createAuth(env as never);
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session?.session) {
    return Response.json({ token: null }, { status: 401 });
  }
  return Response.json({
    token: session.session.token,
    userId: session.user.id,
  });
}
