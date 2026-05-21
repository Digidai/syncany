/**
 * @raltic/bridge-core — Bridge daemon as a reusable library.
 *
 * apps/bridge wraps this in a Node CLI; apps/desktop will wrap it inside
 * Electron's main process so the same code runs whether the user installs
 * via `npx @raltic/bridge` or launches the desktop app.
 *
 * Anything OS-specific (process spawning, filesystem paths, network
 * fingerprint) stays inside this package — callers only pass options.
 */
export { Bridge, type BridgeOpts } from "./bridge.js";
export { AgentManager } from "./agent-manager.js";
export { buildSystemPrompt } from "./system-prompt.js";
