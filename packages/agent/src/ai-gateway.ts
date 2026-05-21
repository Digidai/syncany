/**
 * Model resolver.
 *
 * Routes ALL model requests through one OpenAI-compatible endpoint
 * (currently easyrouter.io). The router speaks OpenAI's chat-completions
 * shape and maps internally to upstream providers (Anthropic, Google,
 * OpenAI itself) — so RalticAgent doesn't need a per-provider client.
 *
 * Why one endpoint not per-provider clients (Anthropic / Google / etc.)?
 *   - Single API key, single billing dashboard (easyrouter side)
 *   - Easyrouter handles fallback, rate-limit, model availability — same
 *     value AI Gateway gives us at the CF layer. Stacking both works but
 *     is unnecessary until we hit easyrouter-specific limits.
 *   - Simpler dependency graph: one provider SDK package.
 *
 * Model names pass through unchanged. Easyrouter recognises:
 *   - "claude-haiku-4-5" / "claude-sonnet-4-6" / "claude-opus-4-7"
 *   - "gpt-5.4" / "gpt-5.5" / etc.
 *   - "gemini-2.5-flash" / "gemini-2.5-pro"
 *
 * If user later configures CF AI Gateway in front of easyrouter (per
 * DESIGN_agent_platform_v2 §4.3), update `AI_GATEWAY_BASE` env to point
 * at the gateway's universal endpoint and easyrouter URL becomes the
 * gateway's upstream — no code change here.
 */
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import type { AgentEnv } from "./types.js";

interface ResolveOpts {
  env: AgentEnv;
  model: string;
  /** When set, agent owner supplied a BYO key. We override the platform
   *  key so the upstream provider bills the user, not us. */
  byoKey?: string;
}

export function resolveModel({ env, model, byoKey }: ResolveOpts): LanguageModel {
  // AI_GATEWAY_BASE doubles as "where does my LLM traffic egress to".
  // For now it points at easyrouter.io (no CF AI Gateway in front yet).
  // Strip trailing slash so concatenation with `/chat/completions` is
  // predictable regardless of how the URL was configured.
  const baseURL = env.AI_GATEWAY_BASE.replace(/\/$/, "");
  const apiKey = byoKey ?? env.LLM_API_KEY;
  if (!apiKey) {
    throw new Error("LLM_API_KEY not configured; set via `wrangler secret put`");
  }
  const client = createOpenAICompatible({
    name: "raltic-router",
    baseURL,
    apiKey,
    // When user supplies BYO key we still pass the gateway protect token
    // so the upstream gateway logs the request to the right tenant.
    headers: env.AI_GATEWAY_TOKEN
      ? { "cf-aig-authorization": `Bearer ${env.AI_GATEWAY_TOKEN}` }
      : {},
  });
  return client(model);
}
