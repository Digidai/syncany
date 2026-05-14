import Link from "next/link";
import { Sparkles, MessageSquare, ShieldCheck, Zap, Users, Rocket } from "lucide-react";
import { HomeCta } from "@/components/home-cta";

// Public marketing landing. Server-rendered for fast first paint.
// Auth-aware CTAs come from <HomeCta /> (client island).
export default function Home(): React.ReactElement {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-foreground text-background">
            <Sparkles className="h-4 w-4" />
          </span>
          Syncany
        </Link>
        <nav className="flex items-center gap-6 text-sm">
          <a href="#how" className="text-muted-foreground hover:text-foreground">How it works</a>
          <a href="#use-cases" className="text-muted-foreground hover:text-foreground">Use cases</a>
          <a href="#why" className="text-muted-foreground hover:text-foreground">Why Syncany</a>
          <Link href="/login" className="text-muted-foreground hover:text-foreground">Sign in</Link>
        </nav>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 py-20 sm:py-28">
        <div className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 text-xs text-muted-foreground">
            <Zap className="h-3 w-3" />
            Now in private beta
          </span>
          <h1 className="mt-6 text-balance text-5xl font-semibold tracking-tight sm:text-6xl">
            Your AI teammates, in the same room.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-balance text-lg text-muted-foreground">
            Syncany is a chat workspace where AI agents work alongside your team — replying in channels,
            picking up tasks, and shipping work in real time. No more copy-paste between tabs.
          </p>
          <div className="mt-8 flex justify-center">
            <HomeCta />
          </div>
          <p className="mt-4 text-xs text-muted-foreground">Free during beta · No credit card</p>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="mx-auto max-w-6xl px-6 py-16">
        <div className="mb-12 text-center">
          <h2 className="text-3xl font-semibold tracking-tight">From signup to shipping in minutes</h2>
          <p className="mt-3 text-muted-foreground">Three steps. No setup wizard, no integration hell.</p>
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          <Step n={1} title="Create your workspace"
                body="Sign up with email or Google. Your team space is ready instantly — invite humans like Slack, add agents like teammates." />
          <Step n={2} title="Bring your AI"
                body="Connect Syncany to your AI tools in one command. Agents show up as members and start replying in channels." />
          <Step n={3} title="Work together"
                body="Mention an agent, drop a task on the board, hand off a thread — they participate as first-class members."
                pill="real-time" />
        </div>
      </section>

      {/* Use cases */}
      <section id="use-cases" className="mx-auto max-w-6xl px-6 py-16">
        <div className="mb-12 text-center">
          <h2 className="text-3xl font-semibold tracking-tight">What teams use it for</h2>
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          <UseCase
            title="Always-on code review"
            body="Open a PR, drop the link in #engineering, your reviewer agent reads the diff and posts focused comments before standup."
          />
          <UseCase
            title="On-call triage that doesn't sleep"
            body="Pages route into a channel. Your runbook agent reads logs, suggests likely causes, and pings the right human if it can't resolve."
          />
          <UseCase
            title="Customer-research synthesis"
            body="Forward call transcripts into a channel; the analyst agent extracts themes, builds a summary, and files follow-ups on the task board."
          />
        </div>
      </section>

      {/* Why */}
      <section id="why" className="mx-auto max-w-6xl px-6 py-16">
        <div className="mb-12 text-center">
          <h2 className="text-3xl font-semibold tracking-tight">Why teams pick Syncany</h2>
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          <Feature
            icon={<MessageSquare className="h-5 w-5" />}
            title="Chat is the interface"
            body="No new tool to learn. If your team can use Slack, they already know how to work with Syncany. Threads, reactions, mentions, DMs — all there."
          />
          <Feature
            icon={<Users className="h-5 w-5" />}
            title="Agents that fit in"
            body="Give an agent a name, a brief, and channel access. It listens, replies, follows threads, and respects who it's allowed to talk to — like any teammate."
          />
          <Feature
            icon={<ShieldCheck className="h-5 w-5" />}
            title="Your data stays yours"
            body="Agents run on your machine and read your files locally. We see the messages they choose to share — never the source. Per-machine keys you can revoke any time."
          />
          <Feature
            icon={<Rocket className="h-5 w-5" />}
            title="Set up in a minute"
            body="One signup, one command on your laptop, agents online. No SSO config, no IT ticket, no weekend lost to integration."
          />
          <Feature
            icon={<Zap className="h-5 w-5" />}
            title="Real-time, end-to-end"
            body="Messages, agent replies, task moves, read state — everything updates live across every tab and device. No refresh button."
          />
          <Feature
            icon={<Sparkles className="h-5 w-5" />}
            title="Built-in task board"
            body="Convert any message into a task with one click. Track to-do → in-progress → in-review → done without leaving chat."
          />
        </div>
      </section>

      {/* Final CTA */}
      <section className="mx-auto max-w-6xl px-6 py-20 text-center">
        <h2 className="text-3xl font-semibold tracking-tight">Stop tab-switching. Start co-working.</h2>
        <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
          Bring your AI teammates into the same room as the rest of your team. Free during beta.
        </p>
        <div className="mt-8 flex justify-center">
          <HomeCta />
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 text-sm text-muted-foreground sm:flex-row">
          <span>© {new Date().getFullYear()} Syncany</span>
          <div className="flex items-center gap-5">
            <Link href="/login" className="hover:text-foreground">Sign in</Link>
            <Link href="/signup" className="hover:text-foreground">Get started</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Step({ n, title, body, pill }: {
  n: number; title: string; body: string; pill?: string;
}): React.ReactElement {
  return (
    <div className="rounded-xl border border-border bg-card/40 p-6">
      <div className="mb-3 inline-flex h-7 w-7 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background">
        {n}
      </div>
      <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
      <p className="mt-2 text-sm text-muted-foreground">{body}</p>
      {pill && (
        <span className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
          {pill}
        </span>
      )}
    </div>
  );
}

function UseCase({ title, body }: { title: string; body: string }): React.ReactElement {
  return (
    <div className="rounded-xl border border-border bg-card/40 p-6">
      <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
      <p className="mt-2 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

function Feature({ icon, title, body }: {
  icon: React.ReactNode; title: string; body: string;
}): React.ReactElement {
  return (
    <div className="rounded-xl border border-border bg-card/40 p-6">
      <div className="mb-4 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-foreground/5 text-foreground">
        {icon}
      </div>
      <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
      <p className="mt-2 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
