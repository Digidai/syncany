"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api, ApiError, type Server } from "@/lib/api";
import { AgentActivityProvider } from "@/hooks/use-agent-activity";
import { WelcomeToast } from "@/components/welcome-toast";
import { WorkspaceShell } from "@/components/workspace-shell";
import { Button } from "@/components/heroui-pro/button";

export default function ServerLayout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const router = useRouter();
  const slug = params.slug as string;
  const [server, setServer] = useState<Server | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadServer() {
      try {
        const { server } = await api.getServerBySlug(slug);
        if (!server) throw new Error("Server payload missing");
        if (cancelled) return;
        setServer(server);
        setLoadErr(null);
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 401) { router.push("/login"); return; }
        if (e instanceof ApiError && e.status === 404) { router.push("/"); return; }
        // Surface the failure as in-page UI rather than re-throwing into
        // an async IIFE (becomes an unhandled rejection that Next can
        // route up to the root error.tsx). Keeping it state-based lets
        // the user retry without losing the rest of the app shell.
        console.error("[workspace layout] loadServer failed", e);
        setLoadErr(e instanceof Error ? e.message : "Failed to load workspace");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadServer();
    return () => { cancelled = true; };
  }, [slug, router]);

  const showingStaleServer = server?.slug !== slug;
  if (loading || (!loadErr && showingStaleServer)) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-sm text-muted-foreground">Loading…</div>
      </div>
    );
  }
  if (loadErr || !server) {
    return (
      <div className="flex h-screen items-center justify-center bg-background p-8">
        <div className="max-w-md rounded-lg border bg-card p-6 text-center shadow-sm">
          <h2 className="text-base font-semibold">Couldn&apos;t load this workspace</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {loadErr ?? "Workspace not found."}
          </p>
          <Button
            type="button"
            onClick={() => { setLoading(true); setLoadErr(null); router.refresh(); }}
            variant="outline"
            size="sm"
            className="mt-4"
          >
            Try again
          </Button>
        </div>
      </div>
    );
  }

  // Chat shell is fixed-viewport, no-scroll — internal regions
  // (sidebar, message list, etc.) own their own scroll. h-screen here
  // because s/[slug] is not nested under the (chat) route group, so the
  // chat layout doesn't apply: this layout has to lock viewport itself.
  return (
    <AgentActivityProvider>
      {/* One-shot "welcome to Raltic — you also have your own workspace"
          toast triggered by ?welcome=joined after invite-accept. Mounted
          here (not on individual pages) so any workspace landing covers
          it. Renders nothing in the no-op case. */}
      <WelcomeToast />
      {/* Brand background — two soft brand-tinted radial washes give the
          shell a sense of place vs flat #fff. Static, GPU-cheap, ignored
          on dark mode where they'd muddy the contrast. */}
      <WorkspaceShell server={server}>{children}</WorkspaceShell>
    </AgentActivityProvider>
  );
}
