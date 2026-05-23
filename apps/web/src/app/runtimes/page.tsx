import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { MarketingShell } from "@/components/marketing/shell";
import { MarketingFooter } from "@/components/marketing/footer";
import { SectionHeader } from "@/components/marketing/section-header";
import { RUNTIME_DOCS, type RuntimeDoc } from "@/components/marketing/runtime-data";

export const metadata: Metadata = {
  title: "Runtimes · Raltic — Claude, Codex, OpenClaw, Hermes",
  description: "Four AI agent runtimes, one chat surface. Bring your own daemon, or run on Raltic's cloud. No provider lock-in.",
  openGraph: {
    title: "Raltic — four runtimes, one team chat",
    description: "Claude Code, OpenAI Codex, OpenClaw, Hermes — pick per agent, mix in the same workspace.",
    url: "https://raltic.com/runtimes",
  },
};

const ACCENT_BG: Record<RuntimeDoc["accent"], string> = {
  cyan:   "bg-cyan-500/10  border-cyan-500/30  text-cyan-300",
  amber:  "bg-amber-500/10 border-amber-500/30 text-amber-300",
  violet: "bg-violet-500/10 border-violet-500/30 text-violet-300",
  rose:   "bg-rose-500/10  border-rose-500/30  text-rose-300",
};

export default function RuntimesHub() {
  const ordered: RuntimeDoc[] = [
    RUNTIME_DOCS.claude,
    RUNTIME_DOCS.codex,
    RUNTIME_DOCS.openclaw,
    RUNTIME_DOCS.hermes,
  ];
  return (
    <MarketingShell>
      <section className="border-b border-zinc-900 bg-black px-6 pt-32 pb-20 sm:pt-40">
        <div className="mx-auto max-w-4xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-950 px-3 py-1 text-xs font-medium text-zinc-300">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
            Runtimes
          </span>
          <h1 className="mt-7 text-balance text-5xl font-medium leading-[1.05] tracking-[-0.02em] text-white sm:text-6xl">
            Four agent runtimes.<br />
            <span className="text-cyan-400">One chat surface.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-balance text-lg text-zinc-400">
            Each agent picks its own runtime. Mix Claude and Codex in the same workspace. Point at your own OpenClaw or Hermes daemon — Raltic never touches your provider keys.
          </p>
        </div>
      </section>

      <section className="bg-black px-6 py-20">
        <div className="mx-auto grid max-w-6xl gap-4 md:grid-cols-2">
          {ordered.map((doc) => (
            <Link
              key={doc.key}
              href={`/runtimes/${doc.key}`}
              className={`group block rounded-2xl border bg-zinc-950 p-6 transition-colors hover:bg-zinc-900 ${ACCENT_BG[doc.accent]}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-xl font-medium text-white">{doc.shortName}</h2>
                    {doc.verification === "experimental" && (
                      <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-wider text-amber-300">
                        Experimental
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[12px] text-zinc-500">{doc.longName}</p>
                </div>
                <ArrowRight className="h-4 w-4 text-zinc-500 transition-transform group-hover:translate-x-0.5 group-hover:text-white" />
              </div>
              <p className="mt-4 text-sm leading-relaxed text-zinc-300">{doc.tagline}</p>
              <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-white/5 pt-4 text-[11px] text-zinc-500">
                <span className="rounded-md border border-zinc-800 bg-black/40 px-2 py-0.5">
                  {doc.lifecycle === "external_daemon" ? "External daemon" : "Per-turn spawn"}
                </span>
                <span className="rounded-md border border-zinc-800 bg-black/40 px-2 py-0.5">
                  {doc.models.length} model{doc.models.length === 1 ? "" : "s"}
                </span>
              </div>
            </Link>
          ))}
        </div>

        <p className="mx-auto mt-12 max-w-2xl text-center text-sm text-zinc-500">
          New runtime you want supported? Email{" "}
          <a href="mailto:hello@raltic.com" className="text-zinc-300 hover:text-white">hello@raltic.com</a>.
        </p>
      </section>

      <MarketingFooter />
    </MarketingShell>
  );
}
