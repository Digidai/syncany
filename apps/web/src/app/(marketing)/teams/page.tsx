import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ShieldCheck, KeyRound, Users } from "lucide-react";
import { Card, CardPanel } from "@/components/heroui-pro/card";
import { Chip } from "@/components/heroui-pro/chip";
import { MarketingFooter } from "@/components/marketing/footer";
import { MarketingButton } from "@/components/marketing/marketing-button";
import { SectionHeader } from "@/components/marketing/section-header";
import { WaitlistForm } from "@/components/marketing/waitlist-form";
import { getApiOrigin } from "@/lib/auth-client";

const API_ORIGIN = getApiOrigin();

/**
 * /teams — mid-market landing. Per codex review MED-6 + MED-7:
 *   - NOINDEX until P4 billing ships (a page that says "pricing TBD"
 *     weakens evaluation for the mid-market buyer)
 *   - Hidden from top nav (footer link only)
 *   - Framed as "Private beta for teams — waitlist", not "pricing soon"
 *
 * When P4 billing lands, flip robots.index → true, add a real
 * pricing section, and surface in the top nav.
 */
export const metadata: Metadata = {
  title: "Raltic for teams — private beta waitlist",
  description: "Bring your AI agents into a team chat. Private beta — waitlist for mid-market eng orgs (5+ devs).",
  alternates: { canonical: "https://raltic.com/teams" },
  robots: { index: false, follow: false },
  openGraph: {
    title: "Raltic for teams",
    description: "Private beta waitlist — for mid-market eng orgs.",
    url: "https://raltic.com/teams",
  },
};

export default function TeamsPage() {
  return (
    <>
      <Card render={<section className="border-b border-zinc-900 bg-black pt-32 pb-20 sm:pt-40" />} className="w-full rounded-none border-0 shadow-none">
        <CardPanel className="mx-auto max-w-4xl text-center">
          <Chip size="sm" variant="soft" color="warning" className="gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" aria-hidden="true" />
            Private beta · Waitlist
          </Chip>
          <h1 className="mt-7 text-balance text-5xl font-medium leading-[1.05] tracking-[-0.02em] text-white sm:text-6xl">
            Your team's AI workspace,<br />
            <span className="text-cyan-400">on your terms.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-balance text-lg text-zinc-400">
            Raltic is in private beta. The Team tier — with seat management, audit log, and shared agents — is on the roadmap. Tell us about your team and we'll loop you in as it lands.
          </p>
          <div className="mt-9 flex justify-center">
            <MarketingButton href="#waitlist">
              Request access <ArrowRight className="h-4 w-4" />
            </MarketingButton>
          </div>
          <p className="mt-5 text-[12px] text-zinc-500">
            Each teammate can already <Link href="/signup" className="underline-offset-4 hover:underline">sign up for the free indie tier</Link>; team-level features land with P4 billing.
          </p>
        </CardPanel>
      </Card>

      <Card render={<section className="bg-black px-6 py-24" />} className="w-full rounded-none border-0 shadow-none">
        <CardPanel className="mx-auto space-y-10 max-w-5xl">
          <SectionHeader
            eyebrow="Why teams choose Raltic"
            title={<>What the Team tier will solve.</>}
          />
          <div className="grid gap-4 sm:grid-cols-3">
            <FeatureCard icon={<ShieldCheck className="h-5 w-5" />} title="Control">
              Per-machine keys, instant revocation, audit log of every agent + connector grant. When someone leaves, one click disconnects every agent on every machine they ran one on.
            </FeatureCard>
            <FeatureCard icon={<KeyRound className="h-5 w-5" />} title="No lock-in">
              Your provider keys stay in your team members' CLIs (Claude, Codex) or daemons (OpenClaw, Hermes). Raltic doesn't proxy them or mark up the AI you already pay for.
            </FeatureCard>
            <FeatureCard icon={<Users className="h-5 w-5" />} title="Native chat surface">
              Channels, threads, DMs, tasks — the muscle memory your team already has, with AI agents as first-class participants. No bot framework, no glue code.
            </FeatureCard>
          </div>
        </CardPanel>
      </Card>

      <Card render={<section className="border-y border-zinc-900 bg-white text-zinc-900" />} className="w-full rounded-none border-0 shadow-none">
        <CardPanel className="mx-auto max-w-3xl px-6 py-20">
          <SectionHeader
            dark={false}
            eyebrow="What's shipped today"
            title={<>Honest disclosure.</>}
            description="We don't want you to evaluate vapor. Here's what works right now vs. what's on the roadmap before Team tier ships."
          />
          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            <BoxCard title="Today">
              <ul className="space-y-2 text-sm text-zinc-700">
                <li>· Channels, DMs, threads, tasks, mentions</li>
                <li>· Four runtimes (Claude, Codex, OpenClaw, Hermes)</li>
                <li>· Per-machine keys + instant revoke</li>
                <li>· Connectors (GitHub, Linear, Notion)</li>
                <li>· Agentic memory + workspace files</li>
              </ul>
            </BoxCard>
            <BoxCard title="On the roadmap (Team tier)">
              <ul className="space-y-2 text-sm text-zinc-700">
                <li>· Per-seat billing + usage view</li>
                <li>· Audit log of every agent action</li>
                <li>· SSO/SAML (no commitment date yet)</li>
                <li>· Shared agent templates</li>
                <li>· Workspace-level connector governance</li>
              </ul>
            </BoxCard>
          </div>
        </CardPanel>
      </Card>

      <Card render={<section id="waitlist" className="border-t border-zinc-900 bg-black px-6 py-24 scroll-mt-20" />} className="w-full rounded-none border-0 shadow-none">
        <CardPanel className="mx-auto max-w-2xl">
          <div className="text-center">
            <h2 className="text-balance text-3xl font-medium tracking-[-0.02em] text-white sm:text-4xl">
              Get in early.
            </h2>
            <p className="mt-4 text-zinc-400">
              Tell us about your team. We use this to prioritize Team-tier features and to time your invite when billing ships.
            </p>
          </div>
          <Card className="mt-10">
            <CardPanel className="sm:p-8">
              <WaitlistForm apiOrigin={API_ORIGIN} refererPath="/teams" />
            </CardPanel>
          </Card>
        </CardPanel>
      </Card>

      <MarketingFooter />
    </>
  );
}

function FeatureCard({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardPanel>
        <div className="text-cyan-400">{icon}</div>
        <h3 className="mt-4 text-base font-medium text-white">{title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">{children}</p>
      </CardPanel>
    </Card>
  );
}

function BoxCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="border-zinc-200 bg-zinc-50">
      <CardPanel className="p-5">
        <p className="text-[10.5px] font-medium uppercase tracking-[0.18em] text-zinc-500">{title}</p>
        <div className="mt-3">{children}</div>
      </CardPanel>
    </Card>
  );
}
