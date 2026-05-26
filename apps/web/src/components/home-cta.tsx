"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/lib/auth-client";
import { api } from "@/lib/api";
import { MarketingButton } from "@/components/marketing/marketing-button";

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

  const baseCta = "inline-flex h-11 items-center justify-center gap-1.5 rounded-xl px-6 text-[15px] font-semibold tracking-[-0.005em] transition-[transform,box-shadow] duration-150 active:translate-y-px";
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
      <MarketingButton href={openHref} className={CTA_MIN}>
        Open Raltic <span aria-hidden="true">→</span>
      </MarketingButton>
    );
  }

  // Primary CTA — labels the actual default path (cloud-native Agent)
  // instead of a generic "Get started". Codex GTM H2: makes the dual-mode
  // story explicit at the click, not just in the page body.
  return (
    <MarketingButton href="/signup" className={CTA_MIN}>
      Start a cloud Agent <span aria-hidden="true">→</span>
    </MarketingButton>
  );
}
