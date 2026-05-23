import type { Metadata } from "next";
import Link from "next/link";
import { MarketingShell } from "@/components/marketing/shell";
import { MarketingFooter } from "@/components/marketing/footer";

/**
 * Privacy Policy.
 *
 * Written to match what Raltic actually does (not boilerplate). Sources
 * of truth checked when drafting:
 *   - apps/api/src/* — what data we collect server-side
 *   - packages/db/src/schema.ts — what we persist
 *   - apps/web/src/app/api/marketing/event/route.ts — beacon events
 *   - docs/SMOKE_TESTS_openclaw_hermes.md — what flows through bridges
 *
 * NOT a substitute for legal review. The "(template — pending legal
 * review)" disclaimer at the top is intentional and should stay until
 * counsel signs off.
 */
export const metadata: Metadata = {
  title: "Privacy Policy — Raltic",
  description: "How Raltic handles your data. Local-first execution, no provider keys, plain disclosure.",
  alternates: { canonical: "https://raltic.com/privacy" },
};

const LAST_UPDATED = "May 23, 2026";

export default function PrivacyPage() {
  return (
    <MarketingShell>
      <article className="prose-doc mx-auto max-w-3xl px-6 pt-32 pb-24 text-zinc-200 sm:pt-40">
        <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Legal</p>
        <h1 className="mt-3 text-4xl font-medium tracking-[-0.02em] text-white">Privacy Policy</h1>
        <p className="mt-3 text-sm text-zinc-500">Last updated: {LAST_UPDATED}</p>

        <Note>
          Working draft pending external legal review. Reflects what Raltic actually does today (private beta). We will revise as the product evolves and post version history at the bottom of this page.
        </Note>

        <H2>1. Who we are</H2>
        <P>
          Raltic is operated by the team behind raltic.com (the "Service"). Contact: <a className="underline" href="mailto:privacy@raltic.com">privacy@raltic.com</a>.
        </P>

        <H2>2. What we collect</H2>
        <P>
          We collect only what the Service requires to operate:
        </P>
        <UL>
          <li><B>Account identity</B>: email, display name, hashed password (via better-auth) or OAuth subject ID if you sign in with Google.</li>
          <li><B>Workspace + channel data</B>: workspaces you create or join, channel names + descriptions, member rosters.</li>
          <li><B>Messages</B>: the chat messages you and any AI agents you operate post into channels — stored and delivered to your workspace members in real time.</li>
          <li><B>Agent configuration</B>: agent name, system prompt, runtime selection (Claude/Codex/OpenClaw/Hermes/cloud), model choice. We do NOT collect provider API keys for bridge runtimes — those stay in your local CLI's auth path.</li>
          <li><B>Connector credentials</B>: when you wire up GitHub, Linear, or Notion, the personal access tokens you provide are stored envelope-encrypted (AES-GCM) in our database and only decrypted at the moment an agent you authorized invokes a connector tool.</li>
          <li><B>Machine keys + bridge metadata</B>: when you run our bridge daemon, we issue a per-machine key (revocable instantly). We see the hostname, fingerprint, and detected runtimes you reported.</li>
          <li><B>Marketing events</B>: when you visit our public pages, we record path + UTM parameters via <Link className="underline" href="/api/marketing/event">/api/marketing/event</Link> and a first-party <Code>ral_utm</Code> cookie (30-day, SameSite=Lax). No cross-site tracking. Cloudflare Web Analytics tracks aggregate page-view counts.</li>
          <li><B>Operational logs</B>: request paths, status codes, error stacks. No raw request bodies are logged.</li>
        </UL>

        <H2>3. What we don't collect</H2>
        <UL>
          <li>Your source code, repository contents, or local files — bridge runtimes read these on YOUR machine; only the chat reply crosses the network.</li>
          <li>Your AI provider API keys (Anthropic, OpenAI, Google, etc.) — the keys live in your CLI / daemon, not in our database.</li>
          <li>Browser-fingerprinting signals beyond what your browser sends in normal HTTP headers.</li>
          <li>Third-party analytics scripts. We don't include Google Analytics, Segment, Mixpanel, Sentry-Pageview, etc.</li>
        </UL>

        <H2>4. How we use what we collect</H2>
        <UL>
          <li>To run the Service — render your channels, deliver messages, dispatch agent turns, enforce authorization.</li>
          <li>To bill you when the Team tier ships (not active today — Raltic is in free private beta).</li>
          <li>To debug failures and improve reliability — operational logs are read by engineers when investigating incidents.</li>
          <li>To respond to your support requests.</li>
        </UL>
        <P>
          We do <B>not</B> use your messages to train models. We do not sell your data. We do not share your data with advertisers.
        </P>

        <H2>5. AI provider routing</H2>
        <P>
          When you use the <B>cloud Agent</B> (default, zero-install), Raltic's sandbox container calls AI providers (Anthropic, OpenAI, Google) via Cloudflare AI Gateway using Raltic-owned API keys. Your prompts and the resulting completions transit those providers' APIs and are subject to <B>their</B> data-handling policies. We don't retain prompts after the agent turn completes beyond what's persisted as the chat message.
        </P>
        <P>
          When you use a <B>bridge runtime</B> (Claude Code / Codex / OpenClaw / Hermes), the AI provider call originates from YOUR machine using YOUR auth. Raltic never sees that traffic.
        </P>

        <H2>6. Storage + retention</H2>
        <UL>
          <li>Application data is hosted on a global edge network. Data residency is not currently configurable per workspace.</li>
          <li>Connector tokens are envelope-encrypted at rest.</li>
          <li>Transport between your browser and Raltic uses HTTPS + WSS only.</li>
          <li>We retain your messages and account data until you delete them or close your account. Account deletion within 30 days of request; ask via <a className="underline" href="mailto:privacy@raltic.com">privacy@raltic.com</a>.</li>
          <li>Operational logs are retained for ~14 days for incident review.</li>
        </UL>

        <H2>7. What we DON'T have yet</H2>
        <P>
          We believe in honest gap disclosure:
        </P>
        <UL>
          <li>No SSO/SAML. On the Team-tier roadmap; not committed to a date.</li>
          <li>No SOC 2 or HIPAA audit. We will pursue when an enterprise contract justifies the investment.</li>
          <li>No customer-managed encryption keys.</li>
          <li>No regional data pinning.</li>
          <li>No GDPR Article 30 record-of-processing exposed (we maintain it internally; ask if you need it).</li>
        </UL>

        <H2>8. Your rights</H2>
        <P>
          You can:
        </P>
        <UL>
          <li>Access — download your data via <Code>raltic export</Code> (CLI) or request via email.</li>
          <li>Correct — edit your profile + messages in-app.</li>
          <li>Delete — close your account; we wipe within 30 days. Cascades to every machine key + connector grant you owned.</li>
          <li>Object / restrict processing — contact us; we'll handle case-by-case.</li>
        </UL>
        <P>
          For GDPR / CCPA / similar requests, email <a className="underline" href="mailto:privacy@raltic.com">privacy@raltic.com</a>. We respond within 30 days.
        </P>

        <H2>9. Cookies</H2>
        <UL>
          <li><Code>better-auth.session_token</Code> — authentication, required.</li>
          <li><Code>ral_utm</Code> — first-touch attribution; 30 days; first-party only.</li>
          <li>Cloudflare may set its own <Code>__cf_*</Code> cookies for bot mitigation.</li>
        </UL>

        <H2>10. Children</H2>
        <P>The Service is not directed to children under 16. We don't knowingly collect data from them. If you believe a child has signed up, email us and we'll delete.</P>

        <H2>11. Changes</H2>
        <P>Material changes will be announced via email to active users and version-noted at the top of this page. Last update timestamp is canonical.</P>

        <H2>12. Contact</H2>
        <P>
          Privacy questions: <a className="underline" href="mailto:privacy@raltic.com">privacy@raltic.com</a><br />
          Security reports: <a className="underline" href="mailto:security@raltic.com">security@raltic.com</a><br />
          General: <a className="underline" href="mailto:hello@raltic.com">hello@raltic.com</a>
        </P>
      </article>
      <MarketingFooter />
    </MarketingShell>
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
function B({ children }: { children: React.ReactNode }) {
  return <strong className="font-semibold text-white">{children}</strong>;
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
