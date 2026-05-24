"use client";

import { useState } from "react";
import { Bot, LogOut, MoreHorizontal, Settings, Users } from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator,
} from "@raltic/ui/components/ui/menu";
import { useRouter } from "next/navigation";
import { api, ApiError, type Channel, type ChannelMember } from "@/lib/api";
import { notifySuccess, notifyThrown } from "@/lib/notify";
import { ChannelSettingsDialog } from "./channel-settings-dialog";
import { ChannelMembersDialog } from "./channel-members-dialog";
import { ConfirmDialog } from "./confirm-dialog";

interface Props {
  channel: Channel;
  members: ChannelMember[];
  selfUserId: string;
  serverSlug: string;
  /** True if viewer is channel creator OR workspace owner. Used to
   *  gate Settings (rename/desc/delete) + Remove other members. */
  canManage: boolean;
  /** True if viewer is any current channel member — used to gate
   *  the Add Members action (server's policy.canAddMember). */
  canAddMembers: boolean;
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
export function ChannelActions({ channel, members, selfUserId, serverSlug, canManage, canAddMembers, onChanged }: Props) {
  const router = useRouter();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const humanCount = members.filter(m => m.memberType === "human").length;
  const agentCount = members.filter(m => m.memberType === "agent").length;
  // Compose the human-readable label for tooltip + aria-label. Mirrors
  // the Members dialog's two-section structure so a screen reader user
  // hears the same breakdown a sighted user reads in the chip.
  const peoplePart = `${humanCount} ${humanCount === 1 ? "person" : "people"}`;
  const agentPart = agentCount > 0 ? `, ${agentCount} agent${agentCount === 1 ? "" : "s"}` : "";
  const membersLabel = peoplePart + agentPart;

  async function handleLeave() {
    if (leaving) return;
    setLeaving(true);
    try {
      await api.leaveChannel(channel.id);
      notifySuccess(`Left #${channel.name}`);
      window.dispatchEvent(new CustomEvent("raltic:channels-changed"));
      setLeaveConfirmOpen(false);
      router.push(`/s/${serverSlug}`);
    } catch (e) {
      notifyThrown("Couldn't leave channel", e instanceof ApiError ? e : new Error(String(e)));
    } finally {
      setLeaving(false);
    }
  }

  return (
    <div className="flex shrink-0 items-center gap-1">
      {/* Members chip — surfaces BOTH humans and agents because in
          Raltic agents are first-class channel members (matches the
          Members dialog's two-section roster). Agent half hidden when
          zero so single-human channels still look clean. Numbers are
          hidden below `sm` so the right cluster doesn't squeeze the
          channel title on mobile (codex C5 MED). */}
      <button
        type="button"
        onClick={() => setMembersOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground"
        aria-label={`Members: ${membersLabel}`}
        title={`Members: ${membersLabel}`}
      >
        <Users className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="hidden sm:inline">{humanCount}</span>
        {agentCount > 0 && (
          <>
            <Bot className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">{agentCount}</span>
          </>
        )}
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
          <DropdownMenuItem onClick={() => setLeaveConfirmOpen(true)} variant="destructive">
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
        canRemove={canManage}
        canAdd={canAddMembers}
        selfUserId={selfUserId}
        open={membersOpen}
        onOpenChange={setMembersOpen}
        onChanged={onChanged}
      />
      <ConfirmDialog
        open={leaveConfirmOpen}
        onOpenChange={setLeaveConfirmOpen}
        title={`Leave #${channel.name}?`}
        description="You'll lose access to its history until someone adds you back."
        confirmLabel="Leave channel"
        destructive
        busy={leaving}
        onConfirm={handleLeave}
      />
    </div>
  );
}
