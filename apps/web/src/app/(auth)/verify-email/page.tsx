"use client";

import { Suspense, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { safeNext } from "@/lib/safe-redirect";

/**
 * Landing page for email verification success.
 *
 * better-auth's /api/auth/verify-email endpoint finishes by redirecting to
 * the `callbackURL` query param. We pass `callbackURL=/verify-email` (in the
 * email template) so users land here with a clear success state instead of
 * being silently dumped into the home redirect chain.
 *
 * `autoSignInAfterVerification: true` means the session cookie is set by
 * the time the user lands here. If `useSession()` resolves with a user,
 * silently bounce them to the destination (`?next=` if present, else `/`).
 */
export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">Loading…</div>}>
      <VerifyEmailInner />
    </Suspense>
  );
}

function VerifyEmailInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const session = authClient.useSession();
  const nextPath = safeNext(sp.get("next")) ?? "/";
  // Fire the redirect at most once per (component instance, nextPath)
  // pair. Without the ref, hitting back-button bounces the user forward
  // again. Without resetting on nextPath change, an in-app nav from
  // /verify-email?next=/a to /verify-email?next=/b would keep the same
  // component instance and ignore the second redirect target.
  const redirected = useRef(false);
  useEffect(() => { redirected.current = false; }, [nextPath]);

  useEffect(() => {
    if (session.data?.user && !redirected.current) {
      redirected.current = true;
      router.replace(nextPath);
    }
  }, [session.data?.user, nextPath, router]);

  if (session.isPending) {
    return <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">Verifying…</div>;
  }

  // Reachable only when the user is NOT signed in (e.g. they opened the
  // verification link in a different browser, or navigated here manually).
  // Show a generic CTA — we can't know whether they actually verified, so
  // avoid claims like "✓ Done".
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8">
      <div className="max-w-sm w-full text-center">
        <h1 className="text-2xl font-semibold">Almost there</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          If you clicked a verification link, your email is now confirmed.
          Sign in to continue.
        </p>
        <Link href={nextPath !== "/" ? `/login?next=${encodeURIComponent(nextPath)}` : "/login"}
          className="mt-6 inline-block rounded bg-foreground px-4 py-2 text-sm text-background hover:opacity-90">
          Sign in
        </Link>
      </div>
    </div>
  );
}
