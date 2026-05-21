"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * Invite-acceptance error boundary. If invite metadata fetch fails
 * we want a focused "this invite link is broken" UI, not the full
 * root error.tsx which is too heavy for what's typically a copy-paste
 * link issue.
 */
export default function InviteError({ error, reset }: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.ReactElement {
  useEffect(() => { console.error("[invite error.tsx]", error); }, [error]);
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-8">
      <div className="max-w-sm text-center">
        <h2 className="text-lg font-semibold">Invite link issue</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {error.message || "We couldn't load this invite. The link may be expired or already used."}
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
