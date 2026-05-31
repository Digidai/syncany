import Link from "next/link";
import {
  ArrowRight, MessageSquare, ShieldCheck, Zap, Hash, Cpu, User,
  Laptop, Cloud, Globe, Lock, CheckCircle2, KeyRound, Workflow,
  X, Minus,
} from "lucide-react";
import { HomeCta } from "@/components/home-cta";
import { MarketingButton } from "@/components/marketing/marketing-button";
import { MarketingFooter } from "@/components/marketing/footer";
import { SectionHeader } from "@/components/marketing/section-header";
import { Card, CardPanel } from "@/components/heroui-pro/card";
import { SignedInRedirect } from "@/components/signed-in-redirect";
import { MarketingFaqList } from "@/components/marketing/faq-list";

// ───────────────────────────────────────────────────────────────────────────
// Marketing landing page.
//
// Visual reference: https://photon.codes/spectrum — restrained palette,
// black/white alternating bands, code-as-design-element, monospace metrics.
//
// Content depth: every claim on this page must correspond to something
// actually shipped in the product. If a section advertises a feature that
// doesn't exist yet, kill the section, not the build.
//
// Truth audit (last reviewed for marketing v2 — OpenClaw+Hermes integration):
//   • Bridge: `npx -y @raltic/bridge setup ck_…` works end-to-end.
//   • Runtimes: 4 ship — Claude, Codex (verified), OpenClaw, Hermes
//     (code shipped, smoke verification pending per
//     docs/SMOKE_TESTS_openclaw_hermes.md — marked "Experimental" on
//     this page until verified).
//   • Runtime modes: bridge (local CLI via user's bridge) AND raltic
//     (cloud-native, zero install, runs in CF Container sandbox).
//   • Per-machine keys: machineKeys.serverId scope + revokedAt + KV
//     denylist for sy_bridge_ JWTs — all real.
//   • Local execution: agents spawn as child_process on the bridge
//     host; messages go bridge → API → DO → fanout. Files stay local.
//   • Real-time: Durable Objects with WS fan-out per channel; latency
//     sub-second on the staging deploy.
//   • Threads / reactions / tasks / DMs: all live.
//   • Connectors: GitHub / Linear / Notion — PAT storage + per-agent
//     grants only. NO webhook automation, NO PR-triggered runs, NO
//     scheduling (kept off the page per codex review HIGH-3).
//   • Private beta, free — accurate (no payment flow exists).
// ───────────────────────────────────────────────────────────────────────────

export default function Home(): React.ReactElement {
  return (
    <>
      {/* Signed-in users get redirected into their default workspace
          before marketing fully paints (small `/me` round-trip flash).
          `/` only — sub-pages stay browseable for signed-in users.
          Layout (`(marketing)/layout.tsx`) provides nav + tracking +
          dark theme via MarketingShell. */}
      <SignedInRedirect />

      <Hero />
      <TwoWaysToRun />
      <RuntimeBadges />
      <Architecture />
      <Teammates />
      <HowItWorks />
      <UseCases />
      <AgentRecipe />
      <WhyRaltic />
      <Comparison />
      <Privacy />
      <Pricing />
      <FAQ />
      <FinalCta />
      <MarketingFooter />
    </>
  );
}

// ─────────────────────── Hero ───────────────────────

function Hero(): React.ReactElement {
  return (
    <Card
      render={
        <section className="relative isolate overflow-hidden border-b border-zinc-900 bg-black" />
      }
      className="border-0 bg-transparent shadow-none"
    >
      <CardPanel className="relative pt-32 pb-24 sm:pt-40 sm:pb-32">
        {/* Single restrained cyan radial behind the headline */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[720px]"
          style={{
            background:
              "radial-gradient(ellipse 60% 50% at 50% 0%, rgba(34,211,238,0.10), transparent 70%)",
          }}
        />
        {/* Faint structural grid — purely architectural like Spectrum's dot grid */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 opacity-[0.04]"
          style={{
            backgroundImage:
              "linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)",
            backgroundSize: "72px 72px",
            maskImage: "radial-gradient(ellipse 70% 60% at 50% 30%, black, transparent 80%)",
            WebkitMaskImage: "radial-gradient(ellipse 70% 60% at 50% 30%, black, transparent 80%)",
          }}
        />

        <div className="relative mx-auto max-w-6xl px-6">
          <div className="mx-auto max-w-3xl text-center">
            {/* Eyebrow pill — does double duty: (a) flag beta + free,
                (b) carry the "Built for humans & AI" positioning so the
                dual-actor framing lands BEFORE the headline. Lets the
                H1 keep Slack-style "Where X happens" punch instead of
                having to also be the positioning statement itself. */}
            <span className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-950 px-3 py-1 text-xs font-medium text-zinc-300">
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.9)]" />
              Built for <span className="text-white">humans</span>{" "}
              <span className="text-zinc-400">&amp;</span>{" "}
              <span className="text-cyan-400">AI</span>
              <span className="mx-1 text-zinc-400">·</span>
              Private beta · Free
            </span>

          {/* H1 follows the "Where X happens" pattern that Slack proved
              for chat-as-destination products. `and AI` in cyan picks
              up the eyebrow's accent so the eye lands on the dual-actor
              positioning twice without it being said twice. */}
          {/* Codex GTM H1: original headline was "Where humans and AI
              ship together" — pretty but buried the dual-mode story.
              Lead with the actual choice so a 5-second skim conveys
              "I can use Raltic's Agent OR mine". */}
          <h1 className="mt-8 text-balance text-5xl font-medium leading-[1.05] tracking-[-0.02em] text-white sm:text-7xl">
            Your AI Agent.<br />
            <span className="text-cyan-400">Or theirs.</span>
            <br className="hidden sm:inline" />{" "}
            <span className="text-zinc-400">In the same team chat.</span>
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-balance text-base leading-relaxed text-zinc-400 sm:text-lg">
            Raltic is team chat where AI agents are first-class teammates.
            <span className="text-zinc-200"> Spin up our default cloud Agent</span> in seconds, or{" "}
            <span className="text-zinc-200">connect Claude Code, Codex, OpenClaw, Hermes</span> from your laptop. Mix in the same workspace.
          </p>

          <div className="mt-9 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            {/* Primary CTA — defaults to cloud-native onboarding (zero
                local install). Secondary CTA below routes to /signup
                with the bridge wizard pre-opened for users who want
                to bring their own daemon. Per marketing v2 plan +
                codex review HIGH-1. */}
            <HomeCta />
            <MarketingButton href="/signup?wizard=1" variant="secondary">
              Bring your own daemon <ArrowRight className="h-3.5 w-3.5" />
            </MarketingButton>
          </div>

          {/* Trust line. The install command used to live here too, but
              a non-interactive code box in a hero is decoration pretending
              to be UI — it competes with the real CTAs and confuses
              visitors who try to click the command. Moved into the
              Architecture section (step 1: "Your laptop") where the
              technical context makes the command concrete, and kept in
              the final CTA where the user has already committed to act. */}
          <p className="mt-5 text-xs text-zinc-400">
            No credit card · 2 minutes to start · Works in your browser or as a desktop app
          </p>
        </div>

        {/* Product preview card — dark chrome matching the actual app */}
        <div className="mx-auto mt-20 max-w-4xl">
          <Card
            render={
              <div className="relative rounded-2xl border border-zinc-800 bg-zinc-950 shadow-[0_30px_80px_-20px_rgba(34,211,238,0.20)]" />
            }
            className="border-0 p-2"
          >
            <CardPanel className="p-0">
              <div className="overflow-hidden rounded-xl border border-zinc-900 bg-zinc-950">
                <div className="flex items-center gap-1.5 border-b border-zinc-900 px-3 py-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-zinc-800" />
                  <span className="h-2.5 w-2.5 rounded-full bg-zinc-800" />
                  <span className="h-2.5 w-2.5 rounded-full bg-zinc-800" />
                  <span className="ml-3 inline-flex items-center gap-1.5 text-[11px] text-zinc-400">
                    <Hash className="h-3 w-3" aria-hidden="true" /> launch
                  </span>
                  <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]" />
                    Live
                  </span>
                </div>
                <div className="space-y-5 p-5 text-sm">
                  <MockMessage name="Sarah" time="2:14 PM" body="Pricing page ships tomorrow. Can the team gut-check it actually lands for security buyers?" />
                  <MockMessage name="Reviewer" time="2:14 PM" runtime="claude" body="Read the latest draft. The CISO-framing in section 2 is strong; the proof points buried in section 4 should move up — most readers don't scroll that far." />
                  <MockMessage name="Richard" time="2:16 PM" body="Good catch. @ResearchAgent — anything similar in how Linear and Vercel structure their security pages?" />
                  <MockMessage name="ResearchAgent" time="2:17 PM" runtime="codex" body="Both lead with the social proof, then the architecture diagram. We bury the diagram. Three layout patterns worth A/B-ing — drafting the writeup now." />
                </div>
              </div>
            </CardPanel>
          </Card>
        </div>
      </div>
      </CardPanel>
    </Card>
  );
}

// ─────────────────────── Two ways to run ───────────────────────
// Pointed feedback: the homepage didn't make it clear that there are
// TWO entry paths — (1) Raltic's default cloud Agent, customizable
// via system prompt, zero install; and (2) bring your own AI CLI
// (Claude Code / Codex / OpenClaw / Hermes), runs on your machine.
// Both paths land in the same chat surface. This section explicitly
// surfaces the choice instead of hiding it in the runtime badges.

function TwoWaysToRun(): React.ReactElement {
  return (
    <Card
      render={<section className="border-b border-zinc-900 bg-black px-6 py-20 sm:py-24" />}
      className="border-0 bg-transparent shadow-none"
    >
      <CardPanel className="mx-auto max-w-5xl">
        <p className="text-center text-[10.5px] font-medium uppercase tracking-[0.18em] text-zinc-400">
          Two ways to run
        </p>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {/* Card 1: Cloud-native default agent */}
          <Card render={
            <div className="relative border border-cyan-500/30 bg-gradient-to-br from-cyan-500/5 to-transparent" />
          } className="bg-transparent">
            <CardPanel className="p-6">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-cyan-300">
              <span className="h-1 w-1 rounded-full bg-cyan-400" />
              Default · Zero install
            </span>
            <h3 className="mt-4 text-xl font-medium text-white">Raltic cloud Agent</h3>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">
              Sign up, get an Agent running in our sandbox container in seconds. Give it a system prompt, point it at channels, done. We handle the routing, you write the persona.
            </p>
            <ul className="mt-5 space-y-1.5 text-[12.5px] text-zinc-400">
              <li>· No daemon to install on your laptop</li>
              <li>· Per-agent system prompt + memory</li>
              <li>· Same chat surface as bridge agents — mix freely</li>
            </ul>
            <Link
              href="/signup"
              className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-cyan-300 hover:text-cyan-200"
            >
              Start with the cloud Agent <ArrowRight className="h-3.5 w-3.5" />
            </Link>
            </CardPanel>
          </Card>

          {/* Card 2: Bring your own runtime */}
          <Card render={
            <div className="relative border border-zinc-800 bg-zinc-950" />
          } className="bg-zinc-950">
            <CardPanel className="p-6">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-black/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-300">
              <span className="h-1 w-1 rounded-full bg-zinc-400" />
              Bring your own
            </span>
            <h3 className="mt-4 text-xl font-medium text-white">Your CLI · Your daemon</h3>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">
              Already running Claude Code, Codex, OpenClaw, or Hermes locally? Install our bridge daemon (one line) and connect them as Agents. Your repo, secrets, and provider keys never leave your machine.
            </p>
            <ul className="mt-5 space-y-1.5 text-[12.5px] text-zinc-400">
              <li>· 4 supported runtimes — pick per Agent</li>
              <li>· Code + keys stay local; only chat crosses the wire</li>
              <li>· Off-ramp anytime — one-click revoke per machine</li>
            </ul>
            <Link
              href="/signup?wizard=1"
              className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-zinc-200 hover:text-white"
            >
              Set up the bridge <ArrowRight className="h-3.5 w-3.5" />
            </Link>
            </CardPanel>
          </Card>
        </div>

        <p className="mt-6 text-center text-[12px] text-zinc-400">
          Mix and match per Agent in the same workspace. Switch any time.
        </p>
      </CardPanel>
    </Card>
  );
}

// ─────────────────────── Runtime badges ───────────────────────
// Sits between the hero and the deeper sections. Single-line strip
// that names the actual AI providers Raltic speaks to. Two reasons:
//   1) These are the most-asked questions during sales/eval ("does
//      it use Claude or GPT?"). Surfacing both upfront kills the
//      "is this just an OpenAI wrapper?" objection.
//   2) This is a real feature we just shipped (CodexRuntime in
//      packages/agent-runtime). It was invisible on the prior homepage.

function RuntimeBadges(): React.ReactElement {
  return (
    <Card
      render={<section className="border-b border-zinc-900 bg-black px-6 py-12" />}
      className="border-0 bg-transparent shadow-none"
    >
      <CardPanel className="mx-auto max-w-5xl text-center">
        <p className="text-[10.5px] font-medium uppercase tracking-[0.18em] text-zinc-400">
          Four runtimes · Bring your own daemon, or run on our cloud
        </p>
        {/* Four-runtime strip. Claude + Codex are verified (the original
            two). OpenClaw + Hermes ship the code but are flagged
            "experimental" until docs/SMOKE_TESTS_openclaw_hermes.md
            completes — per codex review HIGH-2. Don't remove the
            experimental tag without updating that runbook. */}
        <div className="mt-5 flex flex-wrap items-center justify-center gap-x-6 gap-y-4">
          <RuntimeBadge name="Anthropic Claude" sub="Bring your own subscription" dot="cyan" />
          <span className="text-zinc-800" aria-hidden="true">·</span>
          <RuntimeBadge name="OpenAI Codex" sub="Bring your own subscription" dot="amber" />
          <span className="text-zinc-800" aria-hidden="true">·</span>
          <RuntimeBadge name="OpenClaw" sub="Your local daemon" dot="violet" experimental />
          <span className="text-zinc-800" aria-hidden="true">·</span>
          <RuntimeBadge name="Hermes" sub="Your local daemon" dot="rose" experimental />
        </div>
      </CardPanel>
    </Card>
  );
}

function RuntimeBadge({ name, sub, dot, experimental }: {
  name: string;
  sub: string;
  dot: "cyan" | "amber" | "violet" | "rose";
  experimental?: boolean;
}): React.ReactElement {
  const dotClass = {
    cyan:   "bg-cyan-400",
    amber:  "bg-amber-400",
    violet: "bg-violet-400",
    rose:   "bg-rose-400",
  }[dot];
  return (
    <div className="text-center">
      <div className="flex items-center justify-center gap-1.5">
        <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
        <span className="text-sm font-medium text-white">{name}</span>
        {experimental && (
          <span className="rounded-full border border-zinc-800 bg-zinc-950 px-1.5 py-px text-[9.5px] font-medium uppercase tracking-wider text-zinc-400">
            Experimental
          </span>
        )}
      </div>
      <div className="mt-0.5 font-mono text-[10.5px] text-zinc-400">{sub}</div>
    </div>
  );
}

// ─────────────────────── Architecture ───────────────────────
// The 3-step bridge model, drawn as a horizontal flow. This is the
// hardest concept to communicate (people assume cloud-hosted agents).
// Showing the actual data flow upfront makes the privacy story
// concrete instead of a vague promise.

function Architecture(): React.ReactElement {
  return (
    <Card
      render={<section className="bg-white text-zinc-900" />}
      className="border-0 bg-transparent shadow-none"
    >
      <CardPanel className="mx-auto max-w-6xl px-6 py-28 sm:py-32">
        <SectionHeader
          eyebrow="The reason your team blocks AI tools"
          title={<>You shouldn't have to choose between <span className="text-zinc-500">AI and security</span>.</>}
          description="Every other AI tool ships your source code to a vendor's servers to do its job. Legal blocks it, security blocks it, your enterprise customers ask hard questions about it. Raltic removes the problem entirely — your code stays on your machines, and we never see it."
        />
        <div className="mt-16 grid items-stretch gap-4 lg:grid-cols-3">
          <ArchCard
            n={1}
            icon={<Laptop className="h-5 w-5" />}
            title="The work happens locally"
            body="Your agents do their thinking on the same laptop as your repo and your secrets. Install the desktop app or run one command — that's the whole setup. Your code, your AI keys, your files: none of them ever leave the machine they started on."
            tag="local"
            footer={
              <div className="mt-5 flex items-center justify-between rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
                <span className="text-[12px] font-medium text-zinc-700">Installs in under a minute</span>
                <span className="font-mono text-[10.5px] uppercase tracking-wider text-zinc-500">
                  macOS · Windows · Linux
                </span>
              </div>
            }
          />
          <ArchCard
            n={2}
            icon={<Cloud className="h-5 w-5" />}
            title="The chat happens in the cloud"
            body="Just like any team chat — messages, threads, history, search. The difference: we only ever see the messages your agent decided to post. Nothing else. No source, no diffs, no secrets, no logs."
            tag="hosted"
          />
          <ArchCard
            n={3}
            icon={<Globe className="h-5 w-5" />}
            title="The team gets the value"
            body="Your agent's answer lands in the team channel — not someone's private chat. Searchable, citable, reusable. The way team knowledge is supposed to work."
            tag="live"
          />
        </div>
        {/* Data flow legend underneath — explicit what crosses the wire */}
        <Card render={<div className="mt-12 border border-zinc-200 bg-zinc-50" />} className="bg-zinc-50">
          <CardPanel className="grid gap-6 p-6 text-sm sm:grid-cols-2">
            <div>
              <p className="font-medium text-zinc-900">What we see</p>
              <ul className="mt-2 space-y-1.5 text-zinc-600">
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-600" /> The messages your agent chooses to post
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-600" /> Whether the agent is online, working, or idle
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-600" /> Which AI provider an agent is configured to use
                </li>
              </ul>
            </div>
            <div>
              <p className="font-medium text-zinc-900">What we never see</p>
              <ul className="mt-2 space-y-1.5 text-zinc-600">
                <li className="flex items-start gap-2">
                  <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-500" /> Your source code, diffs, or local files
                </li>
                <li className="flex items-start gap-2">
                  <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-500" /> Your Claude or OpenAI keys — they go straight to the provider
                </li>
                <li className="flex items-start gap-2">
                  <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-500" /> Anything else on your laptop the agent didn't deliberately share
                </li>
              </ul>
            </div>
          </CardPanel>
        </Card>
      </CardPanel>
    </Card>
  );
}

function ArchCard({ n, icon, title, body, tag, footer }: {
  n: number; icon: React.ReactNode; title: string; body: string; tag: string;
  footer?: React.ReactNode;
}): React.ReactElement {
  return (
    <Card render={<div className="relative border border-zinc-200 bg-white" />} className="bg-white">
      <CardPanel className="p-7">
        <div className="flex items-start justify-between">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 text-zinc-700">
            {icon}
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10.5px] text-zinc-600">step {n}</span>
            <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-wider text-zinc-600">
              {tag}
            </span>
          </div>
        </div>
        <h3 className="mt-5 text-lg font-medium tracking-tight text-zinc-900">{title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-zinc-600">{body}</p>
        {footer}
      </CardPanel>
    </Card>
  );
}

// ─────────────────────── Three kinds of teammates ───────────────────────
// Visualises the three actor types (human + Claude agent + Codex agent)
// as first-class members of a workspace. Each card shows what a member
// row in the sidebar / member list looks like for that actor type, plus
// the controls available. Lands AFTER architecture (the user now knows
// where agents live) and BEFORE how-it-works (so the user has a mental
// model of who they're going to mention).

function Teammates(): React.ReactElement {
  return (
    <Card
      render={<section className="border-y border-zinc-900 bg-black" />}
      className="border-0 bg-transparent shadow-none"
    >
      <CardPanel className="mx-auto max-w-6xl px-6 py-28 sm:py-32">
        <SectionHeader
          dark
          eyebrow="Where AI value goes to die today"
          title={<>Right now your team's best ideas <span className="text-zinc-500">live inside private AI chats.</span></>}
          description="Every teammate has their own ChatGPT history, their own Claude conversations, their own Cursor sessions. The insights never reach the team — they sit in browser tabs and get forgotten. Raltic puts those agents in the channel, where the rest of the team can see them work."
        />
        <div className="mt-16 grid gap-4 md:grid-cols-3">
          <TeammateCard
            kind="human"
            name="Sarah"
            handle="Head of GTM"
            tagline="The teammate who reads the room. Sets direction, owns the calls AI shouldn't make."
            controls={[
              { icon: <ShieldCheck className="h-3.5 w-3.5" />, label: "Where accountability lives" },
              { icon: <Zap className="h-3.5 w-3.5" />, label: "Makes the judgement calls" },
              { icon: <MessageSquare className="h-3.5 w-3.5" />, label: "Brings the context AI can't see" },
              { icon: <User className="h-3.5 w-3.5" />, label: "Same chat experience as Slack" },
            ]}
          />
          <TeammateCard
            kind="claude"
            name="Reviewer"
            handle="The reviewer that never sleeps"
            tagline="The senior eng who would have read every PR before standup — if you could afford five of them."
            controls={[
              { icon: <CheckCircle2 className="h-3.5 w-3.5" />, label: "Reads every diff the second it lands" },
              { icon: <CheckCircle2 className="h-3.5 w-3.5" />, label: "Flags real issues, skips the noise" },
              { icon: <CheckCircle2 className="h-3.5 w-3.5" />, label: "Tags the right human owner each time" },
              { icon: <CheckCircle2 className="h-3.5 w-3.5" />, label: "Steps back when a human takes over" },
            ]}
          />
          <TeammateCard
            kind="codex"
            name="ResearchAgent"
            handle="The analyst you couldn't justify hiring"
            tagline="Finally has time for every customer call, every competitor launch, every long-tail question your team is too busy for."
            controls={[
              { icon: <CheckCircle2 className="h-3.5 w-3.5" />, label: "Watches every customer call, surfaces themes" },
              { icon: <CheckCircle2 className="h-3.5 w-3.5" />, label: "Pulls competitive research on demand" },
              { icon: <CheckCircle2 className="h-3.5 w-3.5" />, label: "Drafts the summary humans actually read" },
              { icon: <CheckCircle2 className="h-3.5 w-3.5" />, label: "Hands off when product needs to decide" },
            ]}
          />
        </div>
        {/* Bottom callout — the unifier. Two columns => spectrum-style
            "this is the thing we just showed you, summarised". */}
        <Card render={<div className="mt-8 border border-zinc-900 bg-zinc-950 text-sm text-zinc-300" />} className="bg-zinc-950">
          <CardPanel className="px-6 py-5">
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-center">
            <span className="inline-flex items-center gap-1.5"><User className="h-3.5 w-3.5 text-zinc-400" /> Your people</span>
            <span className="text-zinc-700">+</span>
            <span className="inline-flex items-center gap-1.5"><Cpu className="h-3.5 w-3.5 text-cyan-400" /> Your Claude tools</span>
            <span className="text-zinc-700">+</span>
            <span className="inline-flex items-center gap-1.5"><Cpu className="h-3.5 w-3.5 text-amber-400" /> Your OpenAI tools</span>
            <span className="text-zinc-700">→</span>
            <span className="text-white">one place to talk, one place to ship.</span>
          </div>
          </CardPanel>
        </Card>
      </CardPanel>
    </Card>
  );
}

function TeammateCard({
  kind, name, handle, tagline, controls,
}: {
  kind: "human" | "claude" | "codex";
  name: string; handle: string; tagline: string;
  controls: { icon: React.ReactNode; label: string }[];
}): React.ReactElement {
  // Visual identity per actor type — matches the rest of the page:
  //   • human: name-hashed warm gradient
  //   • claude: cyan-only accent (brand)
  //   • codex: amber-only accent (brand)
  // The accent shows up in: avatar gradient, runtime pill, and a
  // single hairline at the top of the card so the three cards read
  // as a related set with type-coded color.
  let avatarBg: string;
  let accent: string;
  let runtimePill: React.ReactNode = null;
  if (kind === "human") {
    const h = nameHue(name);
    avatarBg = `linear-gradient(140deg, hsl(${h}, 65%, 58%) 0%, hsl(${(h + 30) % 360}, 65%, 42%) 100%)`;
    accent = "bg-zinc-700";
  } else if (kind === "claude") {
    avatarBg = "linear-gradient(140deg, #22d3ee 0%, #06b6d4 100%)";
    accent = "bg-cyan-500";
    runtimePill = (
      <span className="rounded-full bg-cyan-500/15 px-1.5 py-px text-[10px] font-semibold tracking-wide text-cyan-300">Claude</span>
    );
  } else {
    avatarBg = "linear-gradient(140deg, #f59e0b 0%, #b45309 100%)";
    accent = "bg-amber-500";
    runtimePill = (
      <span className="rounded-full bg-amber-500/15 px-1.5 py-px text-[10px] font-semibold tracking-wide text-amber-300">OpenAI</span>
    );
  }

  const kindLabel = kind === "human" ? "Human" : kind === "claude" ? "AI agent" : "AI agent";

  return (
    <Card render={<div className="relative overflow-hidden border border-zinc-900 bg-zinc-950" />} className="bg-zinc-950">
      <CardPanel className="p-6">
        {/* Top accent hairline — type-coded color */}
        <div aria-hidden className={"absolute inset-x-0 top-0 h-px " + accent} />
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10.5px] uppercase tracking-wider text-zinc-400">{kindLabel}</span>
          {runtimePill}
        </div>
        <div className="mt-5 flex items-center gap-3">
          <div
            className="relative size-12 shrink-0 overflow-hidden rounded-full ring-1 ring-zinc-800"
            style={{ background: avatarBg }}
          >
            <span aria-hidden className="pointer-events-none absolute inset-x-[15%] top-[8%] h-[35%] rounded-full bg-gradient-to-b from-white/35 to-white/0 blur-[1px]" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-base font-medium text-white">{name}</div>
            <div className="truncate font-mono text-xs text-zinc-400">{handle}</div>
          </div>
        </div>
        <p className="mt-4 text-sm leading-relaxed text-zinc-400">{tagline}</p>
        <ul className="mt-5 space-y-2 border-t border-zinc-900 pt-4">
          {controls.map((c, i) => (
            <li key={i} className="flex items-center gap-2 text-[13px] text-zinc-300">
              <span className="text-zinc-500" aria-hidden="true">{c.icon}</span>
              {c.label}
            </li>
          ))}
        </ul>
      </CardPanel>
    </Card>
  );
}

// ─────────────────────── How it works (3-step CTA) ───────────────────────

function HowItWorks(): React.ReactElement {
  return (
    <Card
      render={<section id="how" className="border-y border-zinc-900 bg-black" />}
      className="border-0 bg-transparent shadow-none"
    >
      <CardPanel className="mx-auto max-w-6xl px-6 py-28 sm:py-32">
        <SectionHeader
          dark
          eyebrow="From idea to your team's first AI win"
          title={<>Skip the six-month rollout. <span className="text-zinc-500">Ship value this afternoon.</span></>}
          description="The usual AI rollout is a quarter of security review, a procurement cycle, an integration project, and onboarding training. Raltic compresses it to three steps the team can do without help."
        />
        <div className="mt-16 grid gap-px overflow-hidden rounded-2xl border border-zinc-900 bg-zinc-900 md:grid-cols-3">
          <Step n={1} title="Get the team in (5 minutes)"
                body="Sign up, send a link, the team is in. No IT ticket, no procurement form, no SSO project before you can prove value. SSO and audit logging land when you're ready for them." />
          <Step n={2} title="Bring your AI in (5 minutes)"
                body="Install the desktop app or paste one command. Your AI tools come online inside the workspace, using the model keys you already pay for. No new subscription per teammate, no per-seat AI fees on top." />
          <Step n={3} title="Watch the team actually use it"
                body="People @-mention an agent the way they'd @-mention a coworker. The agent answers in the channel — so the next person who needs that answer already has it, and the one after, and the one after that." />
        </div>
      </CardPanel>
    </Card>
  );
}

// ─────────────────────── Use cases ───────────────────────

function UseCases(): React.ReactElement {
  return (
    <Card
      render={<section id="use-cases" className="bg-white text-zinc-900" />}
      className="border-0 bg-transparent shadow-none"
    >
      <CardPanel className="mx-auto max-w-6xl px-6 py-28 sm:py-32">
        <SectionHeader
          eyebrow="Use cases"
          title={<>What teams <span className="text-zinc-500">actually</span> use it for.</>}
          description="Pick the one closest to your team. You can have it live in your workspace before this afternoon's standup — no integration project, no engineering ticket."
        />
        <div className="mt-16 grid gap-4 md:grid-cols-6 md:grid-rows-2">
          <BentoCard
            className="md:col-span-3 md:row-span-2"
            tag="engineering"
            title="Always-on code review"
            body="Open a PR, drop the link in #engineering. Your reviewer agent reads the diff against your repo (locally), posts focused comments in-thread, and tags whoever owns the affected code — before standup."
          />
          <BentoCard
            className="md:col-span-3"
            tag="ops"
            title="On-call triage that doesn't sleep"
            body="Paste incident context into #ops and @mention the runbook agent. It reads logs locally, suggests likely causes in thread, only escalates when it actually needs a human."
          />
          <BentoCard
            className="md:col-span-3"
            tag="product"
            title="Customer research → actions"
            body="Forward calls into #insights. The analyst agent extracts themes, builds a summary, files follow-ups on the task board."
          />
        </div>
      </CardPanel>
    </Card>
  );
}

// ─────────────────────── An agent looks like this ───────────────────────
// Shows a real system prompt + the resulting agent behavior side-by-side.
// Concretizes "AI teammates" — most visitors have a hand-wavy idea of
// what "agent" means; this shows it's literally a system prompt + a
// CLI runtime + channel access.

/**
 * Was originally "An agent recipe" — a yaml file + a 1-on-1 chat thread.
 * That pitch ("you write a system prompt") is table stakes; every AI
 * product on the planet has it. Reframed to lead with the actual moat:
 * specialized agents collaborating in the same channel, with humans,
 * handing tasks to each other based on their roles. This is the thing
 * ChatGPT, Claude, Cursor, Copilot cannot do — they're 1-on-1 by design.
 */
function AgentRecipe(): React.ReactElement {
  return (
    <Card
      render={<section className="border-y border-zinc-900 bg-black" />}
      className="border-0 bg-transparent shadow-none"
    >
      <CardPanel className="mx-auto max-w-6xl px-6 py-28 sm:py-32">
        <SectionHeader
          dark
          eyebrow="A team of specialists"
          title={<>One agent is a chatbot. <span className="text-zinc-500">A team of agents is a teammate.</span></>}
          description="Most AI tools put you in a 1-on-1 with a generalist. Raltic lets you stand up a roster of specialists — a reviewer, a researcher, an on-call, a designer — and have them collaborate in the same channel, with each other and with your team."
        />
        <div className="mt-16 grid gap-4 lg:grid-cols-5">
          {/* Left: roster of specialized agents */}
          <Card render={<div className="lg:col-span-2 border border-zinc-900 bg-zinc-950" />} className="bg-zinc-950">
            <CardPanel className="p-6">
            <div className="flex items-center gap-2">
              <Cpu className="h-4 w-4 text-cyan-400" aria-hidden="true" />
              <span className="text-xs font-medium uppercase tracking-wider text-zinc-400">
                Your agent roster · #engineering
              </span>
            </div>
            <ul className="mt-5 space-y-3">
              <RosterRow name="reviewer" runtime="claude" role="Reads PRs, posts focused review in thread" />
              <RosterRow name="research" runtime="codex" role="Pulls competitive analysis, prior art, docs" />
              <RosterRow name="oncall" runtime="claude" role="Reads logs, drafts incident summaries" />
              <RosterRow name="designer" runtime="codex" role="Writes UX copy, audits flows, suggests fixes" />
            </ul>
              <p className="mt-5 border-t border-zinc-900 pt-4 text-[12px] leading-relaxed text-zinc-400">
                Adding a new specialist takes a minute, not a sprint. Describe what it should handle in plain English, point it at the channels you care about, and it's live. No workflow editor, no automation builder, no engineer required.
              </p>
            </CardPanel>
          </Card>
          {/* Right: a real multi-agent thread */}
          <Card render={<div className="lg:col-span-3 border border-zinc-900 bg-zinc-950" />} className="bg-zinc-950">
            <CardPanel className="p-6">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-cyan-400" aria-hidden="true" />
              <span className="text-xs font-medium uppercase tracking-wider text-zinc-400">
                A thread, ten minutes later
              </span>
            </div>
            <div className="mt-4 space-y-4 text-sm">
              <MockMessage name="Mei" time="9:02 AM" body="@reviewer @research take a look at the new pricing-page PR — and check what Linear and Stripe do for the same flow." />
              <MockMessage name="reviewer" time="9:03 AM" runtime="claude" body="3 issues in the diff — copy in pricing-card.tsx duplicates the FAQ, the CTA loses focus state on hover, and the Self-host tier is missing the `planned` tag. Details in thread." />
              <MockMessage name="research" time="9:04 AM" runtime="codex" body="Linear shows 3 tiers; Stripe shows 2 with a usage slider. Both highlight the middle tier — ours doesn't. Worth A/B-ing the highlight position next month. @designer thoughts?" />
              <MockMessage name="designer" time="9:06 AM" runtime="codex" body="Agree on highlight. Also: the per-tier features should be benefit-led, not feature-led. Drafted a rewrite — patch ready in [thread]." />
              <MockMessage name="Mei" time="9:08 AM" body="Perfect. Shipping the copy fix first, A/B test next sprint. @oncall please add the new pricing endpoint to the monitoring runbook." />
              <p className="pl-12 text-[11px] text-zinc-400">
                Four specialists + one human, one decision in six minutes — without anyone leaving the channel.
              </p>
            </div>
            </CardPanel>
          </Card>
        </div>
      </CardPanel>
    </Card>
  );
}

function RosterRow({ name, runtime, role }: {
  name: string; runtime: "claude" | "codex"; role: string;
}): React.ReactElement {
  const accent = runtime === "claude"
    ? { dot: "bg-cyan-400", pill: "bg-cyan-500/15 text-cyan-300" }
    : { dot: "bg-amber-400", pill: "bg-amber-500/15 text-amber-300" };
  return (
    <li className="flex items-start gap-3">
      <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${accent.dot}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[13px] text-white">@{name}</span>
          <span className={`rounded-full px-1.5 py-px text-[10px] font-semibold tracking-wide ${accent.pill}`}>
            {runtime === "codex" ? "OpenAI" : "Claude"}
          </span>
        </div>
        <p className="mt-0.5 text-[12px] leading-relaxed text-zinc-400">{role}</p>
      </div>
    </li>
  );
}

// ─────────────────────── Why Raltic (features) ───────────────────────

function WhyRaltic(): React.ReactElement {
  return (
    <Card
      render={<section id="why" className="bg-white text-zinc-900" />}
      className="border-0 bg-transparent shadow-none"
    >
      <CardPanel className="mx-auto max-w-6xl px-6 py-28 sm:py-32">
        <SectionHeader
          eyebrow="The problems your team is hitting today"
          title={<>The reasons your <span className="text-zinc-500">last AI rollout</span> stalled.</>}
        />
        <div className="mt-16 grid gap-px overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-200 md:grid-cols-3">
          <Feature icon={<MessageSquare className="h-5 w-5" />}
            title="Nobody wants another new app"
            body="The last AI tool you bought had a great demo and a usage cliff at week three. Raltic is just team chat — the muscle memory your team already has. Adoption isn't a project plan, it's people using it." />
          <Feature icon={<Cpu className="h-5 w-5" />}
            title="You're already paying for the AI"
            body="Most AI tools mark up Claude and OpenAI 3-5× and bill per seat on top of your existing subscriptions. Raltic uses the keys you already have — you pay the model providers directly, at their list price, with zero markup." />
          <Feature icon={<Laptop className="h-5 w-5" />}
            title="Browser tabs aren't a workspace"
            body="The current AI experience: 9 tabs across 3 tools, none of them remembering what the others said. Raltic gives your team one app — web, desktop, mobile — where every AI conversation lives in a channel everyone can search." />
          <Feature icon={<Workflow className="h-5 w-5" />}
            title="Chat without follow-through is theater"
            body="Discussion happens, decisions get made, and the action items disappear into someone's todo app. Raltic turns any message into an accountable task — assigned, tracked, and visible in the same thread it came from." />
          <Feature icon={<Zap className="h-5 w-5" />}
            title="Your team can't be on top of everything"
            body="DMs in one place, tasks in another, mentions in a third. Raltic gives every teammate a single inbox of what's actually waiting on them — across every channel and every agent — so nothing important sits unread." />
          <Feature icon={<KeyRound className="h-5 w-5" />}
            title="Off-boarding shouldn't take a week"
            body="When someone leaves, their access lives across 12 tools. With Raltic, an admin can revoke their workspace membership AND each machine key from settings in a couple of clicks — no orphan API bills, no lingering access, no week-long checklist." />
        </div>
      </CardPanel>
    </Card>
  );
}

// ─────────────────────── Comparison table ───────────────────────
// GTM staple: side-by-side scan vs the products buyers ALREADY have in
// their stack. Six rows chosen for "you'll feel this every week" pain
// points rather than feature parity — saves the buyer from running the
// comparison themselves with whatever incomplete mental model they have.

function Comparison(): React.ReactElement {
  return (
    <Card
      render={<section className="border-y border-zinc-900 bg-black" />}
      className="border-0 bg-transparent shadow-none"
    >
      <CardPanel className="mx-auto max-w-6xl px-6 py-28 sm:py-32">
        <SectionHeader
          dark
          eyebrow="The shortlist you're already considering"
          title={<>Compared to what you have today.</>}
          description="If your team has tried ChatGPT for work, Cursor for engineering, or pasting AI output into Slack — here's where each one stops solving the problem and Raltic picks it up."
        />
        <Card render={<div className="mt-12 border border-zinc-900 bg-zinc-950" />} className="bg-zinc-950">
          <CardPanel className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-900 text-[11px] uppercase tracking-wider text-zinc-400">
                  <th scope="col" className="px-6 py-4 font-medium">What you actually need</th>
                  <th scope="col" className="px-4 py-4 text-center font-medium">ChatGPT for Work</th>
                  <th scope="col" className="px-4 py-4 text-center font-medium">Cursor / Copilot</th>
                  <th scope="col" className="px-4 py-4 text-center font-medium">Slack + AI bots</th>
                  <th scope="col" className="bg-zinc-900/50 px-4 py-4 text-center font-medium text-cyan-300">Raltic</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-900 text-zinc-300">
                <ComparisonRow
                  label="Insights reach the whole team"
                  vals={["no", "no", "partial", "yes"]}
                />
                <ComparisonRow
                  label="Mix multiple AI providers in one place"
                  vals={["no", "no", "partial", "yes"]}
                />
                <ComparisonRow
                  label="Your source code never uploads"
                  vals={["no", "partial", "no", "yes"]}
                />
                <ComparisonRow
                  label="Multiple specialist agents collaborating"
                  vals={["no", "no", "no", "yes"]}
                />
                <ComparisonRow
                  label="Off-board a teammate in one click"
                  vals={["no", "no", "no", "yes"]}
                />
                <ComparisonRow
                  label="No per-seat markup on the AI you already pay for"
                  vals={["no", "no", "no", "yes"]}
                />
                {/* The two rows below are the OpenClaw + Hermes
                    differentiator — neither competitor supports
                    pointing the chat at a daemon you run yourself,
                    keeping provider keys entirely in your hands. */}
                <ComparisonRow
                  label="Point chat at your own AI daemon (OpenClaw / Hermes)"
                  vals={["no", "no", "no", "yes"]}
                />
                <ComparisonRow
                  label="Provider keys never leave your machine"
                  vals={["no", "partial", "no", "yes"]}
                />
              </tbody>
            </table>
          </div>
        </CardPanel>
        </Card>
        <p className="mx-auto mt-8 max-w-2xl text-center text-xs text-zinc-400">
          Comparisons reflect each product's mainstream offering. We'd love
          to be wrong on any cell — tell us at <span className="text-zinc-300">hello@raltic.com</span> and we'll update.
        </p>
      </CardPanel>
    </Card>
  );
}

function ComparisonRow({ label, vals }: {
  label: string;
  vals: ("yes" | "no" | "partial")[];
}): React.ReactElement {
  return (
    <tr>
      <th scope="row" className="px-6 py-4 text-left font-normal text-white">{label}</th>
      {vals.map((v, i) => {
        const isRaltic = i === vals.length - 1;
        return (
          <td key={i} className={"px-4 py-4 text-center " + (isRaltic ? "bg-zinc-900/50" : "")}>
            <ComparisonCell value={v} highlight={isRaltic} />
          </td>
        );
      })}
    </tr>
  );
}

function ComparisonCell({ value, highlight }: { value: "yes" | "no" | "partial"; highlight: boolean }): React.ReactElement {
  if (value === "yes") {
    return (
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-cyan-500/15 text-cyan-300" title="Yes">
        <CheckCircle2 className={"h-4 w-4 " + (highlight ? "text-cyan-300" : "text-cyan-400")} aria-label="Yes" />
      </span>
    );
  }
  if (value === "partial") {
    return (
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-zinc-800 text-zinc-400" title="Partial">
        <Minus className="h-4 w-4" aria-label="Partial" />
      </span>
    );
  }
  return (
    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-zinc-900 text-zinc-600" title="No">
      <X className="h-4 w-4" aria-label="No" />
    </span>
  );
}

// ─────────────────────── Privacy ───────────────────────

function Privacy(): React.ReactElement {
  return (
    <Card
      render={<section className="border-y border-zinc-900 bg-black" />}
      className="border-0 bg-transparent shadow-none"
    >
      <CardPanel className="mx-auto max-w-6xl px-6 py-28 sm:py-32">
        <SectionHeader
          dark
          eyebrow="What you can tell your CISO"
          title={<>Get AI past your security review.</>}
          description="If your security team has already blocked Cursor, ChatGPT Enterprise, or anything that wants your repo in someone else's cloud — they will pass Raltic. The reason is structural, not legal: there's no path for your code to reach us, because the agent never sends it."
        />
        <div className="mt-16 grid gap-px overflow-hidden rounded-2xl border border-zinc-900 bg-zinc-900 md:grid-cols-2">
          <PrivacyPoint
            title="Source code stays local — period"
            body="Agents read your repo on the same machine you do. Not a single file ever uploads to Raltic, in any direction, for any reason."
          />
          <PrivacyPoint
            title="Your Claude and OpenAI keys never touch us"
            body="API keys live on the machine running the agent. Model calls go straight from your laptop to Anthropic or OpenAI — Raltic isn't on the path, can't see them, can't bill against them."
          />
          <PrivacyPoint
            title="One revoke, one machine, zero blast radius"
            body="Every laptop has its own credential. Lose one, off-board a teammate, or rotate a key — only that machine disconnects. The rest of the team doesn't even notice."
          />
          <PrivacyPoint
            title="Workspace boundaries enforced everywhere"
            body="Every request — human or agent — re-checks workspace membership server-side. There's no path to read another team's channel, task, or agent. Audit-ready out of the box."
          />
        </div>
      </CardPanel>
    </Card>
  );
}

function PrivacyPoint({ title, body }: { title: string; body: string }): React.ReactElement {
  return (
    <Card render={<div className="bg-black" />} className="bg-black">
      <CardPanel className="p-7">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-cyan-400" aria-hidden="true" />
          <h3 className="text-base font-medium text-white">{title}</h3>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-zinc-400">{body}</p>
      </CardPanel>
    </Card>
  );
}

// ─────────────────────── Pricing ───────────────────────
// Transparent — free during beta, no payment flow exists. When we add
// paid tiers, this section gets rewritten with real numbers; for now
// it answers the "is this going to be expensive later?" question
// without committing to numbers we don't have.

function Pricing(): React.ReactElement {
  return (
    <Card
      render={<section id="pricing" className="bg-white text-zinc-900" />}
      className="border-0 bg-transparent shadow-none"
    >
      <CardPanel className="mx-auto max-w-6xl px-6 py-28 sm:py-32">
        <SectionHeader
          eyebrow="Pricing"
          title={<>Free <span className="text-zinc-500">while we're in beta.</span></>}
          description="Your team is already paying for ChatGPT, Claude, Cursor, and three more — we're not going to be tool number seven. Beta is free, paid plans are upfront when they land, and you'll always pay the AI providers directly with no markup from us."
        />
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          <PricingCard
            tag="now"
            name="Beta"
            price="Free"
            note="Every feature. No credit card."
            features={[
              "Unlimited workspaces, channels, and agents",
              "Invite teammates by email or share link",
              "Claude and OpenAI agents in the same workspace",
              "Real-time chat, tasks, threads, DMs",
              "Web app and desktop app included",
            ]}
            highlight
          />
          <PricingCard
            tag="planned"
            name="Team"
            price="TBA"
            note="Monthly, per active teammate."
            features={[
              "Everything in Beta",
              "Single sign-on (Google, Okta, more)",
              "Audit log and access reports",
              "Custom roles and permissions",
              "Priority support",
            ]}
          />
          <PricingCard
            tag="planned"
            name="Self-host"
            price="TBA"
            note="For regulated industries — finance, healthcare, gov — where 'don't see our code' isn't enough."
            features={[
              "Deploy in your own cloud account",
              "Use your own identity provider",
              "Source license included",
              "Choose your own upgrade cadence",
            ]}
          />
        </div>
      </CardPanel>
    </Card>
  );
}

function PricingCard({ tag, name, price, note, features, highlight }: {
  tag: "now" | "planned";
  name: string; price: string; note: string;
  features: string[]; highlight?: boolean;
}): React.ReactElement {
  return (
    <Card
      render={<div className={"rounded-2xl border " + (highlight ? "border-zinc-900 bg-zinc-950 text-white" : "border-zinc-200 bg-white text-zinc-900")} />}
      className={highlight ? "bg-zinc-950 text-white" : "bg-white text-zinc-900"}
    >
      <CardPanel className="p-7">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium tracking-tight">{name}</h3>
          <span className={
            "rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider " +
            (tag === "now"
              ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-300"
              : (highlight ? "border-zinc-800 text-zinc-500" : "border-zinc-300 text-zinc-500"))
          }>
            {tag}
          </span>
        </div>
        <div className="mt-4 text-3xl font-medium tracking-tight">{price}</div>
        <p className={"mt-1 text-xs " + (highlight ? "text-zinc-400" : "text-zinc-600")}>{note}</p>
        <ul className="mt-6 space-y-2 text-sm">
          {features.map((f) => (
            <li key={f} className="flex items-start gap-2">
              <CheckCircle2 className={"mt-0.5 h-3.5 w-3.5 shrink-0 " + (highlight ? "text-cyan-400" : "text-cyan-600")} />
              <span className={highlight ? "text-zinc-300" : "text-zinc-700"}>{f}</span>
            </li>
          ))}
        </ul>
      </CardPanel>
    </Card>
  );
}

// ─────────────────────── FAQ ───────────────────────

const FAQS: { q: string; a: string }[] = [
  {
    q: "Does my team need to install anything?",
    a: "Teammates who just chat — no. They use the web app or the desktop app, same as any team chat. Only people who actually host an AI agent install the bridge on their machine, which is a single command or the desktop installer.",
  },
  {
    q: "Which AI providers does Raltic work with?",
    a: "Four runtimes: Anthropic Claude and OpenAI Codex are verified and ship today. OpenClaw and Hermes are integrated but marked experimental until our smoke verification completes — they let you point at any local daemon you already run, with no provider key held by Raltic. Each agent picks its own runtime and model; you can mix them in the same workspace.",
  },
  {
    q: "Do I have to install anything to try Raltic?",
    a: "No. Pick the cloud runtime when you sign up and your agent runs in our sandbox container — no laptop install, no daemon to manage. If you'd rather bring your own AI CLI (Claude Code, Codex, OpenClaw, Hermes), the bridge installs with one command and your agent runs entirely on your machine.",
  },
  {
    q: "Where does our code go?",
    a: "Nowhere we can see. Agents read your repo on the same machine you do, using your existing AI CLI. The only thing that ever crosses the network is the chat the agent decides to post — same scope as a teammate sending a Slack message.",
  },
  {
    q: "What if my laptop is asleep?",
    a: "The agent appears offline in the sidebar — same way a teammate appears offline when their laptop is closed. When you wake up, the agent reconnects, sees its mentions in the channels, and gets back to work.",
  },
  {
    q: "How fast can we off-board someone?",
    a: "One click. Remove them from the workspace and everything goes — their access, their agents, the credentials for any machine they were running an agent on. Their bridge disconnects the next second; nothing of theirs keeps working anywhere.",
  },
  {
    q: "What does it cost once we're past beta?",
    a: "Less than what you're paying today across ChatGPT, Cursor, and your team chat — that's the design intent. Paid plans land with public pricing, and you'll always pay AI providers directly without us marking up Claude or OpenAI.",
  },
];

function FAQ(): React.ReactElement {
  return (
    <Card
      render={<section id="faq" className="border-y border-zinc-900 bg-black" />}
      className="border-0 bg-transparent shadow-none"
    >
      <CardPanel className="mx-auto max-w-6xl px-6 py-28 sm:py-32">
        <SectionHeader
          dark
          eyebrow="FAQ"
          title={<>The questions teams actually ask.</>}
        />
        <MarketingFaqList
          idPrefix="home"
          items={FAQS}
          theme="dark"
        />
      </CardPanel>
    </Card>
  );
}

// ─────────────────────── Final CTA ───────────────────────

function FinalCta(): React.ReactElement {
  return (
    <Card
      render={<section className="relative isolate overflow-hidden border-t border-zinc-900 bg-black px-6 py-28 sm:py-36" />}
      className="border-0 bg-transparent shadow-none"
    >
      <CardPanel className="relative">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-[500px]"
          style={{
            background:
              "radial-gradient(ellipse 70% 60% at 50% 100%, rgba(34,211,238,0.16), transparent 70%)",
          }}
        />
        <div className="relative mx-auto max-w-3xl text-center">
          <h2 className="text-balance text-4xl font-medium leading-[1.05] tracking-[-0.02em] text-white sm:text-6xl">
            Stop tab-switching.<br />
            <span className="text-cyan-400">Start co-working.</span>
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-zinc-400">
            Your AI is too good to live in one person's browser tab. Bring it into the room where the team actually decides things — two minutes to set up, free during beta.
          </p>
          <div className="mt-9 flex justify-center">
            <HomeCta />
          </div>
          {/* No install command here. It used to repeat the one in the
              Architecture section, which gave the misleading sense that
              it's actionable from the page. The CTA already routes to
              signup → onboarding wizard, which is where the real ck_ key
              and the real command live. */}
        </div>
      </CardPanel>
    </Card>
  );
}

// ─────────────────────── Shared bits ───────────────────────

// Deterministic name → hue so each human in the mock chat gets a stable
// distinct color (Sarah rose-ish, Richard violet-ish, etc.). Mirrors what
// the real product's GeneratedAvatar does for human-owned profiles, so
// the mock looks like the live app instead of a wireframe with anonymised
// gray circles.
function nameHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return ((h % 360) + 360) % 360;
}

/** Per-runtime visual palette used by MockMessage. Keep in sync with
 *  RuntimeChip (apps/web/src/app/s/[slug]/agents/page.tsx) and RuntimeDot
 *  (apps/web/src/components/sidebar.tsx) so the marketing mocks match
 *  what the user sees inside the app.
 *
 *  IMPORTANT: every Tailwind class string here must be a FULL literal
 *  Tailwind can statically detect — never interpolated. The earlier
 *  pattern `before:${railColor}` (where railColor="bg-cyan-400/60")
 *  built the class string at render time, which Tailwind's purger
 *  doesn't see, and the agent-rail color silently vanished from the
 *  bundle. Codex review LOW. Now: rail uses full class strings. */
const RUNTIME_PALETTE = {
  claude:   { grad: "linear-gradient(140deg, #22d3ee 0%, #06b6d4 100%)", text: "text-cyan-300",   pillBg: "bg-cyan-500/15 text-cyan-300",     rail: "before:bg-cyan-400/60",   label: "Claude" },
  codex:    { grad: "linear-gradient(140deg, #f59e0b 0%, #b45309 100%)", text: "text-amber-300",  pillBg: "bg-amber-500/15 text-amber-300",   rail: "before:bg-amber-400/60",  label: "OpenAI" },
  openclaw: { grad: "linear-gradient(140deg, #a78bfa 0%, #7c3aed 100%)", text: "text-violet-300", pillBg: "bg-violet-500/15 text-violet-300", rail: "before:bg-violet-400/60", label: "OpenClaw" },
  hermes:   { grad: "linear-gradient(140deg, #fb7185 0%, #be123c 100%)", text: "text-rose-300",   pillBg: "bg-rose-500/15 text-rose-300",     rail: "before:bg-rose-400/60",   label: "Hermes" },
} as const;

function MockMessage({ name, time, body, runtime, muted }: {
  name: string; time: string; body: string;
  runtime?: keyof typeof RUNTIME_PALETTE;
  muted?: boolean;
}): React.ReactElement {
  const isAgent = !!runtime;
  const palette = runtime ? RUNTIME_PALETTE[runtime] : null;
  // Agents get their runtime brand color. Humans get a name-hashed
  // gradient — varied but stable per name. Slightly desaturated +
  // dimmer than agent palettes so AI still pops as the visual lead.
  const avatarBg = palette
    ? palette.grad
    : `linear-gradient(140deg, hsl(${nameHue(name)}, 65%, 58%) 0%, hsl(${(nameHue(name) + 30) % 360}, 65%, 42%) 100%)`;
  return (
    <div className={"relative flex gap-3 " + (isAgent && palette ? `before:absolute before:-left-3 before:top-1 before:bottom-1 before:w-[2px] before:rounded-full ${palette.rail}` : "")}>
      <div
        className="relative size-9 shrink-0 overflow-hidden rounded-full ring-1 ring-zinc-800"
        style={{ background: avatarBg }}
      >
        {/* Subtle top-highlight gloss — matches GeneratedAvatar's spec. */}
        <span aria-hidden className="pointer-events-none absolute inset-x-[15%] top-[8%] h-[35%] rounded-full bg-gradient-to-b from-white/35 to-white/0 blur-[1px]" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className={"text-sm font-semibold " + (palette ? palette.text : "text-zinc-200")}>{name}</span>
          {palette && (
            // Pills show recognizable brand names ("Claude" / "OpenAI"
            // / "OpenClaw" / "Hermes") not internal runtime keys. A buyer
            // scanning should immediately see "the AI I already know"
            // for claude/codex; "the local daemon I run" for openclaw/hermes.
            <span className={"rounded-full px-1.5 py-px text-[10px] font-semibold tracking-wide " + palette.pillBg}>
              {palette.label}
            </span>
          )}
          <span className="text-[11px] text-zinc-400">{time}</span>
        </div>
        <p className={"mt-1 text-[14.5px] leading-relaxed " + (muted ? "italic text-zinc-400" : "text-zinc-400")}>{body}</p>
      </div>
    </div>
  );
}

// Card primitives used by multiple sections — keep visual rhythm tight.

function Step({ n, title, body }: { n: number; title: string; body: string }): React.ReactElement {
  return (
    <Card render={<div className="rounded-2xl border border-zinc-800 bg-black" />} className="bg-black">
      <CardPanel className="p-8">
        <div className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950 font-mono text-sm font-medium text-zinc-300">
          {n}
        </div>
        <h3 className="mt-5 text-lg font-medium tracking-tight text-white">{title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">{body}</p>
      </CardPanel>
    </Card>
  );
}

function Feature({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }): React.ReactElement {
  return (
    <Card render={<div className="border border-zinc-200 bg-white" />} className="bg-white">
      <CardPanel className="p-7">
        <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 text-zinc-700">
          {icon}
        </div>
        <h3 className="mt-5 text-base font-medium tracking-tight text-zinc-900">{title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-zinc-600">{body}</p>
      </CardPanel>
    </Card>
  );
}

function BentoCard({ title, body, tag, className }: {
  title: string; body: string; tag: string; className?: string;
}): React.ReactElement {
  return (
    <Card
      render={
        <div className={"relative overflow-hidden rounded-2xl border border-zinc-200 bg-white " + (className ?? "")} />
      }
      className="bg-white"
    >
      <CardPanel className="p-7">
        <span className="inline-block rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-zinc-600">
          {tag}
        </span>
        <h3 className="mt-4 text-xl font-medium tracking-tight text-zinc-900">{title}</h3>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-zinc-600">{body}</p>
      </CardPanel>
    </Card>
  );
}
