// Client-side Sentry instrumentation. Runs in the browser. Picked up
// automatically by @sentry/nextjs via the file convention.
//
// DSN comes from NEXT_PUBLIC_SENTRY_DSN (must be public — browser sees it).
// No DSN = SDK no-ops; no error gets shipped. This lets dev + un-configured
// staging deployments boot without a Sentry account.
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    release: process.env.NEXT_PUBLIC_RALTIC_RELEASE,
    // Cheap on the network: only 5% of traces but 100% of errors.
    tracesSampleRate: 0.05,
    // Replay on errors only (1% sessions otherwise, 100% on error) — gives
    // us a video of what the user did right before things blew up, without
    // streaming everyone's session.
    replaysSessionSampleRate: 0.0,
    replaysOnErrorSampleRate: 1.0,
    integrations: [
      Sentry.replayIntegration({
        maskAllText: true,    // privacy — never leak DM contents to Sentry
        blockAllMedia: true,  // never upload screenshots of channel messages
      }),
    ],
    // Filter known-noise events. Add patterns here when you see them in
    // Sentry inbox more than 10× without being actionable.
    ignoreErrors: [
      "ResizeObserver loop limit exceeded", // browser-internal, no app bug
      "Non-Error promise rejection captured",
    ],
  });
}
