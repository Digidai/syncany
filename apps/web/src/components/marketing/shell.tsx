import type { ReactNode } from "react";
import { MarketingNav } from "@/components/marketing-nav";
import { SignedInRedirect } from "@/components/signed-in-redirect";
import { MarketingTracking } from "@/components/marketing/tracking";

/**
 * Wrapper used by every marketing landing other than `/`.
 *
 * Includes:
 *   - dark theme container matching `/`
 *   - signed-in redirect (so signed-in visitors don't sit on a
 *     landing they don't need)
 *   - sticky marketing nav
 *
 * Per-page footer lives in apps/web/src/components/marketing/footer.tsx
 * — kept separate so individual pages can drop sections without
 * losing the global footer.
 */
export function MarketingShell({ children }: { children: ReactNode }) {
  return (
    <div className="dark bg-black text-white">
      <SignedInRedirect />
      {/* Fires once per landing — UTM persistence + landing_view event.
          Per-page event overrides go via direct <MarketingTracking event=…/>. */}
      <MarketingTracking />
      <MarketingNav />
      {children}
    </div>
  );
}
