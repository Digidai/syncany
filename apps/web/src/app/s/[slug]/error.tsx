"use client";

import { useEffect } from "react";
import { AlertCircle, RotateCw } from "lucide-react";
import { Button } from "@/components/heroui-pro/button";
import { Card, CardPanel } from "@/components/heroui-pro/card";

/**
 * Workspace-level error boundary. Catches uncaught render errors from
 * any page under /s/[slug]/* — settings, inbox, agent profile, channels.
 *
 * Renders an in-page card rather than the full-page root error.tsx so
 * the surrounding workspace shell (sidebar, top nav) stays usable. The
 * user can keep navigating to other channels even if one page crashed.
 *
 * Per Next.js App Router contract: must be a client component, receives
 * `error` + `reset` props, calling reset() re-renders the segment.
 */
export default function WorkspaceError({ error, reset }: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.ReactElement {
  useEffect(() => {
    // Logged once per error. Production also routes via Sentry (see
    // sentry.client.config.ts) — this console line aids dev debugging.
    console.error("[workspace error.tsx]", error);
  }, [error]);

  return (
    <div className="flex h-full w-full flex-1 items-center justify-center p-8">
      <Card className="max-w-md text-center">
        <CardPanel className="p-6">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10">
          <AlertCircle className="h-5 w-5 text-destructive" aria-hidden="true" />
        </div>
        <h2 className="text-base font-semibold">This page hit an error</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The rest of your workspace is still working. Try again, or pick another channel from the sidebar.
        </p>
        {error.digest && (
          <p className="mt-2 text-[11px] text-muted-foreground">Reference: {error.digest}</p>
        )}
        <Button
          type="button"
          onClick={() => reset()}
          variant="outline"
          size="sm"
          className="mt-4"
        >
          <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
          Try again
        </Button>
        </CardPanel>
      </Card>
    </div>
  );
}
