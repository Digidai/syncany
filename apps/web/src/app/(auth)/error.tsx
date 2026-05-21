"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * Auth-routes error boundary. Catches render errors on /login,
 * /signup, /reset-password, etc. Shows a focused recovery card so
 * a failed render doesn't kick the user back to root error.tsx
 * (which is meant for fully-broken pages, not "this form bricked").
 */
export default function AuthError({ error, reset }: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.ReactElement {
  useEffect(() => { console.error("[auth error.tsx]", error); }, [error]);
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-8">
      <div className="max-w-sm text-center">
        <h2 className="text-lg font-semibold">Sign-in hit an error</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {error.message || "Something went wrong rendering this page."}
        </p>
        {error.digest && <p className="mt-1 text-[11px] text-muted-foreground">Reference: {error.digest}</p>}
        <div className="mt-4 flex justify-center gap-2">
          <button onClick={() => reset()}
            className="rounded-md bg-foreground px-3 py-1.5 text-sm text-background hover:opacity-90">Try again</button>
          <Link href="/" className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">Home</Link>
        </div>
      </div>
    </div>
  );
}
