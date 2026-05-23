import type { MetadataRoute } from "next";

/**
 * Public sitemap — served at /sitemap.xml. Submit this URL in Google
 * Search Console (Search Console → Sitemaps → Add a new sitemap →
 * `https://raltic.com/sitemap.xml`).
 *
 * Only PUBLIC, indexable pages live here. Routes excluded on purpose:
 *   - Workspace routes (`/s/*`) — auth-walled.
 *   - Invite + email-verify + password-reset flows — single-use.
 *   - `/teams` — NOINDEX until P4 billing ships (codex review MED-6).
 *   - `/runtimes/openclaw` + `/runtimes/hermes` — NOINDEX until smoke
 *     verification completes (codex review HIGH-2).
 *
 * When the openclaw/hermes smoke runbook passes, append them here AND
 * flip robots.index → true in their page.tsx metadata.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://raltic.com";
  const now = new Date();
  return [
    { url: `${base}/`,                lastModified: now, changeFrequency: "weekly",  priority: 1.0 },
    { url: `${base}/runtimes`,        lastModified: now, changeFrequency: "monthly", priority: 0.9 },
    { url: `${base}/runtimes/claude`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/runtimes/codex`,  lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/indie`,           lastModified: now, changeFrequency: "monthly", priority: 0.75 },
    { url: `${base}/connectors`,      lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${base}/security`,        lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${base}/signup`,          lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/login`,           lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/forgot-password`, lastModified: now, changeFrequency: "yearly",  priority: 0.3 },
  ];
}
