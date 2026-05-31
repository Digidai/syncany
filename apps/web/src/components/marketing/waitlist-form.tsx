"use client";

import { useState } from "react";
import { ArrowRight, CheckCircle2, Loader2 } from "lucide-react";
import { trackCtaClick } from "@/components/marketing/tracking";
import { Button } from "@/components/heroui-pro/button";
import { Input } from "@/components/heroui-pro/input";
import { Select } from "@/components/heroui-pro/select";
import { Textarea } from "@/components/heroui-pro/textarea";
import { Field, FieldLabel } from "@/components/heroui-pro/field";
import { Alert, AlertDescription, AlertTitle } from "@/components/heroui-pro/alert";

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
  const TEAM_SIZE_OPTIONS = TEAM_SIZES.map((size) => ({ value: size, label: `${size} people` }));
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
      <Alert
        role="status"
        aria-live="polite"
        variant="success"
        className="text-center"
      >
        <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-400" aria-hidden="true" />
        <AlertTitle className="mt-4 text-xl">You're on the list</AlertTitle>
        <AlertDescription className="mt-3">
          We'll reply within 1–2 business days. If it's urgent, write us at{" "}
          <a className="text-foreground underline-offset-4 hover:underline" href="mailto:hello@raltic.com">hello@raltic.com</a>.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-busy={state === "submitting"}
      className="space-y-5"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="waitlist-name" className="text-[11.5px] font-medium uppercase tracking-wider text-zinc-400">
            Your name <span className="ml-1 text-rose-400">*</span>
          </FieldLabel>
          <Input
            id="waitlist-name"
            type="text"
            required
            autoComplete="name"
            value={name}
            onChange={e => setName((e.target as HTMLInputElement).value)}
            placeholder="Jane Doe"
            disabled={state === "submitting"}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="waitlist-email" className="text-[11.5px] font-medium uppercase tracking-wider text-zinc-400">
            Work email <span className="ml-1 text-rose-400">*</span>
          </FieldLabel>
          <Input
            id="waitlist-email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={e => setEmail((e.target as HTMLInputElement).value)}
            placeholder="you@yourcompany.com"
            disabled={state === "submitting"}
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="waitlist-company" className="text-[11.5px] font-medium uppercase tracking-wider text-zinc-400">
            Company
          </FieldLabel>
          <Input
            id="waitlist-company"
            type="text"
            autoComplete="organization"
            value={company}
            onChange={e => setCompany((e.target as HTMLInputElement).value)}
            placeholder="Acme Inc."
            disabled={state === "submitting"}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="waitlist-team-size" className="text-[11.5px] font-medium uppercase tracking-wider text-zinc-400">
            Team size
          </FieldLabel>
          <Select
            id="waitlist-team-size"
            value={teamSize}
            onChange={e => setTeamSize(e.target.value as TeamSize | "")}
            disabled={state === "submitting"}
            className="w-full"
            options={[{ value: "", label: "Pick one…" }, ...TEAM_SIZE_OPTIONS]}
          >
          </Select>
        </Field>
      </div>

      <Field>
        <FieldLabel htmlFor="waitlist-use-case" className="text-[11.5px] font-medium uppercase tracking-wider text-zinc-400">
          What would you use Raltic for?
        </FieldLabel>
        <Textarea
          id="waitlist-use-case"
          rows={4}
          value={useCase}
          onChange={e => setUseCase((e.target as HTMLTextAreaElement).value)}
          placeholder="e.g. We run Claude Code daily and want a shared chat where the agent's work is visible to the whole eng team."
          disabled={state === "submitting"}
          className="resize-none"
          maxLength={2000}
        />
      </Field>

      {state === "error" && errorMsg && (
        <Alert variant="error">
          <AlertDescription>{errorMsg}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col items-center gap-2 sm:flex-row sm:justify-between">
        <p className="text-[11px] text-zinc-500">
          We'll only email you about your waitlist status. No marketing blasts. Privacy: <a href="/privacy" className="underline-offset-4 hover:underline">privacy policy</a>.
        </p>
        <Button
          type="submit"
          disabled={state === "submitting"}
          className="w-full shrink-0 sm:w-auto"
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
