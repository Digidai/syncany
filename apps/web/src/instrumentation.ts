// Next.js instrumentation hook — runs ONCE per server cold-start.
// Picked up automatically because Next 16's default config enables
// instrumentation. Loads Sentry's server/edge SDK based on runtime.
//
// Why split files per runtime: Sentry's server SDK pulls in Node-only
// modules that fail to bundle for the edge runtime. The dynamic import
// pattern below keeps each bundle clean.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

// Same as `register`, but for server-side errors that happen outside a
// route handler (data fetching, etc.). Sentry uses this hook to wire
// global error capture in production.
//
// The signature is intentionally permissive (no explicit Request typing)
// because the Cloudflare Workers Request shape and Sentry's expected
// RequestInfo shape don't perfectly align — passing through via
// Parameters<…>[1] keeps the bridge typed against whatever Sentry expects
// without us re-deriving it.
export const onRequestError = async (
  ...args: Parameters<typeof import("@sentry/nextjs").captureRequestError>
) => {
  if (process.env.NEXT_RUNTIME === "nodejs" || process.env.NEXT_RUNTIME === "edge") {
    const Sentry = await import("@sentry/nextjs");
    Sentry.captureRequestError(...args);
  }
};
