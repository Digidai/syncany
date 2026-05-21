/**
 * ApiClient interface — host-agnostic typed fetch shape.
 *
 * The concrete implementation in apps/web/src/lib/api.ts (with cookies,
 * the sy_api_ HMAC token loop, etc) is web-specific. Desktop will provide
 * its own implementation that authenticates via a long-lived session
 * token stored in Electron's safe storage.
 *
 * UI code that needs to call the API gets the client via
 * `<ApiClientProvider value={client}>` + `useApiClient()` hook. Same
 * pattern as PlatformAdapter — keeps UI portable.
 *
 * NOTE: this interface is intentionally narrow + tied to operations the
 * UI actually performs. It is NOT a 1:1 mirror of the @raltic/protocol
 * shapes. Keep this surface minimal so refactors of the underlying
 * client don't ripple through UI.
 */
import type {
  CreateAgentRequest,
  CreateChannelRequest,
  SendMessageRequest,
} from "@raltic/protocol";

// Minimal subset of the existing apps/web/src/lib/api.ts surface — to be
// expanded as features migrate into packages/ui/features/. Right now this
// just establishes the type so consumer hooks compile against it.
export interface ApiClient {
  // ── reads ────────────────────────────────────────────────────────────
  me(): Promise<{ subject: { kind: "user"; userId: string } }>;
  // ── workspaces ───────────────────────────────────────────────────────
  listServers(): Promise<{ servers: Array<{ id: string; slug: string; name: string }> }>;
  // ── messages ─────────────────────────────────────────────────────────
  sendMessage(req: SendMessageRequest): Promise<{ ok: true }>;
  // ── agents ───────────────────────────────────────────────────────────
  createAgent(req: CreateAgentRequest): Promise<{ id: string }>;
  // ── channels ─────────────────────────────────────────────────────────
  createChannel(req: CreateChannelRequest): Promise<{ id: string }>;
  // (more methods added as features migrate)
}
