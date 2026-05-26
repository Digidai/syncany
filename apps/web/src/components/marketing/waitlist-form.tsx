"use client";

import { useState } from "react";
import { ArrowRight, CheckCircle2, Loader2 } from "lucide-react";
import { trackCtaClick } from "@/components/marketing/tracking";
import { Button } from "@/components/heroui-pro/button";
import { Input } from "@/components/heroui-pro/input";
import { Select } from "@/components/heroui-pro/select";
import { Textarea } from "@/components/heroui-pro/textarea";

const TEAM_SIZES = ["1-4", "5-20", "21-100", "100+"] as const;
type TeamSize = (typeof TEAM_SIZES)[number];

/**
 * Five-field Team-tier waitlist form. Replaces the earlier mailto:
 * affordance which was both lazy (no validation, no persistence) and
 * easy to abuse (lots of mid-market buyers won't have a mail client
 * configured on the browser they're using).
 *
 * Posts to POST /api/v1/marketing/waitlist on the API origin. UTM
 * fields read from the `ral_utm` first-party cookie set by
 * <MarketingTracking />, so paid-traffic attribution survives the
 * submit.
 *
 * Renders inline; the parent (/teams page) gives it a card frame.
 */
export function WaitlistForm({ apiOrigin, refererPath = "/teams" }: {
  apiOrigin: string;
  refererPath?: string;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [teamSize, setTeamSize] = useState<TeamSize | "">("");
  const [useCase, setUseCase] = useState("");
  const [state, setState] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (state === "submitting") return;

    setState("submitting");
    setErrorMsg(null);
    trackCtaClick("waitlist_submit");

    const utm = readUtmCookie();

    try {
      const res = await fetch(`${apiOrigin}/api/v1/marketing/waitlist`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          company: company || null,
          teamSize: teamSize || undefined,
          useCase: useCase || null,
          refererPath,
          utmSource: utm.utm_source ?? null,
          utmCampaign: utm.utm_campaign ?? null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: { message?: string } } | null;
        const msg = body?.error?.message ?? `server error (${res.status})`;
        throw new Error(msg);
      }
      setState("done");
    } catch (err) {
      setState("error");
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }

  if (state === "done") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-8 text-center"
      >
        <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-400" aria-hidden="true" />
        <h3 className="mt-4 text-xl font-medium text-white">You're on the list</h3>
        <p className="mt-3 text-sm text-zinc-400">
          We'll reply within 1–2 business days. If it's urgent, write us at{" "}
          <a className="text-zinc-200 underline-offset-4 hover:underline" href="mailto:hello@raltic.com">hello@raltic.com</a>.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-busy={state === "submitting"}
      className="space-y-5"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Your name" required>
          <Input
            type="text"
            required
            autoComplete="name"
            value={name}
            onChange={e => setName((e.target as HTMLInputElement).value)}
            placeholder="Jane Doe"
            disabled={state === "submitting"}
            className={INPUT_CLS}
          />
        </Field>
        <Field label="Work email" required>
          <Input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={e => setEmail((e.target as HTMLInputElement).value)}
            placeholder="you@yourcompany.com"
            disabled={state === "submitting"}
            className={INPUT_CLS}
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Company">
          <Input
            type="text"
            autoComplete="organization"
            value={company}
            onChange={e => setCompany((e.target as HTMLInputElement).value)}
            placeholder="Acme Inc."
            disabled={state === "submitting"}
            className={INPUT_CLS}
          />
        </Field>
        <Field label="Team size">
          <Select
            value={teamSize}
            onChange={e => setTeamSize(e.target.value as TeamSize | "")}
            disabled={state === "submitting"}
            className="w-full"
            selectClassName={INPUT_CLS}
          >
            <option value="">Pick one…</option>
            {TEAM_SIZES.map(s => <option key={s} value={s}>{s} people</option>)}
          </Select>
        </Field>
      </div>

      <Field label="What would you use Raltic for?">
        <Textarea
          rows={4}
          value={useCase}
          onChange={e => setUseCase((e.target as HTMLTextAreaElement).value)}
          placeholder="e.g. We run Claude Code daily and want a shared chat where the agent's work is visible to the whole eng team."
          disabled={state === "submitting"}
          className={INPUT_CLS + " resize-none"}
          maxLength={2000}
        />
      </Field>

      {state === "error" && errorMsg && (
        <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-300">
          {errorMsg}
        </div>
      )}

      <div className="flex flex-col items-center gap-2 sm:flex-row sm:justify-between">
        <p className="text-[11px] text-zinc-500">
          We'll only email you about your waitlist status. No marketing blasts. Privacy: <a href="/privacy" className="underline-offset-4 hover:underline">privacy policy</a>.
        </p>
        <Button
          type="submit"
          disabled={state === "submitting"}
          variant="secondary"
          className="!h-11 w-full shrink-0 !bg-white !px-6 !text-[15px] !font-semibold !text-black hover:!bg-zinc-100 hover:!text-black sm:w-auto"
        >
          {state === "submitting" ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> Sending…</>
          ) : (
            <>Request access <ArrowRight className="h-4 w-4" /></>
          )}
        </Button>
      </div>
    </form>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 inline-block text-[11.5px] font-medium uppercase tracking-wider text-zinc-400">
        {label}{required && <span className="ml-1 text-rose-400">*</span>}
      </span>
      {children}
    </label>
  );
}

const INPUT_CLS = "block w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-cyan-500/50 focus:outline-none focus:ring-1 focus:ring-cyan-500/30 disabled:opacity-60";

function readUtmCookie(): Record<string, string> {
  if (typeof document === "undefined") return {};
  const c = document.cookie.split("; ").find(p => p.startsWith("ral_utm="));
  if (!c) return {};
  try {
    const decoded = JSON.parse(decodeURIComponent(c.slice("ral_utm=".length)));
    return typeof decoded === "object" && decoded ? decoded as Record<string, string> : {};
  } catch {
    return {};
  }
}
