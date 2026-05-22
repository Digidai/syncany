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

/** Storage key for the persisted bearer token. */
const BEARER_KEY = "sandbox-bearer";

export class SandboxContainer extends Container<SandboxEnv> {
  /** Container exposes the sandbox-daemon HTTP on :8080. */
  defaultPort = 8080;

  /** Sleep after 5 minutes idle. Containers are cheap when asleep but
   *  not when running, so we sleep aggressively for cost control.
   *  Overridable via env var so test/staging can use shorter values. */
  sleepAfter: `${number}s` | `${number}m` | `${number}h` = "5m";

  /**
   * `envVars` is an INSTANCE property on the Container base class —
   * the SDK reads it on every container start (including lazy wakes
   * triggered by fetch after `sleepAfter`). We can't set it once at
   * provisioning time and forget about it: hibernation drops the JS
   * instance, the DO comes back as a fresh JS object, and the next
   * lazy wake would start the container WITHOUT env → daemon exits
   * immediately because RALTIC_SANDBOX_TOKEN is missing → fetch sees
   * a 5xx (HTTP 500 from container proxy when port never opens).
   *
   * Fix: persist the bearer in DO storage and re-hydrate `envVars`
   * synchronously in the constructor. Every JS reincarnation of this
   * DO sees the same bearer. RalticAgent calls `setBearer()` exactly
   * once at provisioning to seed it. Bearer-rotation later: call
   * setBearer() with the new value + call destroy() to recycle the
   * container so the new env takes effect.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(ctx: any, env: SandboxEnv) {
    super(ctx, env);
    // ctx.storage.kv is sync (CF Durable Objects SQLite KV). If kv is
    // unavailable in a given runtime, fall back to async storage in
    // ensureEnvHydrated().
    try {
      const kv = (ctx?.storage as { kv?: { get?(k: string): string | undefined } } | undefined)?.kv;
      const seeded = kv?.get?.(BEARER_KEY);
      if (typeof seeded === "string" && seeded.length > 0) {
        this.envVars = {
          RALTIC_SANDBOX_TOKEN: seeded,
          RALTIC_SANDBOX_WORKSPACE: "/workspace",
          RALTIC_SANDBOX_PORT: "8080",
        };
      }
    } catch {
      /* fall back to async path */
    }
  }

  /** Async fallback for runtimes without sync KV. Call before any
   *  request that may trigger a lazy container wake. */
  private async ensureEnvHydrated(): Promise<void> {
    if (this.envVars && (this.envVars as Record<string, string>).RALTIC_SANDBOX_TOKEN) return;
    const bearer = await this.ctx.storage.get<string>(BEARER_KEY);
    if (typeof bearer === "string" && bearer.length > 0) {
      this.envVars = {
        RALTIC_SANDBOX_TOKEN: bearer,
        RALTIC_SANDBOX_WORKSPACE: "/workspace",
        RALTIC_SANDBOX_PORT: "8080",
      };
    }
  }

  /**
   * Seed (or rotate) the bearer that the daemon expects in
   * `Authorization: Bearer <token>` on every authed request. Called
   * once by RalticAgent at provisioning; safe to call again to
   * rotate (caller is responsible for recycling the container so the
   * new env propagates).
   */
  async setBearer(bearer: string): Promise<void> {
    if (!bearer || bearer.length < 16) {
      throw new Error("SandboxContainer.setBearer: bearer too short");
    }
    const prev = await this.ctx.storage.get<string>(BEARER_KEY);
    await this.ctx.storage.put(BEARER_KEY, bearer);
    this.envVars = {
      RALTIC_SANDBOX_TOKEN: bearer,
      RALTIC_SANDBOX_WORKSPACE: "/workspace",
      RALTIC_SANDBOX_PORT: "8080",
    };
    // If bearer changed AND there is a live container, recycle it so the
    // new env takes effect immediately. The Container base class will
    // lazy-start a fresh instance on the next fetch with envVars.
    //
    // Migration path for agents whose containers were started before
    // this DO learned to inject env: prev is undefined → we still call
    // destroy() because the live container (if any) is running without
    // RALTIC_SANDBOX_TOKEN and would 401/500 every authed request
    // anyway. Safe because the workspace is empty for those agents
    // (the daemon refused to start, so nothing was written).
    if (prev !== bearer) {
      try {
        await this.destroy();
      } catch {
        // No container to destroy, or destroy not supported on this
        // class — non-fatal; the bearer change will still apply on
        // the next natural restart (after sleepAfter).
      }
    }
  }

  /** Override fetch to hydrate env from storage before delegating to
   *  the Container base class. Catches the cold-start case where the
   *  sync KV read in the constructor failed (or returned undefined
   *  because the bearer was set later via async storage). */
  async fetch(request: Request): Promise<Response> {
    await this.ensureEnvHydrated();
    return super.fetch(request);
  }
}
