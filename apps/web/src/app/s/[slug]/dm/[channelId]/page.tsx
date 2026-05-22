"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { MessageArea } from "@/components/message-area";
import { WorkspacePane } from "@/components/workspace-pane";
import { api, type Agent, type Channel } from "@/lib/api";

export default function DmPage() {
  const params = useParams();
  const channelId = params.channelId as string;
  // Resolve the agent peer (if any) so we can render its workspace pane.
  // For human-human DMs and channels without an agent, peerAgent stays
  // null and WorkspacePane renders its empty state (no clutter).
  const [peerAgent, setPeerAgent] = useState<Agent | null>(null);
  useEffect(() => {
    if (!channelId) return;
    // Always reset first — otherwise the previous channel's agent
    // workspace lingers in the pane (and the 5s terminal poll keeps
    // hitting the old agent) until the new fetch resolves. Codex HIGH.
    setPeerAgent(null);
    let cancelled = false;
    (async () => {
      try {
        const { peer } = await api.getChannel(channelId);
        if (cancelled) return;
        if (!peer || peer.type !== "agent") return;
        const { agents } = await api.listAgents();
        if (cancelled) return;
        setPeerAgent(agents.find(a => a.id === peer.id) ?? null);
      } catch {
        if (!cancelled) setPeerAgent(null);
      }
    })();
    return () => { cancelled = true; };
  }, [channelId]);

  return (
    <div className="flex h-full w-full min-w-0">
      <MessageArea channelId={channelId} />
      <WorkspacePane agent={peerAgent} />
    </div>
  );
}
