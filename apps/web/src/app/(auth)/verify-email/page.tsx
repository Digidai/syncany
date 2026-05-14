"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

/**
 * Landing page for email verification success.
 *
 * Better-auth's /api/auth/verify-email endpoint finishes by redirecting to
 * the `callbackURL` query param. We pass `callbackURL=/verify-email` (in the
 * email template) so users land here with a clear success message instead
 * of being silently dumped into the home redirect chain.
 */
export default function VerifyEmailPage() {
  const [now, setNow] = useState(0);
  useEffect(() => { setNow(Date.now()); }, []);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8">
      <div className="max-w-sm w-full text-center">
        <h1 className="text-2xl font-semibold">Email verified ✓</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          You can now sign in.
        </p>
        <Link href="/login"
          className="mt-6 inline-block rounded bg-foreground px-4 py-2 text-sm text-background hover:opacity-90">
          Sign in
        </Link>
        {now > 0 && (
          <p className="mt-6 text-[10px] text-muted-foreground">
            If you got here by accident, just close this tab.
          </p>
        )}
      </div>
    </div>
  );
}
