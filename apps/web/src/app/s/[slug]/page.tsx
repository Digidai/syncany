"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { SetupWizard } from "@/components/setup-wizard";
import { Sparkles } from "lucide-react";

interface ServerStats {
  id: string;
  name: string;
  description: string | null;
  agentCount: number;
  channelCount: number;
}

export default function ServerHomePage() {
  const params = useParams();
  const slug = params.slug as string;
  const [stats, setStats] = useState<ServerStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasBridge, setHasBridge] = useState<boolean | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [data, me] = await Promise.all([
          api.getServerBySlug(slug),
          api.me(),
        ]);
        if (cancelled) return;
        setStats({
          id: data.server.id,
          name: data.server.name,
          description: data.server.description,
          agentCount: data.agents.length,
          channelCount: data.channels.length,
        });
        setHasBridge(me.hasConnectedBridge);
        if (!me.hasConnectedBridge) setWizardOpen(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [slug]);

  if (loading) return <div className="flex flex-1 items-center justify-center"><div className="text-sm text-muted-foreground">Loading...</div></div>;
  if (!stats) return <div className="flex flex-1 items-center justify-center"><div className="text-sm text-muted-foreground">Workspace not found</div></div>;

  return (
    <div className="relative flex flex-1 flex-col items-center justify-center px-8">
      <div className="max-w-md w-full text-center">
        <Avatar className="size-16 mx-auto mb-6">
          <AvatarFallback className="text-2xl font-bold">
            {stats.name.charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <h1 className="text-xl font-semibold text-foreground mb-2">{stats.name}</h1>
        {stats.description && (
          <p className="text-sm text-muted-foreground mb-6">{stats.description}</p>
        )}
        <div className="flex justify-center gap-8 mb-8">
          <Stat label="Agents" value={stats.agentCount} />
          <Stat label="Channels" value={stats.channelCount} />
        </div>
        {hasBridge ? (
          <p className="text-sm text-muted-foreground">
            Select an agent or channel from the sidebar to start a conversation.
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Your workspace is ready, but no agent is online yet —
              the bridge needs to run on your laptop.
            </p>
            <Button onClick={() => setWizardOpen(true)} className="mt-2">
              <Sparkles className="mr-1 h-3.5 w-3.5" /> Start the 2-min setup
            </Button>
          </div>
        )}
      </div>

      {wizardOpen && (
        <SetupWizard
          serverId={stats.id}
          serverSlug={slug}
          onDismiss={() => setWizardOpen(false)}
        />
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center">
      <div className="text-2xl font-semibold text-foreground">{value}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
    </div>
  );
}
