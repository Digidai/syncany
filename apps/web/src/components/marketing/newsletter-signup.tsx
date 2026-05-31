"use client";

import { useState } from "react";
import { ArrowRight, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/heroui-pro/button";
import { Input } from "@/components/heroui-pro/input";
import { Field, FieldLabel } from "@/components/heroui-pro/field";
import { Alert, AlertDescription, AlertTitle } from "@/components/heroui-pro/alert";

/**
 * Compact email-only signup. Sits at the bottom of /indie and /teams
 * (anywhere we want a low-friction "keep me in the loop" affordance
 * without asking for a full waitlist payload).
 *
 * Posts to POST /api/v1/marketing/newsletter. Server soft-dedupes on
 * email so re-submits are idempotent.
 */
export function NewsletterSignup({ apiOrigin, page = "/" }: {
  apiOrigin: string;
  page?: string;
}) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (state === "submitting") return;
    setState("submitting");
    setMsg(null);

    const utm = readUtmCookie();
    try {
      const res = await fetch(`${apiOrigin}/api/v1/marketing/newsletter`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          page,
          utmSource: utm.utm_source ?? null,
          utmCampaign: utm.utm_campaign ?? null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? `server error (${res.status})`);
      }
      const body = await res.json() as { deduped?: boolean };
      setState("done");
      setMsg(body.deduped ? "You're already on the list — thanks!" : "Subscribed. We'll only email when there's product news.");
    } catch (err) {
      setState("error");
      setMsg(err instanceof Error ? err.message : String(err));
    }
  }

  if (state === "done") {
    return (
      <Alert
        role="status"
        aria-live="polite"
        variant="success"
        className="max-w-full"
      >
        <AlertTitle className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          Subscribed
        </AlertTitle>
        <AlertDescription className="whitespace-normal text-left">{msg}</AlertDescription>
      </Alert>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      // position:relative so absolute error overlay anchors here (Claude L6).
      // aria-busy so AT announces the in-flight state (codex 5 MED).
      aria-busy={state === "submitting"}
      className="relative flex flex-col items-stretch gap-2 sm:flex-row sm:items-center"
    >
      <Field>
        <FieldLabel htmlFor="newsletter-email" className="sr-only">Your email address</FieldLabel>
        <Input
          id="newsletter-email"
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={e => {
            setEmail((e.target as HTMLInputElement).value);
            // Clear stale error the moment user edits — codex 8 LOW.
            if (state === "error") { setState("idle"); setMsg(null); }
          }}
          placeholder="you@example.com"
          disabled={state === "submitting"}
          className="flex-1"
        />
      </Field>
      <Button
        type="submit"
        disabled={state === "submitting"}
        className="shrink-0"
      >
        {state === "submitting" ? (
          <><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Sending…</>
        ) : (
          <>Keep me in the loop <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></>
        )}
      </Button>
      {state === "error" && msg && (
        <div className="sm:absolute sm:mt-12">
          <Alert variant="error">
            <AlertDescription>{msg}</AlertDescription>
          </Alert>
        </div>
      )}
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
