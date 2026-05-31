"use client";

// Catches errors thrown by the root layout itself (font loading,
// metadata generation, etc.). `app/error.tsx` only catches errors
// inside a route — if the layout crashes, you need this. Must render
// its own <html>+<body> because Next.js skipped the root layout.
//
// Sentry will capture this via the SDK's automatic instrumentation
// (no manual report needed). Keep this file minimal — anything fancy
// risks crashing itself.

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardPanel, CardFooter } from "@/components/heroui-pro/card";
import { Button } from "@/components/heroui-pro/button";

export default function GlobalError({ error, reset }: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Last-resort log. Sentry catches this automatically once integrated.
    console.error("[global-error]", error);
  }, [error]);

  return (
    <html lang="en">
      <body className="bg-background">
        <div className="flex min-h-screen items-center justify-center bg-background p-8">
          <Card className="w-full max-w-md">
            <CardHeader className="gap-2">
              <CardTitle className="flex items-center gap-2">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-destructive/15 text-destructive-foreground">
                  <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                </span>
                Raltic stopped responding
              </CardTitle>
              <CardDescription>
                The app hit an unrecoverable error before the page could load.
              </CardDescription>
            </CardHeader>
            <CardPanel className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Try reloading first. If it keeps happening, our team has been notified.
              </p>
              {error.digest && (
                <p className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive-foreground">
                  Reference: {error.digest}
                </p>
              )}
            </CardPanel>
            <CardFooter className="gap-2">
              <Button type="button" onPress={() => reset()} className="w-full sm:w-auto">
                Reload
              </Button>
              <Button type="button" variant="outline" render={<Link href="/" />} className="w-full sm:w-auto">
                Home
              </Button>
            </CardFooter>
          </Card>
        </div>
      </body>
    </html>
  );
}
