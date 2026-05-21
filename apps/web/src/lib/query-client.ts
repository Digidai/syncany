"use client";

import { QueryClient } from "@tanstack/react-query";

/**
 * Shared TanStack Query client. Multica's playbook (CLAUDE.md):
 *   - Server state lives in the query cache (not Zustand).
 *   - WS events invalidate queries; no polling, no staleTime workarounds.
 *   - Workspace-scoped queries key on wsId so switch is automatic.
 *   - Mutations are optimistic by default.
 *
 * Defaults tuned for our shape:
 *   - staleTime: 30s — server data feels live, but cached enough that
 *     a quick tab-switch doesn't re-fetch.
 *   - gcTime: 5min — keep dropped queries around long enough that a
 *     back-button hit gets instant render.
 *   - retry: 1 — the api.ts call() already retries idempotent fetches
 *     once; TanStack stacking another retry on top creates 4-attempt
 *     bursts on 5xx. One layer's worth is enough.
 *   - refetchOnWindowFocus: false — we use WS for live updates, refocus
 *     re-fetch wastes bandwidth (and gives users surprise re-renders).
 */
let _client: QueryClient | null = null;
export function getQueryClient(): QueryClient {
  if (_client) return _client;
  _client = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: 0 },
    },
  });
  return _client;
}
