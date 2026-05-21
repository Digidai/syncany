// Server-side Sentry for Next.js routes that run on the Cloudflare
// Workers runtime (via OpenNext). Server config can't access the
// browser `Replay` integration. Picked up by @sentry/nextjs via file
// convention.
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN; // non-public — server only

if (dsn) {
  Sentry.init({
    dsn,
    release: process.env.RALTIC_RELEASE,
    tracesSampleRate: 0.05,
    sendDefaultPii: false,
  });
}
