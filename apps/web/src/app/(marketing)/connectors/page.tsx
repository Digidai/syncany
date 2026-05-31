import type { Metadata } from "next";
import { ArrowRight, GitBranch, Layers, FileText } from "lucide-react";
import { MarketingFooter } from "@/components/marketing/footer";
import { MarketingButton } from "@/components/marketing/marketing-button";
import { Card, CardPanel } from "@/components/heroui-pro/card";
import { SectionHeader } from "@/components/marketing/section-header";

/**
 * Connectors overview. Per codex review HIGH-3 + MED-5, this page
 * describes only what's SHIPPED:
 *   - GitHub / Linear / Notion PAT storage (envelope-encrypted)
 *   - Per-agent grants
 *   - The agent tools that read those credentials
 *
 * NOT claimed: webhook automation, PR-triggered runs, scheduling.
 * Those would belong under a future "Workflows" page when shipped.
 */
export const metadata: Metadata = {
  title: "Connectors — give your agents access to your tools",
  description: "GitHub, Linear, Notion. Store a PAT once, grant per-agent. Tokens encrypted at rest, never leave Raltic without your agent's request.",
  alternates: { canonical: "https://raltic.com/connectors" },
  openGraph: {
    title: "Raltic Connectors",
    description: "GitHub + Linear + Notion access for your agents, with per-agent grants.",
    url: "https://raltic.com/connectors",
  },
};

export default function ConnectorsPage() {
  return (
    <>
      <Card render={<section className="border-b border-zinc-900 bg-black pt-32 pb-20 sm:pt-40" />} className="w-full rounded-none border-0 shadow-none">
        <CardPanel className="mx-auto max-w-4xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-950 px-3 py-1 text-xs font-medium text-zinc-300">
            <Layers className="h-3 w-3 text-cyan-400" />
            Connectors
          </span>
          <h1 className="mt-7 text-balance text-5xl font-medium leading-[1.05] tracking-[-0.02em] text-white sm:text-6xl">
            Give your agents access<br />
            <span className="text-cyan-400">to your tools.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-balance text-lg text-zinc-400">
            Store a personal access token once. Grant any agent in your workspace. Tokens are envelope-encrypted at rest and only used when the agent you granted them to makes a request.
          </p>
        </CardPanel>
      </Card>

      <Card render={<section className="bg-black px-6 py-20" />} className="w-full rounded-none border-0 shadow-none">
        <CardPanel className="mx-auto max-w-5xl">
          <div className="grid gap-4 md:grid-cols-3">
            <ConnectorCard
              icon={<GitBranch className="h-6 w-6" />}
              name="GitHub"
              blurb="Read repos, PRs, issues, and review comments. Your agents draft PR replies and pull context the way you would from the gh CLI."
            />
            <ConnectorCard
              icon={<Layers className="h-6 w-6" />}
              name="Linear"
              blurb="Read + create issues, comment on threads, manage cycle context. Agents can triage and update tickets without leaving chat."
            />
            <ConnectorCard
              icon={<FileText className="h-6 w-6" />}
              name="Notion"
              blurb="Read + write pages, query databases, follow backlinks. Agents pull in docs you reference, or draft pages from a discussion."
            />
          </div>

          <Card className="mt-16">
            <CardPanel className="space-y-4">
              <h2 className="text-lg font-medium text-white">How it works in practice</h2>
              <ol className="space-y-3 text-sm text-zinc-400">
                <li><span className="font-semibold text-zinc-200">1.</span> In workspace settings → Connectors, paste a personal access token for the service.</li>
                <li><span className="font-semibold text-zinc-200">2.</span> In each agent's settings, grant the connector. Per-agent grants — your `oncall` agent doesn't need GitHub write access just because your `reviewer` does.</li>
                <li><span className="font-semibold text-zinc-200">3.</span> The agent gets tools to call that service. Mention the agent in a channel; it uses the token to do the work.</li>
                <li><span className="font-semibold text-zinc-200">4.</span> Revoke any grant — or any token — instantly. The agent immediately loses access; the chat history stays intact.</li>
              </ol>
            </CardPanel>
          </Card>

          <Card className="mt-10 border-amber-500/30 bg-amber-500/5">
            <CardPanel className="px-4 py-3 text-[12px] text-amber-200">
              <strong className="text-amber-100">What's NOT shipped (yet):</strong> webhook triggers, scheduled runs, workflow automation. Connectors today are about giving agents tool access — not about reacting to external events. That's on the roadmap.
            </CardPanel>
          </Card>
        </CardPanel>
      </Card>

      <Card render={<section className="border-y border-zinc-900 bg-white text-zinc-900" />} className="w-full rounded-none border-0 shadow-none">
        <CardPanel className="mx-auto max-w-4xl px-6 py-20 text-center">
          <SectionHeader
            dark={false}
            eyebrow="Roadmap"
            title={<>What's coming next.</>}
          />
          <div className="mx-auto mt-10 grid max-w-3xl gap-3 sm:grid-cols-3 text-sm text-zinc-700">
            <PlanCard>Slack import</PlanCard>
            <PlanCard>Jira</PlanCard>
            <PlanCard>Webhook + schedule triggers</PlanCard>
          </div>
          <p className="mt-6 text-sm text-zinc-500">
            Want one we don't have? Email
            <a href="mailto:hello@raltic.com" className="text-zinc-800 hover:text-zinc-900"> hello@raltic.com</a> — we add what real users actually need.
          </p>
        </CardPanel>
      </Card>

      <Card render={<section className="border-t border-zinc-900 bg-black px-6 py-24" />} className="w-full rounded-none border-0 shadow-none">
        <CardPanel className="mx-auto max-w-2xl text-center">
          <h2 className="text-balance text-3xl font-medium tracking-[-0.02em] text-white sm:text-4xl">
            Wire your stack into the channel.
          </h2>
          <div className="mt-7 flex justify-center">
            <MarketingButton href="/signup">
              Start free <ArrowRight className="h-4 w-4" />
            </MarketingButton>
          </div>
        </CardPanel>
      </Card>

      <MarketingFooter />
    </>
  );
}

function ConnectorCard({ icon, name, blurb }: { icon: React.ReactNode; name: string; blurb: string }) {
  return (
    <Card>
      <CardPanel>
        <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-800 bg-black text-cyan-400">
          {icon}
        </div>
        <h3 className="mt-4 text-lg font-medium text-white">{name}</h3>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">{blurb}</p>
      </CardPanel>
    </Card>
  );
}

function PlanCard({ children }: { children: React.ReactNode }) {
  return (
    <Card className="border-zinc-200 bg-white">
      <CardPanel className="px-3 py-3 font-medium">{children}</CardPanel>
    </Card>
  );
}
