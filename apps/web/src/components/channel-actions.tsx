"use client";

import { useState } from "react";
import { LogOut, MoreHorizontal, Settings, Users } from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator,
} from "@raltic/ui/components/ui/menu";
import { useRouter } from "next/navigation";
import { api, ApiError, type Channel, type ChannelMember } from "@/lib/api";
import { notifySuccess, notifyThrown } from "@/lib/notify";
import { ChannelSettingsDialog } from "./channel-settings-dialog";
import { ChannelMembersDialog } from "./channel-members-dialog";

interface Props {
  channel: Channel;
  members: ChannelMember[];
  selfUserId: string;
  serverSlug: string;
  /** True if viewer is channel creator OR workspace owner. Used to
   *  gate Settings (rename/desc/delete) + Remove other members.
   *  Computed by the caller from `channel.createdBy === selfUserId
   *  || viewerRole === "owner"`. */
  canManage: boolean;
  /** Called after any successful add/remove/rename so the channel
   *  header re-fetches member + channel state. */
  onChanged?: () => void;
}

/**
 * Right-side cluster in the channel header — surfaces every channel
 * action that previously had no UI:
 *
 *   [Members chip] [⋯ menu → Settings / Leave]
 *
 * DMs are special-cased out at the call site; they don't have
 * members to manage or a name to rename.
 */
export function ChannelActions({ channel, members, selfUserId, serverSlug, canManage, onChanged }: Props) {
  const router = useRouter();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const humanCount = members.filter(m => m.memberType === "human").length;

  async function handleLeave() {
    if (leaving) return;
    if (!confirm(`Leave #${channel.name}? You'll lose access to its history until someone adds you back.`)) return;
    setLeaving(true);
    try {
      await api.leaveChannel(channel.id);
      notifySuccess(`Left #${channel.name}`);
      window.dispatchEvent(new CustomEvent("raltic:channels-changed"));
      router.push(`/s/${serverSlug}`);
    } catch (e) {
      if (e instanceof ApiError) {
        notifyThrown("Couldn't leave channel", e);
      } else {
        notifyThrown("Couldn't leave channel", e);
      }
    } finally {
      setLeaving(false);
    }
  }

  return (
    <div className="flex shrink-0 items-center gap-1">
      <button
        type="button"
        onClick={() => setMembersOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground"
        aria-label={`${humanCount} member${humanCount === 1 ? "" : "s"}`}
        title="View members"
      >
        <Users className="h-3.5 w-3.5" />
        {humanCount}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label="Channel actions"
        >
          <MoreHorizontal className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={4} className="w-48">
          <DropdownMenuItem onClick={() => setMembersOpen(true)}>
            <Users className="h-4 w-4" />
            Members
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setSettingsOpen(true)}>
            <Settings className="h-4 w-4" />
            {canManage ? "Channel settings" : "View details"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleLeave} variant="destructive" disabled={leaving}>
            <LogOut className="h-4 w-4" />
            Leave channel
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ChannelSettingsDialog
        channel={channel}
        serverSlug={serverSlug}
        canManage={canManage}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onSaved={onChanged}
      />
      <ChannelMembersDialog
        channel={channel}
        initialMembers={members}
        canManage={canManage}
        selfUserId={selfUserId}
        open={membersOpen}
        onOpenChange={setMembersOpen}
        onChanged={onChanged}
      />
    </div>
  );
}
