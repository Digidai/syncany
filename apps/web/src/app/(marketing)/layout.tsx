import type { ReactNode } from "react";
import { MarketingShell } from "@/components/marketing/shell";

/**
 * Route-group layout for every public marketing page.
 *
 * Wraps children in MarketingShell (dark theme + MarketingNav +
 * MarketingTracking) so individual pages no longer need to mount it
 * themselves. URLs are unchanged — Next route groups are
 * URL-invisible.
 *
 * The homepage (`./page.tsx`) keeps its own `<SignedInRedirect />`
 * inline because that redirect is `/`-only; sub-pages stay browseable
 * for signed-in users (e.g. sharing a runtime page in a channel).
 */
export default function MarketingLayout({ children }: { children: ReactNode }) {
  return <MarketingShell>{children}</MarketingShell>;
}
