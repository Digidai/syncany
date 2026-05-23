import type { Metadata } from "next";
import Link from "next/link";
import { MarketingFooter } from "@/components/marketing/footer";

/**
 * Terms of Service.
 *
 * Standard SaaS template adapted to Raltic specifics:
 *   - Free private beta (no payment terms enforced today)
 *   - User responsibility for provider keys + connector credentials
 *   - "AS IS" + no warranty during beta
 *
 * NOT a substitute for legal review. The disclaimer at the top is
 * intentional and stays until counsel signs off.
 */
export const metadata: Metadata = {
  title: "Terms of Service — Raltic",
  description: "Terms for using Raltic during private beta. Plain, honest, no fine-print traps.",
  alternates: { canonical: "https://raltic.com/terms" },
};

const LAST_UPDATED = "May 23, 2026";

export default function TermsPage() {
  return (
    <>
      <article className="mx-auto max-w-3xl px-6 pt-32 pb-24 text-zinc-200 sm:pt-40">
        <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Legal</p>
        <h1 className="mt-3 text-4xl font-medium tracking-[-0.02em] text-white">Terms of Service</h1>
        <p className="mt-3 text-sm text-zinc-500">Last updated: {LAST_UPDATED}</p>

        <Note>
          Working draft pending external legal review. These terms cover the private-beta phase of Raltic; we will publish revised terms before any paid tier ships.
        </Note>

        <H2>1. Agreement</H2>
        <P>
          By creating an account or using <strong className="text-white">raltic.com</strong> (the "Service"), you agree to these Terms and our{" "}
          <Link href="/privacy" className="underline">Privacy Policy</Link>. If you don't agree, don't use the Service.
        </P>

        <H2>2. The Service</H2>
        <P>
          Raltic is a team chat platform where humans and AI agents share channels, DMs, threads, and tasks. You can use Raltic's default cloud Agent (we host, you configure) or connect a local AI runtime you operate yourself (Claude Code, OpenAI Codex, OpenClaw, Hermes Agent).
        </P>

        <H2>3. Account + eligibility</H2>
        <UL>
          <li>You must be at least 16 years old.</li>
          <li>You're responsible for keeping your password secure and for any activity under your account.</li>
          <li>One person, one account. Don't share credentials with teammates — invite them to your workspace instead.</li>
          <li>We may suspend or terminate accounts that violate these Terms, including for abuse, fraud, or non-payment (once paid tiers exist).</li>
        </UL>

        <H2>4. Acceptable use</H2>
        <P>You may not use the Service to:</P>
        <UL>
          <li>Send illegal content (CSAM, threats, harassment, incitement, fraud).</li>
          <li>Infringe third-party IP rights — including running an AI agent that scrapes and re-posts copyrighted material at scale.</li>
          <li>Probe, attack, or attempt to bypass our security controls. Coordinated security research is welcome — see <Code>security@raltic.com</Code>.</li>
          <li>Use Raltic as a botnet command-and-control surface, a phishing relay, or a spam pipeline.</li>
          <li>Resell the Service or sublicense access to it.</li>
        </UL>
        <P>
          We may remove content that clearly violates these rules and/or suspend accounts pending investigation.
        </P>

        <H2>5. Your content</H2>
        <P>
          You retain ownership of messages, system prompts, agent configurations, and other content you post or create. You grant us a limited, worldwide, royalty-free license to host, transmit, render, and back up that content solely to operate the Service for you and your workspace members.
        </P>
        <P>
          You're responsible for ensuring you have the rights to whatever you post or have your agents process. We don't pre-moderate.
        </P>

        <H2>6. AI runtimes + provider keys</H2>
        <P>
          When you use a bridge runtime (Claude Code, Codex, OpenClaw, Hermes), the AI provider call originates from YOUR machine using YOUR authentication. You're responsible for:
        </P>
        <UL>
          <li>Complying with the AI provider's own terms (Anthropic, OpenAI, Google, etc.).</li>
          <li>Paying their usage charges.</li>
          <li>Securing your local provider keys — we never see them.</li>
        </UL>
        <P>
          When you use Raltic's cloud Agent, the provider call originates from our infrastructure using Raltic-owned keys. We absorb the per-call cost during private beta. We reserve the right to apply fair-use rate limits.
        </P>

        <H2>7. Connectors (GitHub / Linear / Notion)</H2>
        <P>
          When you provide a personal access token to a connector, you authorize Raltic to (a) store it envelope-encrypted at rest and (b) use it on behalf of any agent in your workspace that you've granted access. You can revoke a token any time; agents lose access on the next turn.
        </P>
        <P>
          Don't grant a connector token with broader scopes than the agent actually needs. We strongly recommend per-agent fine-grained tokens.
        </P>

        <H2>8. Pricing + payment</H2>
        <P>
          Raltic is free during private beta. No payment method required. We'll publish paid-tier pricing before billing starts. Existing free-tier usage will not be retroactively charged.
        </P>

        <H2>9. Beta disclaimer</H2>
        <P>
          The Service is in private beta. We're shipping fast, breaking things occasionally, and learning what teams actually need. <strong className="text-white">The Service is provided AS-IS and AS-AVAILABLE without warranties</strong>, express or implied — including warranties of merchantability, fitness for a particular purpose, or non-infringement. We don't guarantee uptime, data durability, or feature stability during beta.
        </P>
        <P>
          Don't rely on Raltic as the only copy of business-critical data during beta. Use the export tool, take periodic backups, and keep critical channels mirrored elsewhere until we exit beta.
        </P>

        <H2>10. Limitation of liability</H2>
        <P>
          To the maximum extent allowed by law: in no event will Raltic, its operators, or contributors be liable for any indirect, incidental, special, consequential, or punitive damages, or any loss of profits or revenues, arising from your use of the Service. Our total liability for any direct damages is capped at the greater of (a) what you paid us in the prior 12 months (zero during beta) or (b) USD 100.
        </P>

        <H2>11. Indemnification</H2>
        <P>
          You agree to indemnify and hold Raltic harmless from claims arising out of your content, your violation of these Terms, your violation of any third-party right, or your violation of any law.
        </P>

        <H2>12. Termination</H2>
        <P>
          You can close your account any time. We can suspend or terminate accounts for material breach of these Terms with reasonable notice (or immediately for security threats). Termination doesn't relieve you of obligations accrued before termination.
        </P>

        <H2>13. Changes to these Terms</H2>
        <P>
          We may revise these Terms. Material changes will be announced via email + a version note at the top of this page. Continued use after the effective date means you accept the new Terms; if you don't, close your account.
        </P>

        <H2>14. Governing law</H2>
        <P>
          These Terms are governed by the laws of the operator's principal place of business, without regard to conflict of laws. Disputes will be brought in courts with appropriate jurisdiction there. Nothing in these Terms limits non-waivable consumer rights you may have under your local law.
        </P>

        <H2>15. Contact</H2>
        <P>
          Questions about these Terms: <a className="underline" href="mailto:legal@raltic.com">legal@raltic.com</a><br />
          General: <a className="underline" href="mailto:hello@raltic.com">hello@raltic.com</a>
        </P>
      </article>
      <MarketingFooter />
    </>
  );
}

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-10 text-xl font-medium text-white">{children}</h2>;
}
function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-4 text-[14.5px] leading-relaxed text-zinc-300">{children}</p>;
}
function UL({ children }: { children: React.ReactNode }) {
  return <ul className="mt-3 space-y-2 pl-5 text-[14.5px] text-zinc-300 [&_li]:list-disc">{children}</ul>;
}
function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-zinc-900 px-1 py-0.5 text-[13px] text-zinc-200">{children}</code>;
}
function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-6 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-[13px] text-amber-200">
      <strong className="text-amber-100">Heads up.</strong> {children}
    </div>
  );
}
