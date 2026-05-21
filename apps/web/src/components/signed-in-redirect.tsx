"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/auth-client";
import { api } from "@/lib/api";

/**
 * Mounted at the top of the marketing landing (`/`). For signed-in users,
 * resolves `defaultServerSlug` via /me and redirects them into the app
 * (no marketing page flash beyond the time it takes /me to round-trip).
 *
 * Signed-out users: no-op, marketing renders normally.
 *
 * Why client-only + router.replace:
 *   • Doing this on the server would require reading better-auth's
 *     session cookie + an extra API hop in the SSR render — adds
 *     latency to every public visit even for signed-out users.
 *   • `useSession()` only fires the API call when the cookie is present,
 *     so the signed-out path stays free.
 *   • `router.replace` (not push) so the back button doesn't trap the
 *     user on /.
 *
 * Fallback chain matches /me's resolver: defaultServerSlug →
 * personalServerSlug → first server in the list. If none resolves
 * (zero memberships), we let the user stay on `/` and click "Get
 * started" — they probably need to finish a stuck signup.
 */
export function SignedInRedirect(): null {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  // One-shot guard: useSession is reactive but redirect should fire once
  // per landing. Without this, an HMR refresh that re-fires the effect
  // would race router.replace against itself.
  const fired = useRef(false);

  useEffect(() => {
    if (isPending) return;
    if (!session?.user) return;
    if (fired.current) return;
    fired.current = true;

    let cancelled = false;
    (async () => {
      try {
        const me = await api.me();
        if (cancelled) return;
        const target =
          me.defaultServerSlug
          ?? me.personalServerSlug
          ?? me.servers[0]?.slug
          ?? null;
        if (target) router.replace(`/s/${target}`);
        // No workspace at all — leave the user on marketing. They'll
        // see Get Started CTA. Genuinely shouldn't happen post-onboarding.
      } catch {
        // /me failed (session expired between cookie check and call):
        // fall back to staying on marketing. The user can click Sign in.
      }
    })();

    return () => { cancelled = true; };
  }, [isPending, session?.user, router]);

  return null;
}
