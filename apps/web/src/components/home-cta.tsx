"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth-client";
import { api } from "@/lib/api";

/**
 * Auth-aware CTA pair shown in the homepage hero.
 *
 * Not signed in → "Get started" + "Sign in"
 * Signed in    → "Open Syncany" (resolves to first workspace slug)
 */
export function HomeCta(): React.ReactElement {
  const { data: session, isPending } = useSession();
  const [openHref, setOpenHref] = useState<string>("/login");

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    api.listServers().then(({ servers }) => {
      if (cancelled) return;
      if (servers[0]) setOpenHref(`/s/${servers[0].slug}`);
    }).catch(() => { /* fall back to /login */ });
    return () => { cancelled = true; };
  }, [session]);

  if (isPending) {
    return <div className="h-10 w-32 animate-pulse rounded-lg bg-muted/40" />;
  }

  if (session) {
    return (
      <Link href={openHref}>
        <Button size="lg">Open Syncany →</Button>
      </Link>
    );
  }

  return (
    <div className="flex gap-3">
      <Link href="/signup"><Button size="lg">Get started</Button></Link>
      <Link href="/login"><Button size="lg" variant="outline">Sign in</Button></Link>
    </div>
  );
}
