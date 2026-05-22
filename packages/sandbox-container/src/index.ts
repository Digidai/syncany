/**
 * SandboxContainer DO — per-Agent CF Container lifecycle wrapper.
 *
 * Each instance of this DO owns ONE container. The DO id (`idFromName`)
 * is derived deterministically from the agentId so an agent's container
 * persists across DO evictions: same name → same container.
 *
 * Lifecycle:
 *   - First `fetch()` after creation lazy-starts the container. The
 *     Container base class (cloudflare:workers) handles image pull,
 *     env injection, port wiring, and sleep-on-idle.
 *   - When the agent is idle, the container is asleep. Cost ≈ $0.
 *   - When an agent message lands, RalticAgent DO calls our `fetch()`
 *     which transparently wakes the container if asleep.
 *
 * Routing:
 *   The DO is a thin pass-through: receive HTTP from RalticAgent →
 *   forward to the container's :8080 (sandbox-daemon) → return response.
 *   Env injection (RALTIC_SANDBOX_TOKEN, RALTIC_SANDBOX_WORKSPACE) is
 *   passed via container env (set per-instance in wrangler.jsonc + via
 *   start params).
 */
import { Container } from "@cloudflare/containers";

interface SandboxEnv {
  /** Hard idle timeout. After this much wall-clock with no fetch, CF
   *  hibernates the container (instant resume on next fetch). */
  SANDBOX_IDLE_TIMEOUT_SECONDS?: string;
}

export class SandboxContainer extends Container<SandboxEnv> {
  /** Container exposes the sandbox-daemon HTTP on :8080. */
  defaultPort = 8080;

  /** Sleep after 5 minutes idle. Containers are cheap when asleep but
   *  not when running, so we sleep aggressively for cost control.
   *  Overridable via env var so test/staging can use shorter values. */
  sleepAfter: `${number}s` | `${number}m` | `${number}h` = "5m";

  /**
   * The Container base class handles startup, env injection, and port
   * routing. Inherited fetch() proxies HTTP to defaultPort and lazily
   * starts/wakes the container as needed.
   *
   * Bearer auth lives in sandbox-daemon (packages/sandbox-daemon/src/
   * app.ts) — every request carries `Authorization: Bearer <token>`
   * injected by RalticAgent DO. The token is set in the container's
   * env via `envVars` when the DO first starts the container; see
   * RalticAgent.ensureSandbox.
   */
}
