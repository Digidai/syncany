"use client";

import { useState } from "react";
import { ArrowRight, CheckCircle2, Loader2 } from "lucide-react";

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
      <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-sm text-emerald-300">
        <CheckCircle2 className="h-4 w-4" />
        {msg}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
      <input
        type="email"
        required
        autoComplete="email"
        value={email}
        onChange={e => setEmail(e.target.value)}
        placeholder="you@example.com"
        disabled={state === "submitting"}
        className="flex-1 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-cyan-500/50 focus:outline-none focus:ring-1 focus:ring-cyan-500/30 disabled:opacity-60"
      />
      <button
        type="submit"
        disabled={state === "submitting"}
        className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-60"
      >
        {state === "submitting" ? (
          <><Loader2 className="h-3.5 w-3.5 animate-spin" /> …</>
        ) : (
          <>Keep me in the loop <ArrowRight className="h-3.5 w-3.5" /></>
        )}
      </button>
      {state === "error" && msg && (
        <p className="text-[12px] text-rose-300 sm:absolute sm:mt-12">{msg}</p>
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
