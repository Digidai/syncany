"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";

// App-router error boundary. Catches uncaught render errors from any
// nested route. Must be a client component.
export default function GlobalError({ error, reset }: {
  error: Error & { digest?: string }; reset: () => void;
}): React.ReactElement {
  useEffect(() => {
    console.error("[error.tsx]", error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8">
      <div className="max-w-md text-center">
        <Link href="/" className="inline-flex items-center gap-2 font-semibold tracking-tight">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500 to-amber-500 text-white shadow-sm">
            <Sparkles className="h-4 w-4" />
          </span>
          Syncany
        </Link>
        <h1 className="mt-8 text-4xl font-semibold tracking-tight">Something went wrong</h1>
        <p className="mt-3 text-muted-foreground">
          The page hit an unexpected error. We&apos;ve been notified — try again, or head home.
        </p>
        {error.digest && (
          <p className="mt-2 text-xs text-muted-foreground">Reference: {error.digest}</p>
        )}
        <div className="mt-8 flex justify-center gap-3 text-sm">
          <button onClick={() => reset()}
            className="rounded-lg bg-foreground px-4 py-2 text-background hover:opacity-90">Try again</button>
          <Link href="/" className="rounded-lg border px-4 py-2 hover:bg-accent">Go home</Link>
        </div>
      </div>
    </div>
  );
}
