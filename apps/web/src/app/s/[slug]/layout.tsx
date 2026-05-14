"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { api, ApiError, type Server } from "@/lib/api";
import { AgentActivityProvider } from "@/hooks/use-agent-activity";

export default function ServerLayout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const router = useRouter();
  const slug = params.slug as string;
  const [server, setServer] = useState<Server | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadServer() {
      try {
        const { server } = await api.getServerBySlug(slug);
        setServer(server);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) router.push("/login");
        else if (e instanceof ApiError && e.status === 404) router.push("/");
        else throw e;
      } finally {
        setLoading(false);
      }
    }
    loadServer();
  }, [slug, router]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-sm text-muted-foreground">Loading...</div>
      </div>
    );
  }
  if (!server) return null;

  // Chat shell is fixed-viewport, no-scroll — internal regions
  // (sidebar, message list, etc.) own their own scroll. h-screen here
  // because s/[slug] is not nested under the (chat) route group, so the
  // chat layout doesn't apply: this layout has to lock viewport itself.
  return (
    <AgentActivityProvider>
      <div className="flex h-screen overflow-hidden bg-background p-2">
        <Sidebar serverSlug={server.slug} serverId={server.id} serverName={server.name} />
        <div className="flex flex-1 overflow-hidden rounded-xl bg-card shadow-border">
          {children}
        </div>
      </div>
    </AgentActivityProvider>
  );
}
