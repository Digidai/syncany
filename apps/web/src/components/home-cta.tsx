"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/lib/auth-client";
import { api } from "@/lib/api";
import { MarketingButton } from "@/components/marketing/marketing-button";

/**
 * Auth-aware CTA pair shown in the homepage hero.
 *
 * Not signed in → "Start a cloud Agent" + "Bring your own daemon"
 * Signed in    → "Open Raltic" (resolves to first workspace slug)
 */
export function HomeCta(): React.ReactElement {
  const { data: session, isPending } = useSession();
  // null = signed in but workspace lookup hasn't resolved yet. Render a
  // readable fallback instead of briefly pointing at /login. We pick
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

  // One min-width across pending / signed-out / signed-in so the hero
  // row never jumps when useSession() resolves. 184px fits the widest
  // resolved label ("Open Raltic →"); signed-out "Get started →" sits
  // a bit looser but stays visually centered inside the same chip.
  const CTA_MIN = "min-w-[184px]";

  if (isPending) {
    return (
      <MarketingButton href="/signup" className={CTA_MIN}>
        Start a cloud Agent <span aria-hidden="true">→</span>
      </MarketingButton>
    );
  }

  // Keep the CTA readable while /me resolves. If it is clicked before
  // resolution, it stays on the homepage instead of showing a blank slot.
  if (session && openHref === null) {
    return (
      <MarketingButton href="/" className={`${CTA_MIN} opacity-90`}>
        Open Raltic <span aria-hidden="true">→</span>
      </MarketingButton>
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
