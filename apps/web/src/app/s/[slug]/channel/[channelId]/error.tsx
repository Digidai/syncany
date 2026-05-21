"use client";

import { useEffect } from "react";
import { AlertCircle, RotateCw } from "lucide-react";

// Channel-page-scoped error boundary. Keeps a single bad render
// (malformed message row, missing field, etc.) from blowing past the
// workspace layout and landing on the root /app/error.tsx — the user
// loses the sidebar + nav and the whole shell feels broken. This
// boundary keeps the shell intact and only the message pane shows the
// fallback, so they can pick another channel without a full reload.
export default function ChannelError({ error, reset }: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.ReactElement {
  useEffect(() => {
    console.error("[channel error.tsx]", error);
  }, [error]);

  return (
    <div className="flex h-full flex-1 items-center justify-center p-8">
      <div className="max-w-md rounded-lg border bg-card p-6 text-center shadow-sm">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10">
          <AlertCircle className="h-5 w-5 text-destructive" aria-hidden="true" />
        </div>
        <h2 className="text-base font-semibold">This channel hit an error</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The rest of your workspace is fine. Try again, or pick another channel from the sidebar.
        </p>
        {error.digest && (
          <p className="mt-2 text-[11px] text-muted-foreground">Reference: {error.digest}</p>
        )}
        <button
          onClick={() => reset()}
          className="mt-4 inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent"
        >
          <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
          Try again
        </button>
      </div>
    </div>
  );
}
