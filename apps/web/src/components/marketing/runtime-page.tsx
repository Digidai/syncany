import { ArrowRight, CheckCircle2, ExternalLink, Terminal } from "lucide-react";
import { MarketingFooter } from "./footer";
import { MarketingButton } from "./marketing-button";
import { SectionHeader } from "./section-header";
import type { RuntimeDoc } from "./runtime-data";
import { MarketingFaqList } from "./faq-list";

/** Per-accent class lookups — kept inline (vs. dynamic class names) so
 *  Tailwind's purger sees the strings at build time. */
const ACCENT_TEXT: Record<RuntimeDoc["accent"], string> = {
  cyan:   "text-cyan-300",
  amber:  "text-amber-300",
  violet: "text-violet-300",
  rose:   "text-rose-300",
};
const ACCENT_BG: Record<RuntimeDoc["accent"], string> = {
  cyan:   "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
  amber:  "bg-amber-500/15 text-amber-300 border-amber-500/30",
  violet: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  rose:   "bg-rose-500/15 text-rose-300 border-rose-500/30",
};
const ACCENT_GLOW: Record<RuntimeDoc["accent"], string> = {
  cyan:   "rgba(34,211,238,0.10)",
  amber:  "rgba(245,158,11,0.10)",
  violet: "rgba(167,139,250,0.10)",
  rose:   "rgba(251,113,133,0.10)",
};

/**
 * Shared template for /runtimes/[id]. Renders the per-runtime hero,
 * "what it is", "how Raltic uses it", install command, "best at"
 * bullets, FAQ, and a CTA.
 *
 * Per codex review L9 (thin-content guard): the unique copy comes from
 * RUNTIME_DOCS[key] in runtime-data.ts — this template is pure layout.
 * Each runtime's body content is hand-written, distinct from the others.
 */
export function RuntimePage({ doc }: { doc: RuntimeDoc }) {
  return (
    <>
      <Hero doc={doc} />
      <section className="border-y border-zinc-900 bg-black">
        <div className="mx-auto grid max-w-6xl gap-12 px-6 py-24 lg:grid-cols-2">
          <div>
            <h2 className="text-2xl font-medium text-white">What it is</h2>
            <p className="mt-3 text-zinc-400">{doc.whatItIs}</p>
            <a
              href={doc.upstreamHref}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex items-center gap-1.5 text-sm text-zinc-300 underline-offset-4 hover:underline"
            >
              {doc.upstreamLabel} <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
          <div>
            <h2 className="text-2xl font-medium text-white">How Raltic uses it</h2>
            <p className="mt-3 text-zinc-400">{doc.howRalticUses}</p>
            <div className="mt-4 inline-flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1 text-[11px] font-medium text-zinc-400">
              Lifecycle: <span className="text-zinc-200">{doc.lifecycle === "external_daemon" ? "External daemon (yours)" : "Per-turn CLI spawn"}</span>
            </div>
          </div>
        </div>
      </section>

      <InstallStrip doc={doc} />
      <BestAt doc={doc} />
      <Faq doc={doc} />
      <Cta doc={doc} />
      <MarketingFooter />
    </>
  );
}

function Hero({ doc }: { doc: RuntimeDoc }) {
  return (
    <section className="relative isolate overflow-hidden border-b border-zinc-900 bg-black pt-32 pb-20 sm:pt-40">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[640px]"
        style={{
          background: `radial-gradient(ellipse 60% 50% at 50% 0%, ${ACCENT_GLOW[doc.accent]}, transparent 70%)`,
        }}
      />
      <div className="mx-auto max-w-4xl px-6 text-center">
        <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${ACCENT_BG[doc.accent]}`}>
          {doc.shortName} runtime
          {doc.verification === "experimental" && (
            <>
              <span className="text-zinc-500" aria-hidden>·</span>
              <span className="font-semibold uppercase tracking-wider text-amber-300">Experimental</span>
            </>
          )}
        </span>
        <h1 className="mt-7 text-balance text-5xl font-medium leading-[1.05] tracking-[-0.02em] text-white sm:text-6xl">
          <span className={ACCENT_TEXT[doc.accent]}>{doc.shortName}</span>{" "}
          in Raltic
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-balance text-lg text-zinc-400">{doc.tagline}</p>
        <p className="mx-auto mt-6 max-w-2xl text-balance text-sm leading-relaxed text-zinc-500">{doc.hero}</p>
        {doc.verification === "experimental" && (
          <div className="mx-auto mt-6 max-w-2xl rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-left text-[12px] text-amber-200">
            <strong className="text-amber-100">Experimental runtime.</strong> Code shipped; CLI shape was implemented from public docs without a local smoke pass. See{" "}
            <code className="rounded bg-amber-500/10 px-1">docs/SMOKE_TESTS_openclaw_hermes.md</code>{" "}
            for what verification needs to cover. Recommended for evaluation, not production-critical work.
          </div>
        )}
        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <MarketingButton href="/signup">
            Start free <ArrowRight className="h-4 w-4" />
          </MarketingButton>
          <MarketingButton href="/runtimes" variant="secondary">
            See all runtimes
          </MarketingButton>
        </div>
      </div>
    </section>
  );
}

function InstallStrip({ doc }: { doc: RuntimeDoc }) {
  return (
    <section className="bg-white text-zinc-900">
      <div className="mx-auto max-w-6xl px-6 py-24">
        <SectionHeader
          dark={false}
          eyebrow="Install"
          title={<>One line, on your machine.</>}
          description={
            doc.lifecycle === "external_daemon"
              ? "Raltic doesn't bundle this runtime. Install the daemon from its upstream, then point Raltic at it. We never see your provider keys."
              : "Raltic doesn't bundle this CLI. Install it from upstream, then start the Raltic bridge — your provider key stays in the CLI's own auth path."
          }
        />
        <div className="mx-auto mt-10 max-w-3xl">
          <div className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 font-mono text-sm">
            <Terminal className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden />
            <code className="flex-1 truncate text-zinc-800">{doc.installCmd}</code>
          </div>
          <p className="mt-4 text-center text-[12px] text-zinc-500">
            Then sign up and pick <span className="font-medium text-zinc-800">{doc.shortName}</span> when creating your first agent.
          </p>
        </div>
      </div>
    </section>
  );
}

function BestAt({ doc }: { doc: RuntimeDoc }) {
  return (
    <section className="border-y border-zinc-900 bg-black">
      <div className="mx-auto max-w-6xl px-6 py-24">
        <SectionHeader
          eyebrow="Best at"
          title={<>Three things this runtime is best at in Raltic.</>}
        />
        <div className="mx-auto mt-12 grid max-w-4xl gap-4 sm:grid-cols-3">
          {doc.bestAt.map((point, idx) => (
            <div key={idx} className="rounded-xl border border-zinc-900 bg-zinc-950 p-5">
              <div className={`flex items-center gap-2 ${ACCENT_TEXT[doc.accent]}`}>
                <CheckCircle2 className="h-4 w-4" />
                <span className="text-[10.5px] font-medium uppercase tracking-wider">{`#${idx + 1}`}</span>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-zinc-300">{point}</p>
            </div>
          ))}
        </div>
        <p className="mx-auto mt-10 max-w-2xl text-center text-[12px] text-zinc-500">
          Available models in Raltic: {doc.models.map(m => <code key={m} className="mx-0.5 rounded bg-zinc-900 px-1 py-0.5 text-zinc-300">{m}</code>)}
        </p>
      </div>
    </section>
  );
}

function Faq({ doc }: { doc: RuntimeDoc }) {
  return (
    <section className="bg-white text-zinc-900">
      <div className="mx-auto max-w-3xl px-6 py-24">
        <SectionHeader
          dark={false}
          eyebrow="FAQ"
          title={<>Questions specific to {doc.shortName}.</>}
        />
        <MarketingFaqList idPrefix={doc.key} items={doc.faq} theme="light" />
      </div>
    </section>
  );
}

function Cta({ doc }: { doc: RuntimeDoc }) {
  return (
    <section className="border-t border-zinc-900 bg-black px-6 py-24">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-balance text-3xl font-medium tracking-[-0.02em] text-white sm:text-4xl">
          Bring {doc.shortName} into the team channel.
        </h2>
        <p className="mt-4 text-zinc-400">
          Free during private beta. {doc.lifecycle === "external_daemon" ? "Your daemon stays yours." : "Your CLI auth stays yours."} We never see your keys.
        </p>
        <div className="mt-7 flex justify-center">
          <MarketingButton href="/signup">
            Start free <ArrowRight className="h-4 w-4" />
          </MarketingButton>
        </div>
      </div>
    </section>
  );
}
