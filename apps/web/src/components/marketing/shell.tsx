import type { ReactNode } from "react";
import { MarketingNav } from "@/components/marketing-nav";
import { MarketingTracking } from "@/components/marketing/tracking";

/**
 * Wrapper rendered by `app/(marketing)/layout.tsx` for every page in
 * the marketing route group — including the homepage `/`.
 *
 * Includes:
 *   - dark theme container
 *   - MarketingTracking beacon (UTM capture + landing_view)
 *   - sticky MarketingNav
 *
 * Per-page footer lives in apps/web/src/components/marketing/footer.tsx
 * — kept separate so individual pages can drop sections without
 * losing the global footer.
 */
export function MarketingShell({ children }: { children: ReactNode }) {
  // NOTE: deliberately does NOT include SignedInRedirect.
  // Auto-redirect to /s/[slug] is mounted ONLY in the homepage
  // (`app/(marketing)/page.tsx`) so secondary marketing pages
  // (/runtimes, /indie, /security, /privacy, etc.) stay browsable
  // by signed-in users — they may want to share a runtime page or
  // re-read the security disclosures without being thrown back into
  // their workspace. (Reported feedback: previously kicked signed-in
  // users out of every marketing click — confusing UX.)
  return (
    <div className="dark bg-black text-white">
      <MarketingTracking />
      <MarketingNav />
      {children}
    </div>
  );
}
