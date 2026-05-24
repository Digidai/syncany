"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { Users, MessageSquare, ArrowRight, Crown, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import { notifyThrown } from "@/lib/notify";
import { authClient } from "@/lib/auth-client";
import { GeneratedAvatar } from "@/components/generated-avatar";
import { cn } from "@/lib/utils";

/**
 * Workspace human-members directory.
 *
 * Before this page existed, an invitee landing on a workspace had no
 * way to see who else was a member or DM them — only at-mentioning in
 * a public channel made another human visible. We piggyback on the
 * existing `GET /api/v1/servers/:id/members` endpoint (which already
 * scopes to humans) and use the new `POST /api/v1/dm` find-or-create
 * to start a 1:1 conversation.
 *
 * Out of scope here:
 *   - Admin actions (kick / change role) → Settings → Members.
 *   - Per-user profile detail page → not built yet (Phase 2).
 */
type Member = Awaited<ReturnType<typeof api.listMembers>>["members"][number];

export default function PeoplePage() {
  const router = useRouter();
  const { slug } = useParams<{ slug: string }>();
  const session = authClient.useSession();
  // sessionPending: while better-auth is still resolving /me, meId is
  // null — without guarding, the "isMe" check below would always be
  // false and the current user would appear in their own People list
  // with a "Message" button, letting them open a self-DM.
  const sessionPending = session.isPending;
  const meId = session.data?.user?.id ?? null;

  const [members, setMembers] = useState<Member[] | null>(null);
  const [serverId, setServerId] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { server } = await api.getServerBySlug(slug);
      setServerId(server.id);
      const { members } = await api.listMembers(server.id);
      // Stable sort: owners first, then admins, then members, then by
      // joinedAt asc so the dropdown order doesn't shift on each call.
      const rank = { owner: 0, admin: 1, member: 2 } as Record<string, number>;
      const sorted = [...members].sort((a, b) => {
        const r = (rank[a.role] ?? 99) - (rank[b.role] ?? 99);
        return r !== 0 ? r : a.joinedAt - b.joinedAt;
      });
      setMembers(sorted);
    } catch (e) {
      notifyThrown("Couldn't load workspace members", e);
      setMembers([]);
    }
  }, [slug]);
  useEffect(() => { load(); }, [load]);

  async function handleMessage(member: Member) {
    if (!serverId || opening || member.userId === meId) return;
    setOpening(member.userId);
    try {
      const { channelId } = await api.openDm({
        serverId, peerType: "human", peerId: member.userId,
      });
      router.push(`/s/${slug}/dm/${channelId}`);
    } catch (e) {
      notifyThrown("Couldn't open DM", e);
    } finally {
      setOpening(null);
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-b px-6 py-4">
        <div className="mx-auto flex max-w-5xl items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-500/10 text-violet-700 dark:text-violet-400">
            <Users className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold">People</h1>
            <p className="text-xs text-muted-foreground">
              Humans in this workspace. Click <em>Message</em> to start a direct chat.
            </p>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-5xl">
          {(members === null || sessionPending) && (
            // Keep the page in Loading state until BOTH the members
            // fetch resolves AND the session resolves; rendering the
            // list before meId is known would mislabel "you" as another
            // teammate and expose a Message button on yourself.
            <p className="text-sm text-muted-foreground">Loading…</p>
          )}
          {members !== null && !sessionPending && members.length === 0 && (
            <div className="rounded-lg border border-dashed p-8 text-center">
              <Users className="mx-auto h-8 w-8 text-muted-foreground/60" aria-hidden="true" />
              <p className="mt-3 text-sm font-medium">You're the only person here.</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Invite teammates from Settings → Members.
              </p>
            </div>
          )}
          {members !== null && !sessionPending && members.length > 0 && (
            <ul className="space-y-2">
              {members.map((m) => {
                const isMe = m.userId === meId;
                return (
                  <li key={m.userId} className={cn(
                    "flex items-center gap-3 rounded-lg border bg-card p-3 transition-colors hover:border-foreground/20",
                    isMe && "opacity-60",
                  )}>
                    {m.image ? (
                      <img src={m.image} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" referrerPolicy="no-referrer" loading="lazy" />
                    ) : (
                      <GeneratedAvatar id={m.userId} name={m.name} size="lg" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium">{m.name}</span>
                        {isMe && <span className="text-[10px] text-muted-foreground">(you)</span>}
                        <RoleChip role={m.role} />
                      </div>
                      {m.email && (
                        <p className="truncate text-[11px] text-muted-foreground">{m.email}</p>
                      )}
                    </div>
                    {!isMe && (
                      <button
                        onClick={() => handleMessage(m)}
                        disabled={opening === m.userId}
                        className="inline-flex shrink-0 items-center gap-1 rounded-md border bg-card px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
                      >
                        <MessageSquare className="h-3 w-3" />
                        {opening === m.userId ? "Opening…" : "Message"}
                        <ArrowRight className="h-3 w-3" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function RoleChip({ role }: { role: string }) {
  if (role === "owner") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-1.5 py-px text-[9px] font-medium uppercase tracking-wider text-amber-700 dark:text-amber-400">
        <Crown className="h-2.5 w-2.5" /> Owner
      </span>
    );
  }
  if (role === "admin") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/10 px-1.5 py-px text-[9px] font-medium uppercase tracking-wider text-violet-700 dark:text-violet-400">
        <ShieldCheck className="h-2.5 w-2.5" /> Admin
      </span>
    );
  }
  return null;  // no chip for plain members
}
