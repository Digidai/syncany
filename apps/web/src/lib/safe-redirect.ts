/**
 * Validate a `?next=` redirect target before sending the user there.
 *
 * Open-redirect protection: only same-origin paths are allowed. We parse
 * the candidate against a known dummy origin and require the result to
 * stay inside that origin AND start with `/`. This catches every variant
 * we could think of:
 *   - Absolute URLs (`https://evil.com/...`) — different origin → rejected.
 *   - Protocol-relative (`//evil.com`) — URL parses authority → rejected.
 *   - Backslash variants (`/\\evil.com`, `\\\\evil.com`).
 *   - URL-encoded path-traversal (`/%2F%2Fevil.com`, `/%5Cevil.com`) — we
 *     decode and re-validate so encoding tricks don't slip through proxies
 *     that normalize `%2F` → `/` mid-flight.
 *   - Embedded credentials (`/foo@evil.com`) — URL parses as authority →
 *     different origin.
 *   - `javascript:` / `data:` URIs — fail the leading-`/` check.
 *   - Whitespace / tab / null injection — stripped before parsing; the
 *     trimmed result must still start with `/`.
 *
 * Returns the validated path (always starts with `/`) or `null` to fall
 * back to the default redirect.
 */
const DUMMY_ORIGIN = "http://raltic.local";

export function safeNext(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // Strip ASCII whitespace and other parser-confusing characters before
  // anything else.
  const v = raw.trim();
  if (!v) return null;
  if (!v.startsWith("/")) return null;

  // Reject backslashes outright (Windows-style separator some agents honor).
  if (v.includes("\\")) return null;

  // Decode iteratively to defeat double-encoding (e.g. `%252F%252Fevil`
  // decodes once to `%2F%2Fevil`, twice to `//evil`). Cap iterations to
  // bound the work — anything still encoded after 4 rounds is hostile.
  let decoded = v;
  for (let i = 0; i < 4; i++) {
    let next: string;
    try { next = decodeURIComponent(decoded); }
    catch { return null; }
    if (next === decoded) break;
    decoded = next;
  }
  // The WHATWG URL parser silently strips TAB / CR / LF anywhere in a
  // URL — so `/%09//evil.com` becomes `//evil.com` (different origin) by
  // the time `new URL()` sees it, but our `startsWith("//")` check runs
  // against the un-stripped decoded form and misses it. Mirror the
  // parser's normalization here before any structural check.
  const stripped = decoded.replace(/[\t\r\n]/g, "");
  if (!stripped.startsWith("/")) return null;
  if (stripped.startsWith("//")) return null;          // protocol-relative after decode + strip
  if (stripped.includes("\\")) return null;            // backslash smuggled via encoding
  if (/^\/[^/]*@/.test(stripped)) return null;         // authority via embedded `@`

  let parsed: URL;
  try {
    parsed = new URL(v, DUMMY_ORIGIN);
  } catch {
    return null;
  }
  if (parsed.origin !== DUMMY_ORIGIN) return null;
  // `new URL("///evil", "http://x")` yields origin=http://x but
  // pathname="//evil" — which a downstream `<a href>` re-interprets as
  // protocol-relative. Collapse the leading slashes so we emit at most
  // one, then re-check that we still start with `/`.
  let pathname = parsed.pathname.replace(/^\/{2,}/, "/");
  if (!pathname.startsWith("/")) return null;

  // Preserve fragment so deep-links into anchored content (e.g.
  // `/posts/123#comment-7`) survive the round-trip. Fragments are
  // client-only and the URL parser already separated them from the
  // authority, so they can't smuggle a cross-origin redirect.
  return pathname + parsed.search + parsed.hash;
}
