import type { ReactNode } from "react";
import { MarketingNav } from "@/components/marketing-nav";
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
  // NOTE: deliberately does NOT include SignedInRedirect.
  // Auto-redirect to /s/[slug] only applies on the primary landing (`/`).
  // Secondary marketing pages (/runtimes, /indie, /security, /privacy, etc.)
  // are browsable by signed-in users — they may want to share a runtime
  // page or re-read the security disclosures without being thrown back
  // into their workspace. (Reported feedback: previously kicked signed-in
  // users out of every marketing click — confusing UX.)
  return (
    <div className="dark bg-black text-white">
      <MarketingTracking />
      <MarketingNav />
      {children}
    </div>
  );
}
