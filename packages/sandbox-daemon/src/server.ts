#!/usr/bin/env node
/**
 * Daemon entry point — boots the Hono app via Node's http server.
 *
 * Env contract (set by the container entrypoint / CF Containers config):
 *   RALTIC_SANDBOX_TOKEN     bearer token the RalticAgent DO will present
 *   RALTIC_SANDBOX_WORKSPACE filesystem root (default /workspace)
 *   RALTIC_SANDBOX_PORT      listen port (default 8080)
 *
 * Process is PID 1 inside the container; tini handles signal forwarding.
 */
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";

const token = process.env.RALTIC_SANDBOX_TOKEN;
const workspaceRoot = process.env.RALTIC_SANDBOX_WORKSPACE ?? "/workspace";
const port = Number(process.env.RALTIC_SANDBOX_PORT ?? "8080");

if (!token) {
  console.error("[sandbox-daemon] RALTIC_SANDBOX_TOKEN is required");
  process.exit(1);
}
if (!Number.isFinite(port) || port <= 0 || port > 65535) {
  console.error("[sandbox-daemon] RALTIC_SANDBOX_PORT invalid:", port);
  process.exit(1);
}

const app = createApp({ workspaceRoot, bearerToken: token });

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[sandbox-daemon] listening on :${info.port}  workspace=${workspaceRoot}`);
});
