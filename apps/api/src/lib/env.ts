import type { AuthEnv } from "@raltic/auth-core";
import type { Subject } from "@raltic/auth-core";

export interface Env extends AuthEnv {
  RATE_LIMITS: KVNamespace;
  USER_GATEWAY: DurableObjectNamespace;
  /** Workspace presence DO — per server, tracks who's online.
   *  UserGateway routes presence_subscribe / _unsubscribe here.
   *  See docs/DESIGN_workspace_presence.md. */
  WORKSPACE_PRESENCE: DurableObjectNamespace;
  /** RalticAgent DO — per-Agent cloud-native runtime (P0 W2).
   *  Hosts agent loop, history, plan list, sandbox container id.
   *  Resolved via .idFromName(agentId). */
  RALTIC_AGENT: DurableObjectNamespace;
  /** Per-Agent sandbox container DO. Lazy-allocated by RalticAgent on
   *  first FS/Bash tool call. P1 W4 wires CF Containers; P0 stubs OK. */
  SANDBOX?: DurableObjectNamespace;
  /** Workers AI binding — embeddings + free-tier Llama inference. */
  AI?: Ai;
  /** Vectorize index for semantic message search (D8 global + filter). */
  VECTORIZE?: VectorizeIndex;
  /** OpenAI-compatible LLM router base URL (easyrouter / OpenRouter /
   *  CF AI Gateway universal endpoint). Single point for all model calls. */
  AI_GATEWAY_BASE?: string;
  /** Optional CF AI Gateway protect token (cf-aig-authorization). */
  AI_GATEWAY_TOKEN?: string;
  /** Router API key for managed-tier inference. BYO users supply their own. */
  LLM_API_KEY?: string;
  UPLOADS: R2Bucket;
  /** R2 bucket for daily D1 dumps. Optional — only the cron handler uses
   *  it, so dev/test deployments without BACKUPS bound still boot. */
  BACKUPS?: R2Bucket;
  MACHINE_KEY_PEPPER: string;
  /** D1 API credentials for the cron backup job. Optional at build-time;
   *  the cron handler errors loudly if missing at runtime. */
  CF_API_TOKEN?: string;
  CF_ACCOUNT_ID?: string;
  D1_DATABASE_ID?: string;
  /** Sentry DSN — optional. SDK is loaded unconditionally so we get
   *  consistent error wrapping; if DSN is missing the SDK is a no-op. */
  SENTRY_DSN?: string;
  /** Used to tag events with the build that emitted them. Wrangler exposes
   *  this automatically as `WRANGLER_VERSION_ID` for the deployed version;
   *  we mirror to a friendlier name. */
  RALTIC_RELEASE?: string;
}

export type Variables = {
  subject: Subject;
  /** Base context (request_id, method, path, ip…) stashed by the logger
   *  middleware. Handlers use `log(c, "info", …, fields)` which merges
   *  this in automatically. Optional because non-logged routes (health,
   *  unmatched 404) may not have it set. */
  log_ctx?: Partial<import("./logger").LogLine>;
  /** Opt-out from request access log (set by handler if it's noisy). */
  log_skip?: boolean;
};

import type { Context } from "hono";
/** Typed Hono context used everywhere instead of `: any`. */
export type Ctx = Context<{ Bindings: Env; Variables: Variables }>;
