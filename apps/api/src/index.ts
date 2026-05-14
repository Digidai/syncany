import { Hono } from "hono";
import { AuthorizationError } from "@syncany/auth-core";
import type { Env, Variables } from "./lib/env";
import { corsMiddleware } from "./lib/cors";
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

export { ChatRoom, UserGateway } from "@syncany/chat-room";
export type { Env };

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use("*", corsMiddleware());

app.onError((err, c) => {
  if (err instanceof AuthorizationError) {
    return c.json({ error: { code: "FORBIDDEN", message: err.message } }, 403);
  }
  // Zod validation errors: surface field-level details with 400.
  if (err && typeof err === "object" && "issues" in err && Array.isArray((err as { issues?: unknown }).issues)) {
    const issues = (err as { issues: Array<{ path: (string | number)[]; message: string }> }).issues;
    return c.json({
      error: {
        code: "VALIDATION",
        message: "request body failed validation",
        fields: issues.map(i => ({ path: i.path.join("."), message: i.message })),
      },
    }, 400);
  }
  console.error("api error", err);
  return c.json({ error: { code: "INTERNAL", message: "internal error" } }, 500);
});

app.get("/health", (c) => c.json({ ok: true, ts: Date.now() }));

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

export default app;
