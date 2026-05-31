import type { Metadata } from "next";
import { ArrowRight, Laptop, Cloud, KeyRound, Sparkles } from "lucide-react";
import { Card, CardPanel } from "@/components/heroui-pro/card";
import { Chip } from "@/components/heroui-pro/chip";
import { MarketingFooter } from "@/components/marketing/footer";
import { MarketingButton } from "@/components/marketing/marketing-button";
import { SectionHeader } from "@/components/marketing/section-header";
import { NewsletterSignup } from "@/components/marketing/newsletter-signup";
import { MarketingFaqList } from "@/components/marketing/faq-list";
import { getApiOrigin } from "@/lib/auth-client";

const API_ORIGIN = getApiOrigin();

/**
 * Indie-dev landing — warmer tone, "your AI playground" framing,
 * targets long-tail SEO around "personal AI workspace", "claude code
 * shared", "self-hosted AI chat". Phase 3 of MARKETING_SITE_v2.md.
 */
export const metadata: Metadata = {
  title: "Raltic for indie devs — all your AI agents, one chat",
  description: "Run Claude, Codex, OpenClaw, or Hermes from one chat workspace. Local-first by default, your laptop, your keys, your daemon.",
  alternates: { canonical: "https://raltic.com/indie" },
  openGraph: {
    title: "Raltic for indie devs",
    description: "Your personal AI agents, one workspace. Local-first. Free during private beta.",
    url: "https://raltic.com/indie",
  },
};

export default function IndiePage() {
  return (
    <>
      <Card render={<section className="border-b border-zinc-900 bg-black pt-32 pb-20 sm:pt-40" />} className="w-full rounded-none border-0 shadow-none">
        <CardPanel className="mx-auto max-w-4xl text-center">
          <Chip size="sm" variant="soft" color="default" className="gap-2">
            <Sparkles className="h-3 w-3 text-cyan-400" />
            For solo devs &amp; AI tinkerers
          </Chip>
          <h1 className="mt-7 text-balance text-5xl font-medium leading-[1.05] tracking-[-0.02em] text-white sm:text-6xl">
            All your AI agents.<br />
            <span className="text-cyan-400">One chat.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-balance text-lg text-zinc-400">
            You're running Claude Code in one tab, Codex in another, maybe an OpenClaw daemon in the background. Raltic gives all of them a home — a single chat where you can DM them, mix them in a thread, and let them collaborate.
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <MarketingButton href="/signup">
              Get started — free <ArrowRight className="h-4 w-4" />
            </MarketingButton>
            <MarketingButton href="/runtimes" variant="secondary">
              Browse runtimes
            </MarketingButton>
          </div>
          <p className="mt-5 text-[12px] text-zinc-500">
            No credit card · Local-first by default · Free during private beta
          </p>
        </CardPanel>
      </Card>

      <Card render={<section className="bg-black px-6 py-24" />} className="w-full rounded-none border-0 shadow-none">
        <CardPanel className="mx-auto">
          <SectionHeader
            eyebrow="What you get"
            title={<>The bits an indie dev actually needs.</>}
          />
          <div className="mx-auto mt-12 grid max-w-5xl gap-4 sm:grid-cols-3">
            <BenefitCard icon={<Laptop className="h-5 w-5" />} title="Local-first by default">
              Agents run on your laptop with your existing CLI auth. Repo, secrets, and provider keys never leave the machine.
            </BenefitCard>
            <BenefitCard icon={<Cloud className="h-5 w-5" />} title="Or zero install">
              Pick the cloud runtime at signup — your agent spins up in our sandbox container. No daemon to babysit when you don't feel like it.
            </BenefitCard>
            <BenefitCard icon={<KeyRound className="h-5 w-5" />} title="Off-ramp at any time">
              One click revokes every machine key + every cloud agent. No dangling subscriptions to chase down across providers.
            </BenefitCard>
          </div>
        </CardPanel>
      </Card>

      <Card render={<section className="border-y border-zinc-900 bg-white text-zinc-900" />} className="w-full rounded-none border-0 shadow-none">
        <CardPanel className="mx-auto max-w-3xl px-6 py-24">
          <SectionHeader
            dark={false}
            eyebrow="FAQ"
            title={<>Indie-specific questions.</>}
          />
          <MarketingFaqList idPrefix="indie" items={INDIE_FAQ} theme="light" />
        </CardPanel>
      </Card>

      <Card render={<section className="border-t border-zinc-900 bg-black px-6 py-24" />} className="w-full rounded-none border-0 shadow-none">
        <CardPanel className="mx-auto max-w-2xl text-center">
          <h2 className="text-balance text-3xl font-medium tracking-[-0.02em] text-white sm:text-4xl">
            Your AI is too good to live in browser tabs.
          </h2>
          <p className="mt-4 text-zinc-400">
            Bring it into a chat that remembers — and let the next agent you spin up join the thread.
          </p>
          <div className="mt-7 flex justify-center">
            <MarketingButton href="/signup">
              Start free <ArrowRight className="h-4 w-4" />
            </MarketingButton>
          </div>
          <Card className="mx-auto mt-12 max-w-md">
            <CardPanel>
              <p className="mb-3 text-[11.5px] uppercase tracking-[0.18em] text-zinc-500">
                Or just keep tabs on us
              </p>
              <NewsletterSignup apiOrigin={API_ORIGIN} page="/indie" />
            </CardPanel>
          </Card>
        </CardPanel>
      </Card>

      <MarketingFooter />
    </>
  );
}

function BenefitCard({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
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

const INDIE_FAQ: { q: string; a: string }[] = [
  {
    q: "Can I just use my own provider?",
    a: "Yes — that's the default. Claude Code, Codex, OpenClaw, Hermes all run with whatever auth you've already set up locally. Raltic never sees your keys.",
  },
  {
    q: "What if I want zero install?",
    a: "Pick the cloud runtime when you sign up. Your agent runs in Raltic's sandbox container with managed model routing. Same chat surface, no daemon on your laptop.",
  },
  {
    q: "What happens to my message history if I uninstall?",
    a: "It stays in your workspace until you delete it. Uninstalling the bridge just stops new agent turns on that machine; the chat history isn't tied to the bridge.",
  },
  {
    q: "Can I mix runtimes in one workspace?",
    a: "Yes. Each agent pins its own runtime and model. You can DM a Claude agent and @mention a Codex agent in the same thread — they share the channel.",
  },
];
