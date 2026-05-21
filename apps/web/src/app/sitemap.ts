import type { MetadataRoute } from "next";

/**
 * Public sitemap — served at /sitemap.xml. Submit this URL in Google
 * Search Console (Search Console → Sitemaps → Add a new sitemap →
 * `https://raltic.com/sitemap.xml`).
 *
 * Only PUBLIC, indexable pages live here. Workspace routes (`/s/...`),
 * invite pages, and email-verification flows are auth-walled and
 * shouldn't be indexed — they're excluded both via this sitemap AND via
 * the middleware's redirect-to-login on missing session.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://raltic.com";
  const now = new Date();
  return [
    {
      url: `${base}/`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${base}/signup`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${base}/login`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: `${base}/forgot-password`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];
}
