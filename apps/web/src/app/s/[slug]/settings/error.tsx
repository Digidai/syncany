"use client";

import { useEffect } from "react";
import { AlertCircle, RotateCw } from "lucide-react";
import { Button } from "@/components/heroui-pro/button";

/**
 * Settings-section error boundary — narrower than the workspace one.
 * If a single settings tab (account / agents / keys / members /
 * workspace) blows up, this catches at the settings-shell level so
 * the user can flip to a different tab from the settings nav instead
 * of being kicked back to the broader workspace error card.
 */
export default function SettingsError({ error, reset }: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.ReactElement {
  useEffect(() => { console.error("[settings error.tsx]", error); }, [error]);
  return (
    <div className="flex h-full w-full flex-1 items-center justify-center p-6">
      <div className="max-w-md rounded-lg border bg-card p-5 text-center shadow-sm">
        <div className="mx-auto mb-3 flex h-9 w-9 items-center justify-center rounded-full bg-destructive/10">
          <AlertCircle className="h-4 w-4 text-destructive" aria-hidden="true" />
        </div>
        <h2 className="text-sm font-semibold">This settings tab hit an error</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Other settings tabs still work. Pick another from the side nav, or retry below.
        </p>
        {error.digest && <p className="mt-1 text-[10px] text-muted-foreground">Reference: {error.digest}</p>}
        <Button type="button" onClick={() => reset()} variant="outline" size="xs" className="mt-3 text-[11px]">
          <RotateCw className="h-3 w-3" aria-hidden="true" /> Try again
        </Button>
      </div>
    </div>
  );
}
