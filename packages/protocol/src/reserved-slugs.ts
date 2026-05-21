/**
 * Reserved workspace slugs — single source of truth for both API and web.
 *
 * Why this lives in @raltic/protocol:
 *   - The API rejects POST/PATCH /servers that use these slugs (would
 *     collide with our own top-level routes).
 *   - The web client surfaces them as "already taken" before submit, so
 *     the user doesn't type a 30-char workspace name then get rejected.
 *   - Drift between the two = a workspace gets created on the API side
 *     but its URL is shadowed by a marketing page. We've audited it once
 *     already; lift to one shared list so the next audit is automatic.
 *
 * Convention (from multica's playbook + our own past pain):
 *   - Single words only. NO hyphenated word groups at the root (was
 *     /verify-email, /forgot-password, /reset-password — see ./0010
 *     migration; renamed to /verify, /forgot, /reset for this exact
 *     reason).
 *   - {noun}/{verb} pairs are fine if the noun is reserved. Example:
 *     /workspaces/new is OK because "workspaces" reserves the whole
 *     subtree.
 *
 * Adding a new reserved slug:
 *   1. Add string here.
 *   2. CI's typecheck picks it up via the import.
 *   3. Add a smoke test only if the new word covers a new SUBTREE
 *      (e.g. you reserve "billing" because you're about to ship
 *      /billing/* routes).
 */
export const RESERVED_SLUGS: ReadonlyArray<string> = [
  // Auth + identity
  "login", "signup", "logout", "verify", "forgot", "reset",
  // Old hyphenated forms — kept reserved as belt-and-suspenders during
  // the 30-day deprecation window where /verify-email etc still redirect.
  "verify-email", "forgot-password", "reset-password",
  // Top-level app destinations
  "settings", "account", "invite", "api", "admin",
  // Domain top-levels (reserve the noun, never the verb)
  "tasks", "agents", "channels", "people", "skills", "squads",
  // App-internal short prefixes
  "s", "u", "agent", "channel", "dm",
  // Marketing / static
  "help", "support", "docs", "about", "pricing", "legal", "terms", "privacy",
  // Infrastructure hostnames
  "www", "app", "mail", "static", "assets", "uploads", "static-assets",
  // Next.js metadata routes — Next intercepts these slugs as file convention
  // routes (apple-icon.{ext}, opengraph-image.{ext}) and serves the
  // generated metadata image. A workspace at /apple-icon would silently be
  // shadowed by the metadata handler.
  "apple-icon", "opengraph-image", "twitter-image", "icon", "favicon",
  "robots", "sitemap", "manifest", "browserconfig",
];

/** O(1) membership check. */
export const RESERVED_SLUG_SET: ReadonlySet<string> = new Set(RESERVED_SLUGS);

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUG_SET.has(slug.toLowerCase());
}
