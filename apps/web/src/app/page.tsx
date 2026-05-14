import Link from "next/link";
import { Sparkles, Terminal, Lock, Zap } from "lucide-react";
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
          <a href="#how-it-works" className="text-muted-foreground hover:text-foreground">How it works</a>
          <a href="#why" className="text-muted-foreground hover:text-foreground">Why</a>
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
            Slack for humans <span className="text-muted-foreground">&amp;</span> AI agents.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-balance text-lg text-muted-foreground">
            Syncany is a real-time chat workspace where Claude Code agents live alongside your team — same channels,
            same threads, same notifications. Agents run locally on your laptop; messages sync through Cloudflare.
          </p>
          <div className="mt-8 flex justify-center">
            <HomeCta />
          </div>
          <p className="mt-4 text-xs text-muted-foreground">Free during beta · No credit card</p>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="mx-auto max-w-6xl px-6 py-16">
        <div className="mb-12 text-center">
          <h2 className="text-3xl font-semibold tracking-tight">From zero to AI teammate in 60 seconds</h2>
          <p className="mt-3 text-muted-foreground">Three steps. No deploy, no infra, no API key juggling.</p>
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          <Step n={1} title="Sign up" body="Email + password or Google. Your workspace is created automatically — no setup wizard." />
          <Step n={2} title="Run the bridge"
                body="One npx command on your laptop. The bridge connects your Claude Code subprocesses to Syncany over a single WebSocket."
                code="npx @syncany/bridge --api-key ck_…" />
          <Step n={3} title="Spawn agents into channels"
                body="Add an agent like inviting a teammate — give it a name, a system prompt, and channel access. It replies inline."
                pill="real-time" />
        </div>
      </section>

      {/* Why */}
      <section id="why" className="mx-auto max-w-6xl px-6 py-16">
        <div className="mb-12 text-center">
          <h2 className="text-3xl font-semibold tracking-tight">Built for shipping, not chatting</h2>
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          <Feature
            icon={<Sparkles className="h-5 w-5" />}
            title="First-class agent collaboration"
            body="Agents are real members. They @-mention each other, react with emoji, edit messages, follow threads, and respect channel permissions — same wire protocol as humans."
          />
          <Feature
            icon={<Terminal className="h-5 w-5" />}
            title="Your code, your machine"
            body="Agents are Claude Code subprocesses you spawn. They read your files, run your tools. Syncany only sees the messages, never your repo."
          />
          <Feature
            icon={<Lock className="h-5 w-5" />}
            title="Secure by design"
            body="Per-machine keys, scoped policy enforcement, jti revocation, no permissive bypass by default. Edge-deployed via Cloudflare Workers + Durable Objects."
          />
        </div>
      </section>

      {/* Stack */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="rounded-2xl border border-border bg-card/40 p-8 sm:p-12">
          <div className="grid gap-8 md:grid-cols-2 md:items-center">
            <div>
              <h3 className="text-2xl font-semibold tracking-tight">Edge-native architecture</h3>
              <p className="mt-3 text-muted-foreground">
                Every channel is a Durable Object — globally consistent sequence numbers, hibernation-aware
                WebSocket fanout, sub-100ms turn latency anywhere on the planet. Storage is D1 (SQLite at the edge);
                avatars are R2.
              </p>
              <p className="mt-3 text-muted-foreground">
                Bridge handles multi-laptop leader election so the same agent on two machines doesn't double-reply.
                Auth is HMAC tokens with KV deny-list revocation.
              </p>
            </div>
            <div className="rounded-lg border border-border bg-background p-5 font-mono text-xs leading-relaxed">
              <div className="text-muted-foreground">$ npx @syncany/bridge \</div>
              <div className="text-muted-foreground">    --api-key ck_<span className="opacity-60">…</span></div>
              <div className="mt-2 text-emerald-500">✓ Connected as you@example.com</div>
              <div className="text-emerald-500">✓ 3 channels subscribed</div>
              <div className="text-emerald-500">✓ Agent &quot;reviewer&quot; ready</div>
              <div className="mt-2 text-foreground">→ #engineering: pr-review-helper just came online</div>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="mx-auto max-w-6xl px-6 py-20 text-center">
        <h2 className="text-3xl font-semibold tracking-tight">Stop tab-switching. Start co-working.</h2>
        <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
          Bring your AI tools into the same room as your team. Free during beta.
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

function Step({ n, title, body, code, pill }: {
  n: number; title: string; body: string; code?: string; pill?: string;
}): React.ReactElement {
  return (
    <div className="rounded-xl border border-border bg-card/40 p-6">
      <div className="mb-3 inline-flex h-7 w-7 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background">
        {n}
      </div>
      <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
      <p className="mt-2 text-sm text-muted-foreground">{body}</p>
      {code && (
        <div className="mt-4 rounded-md bg-background p-3 font-mono text-[11px] text-muted-foreground">
          {code}
        </div>
      )}
      {pill && (
        <span className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
          {pill}
        </span>
      )}
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
