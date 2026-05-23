"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Button } from "@raltic/ui/components/ui/button";
import { api } from "@/lib/api";
import { SetupWizard } from "@/components/setup-wizard";
import { BrandMonogram, GradientText } from "@/components/brand";
import { Sparkles, ExternalLink } from "lucide-react";

interface ServerStats {
  id: string;
  name: string;
  description: string | null;
  agentCount: number;
  channelCount: number;
}

interface PersonalRef {
  id: string;
  slug: string;
  name: string;
}

/**
 * 24h cool-down on the auto-popup. Snooze key is now keyed by the
 * PERSONAL workspace slug (where the wizard targets), not the current
 * page slug — otherwise an invitee bouncing between Gene's workspace
 * and their own would see the same wizard re-pop on every Gene visit.
 */
const WIZARD_SNOOZE_MS = 24 * 60 * 60 * 1000;
const SNOOZE_KEY_PREFIX = "raltic:wizard:snoozedUntil:";

function snoozeKey(userId: string, personalSlug: string): string {
  return `${SNOOZE_KEY_PREFIX}${userId}:${personalSlug}`;
}

function isWizardSnoozed(userId: string, personalSlug: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(snoozeKey(userId, personalSlug));
    if (!raw) return false;
    return Number(raw) > Date.now();
  } catch { return false; }
}

function snoozeWizard(userId: string, personalSlug: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(snoozeKey(userId, personalSlug), String(Date.now() + WIZARD_SNOOZE_MS));
  } catch { /* private browsing — ignore */ }
}

export default function ServerHomePage() {
  const params = useParams();
  const sp = useSearchParams();
  const slug = params.slug as string;
  // `?wizard=1` lets users re-open the wizard explicitly (from settings,
  // from the banner, etc.) even after the bridge has connected.
  const forceWizard = sp.get("wizard") === "1";
  const [stats, setStats] = useState<ServerStats | null>(null);
  const [loading, setLoading] = useState(true);
  // Per-workspace bridge state — true iff THIS workspace has a key that
  // has ever been used. NOT a user-level flag (that was the original bug).
  const [hasBridgeHere, setHasBridgeHere] = useState<boolean | null>(null);
  // True when this workspace has at least one runtime_mode='bridge'
  // agent — the only case where missing-bridge is a real problem.
  // Drives the new "soft nag vs hard nag" copy below.
  const [hasBridgeAgents, setHasBridgeAgents] = useState<boolean>(false);
  // Personal-workspace bridge state — true iff the user's OWN workspace
  // has a connected bridge. Drives the "Set up your bridge in
  // <Personal>" banner on invited workspaces.
  const [hasBridgeInPersonal, setHasBridgeInPersonal] = useState<boolean | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [personal, setPersonal] = useState<PersonalRef | null>(null);

  // Is the user looking at their own personal workspace?
  const onPersonalWorkspace = stats != null && personal != null && stats.id === personal.id;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Resolve the current workspace first, then ask /me twice —
        // once scoped to this workspace, once scoped to the user's
        // personal workspace — so we can answer two distinct questions:
        //   (a) "is there a bridge serving the workspace I'm looking at?"
        //   (b) "does the user even have a bridge for their OWN agents?"
        // (a) drives the in-page CTA copy ("Pick an agent" vs banner).
        // (b) drives the wizard auto-pop on the personal page only.
        const data = await api.getServerBySlug(slug);
        if (cancelled) return;
        const me = await api.me({ serverId: data.server.id });
        if (cancelled) return;
        setStats({
          id: data.server.id,
          name: data.server.name,
          description: data.server.description,
          agentCount: data.agents.length,
          channelCount: data.channels.length,
        });
        setHasBridgeHere(me.hasConnectedBridge);
        setUserId(me.subject.userId);

        // Personal workspace from /me; fall back to "the current workspace
        // if user owns it" if /me's resolver couldn't find one (extreme
        // edge case — runOnboarding always creates one).
        const personalRef: PersonalRef | null = me.personalServerId && me.personalServerSlug
          ? { id: me.personalServerId, slug: me.personalServerSlug, name: "your workspace" }
          : null;
        setPersonal(personalRef);

        // If we're already on personal, hasBridgeHere is the answer.
        // Otherwise fetch a second /me scoped to personal.
        let personalBridge = me.hasConnectedBridge;
        if (personalRef && personalRef.id !== data.server.id) {
          const me2 = await api.me({ serverId: personalRef.id });
          if (cancelled) return;
          personalBridge = me2.hasConnectedBridge;
        }
        setHasBridgeInPersonal(personalBridge);

        // Auto-pop ONLY on personal workspace AND only if its bridge
        // isn't connected AND not snoozed AND the user has at least
        // one bridge-mode agent in this workspace. Cloud-only users
        // shouldn't be forced through bridge setup just because they
        // signed up — the seeded Onboarding Assistant is raltic-mode
        // (codex P3 audit fix), so they can chat with it without
        // installing anything (codex P3 audit Angle 6 HIGH).
        //
        // The key behavior change vs. the original bug: on an INVITED
        // workspace, we no longer auto-pop. Olivia ran the wizard on
        // Gene's because that's where she landed; the wizard happily
        // minted a key bound to Gene's serverId. Now we only pop where
        // the wizard's target (personal) IS the current workspace.
        const amOnPersonal = personalRef && personalRef.id === data.server.id;
        const hasBridgeAgentHere = data.agents?.some(a => (a as { runtimeMode?: string }).runtimeMode === "bridge") ?? false;
        setHasBridgeAgents(hasBridgeAgentHere);
        if (forceWizard) {
          setWizardOpen(true);
        } else if (
          amOnPersonal &&
          !personalBridge &&
          hasBridgeAgentHere &&
          !isWizardSnoozed(me.subject.userId, personalRef.slug)
        ) {
          setWizardOpen(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [slug, forceWizard]);

  function handleWizardDismiss() {
    setWizardOpen(false);
    if (!forceWizard && userId && personal) snoozeWizard(userId, personal.slug);
  }

  if (loading) return <div className="flex flex-1 items-center justify-center"><div className="text-sm text-muted-foreground">Loading…</div></div>;
  if (!stats) return <div className="flex flex-1 items-center justify-center"><div className="text-sm text-muted-foreground">Workspace not found</div></div>;

  return (
    <div className="relative flex flex-1 flex-col items-center justify-center px-8">
      {/* Subtle hero wash — keeps the empty workspace from feeling like
          a 404 page while the user is still figuring out what to do. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute left-1/2 top-1/3 h-[420px] w-[640px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,_rgba(6,182,212,0.10),_transparent_70%)]" />
      </div>
      <div className="max-w-md w-full text-center">
        <BrandMonogram letter={stats.name} size="xl" className="mx-auto mb-6" />
        <h1 className="mb-2 font-heading text-2xl font-semibold leading-tight">
          Welcome to <GradientText>{stats.name}</GradientText>
        </h1>
        {stats.description && (
          <p className="text-sm text-muted-foreground mb-6">{stats.description}</p>
        )}
        <div className="flex justify-center gap-8 mb-8">
          <Stat label="Agents" value={stats.agentCount} />
          <Stat label="Channels" value={stats.channelCount} />
        </div>

        {onPersonalWorkspace ? (
          // ── On the user's OWN workspace ─────────────────────────────
          // Cloud-mode agents work without any bridge install, so the
          // copy now adapts: if any cloud agent exists, point at it
          // first; only nag for bridge if the user actually has a
          // bridge-mode agent waiting (codex P3 audit Angle 6 HIGH +
          // Angle 9 M1).
          hasBridgeHere || !hasBridgeAgents ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Pick an agent or channel from the sidebar to start a conversation.
              </p>
              {/* Bridge is optional — surface it as a tertiary "later"
                  CTA rather than the headline. */}
              {!hasBridgeHere && (
                <button
                  onClick={() => setWizardOpen(true)}
                  className="text-xs text-muted-foreground underline hover:text-foreground"
                >
                  Want to run agents on your own laptop? Set up the bridge (2 min)
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                One of your agents runs on your laptop, but the bridge
                isn&apos;t connected yet. Two-minute setup brings it online.
              </p>
              <Button onClick={() => setWizardOpen(true)} className="mt-2">
                <Sparkles className="mr-1 h-3.5 w-3.5" /> Start the 2-min setup
              </Button>
            </div>
          )
        ) : (
          // ── On someone ELSE's workspace (invited member) ────────────
          //
          // Don't push the wizard modally here. Instead, surface ONE
          // contextual hint when relevant: the user's PERSONAL workspace
          // has no bridge → "your own agents are offline elsewhere; go
          // fix it there". Click drops them onto /s/{personal}?wizard=1
          // so the wizard pops on the correct target.
          //
          // If `hasBridgeInPersonal` is true, the user is set up and
          // doesn't need a nag on every join. Just the friendly "pick
          // an agent" line.
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              You're a member here. Use the sidebar to jump into a channel.
            </p>
            {personal && hasBridgeInPersonal === false && (
              <Link
                href={`/s/${personal.slug}?wizard=1`}
                className="inline-flex items-center gap-1.5 rounded-md border bg-card px-3 py-1.5 text-xs font-medium hover:bg-accent"
              >
                <Sparkles className="h-3.5 w-3.5 text-cyan-600" />
                Set up your bridge in your own workspace to bring YOUR agents online
                <ExternalLink className="h-3 w-3 opacity-60" />
              </Link>
            )}
          </div>
        )}
      </div>

      {/* Wizard ALWAYS targets the user's PERSONAL workspace, regardless
          of how it was opened (auto-pop OR explicit ?wizard=1). The
          earlier version had a "legacy ?wizard=1 retargets to current
          workspace" branch — that re-introduced the Olivia bug: an
          invitee clicking the Settings → Keys "re-open wizard" link
          on the inviter's workspace would mint a key bound to the
          inviter's serverId, exactly the failure mode the whole
          personal/owned-workspace work was supposed to prevent. The
          legacy per-workspace re-onboarding affordance can come back
          as its own dedicated /workspaces/:id/setup route if we ever
          actually need it. */}
      {wizardOpen && personal && (
        <SetupWizard
          serverId={personal.id}
          serverSlug={personal.slug}
          hasExistingBridge={hasBridgeInPersonal ?? false}
          // "invite" flavor only when the user is currently looking at
          // an invited workspace (i.e. not the personal one). Drives
          // step-1 copy referencing the inviter's workspace name.
          flavor={onPersonalWorkspace ? "solo" : "invite"}
          inviterWorkspaceName={stats.name}
          onDismiss={handleWizardDismiss}
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
