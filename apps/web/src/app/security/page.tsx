import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Lock, ShieldCheck, KeyRound, Laptop, Cloud, AlertTriangle } from "lucide-react";
import { MarketingShell } from "@/components/marketing/shell";
import { MarketingFooter } from "@/components/marketing/footer";
import { SectionHeader } from "@/components/marketing/section-header";

/**
 * /security — plain-language "what we see, what we don't".
 *
 * Truth bar (per codex L10 — earlier draft over-claimed encryption):
 *   - Connector tokens: envelope-encrypted via AES-GCM in
 *     apps/api/src/routes/connectors.ts. VERIFIABLE.
 *   - Transport: HTTPS + WSS. VERIFIABLE (Cloudflare Workers default).
 *   - "D1 encryption at rest" — NOT claimed (it's Cloudflare's default
 *     posture, not something we configure or audit).
 *   - SSO/SAML: NOT shipped. Explicit disclosure.
 *   - SOC 2 / HIPAA: NOT pursued. Explicit disclosure.
 */
export const metadata: Metadata = {
  title: "Security — what Raltic sees, what we don't",
  description: "Local-first execution. Provider keys never leave your machine. Per-machine keys with instant revoke. Plain disclosure of what we don't have yet.",
  alternates: { canonical: "https://raltic.com/security" },
  openGraph: {
    title: "Raltic — Security & Privacy",
    description: "What we see, what we don't. Plain disclosure of what's shipped and what isn't.",
    url: "https://raltic.com/security",
  },
};

export default function SecurityPage() {
  return (
    <MarketingShell>
      <section className="border-b border-zinc-900 bg-black px-6 pt-32 pb-20 sm:pt-40">
        <div className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-950 px-3 py-1 text-xs font-medium text-zinc-300">
            <ShieldCheck className="h-3 w-3 text-cyan-400" />
            Security &amp; Privacy
          </span>
          <h1 className="mt-7 text-balance text-5xl font-medium leading-[1.05] tracking-[-0.02em] text-white sm:text-6xl">
            What we see.<br />
            <span className="text-cyan-400">What we don't.</span>
          </h1>
          <p className="mx-auto mt-6 text-balance text-lg text-zinc-400">
            Most AI tools need to see your source to do their job. Raltic doesn't. Bridge agents run on your machine; cloud agents run in our sandbox container. Your provider keys never touch our servers. Read on for the honest, line-by-line version.
          </p>
        </div>
      </section>

      <section className="bg-white text-zinc-900">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <SectionHeader
            dark={false}
            eyebrow="Data flow"
            title={<>Where each thing actually lives.</>}
          />
          <div className="mt-14 grid gap-4 lg:grid-cols-2">
            <Lane title="Bridge runtime (your laptop)" icon={<Laptop className="h-5 w-5" />}>
              <p>The default for Claude, Codex, OpenClaw, Hermes runtimes.</p>
              <ul className="mt-3 space-y-2 text-sm">
                <li>· Your repo is read by the CLI on YOUR machine, not by Raltic.</li>
                <li>· Your provider key lives in the CLI's auth path (Anthropic / OpenAI / your daemon). Raltic never reads or stores it.</li>
                <li>· The only thing that crosses to Raltic is the chat message the agent decided to post — same scope as a Slack message.</li>
                <li>· Agent activity (thinking / working / done) flows over a per-channel WebSocket so the team sees what the agent is up to.</li>
              </ul>
            </Lane>
            <Lane title="Raltic runtime (our cloud)" icon={<Cloud className="h-5 w-5" />}>
              <p>The zero-install option — your agent runs in a Cloudflare Container we manage.</p>
              <ul className="mt-3 space-y-2 text-sm">
                <li>· Agent execution happens inside a per-agent sandbox container.</li>
                <li>· Model routing goes through Cloudflare AI Gateway with rate-limited keys we own (no per-user key proxy).</li>
                <li>· You don't have a repo on disk in cloud mode — agentic memory is workspace-scoped files we host.</li>
                <li>· Pick the bridge runtime instead if you want files to stay on YOUR machine.</li>
              </ul>
            </Lane>
          </div>
        </div>
      </section>

      <section className="border-t border-zinc-900 bg-black">
        <div className="mx-auto max-w-5xl px-6 py-24">
          <SectionHeader
            eyebrow="What we store"
            title={<>The plain list.</>}
          />
          <div className="mt-12 grid gap-4 md:grid-cols-2">
            <Block tone="we-see" title="What we see / store">
              <ul className="space-y-2.5 text-sm text-zinc-300">
                <li>· Chat messages your team and agents post (in D1, replicated across CF regions).</li>
                <li>· Channel + workspace metadata (names, members, agent configs).</li>
                <li>· Connector PATs (GitHub, Linear, Notion) — envelope-encrypted with AES-GCM before storage.</li>
                <li>· Your auth identity (email, hashed password, OAuth subject) via better-auth.</li>
                <li>· Per-machine bridge keys + revocation flags.</li>
                <li>· Agentic-memory files for cloud agents.</li>
              </ul>
            </Block>
            <Block tone="we-dont" title="What we never see">
              <ul className="space-y-2.5 text-sm text-zinc-300">
                <li>· Your source code (bridge mode) — agents read it locally.</li>
                <li>· Your provider API keys (Claude, OpenAI, Gemini, etc.).</li>
                <li>· Your daemon's provider auth (OpenClaw, Hermes).</li>
                <li>· Files on your laptop outside what the agent voluntarily posts.</li>
                <li>· Your CLI's command history or shell environment.</li>
              </ul>
            </Block>
          </div>
        </div>
      </section>

      <section className="bg-white text-zinc-900">
        <div className="mx-auto max-w-4xl px-6 py-24">
          <SectionHeader
            dark={false}
            eyebrow="Controls you have"
            title={<>Off-ramps, on demand.</>}
          />
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            <Control icon={<KeyRound className="h-5 w-5" />} title="Revoke a machine key">
              Settings → Machine Keys. Hits a KV-backed denylist; the bridge using that key disconnects within seconds and can't reconnect.
            </Control>
            <Control icon={<Lock className="h-5 w-5" />} title="Revoke a connector token">
              Settings → Connectors. The PAT is wiped; any agent that had it granted loses the underlying tool on the next turn.
            </Control>
            <Control icon={<AlertTriangle className="h-5 w-5" />} title="Off-board a teammate">
              Workspace → People → Remove. Cascades through every machine key + connector grant they owned. One click.
            </Control>
          </div>
        </div>
      </section>

      <section className="border-t border-zinc-900 bg-black px-6 py-20">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-2xl font-medium text-white">Honest about what we DON'T have</h2>
          <ul className="mt-5 space-y-3 text-sm text-zinc-400">
            <li><span className="font-semibold text-zinc-200">SSO / SAML</span> — not built. On the roadmap with the Team tier.</li>
            <li><span className="font-semibold text-zinc-200">SOC 2 / HIPAA</span> — not pursued. We'll start the audit work when an enterprise contract makes it economic to commit to.</li>
            <li><span className="font-semibold text-zinc-200">BYO-bucket / data residency</span> — D1 / Workers run on Cloudflare's global edge. Region pinning isn't currently configurable per workspace.</li>
            <li><span className="font-semibold text-zinc-200">Customer-managed encryption keys</span> — not built. Connector tokens use envelope encryption with a Raltic-held KEK today.</li>
          </ul>
          <p className="mt-6 text-sm text-zinc-500">
            If any of these would block your team from using Raltic, tell us — at{" "}
            <a href="mailto:hello@raltic.com" className="text-zinc-300 hover:text-white">hello@raltic.com</a>. We prioritize what real conversations surface, not a hypothetical compliance roadmap.
          </p>
        </div>
      </section>

      <section className="bg-black px-6 py-16">
        <div className="mx-auto max-w-3xl rounded-2xl border border-zinc-900 bg-zinc-950 p-6 text-center">
          <h3 className="text-lg font-medium text-white">Responsible disclosure</h3>
          <p className="mt-2 text-sm text-zinc-400">
            Found a vulnerability? Email{" "}
            <a href="mailto:security@raltic.com" className="text-zinc-200 underline-offset-4 hover:text-white hover:underline">security@raltic.com</a>.
            We acknowledge within 1 business day and credit reporters in the resolution note unless they ask otherwise.
          </p>
        </div>
      </section>

      <section className="border-t border-zinc-900 bg-black px-6 py-24">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-balance text-3xl font-medium tracking-[-0.02em] text-white sm:text-4xl">
            Try Raltic with your real code.
          </h2>
          <p className="mt-4 text-zinc-400">Local-first by default. Your code never crosses our servers.</p>
          <div className="mt-7 flex justify-center">
            <Link
              href="/signup"
              className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-white px-6 text-[15px] font-semibold text-black"
            >
              Start free <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </MarketingShell>
  );
}

function Lane({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-6 text-zinc-700">
      <div className="flex items-center gap-2 text-zinc-900">
        {icon}
        <h3 className="text-lg font-medium">{title}</h3>
      </div>
      <div className="mt-4 text-sm leading-relaxed">{children}</div>
    </div>
  );
}

function Block({ tone, title, children }: { tone: "we-see" | "we-dont"; title: string; children: React.ReactNode }) {
  const accent = tone === "we-see" ? "border-cyan-500/30" : "border-zinc-800";
  return (
    <div className={`rounded-2xl border ${accent} bg-zinc-950 p-6`}>
      <h3 className="text-sm font-medium uppercase tracking-wider text-zinc-400">{title}</h3>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function Control({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5">
      <div className="text-cyan-700">{icon}</div>
      <h4 className="mt-3 text-base font-medium text-zinc-900">{title}</h4>
      <p className="mt-2 text-sm leading-relaxed text-zinc-600">{children}</p>
    </div>
  );
}
