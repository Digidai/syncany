"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "@/lib/auth-client";
import { api } from "@/lib/api";

/**
 * Auth-aware CTA pair shown in the homepage hero.
 *
 * Not signed in → "Get started" + "Sign in"
 * Signed in    → "Open Raltic" (resolves to first workspace slug)
 */
export function HomeCta(): React.ReactElement {
  const { data: session, isPending } = useSession();
  // null = signed in but workspace lookup hasn't resolved yet — render the
  // skeleton instead of letting the button briefly point at /login. We pick
  // /me's defaultServerSlug first (single round-trip, matches the rest of
  // the app's "where do I land" logic) and fall back to the first server.
  const [openHref, setOpenHref] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    (async () => {
      try {
        const me = await api.me();
        if (cancelled) return;
        if (me.defaultServerSlug) {
          setOpenHref(`/s/${me.defaultServerSlug}`);
          return;
        }
        const { servers } = await api.listServers();
        if (cancelled) return;
        // No workspace at all → keep them on the homepage and route them
        // through /signup-completion flow instead of dumping to /login.
        setOpenHref(servers[0] ? `/s/${servers[0].slug}` : "/");
      } catch {
        if (!cancelled) setOpenHref("/");
      }
    })();
    return () => { cancelled = true; };
  }, [session]);

  // Hero CTAs deliberately bypass the design-system <Button> for two
  // reasons: (1) the marketing landing wants a SOLID white-on-black
  // anchor consistent with the nav, not the workspace's cyan-primary
  // chip; (2) we want one tight, crisp glow rather than the design
  // system's inset-shadow chrome which felt fuzzy on the dark hero.
  const baseCta = "inline-flex h-11 items-center justify-center gap-1.5 rounded-xl px-6 text-[15px] font-semibold tracking-[-0.005em] transition-[transform,box-shadow] duration-150 active:translate-y-px";
  const primaryCta = `${baseCta} bg-white text-black shadow-[0_1px_0_rgba(255,255,255,0.4)_inset,0_8px_24px_-8px_rgba(34,211,238,0.55),0_2px_8px_-2px_rgba(0,0,0,0.4)] hover:shadow-[0_1px_0_rgba(255,255,255,0.6)_inset,0_10px_28px_-8px_rgba(34,211,238,0.75),0_2px_8px_-2px_rgba(0,0,0,0.4)]`;
  // One min-width across pending / signed-out / signed-in so the hero
  // row never jumps when useSession() resolves. 184px fits the widest
  // resolved label ("Open Raltic →"); signed-out "Get started →" sits
  // a bit looser but stays visually centered inside the same chip.
  const CTA_MIN = "min-w-[184px]";

  // Show skeleton while session pending OR while signed-in destination
  // is still resolving — clicking before /me returns would otherwise race.
  if (isPending || (session && openHref === null)) {
    // Skeleton mirrors the real CTA's box exactly (same h-11, rounded-xl,
    // px-6, min-width) so the layout slot is reserved 1:1. Color sits
    // between the dark hero background and the white resolved button so
    // it doesn't disappear on dark or scream on light. motion-reduce:
    // honor users who disabled animations; the slot still reserves space.
    return (
      <div
        role="status"
        aria-label="Loading"
        className={`${baseCta} ${CTA_MIN} animate-pulse bg-zinc-200/80 motion-reduce:animate-none dark:bg-zinc-800/60`}
      >
        <span className="sr-only">Loading</span>
      </div>
    );
  }

  if (session && openHref) {
    return (
      <Link href={openHref} className={`${primaryCta} ${CTA_MIN}`}>
        Open Raltic <span aria-hidden="true">→</span>
      </Link>
    );
  }

  // Single primary CTA. Sign in lives in the top nav — duplicating it in
  // the hero made the row feel like a generic "two-button login screen"
  // instead of a confident "this is the action" landing.
  return (
    <Link href="/signup" className={`${primaryCta} ${CTA_MIN}`}>
      Get started <span aria-hidden="true">→</span>
    </Link>
  );
}
