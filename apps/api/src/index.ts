import { Hono } from "hono";
import * as Sentry from "@sentry/cloudflare";
import { AuthorizationError } from "@raltic/auth-core";
import type { Env, Variables } from "./lib/env";
import { corsMiddleware } from "./lib/cors";
import { loggerMiddleware, log } from "./lib/logger";
import { internalRoutes } from "./routes/internal";
import { meRoutes } from "./routes/me";
import { bridgeRoutes } from "./routes/bridge";
import { messagesRoutes } from "./routes/messages";
import { channelsRoutes } from "./routes/channels";
import { serversRoutes } from "./routes/servers";
import { agentsRoutes } from "./routes/agents";
import { tasksRoutes } from "./routes/tasks";
import { invitesRoutes } from "./routes/invites";
import { searchRoutes } from "./routes/search";
import { uploadsRoutes } from "./routes/uploads";
import { machineKeysRoutes } from "./routes/machine-keys";
import { wsRoutes } from "./routes/ws";
import { inboxRoutes } from "./routes/inbox";
import { agentWorkspaceRoutes } from "./routes/agent-workspace";
import { connectorsRoutes } from "./routes/connectors";

export { ChatRoom, UserGateway, WorkspacePresence } from "@raltic/chat-room";
// P0 W2: cloud-native agent runtime DO (per docs/DESIGN_agent_platform_v2.md §4.1).
// Wrangler binding: RALTIC_AGENT — one DO instance per Agent row.
export { RalticAgent } from "@raltic/agent";
// P1 W4: SandboxContainer DO export — class is defined and ready, but
// wrangler binding is commented out in wrangler.jsonc until Docker is
// running locally at deploy time. The export is harmless without a
// binding (CF only instantiates the class when bound).
export { SandboxContainer } from "@raltic/sandbox-container";
export type { Env };

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Order matters: logger BEFORE cors so even preflights show up in logs;
// cors before route handlers so they see corrected origin headers.
app.use("*", loggerMiddleware());
app.use("*", corsMiddleware());

// 404 handler — same `{ error: { code, message } }` shape as everything
// else, so clients don't have to special-case "JSON for known errors,
// HTML for unmatched routes". Returned before onError so this doesn't
// classify a 404 as an internal error.
app.notFound((c) => {
  return c.json({ error: { code: "NOT_FOUND", message: "no route matches this path" } }, 404);
});

app.onError((err, c) => {
  if (err instanceof AuthorizationError) {
    log(c, "warn", "auth.forbidden", { reason: err.message });
    return c.json({ error: { code: "FORBIDDEN", message: err.message } }, 403);
  }
  // Zod validation errors: surface field-level details with 400.
  if (err && typeof err === "object" && "issues" in err && Array.isArray((err as { issues?: unknown }).issues)) {
    const issues = (err as { issues: Array<{ path: (string | number)[]; message: string }> }).issues;
    log(c, "warn", "validation.failed", { issues: issues.map(i => i.path.join(".")) });
    return c.json({
      error: {
        code: "VALIDATION",
        message: "request body failed validation",
        fields: issues.map(i => ({ path: i.path.join("."), message: i.message })),
      },
    }, 400);
  }
  // Unhandled — already logged by loggerMiddleware's catch block, so this
  // just shapes the response. Don't double-log.
  return c.json({ error: { code: "INTERNAL", message: "internal error" } }, 500);
});

// Health check: skip access log (would dominate the stream from CF's
// per-zone monitoring). Still respond fast.
app.get("/health", (c) => {
  c.set("log_skip", true);
  return c.json({ ok: true, ts: Date.now() });
});

app.route("/", internalRoutes);
app.route("/", meRoutes);
app.route("/", bridgeRoutes);
app.route("/", messagesRoutes);
app.route("/", channelsRoutes);
app.route("/", serversRoutes);
app.route("/", agentsRoutes);
app.route("/", tasksRoutes);
app.route("/", invitesRoutes);
app.route("/", searchRoutes);
app.route("/", uploadsRoutes);
app.route("/", machineKeysRoutes);
app.route("/", wsRoutes);
app.route("/", inboxRoutes);
// P1 W6: cloud-agent workspace browser endpoints.
app.route("/", agentWorkspaceRoutes);
// P2: external-service connectors (per-user PATs + per-agent grants).
app.route("/", connectorsRoutes);

// Cron handlers exported alongside fetch. `scheduled` is invoked by CF
// for every cron pattern in wrangler.jsonc — see src/scheduled.ts.
import { scheduled } from "./scheduled";

const handlers = {
  fetch: app.fetch.bind(app),
  scheduled,
};

// Wrap the worker with Sentry's Cloudflare instrumentation. The wrapper:
//   • Auto-captures unhandled errors from fetch + scheduled
//   • Attaches request context (URL, method, headers minus auth)
//   • Tags with deploy version + cf colo
//   • No-ops gracefully if SENTRY_DSN is unset (so dev / staging without
//     a Sentry project still boot)
// `withSentry` returns an object with the same shape as our handlers
// (fetch + scheduled), so the wrapper is transparent to wrangler.
export default Sentry.withSentry(
  (env: Env) => ({
    dsn: env.SENTRY_DSN,
    release: env.RALTIC_RELEASE,
    // Sample 100% of errors (cheap, we want all crashes) and 5% of
    // ordinary traces (latency / breadcrumbs — keeps Sentry costs sane).
    tracesSampleRate: 0.05,
    sendDefaultPii: false,
  }),
  handlers,
);
