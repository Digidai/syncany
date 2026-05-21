"use client";

import { useState, type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { getQueryClient } from "@/lib/query-client";

/**
 * Provider for TanStack Query. Mount once at the root layout.
 *
 * Why useState lazy-init vs module-level singleton:
 *   In dev with React fast-refresh, module re-evaluation can leave
 *   stale closures pointing at a dead QueryClient. Lazy-init inside a
 *   component ties the client to the React tree's lifetime.
 *   getQueryClient() still memoises across renders within the same
 *   tree mount, so cache survives navigation.
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => getQueryClient());
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
