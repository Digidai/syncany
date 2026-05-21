import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAuth } from "@raltic/auth-core";

/**
 * Better-auth catchall handler. Lives on the web origin so cookies and
 * verification email links share a single domain with the UI.
 *
 * The raltic-api Worker no longer serves /api/auth/*; it just trusts
 * Bearer sy_session_<token> headers, looking up sessions in the same D1.
 */
async function handler(req: Request): Promise<Response> {
  const { env } = getCloudflareContext();
  const auth = createAuth(env as never);
  return auth.handler(req);
}

export const GET = handler;
export const POST = handler;
