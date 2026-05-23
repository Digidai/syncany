import type { MetadataRoute } from "next";

/**
 * Robots policy — served at /robots.txt.
 *
 * Disallow everything that requires auth or is otherwise not for public
 * indexing:
 *   • /s/*           workspace routes (members-only)
 *   • /invite/*      one-shot invite acceptance URLs (should not be cached)
 *   • /api/*         auth + business APIs (no SEO value, and indexing
 *                    them risks crawlers triggering side effects)
 *   • /verify-email  email-flow landing — single-use tokens
 *   • /reset-password same
 *
 * Allow the marketing surfaces: `/`, `/login`, `/signup`, `/forgot-password`.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/s/",
          "/invite/",
          "/verify-email",
          "/reset-password",
          // /teams is NOINDEX (waitlist-only) per codex MED-6 until
          // P4 billing ships.
          "/teams",
          // OpenClaw + Hermes runtime pages are NOINDEX until smoke
          // verification completes (codex review HIGH-2). Their
          // page.tsx also carries `robots: { index: false }` for
          // belt-and-braces.
          "/runtimes/openclaw",
          "/runtimes/hermes",
        ],
      },
    ],
    sitemap: "https://raltic.com/sitemap.xml",
    host: "https://raltic.com",
  };
}
