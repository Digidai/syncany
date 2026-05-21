"use client";

import { useEffect, useRef } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { api } from "@/lib/api";
import { notifySuccess } from "@/lib/notify";

/**
 * One-shot welcome toast for invitees. Triggered by `?welcome=joined`
 * appended by the invite-accept handler (apps/web/src/app/invite/[id]/page.tsx).
 *
 * Why this exists:
 *   When a user accepts an invite, they land on the inviter's workspace
 *   and (correctly) see the inviter's sidebar. Most users don't realize
 *   that signup *also* created them their own personal workspace —
 *   the workspace switcher (top-left) shows it, but nobody clicks
 *   dropdowns they didn't know existed. The result: their own agents
 *   stay invisible to them; they wonder why they can't find them.
 *   This toast points the way without being modal.
 *
 * Trigger contract (tightened):
 *   - On first arrival to /s/{slug}?welcome=joined we PIN the welcome
 *     intent to {slug} via sessionStorage and strip the param.
 *   - The actual toast fires only when the user is currently viewing
 *     the pinned slug AND a personal workspace exists AND personal !=
 *     pinned. That guards against the user switching workspaces
 *     between accept and the effect firing — we don't want a welcome
 *     toast popping in a workspace they were already in.
 *   - Pin survives one fire then clears, so a refresh doesn't re-pop.
 *
 * Mounted in apps/web/src/app/s/[slug]/layout.tsx so it covers every
 * workspace page (where invite-accept lands).
 */
const PIN_KEY = "raltic:welcome-pinned-slug";

export function WelcomeToast(): null {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const welcome = sp.get("welcome");
  const fired = useRef(false);

  // Pin the welcome intent to the slug we arrived on, then strip the
  // query param so refreshes don't loop. Done in a separate effect
  // (different deps) from the toast firing so the strip happens
  // synchronously even when /me is in flight.
  useEffect(() => {
    if (welcome !== "joined") return;
    if (typeof window === "undefined") return;
    const currentSlug = pathname.split("/")[2];
    if (!currentSlug) return;
    try {
      window.sessionStorage.setItem(PIN_KEY, currentSlug);
    } catch { /* private mode — skip pin, toast may misfire on switch */ }
    // Strip ?welcome=joined.
    const params = new URLSearchParams(sp.toString());
    params.delete("welcome");
    const next = params.toString();
    router.replace(`${pathname}${next ? `?${next}` : ""}`);
  }, [welcome, pathname, sp, router]);

  // Fire toast once when current slug matches the pinned slug AND
  // /me returns a different personalServerSlug.
  //
  // Pin-clear ordering matters: only clear AFTER /me successfully resolves
  // and we've evaluated the toast condition. Earlier we cleared in `finally`
  // which dropped the pin on network failure OR effect cancellation
  // (Strict-Mode double-mount, fast nav) — the user would never see the
  // welcome toast they were owed. Now failure → keep the pin so the next
  // render retries; success → clear exactly once. `fired.current` is set
  // after success too, for the same reason.
  useEffect(() => {
    if (fired.current) return;
    if (typeof window === "undefined") return;
    const pinned = (() => {
      try { return window.sessionStorage.getItem(PIN_KEY); }
      catch { return null; }
    })();
    if (!pinned) return;
    const currentSlug = pathname.split("/")[2];
    if (currentSlug !== pinned) return;

    let cancelled = false;
    (async () => {
      try {
        const me = await api.me();
        if (cancelled) return;
        // Success — toast (when warranted), pin clear, and fired-flag all
        // happen here together. Either all three or none.
        if (me.personalServerSlug && me.personalServerSlug !== currentSlug) {
          notifySuccess(
            "Welcome to Raltic",
            `You also have your own workspace — switch from the top-left to find it.`,
          );
        }
        try { window.sessionStorage.removeItem(PIN_KEY); }
        catch { /* ignore */ }
        fired.current = true;
      } catch {
        // /me failed (network blip, cold worker, etc.) — keep the pin
        // and the fired flag both unset so the next mount can retry.
      }
    })();

    return () => { cancelled = true; };
  }, [pathname]);

  return null;
}
