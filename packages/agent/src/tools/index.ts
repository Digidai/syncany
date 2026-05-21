/**
 * Tool registry — single source of truth for what tools an agent has.
 *
 * Tools are grouped into capabilities:
 *   - "raltic":     in-Worker tools (search messages, post channel, ...)
 *   - "sandbox":    file/bash/git via SandboxClient (lazy container alloc)
 *   - "connector":  GitHub/Linear/Notion/... (P2)
 *   - "web":        web_fetch / web_search (P1)
 *
 * Each agent gets a per-tools subset based on its config + plan tier.
 */

export type { ToolDispatchCtx, ToolRegistry } from "./registry.js";
export { buildToolRegistry } from "./registry.js";
export { ralticTools }    from "./raltic.js";
export { sandboxTools }   from "./sandbox.js";
