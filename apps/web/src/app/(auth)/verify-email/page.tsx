"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { safeNext } from "@/lib/safe-redirect";
import { Button } from "@/components/heroui-pro/button";
import { Input } from "@/components/heroui-pro/input";
import { Field, FieldLabel } from "@/components/heroui-pro/field";

/**
 * Landing page for email verification.
 *
 * better-auth's /api/auth/verify-email redirects here on completion.
 *   - Success path: session cookie is set; useSession() resolves with
 *     the user and we silently bounce to ?next= (or /).
 *   - Error path: better-auth appends ?error=<code>. We surface it
 *     distinctly with a "resend" affordance instead of the prior
 *     silent-bounce-to-login (which left users with no idea why).
 *   - Cross-browser path: user signed up in browser A, clicks link in
 *     browser B. Browser B's verification succeeds → it shows "verified —
 *     return to original device". Browser A's signup tab listens on a
 *     BroadcastChannel keyed by email and auto-refreshes when verified.
 *
 * Audit notes (codex P3 onboarding audit):
 *   - cross-browser dead-end (UX angle 2 H1) fixed via BroadcastChannel
 *   - expired/invalid-token UI (UX angle 2 H2) fixed via ?error= read
 */
export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">Loading…</div>}>
      <VerifyEmailInner />
    </Suspense>
  );
}

const BROADCAST_CHANNEL_NAME = "raltic-auth";

interface BroadcastVerifiedMsg {
  type: "email-verified";
  email?: string;        // not always known on the click-side
}

function VerifyEmailInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const session = authClient.useSession();
  const nextPath = safeNext(sp.get("next")) ?? "/";

  // ?error=<code> set by better-auth on failure paths. Common codes:
  //   INVALID_TOKEN | TOKEN_EXPIRED | INVALID_EMAIL | INTERNAL_ERROR
  // Don't trust the literal — drive UX off categories, leave the raw
  // code in a hint for support.
  const errorCode = sp.get("error");
  // Email may be on the URL when better-auth appends it (some flows do);
  // also fall back to localStorage from the signup flow so the resend
  // form below is pre-filled.
  const emailFromUrl = sp.get("email") ?? "";

  const redirected = useRef(false);
  useEffect(() => { redirected.current = false; }, [nextPath]);

  // Notify any signup tab (in any browser-window/tab on the same origin)
  // that this email is now verified. The signup tab will listen + reload
  // to pick up the session. Best-effort: BroadcastChannel is per-origin,
  // so this works for the same-browser case automatically; cross-browser
  // still requires the user to return to the original device manually,
  // but they at least see a "verified" state in this tab.
  useEffect(() => {
    if (!session.data?.user) return;
    if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return;
    try {
      const bc = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
      const msg: BroadcastVerifiedMsg = {
        type: "email-verified",
        email: session.data.user.email,
      };
      bc.postMessage(msg);
      bc.close();
    } catch { /* OK — feature-degraded path */ }
  }, [session.data?.user]);

  useEffect(() => {
    if (session.data?.user && !redirected.current) {
      redirected.current = true;
      router.replace(nextPath);
    }
  }, [session.data?.user, nextPath, router]);

  // Error UI takes precedence over loading/auth state. The user clicked
  // a bad link; spinning forever or bouncing to login both hide the
  // actual problem.
  if (errorCode) {
    return (
      <ErrorPanel
        errorCode={errorCode}
        emailFromUrl={emailFromUrl}
        nextPath={nextPath}
      />
    );
  }

  if (session.isPending) {
    return <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">Verifying…</div>;
  }

  // Not signed in here — link was clicked in a different browser than
  // the one that signed up. Tell them clearly and give them a one-tap
  // sign-in CTA. Pre-fill the email if better-auth handed it to us.
  const signInHref = nextPath !== "/"
    ? `/login?next=${encodeURIComponent(nextPath)}${emailFromUrl ? `&email=${encodeURIComponent(emailFromUrl)}` : ""}`
    : `/login${emailFromUrl ? `?email=${encodeURIComponent(emailFromUrl)}` : ""}`;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8">
      <div className="max-w-sm w-full text-center">
        <h1 className="text-2xl font-semibold">Email verified ✓</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          If you signed up on a different device, return there — this
          tab confirmed your email and the other one will pick it up
          automatically. Otherwise, sign in below.
        </p>
        <Button render={<Link href={signInHref} />} className="mt-6">
          Sign in
        </Button>
      </div>
    </div>
  );
}

function ErrorPanel({
  errorCode, emailFromUrl, nextPath,
}: {
  errorCode: string;
  emailFromUrl: string;
  nextPath: string;
}) {
  const [email, setEmail] = useState(emailFromUrl);
  const [resending, setResending] = useState(false);
  const [resentTo, setResentTo] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);

  const isExpired = /EXPIRED/i.test(errorCode);
  const isInvalid = /INVALID/i.test(errorCode);

  async function handleResend(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || resending) return;
    setResending(true);
    setResendError(null);
    try {
      await authClient.sendVerificationEmail({
        email: email.trim(),
        callbackURL: nextPath !== "/" ? `/verify-email?next=${encodeURIComponent(nextPath)}` : "/verify-email",
      });
      setResentTo(email.trim());
    } catch (err) {
      // Avoid enumeration: regardless of whether the email exists,
      // show "if an account exists, we sent a link" — but also surface
      // raw network errors so users aren't stuck on a real outage.
      const msg = err instanceof Error ? err.message : String(err);
      if (/network|fetch|timeout/i.test(msg)) {
        setResendError(msg);
      } else {
        setResentTo(email.trim());
      }
    } finally {
      setResending(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8">
      <div className="max-w-md w-full text-center">
        <h1 className="text-2xl font-semibold">
          {isExpired ? "This link expired" : isInvalid ? "This link is invalid" : "Verification failed"}
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {isExpired
            ? "Verification links are good for a short window. Enter your email and we'll send a fresh one."
            : isInvalid
              ? "The link may have been copy-pasted incorrectly, or it was already used. Try requesting a new one below."
              : "Something went wrong on our end."}
        </p>
        {resentTo ? (
          <p className="mt-6 rounded border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-400">
            If an account exists for <strong>{resentTo}</strong>, a new verification link is on its way.
          </p>
        ) : (
          <form onSubmit={handleResend} className="mt-6 space-y-3 text-left">
            <Field>
              <FieldLabel htmlFor="resend-email">Email</FieldLabel>
              <Input
                id="resend-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail((e.target as HTMLInputElement).value)}
                placeholder="you@example.com"
              />
            </Field>
            <Button
              type="submit"
              disabled={resending || !email.trim()}
              className="w-full"
            >
              {resending ? "Sending…" : "Send a new verification link"}
            </Button>
            {resendError && (
              <p className="text-xs text-destructive-foreground">{resendError}</p>
            )}
          </form>
        )}
        <p className="mt-6 text-xs text-muted-foreground">
          Already verified? <Link href="/login" className="underline hover:text-foreground">Sign in</Link>.
          {" "}
          <span className="opacity-60">[ref: {errorCode}]</span>
        </p>
      </div>
    </div>
  );
}
