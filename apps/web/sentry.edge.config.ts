// Edge-runtime Sentry config — used by Next.js middleware + edge API
// routes. Same minimal init as server; the Sentry SDK detects runtime.
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    release: process.env.RALTIC_RELEASE,
    tracesSampleRate: 0.05,
    sendDefaultPii: false,
  });
}
