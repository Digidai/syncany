"use client";

import { useEffect } from "react";

/**
 * Lightweight marketing tracking.
 *
 * Capabilities:
 *   1. UTM persistence — reads `utm_*` query params on landing, drops
 *      them in a first-party cookie (`ral_utm`, 30-day) so attribution
 *      survives the signup round-trip. Server-side signup hook can
 *      read this cookie to record acquisition source on user.create.
 *   2. landing_view event — fires once per page load. Sends a fetch
 *      to /api/marketing/event with the path + utm fields. Failure
 *      is silent (we'd rather lose a beacon than break a landing).
 *
 * No third-party scripts. No fingerprinting. Cloudflare Web Analytics
 * still gives us the volume picture; this adds attribution.
 *
 * Placement: drop <MarketingTracking /> into any marketing landing
 * (page.tsx, /indie, /teams, /runtimes, /security, /connectors).
 * Calling it on workspace routes is a no-op — the events fire but
 * the server hook checks pathname starts with /s/ and skips.
 */
export function MarketingTracking({ event = "landing_view" }: { event?: string }) {
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      const utm: Record<string, string> = {};
      for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]) {
        const v = url.searchParams.get(key);
        if (v) utm[key] = v.slice(0, 64);
      }
      // Persist UTM the first time we see it; later landings shouldn't
      // overwrite the original-touch attribution.
      if (Object.keys(utm).length > 0) {
        const existing = document.cookie.split("; ").find(c => c.startsWith("ral_utm="));
        if (!existing) {
          const value = encodeURIComponent(JSON.stringify({ ...utm, t: Date.now(), p: window.location.pathname }));
          // 30-day TTL, Lax so signup form submission still includes it.
          document.cookie = `ral_utm=${value}; path=/; max-age=${30 * 24 * 3600}; SameSite=Lax`;
        }
      }
      // Beacon the event. Use sendBeacon if available so it survives
      // navigation away from the page; fall back to fetch with keepalive.
      const body = JSON.stringify({
        event,
        path: window.location.pathname,
        referrer: document.referrer || null,
        utm,
        ts: Date.now(),
      });
      const ok = (navigator as Navigator & { sendBeacon?: (url: string, data: BodyInit) => boolean })
        .sendBeacon?.("/api/marketing/event", new Blob([body], { type: "application/json" }));
      if (!ok) {
        void fetch("/api/marketing/event", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
          keepalive: true,
        }).catch(() => { /* silent */ });
      }
    } catch {
      // any failure here is acceptable — no telemetry is worth breaking the landing
    }
  }, [event]);
  return null;
}

/** CTA-click tracker. Wrap a CTA element with onClick to fire a
 *  beacon BEFORE navigation. Server logs the click_target. */
export function trackCtaClick(target: string): void {
  try {
    const body = JSON.stringify({
      event: "cta_click",
      target,
      path: window.location.pathname,
      ts: Date.now(),
    });
    const ok = (navigator as Navigator & { sendBeacon?: (url: string, data: BodyInit) => boolean })
      .sendBeacon?.("/api/marketing/event", new Blob([body], { type: "application/json" }));
    if (!ok) {
      void fetch("/api/marketing/event", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => {});
    }
  } catch { /* silent */ }
}
