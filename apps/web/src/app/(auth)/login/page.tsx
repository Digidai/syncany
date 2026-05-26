"use client";

import { Suspense, useState } from "react";
import { signIn, authClient } from "@/lib/auth-client";
import { safeNext } from "@/lib/safe-redirect";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardHeader, CardTitle, CardDescription, CardPanel, CardFooter } from "@/components/heroui-pro/card";
import { Button } from "@/components/heroui-pro/button";
import { Input } from "@/components/heroui-pro/input";
import { Field, FieldLabel } from "@/components/heroui-pro/field";
import { Alert, AlertDescription } from "@/components/heroui-pro/alert";

const HAS_GOOGLE = !!process.env.NEXT_PUBLIC_GOOGLE_ENABLED;

/** Map better-auth's OAuth error codes to user-friendly copy. Unknown
 *  codes fall through to the raw string so we never silently swallow
 *  something the user is supposed to know about. */
function interpretOAuthError(code: string): string {
  switch (code) {
    case "account_not_linked":
      return "That email is already registered with a password. Sign in with your password first, then link Google in Settings.";
    case "oauth_callback_error":
    case "oauth_signin_error":
      return "Sign-in via Google failed. Try again, or use email + password below.";
    case "access_denied":
      return "Sign-in cancelled.";
    default:
      return `Sign-in error: ${code}`;
  }
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Loading…</div>}>
      <LoginInner />
    </Suspense>
  );
}

function LoginInner() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [emailNotVerified, setEmailNotVerified] = useState(false);
  const [resendingVerify, setResendingVerify] = useState(false);
  const [resentMsg, setResentMsg] = useState<string | null>(null);
  const router = useRouter();
  const sp = useSearchParams();
  const nextPath = safeNext(sp.get("next")) ?? "/";
  const desktopClient = sp.get("client") === "desktop" || nextPath.startsWith("/desktop");
  const [justReset, setJustReset] = useState(sp.get("reset") === "ok");

  // Surface OAuth-callback errors better-auth bounces back through the
  // `?error=` query — mainly hit when an unauthenticated user clicks
  // "Continue with Google" for an email that already has a password
  // account (we deliberately disabled trustedProviders, so linking
  // requires the user to sign in locally first). Without this they'd
  // see the form re-rendered with no explanation.
  const oauthErrorCode = sp.get("error");
  const oauthErrorMessage = oauthErrorCode ? interpretOAuthError(oauthErrorCode) : null;
  const signupHref = nextPath !== "/"
    ? `/signup?${new URLSearchParams({
      ...(desktopClient ? { client: "desktop" } : {}),
      next: nextPath,
    }).toString()}`
    : desktopClient ? "/signup?client=desktop" : "/signup";

  // First *real* character keystroke clears the "Password updated"
  // banner. We use `onKeyDown` (not `onChange`) because Safari fires
  // synthetic change events on autofill at mount, and we filter to
  // printable keys so Tab / Shift / Enter while navigating the form
  // don't dismiss it before the user reads it.
  function dismissResetBanner(e: React.KeyboardEvent) {
    if (!justReset) return;
    if (e.key.length !== 1) return;
    setJustReset(false);
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setEmailNotVerified(false);
    setResentMsg(null);

    try {
      const { error } = await signIn.email({ email, password });
      if (error) {
        setError(error.message ?? "Sign-in failed");
        if (error.code === "EMAIL_NOT_VERIFIED" || /not verified/i.test(error.message ?? "")) {
          setEmailNotVerified(true);
        }
        return;
      }
      router.push(nextPath);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    if (!email) return;
    setResendingVerify(true); setResentMsg(null);
    try {
      await authClient.sendVerificationEmail({ email, callbackURL: "/verify-email" });
      setResentMsg("Verification email sent.");
    } catch (e) {
      setResentMsg(e instanceof Error ? e.message : String(e));
    } finally { setResendingVerify(false); }
  }

  async function handleGoogle() {
    if (oauthLoading) return;
    setOauthLoading(true);
    try {
      await authClient.signIn.social({ provider: "google", callbackURL: nextPath });
    } finally {
      // OAuth navigates away on success; only resets if it errored locally.
      setOauthLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-sm mx-4">
        {/* Visually hidden h1 — Card uses a div for its visual title
            (CardTitle is a styled div primitive). Screen readers + a11y
            audits expect a real <h1> per page, so we add one here.
            Detected by axe-core (codex T7) — "page should have one h1". */}
        <h1 className="sr-only">Sign in to Raltic</h1>
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">{desktopClient ? "Raltic Desktop" : "Raltic"}</CardTitle>
            <CardDescription>
              {desktopClient
                ? "Sign in to connect this computer to your workspace"
                : "Sign in to your workspace"}
            </CardDescription>
          </CardHeader>
          <form onSubmit={handleLogin} onKeyDown={dismissResetBanner}>
            <CardPanel>
              <div className="space-y-4">
                {justReset && (
                  <Alert>
                    <AlertDescription>Password updated. Sign in below.</AlertDescription>
                  </Alert>
                )}
                {HAS_GOOGLE && (
                  <>
                    <Button type="button" variant="outline" className="w-full"
                      onClick={handleGoogle} loading={oauthLoading} disabled={oauthLoading}>
                      Continue with Google
                    </Button>
                    <div className="relative">
                      <div className="absolute inset-0 flex items-center"><div className="w-full border-t" /></div>
                      <div className="relative flex justify-center text-[10px] uppercase tracking-wider"><span className="bg-card px-2 text-muted-foreground">or</span></div>
                    </div>
                  </>
                )}
                <Field>
                  <FieldLabel htmlFor="login-email">Email</FieldLabel>
                  <Input id="login-email" type="email" required autoComplete="email" value={email}
                    onChange={(e) => setEmail((e.target as HTMLInputElement).value)}
                    placeholder="you@example.com" />
                </Field>
                <Field>
                  <FieldLabel htmlFor="login-password">
                    <span className="flex items-center justify-between">
                      <span>Password</span>
                      <Link href="/forgot-password" className="text-[11px] text-muted-foreground hover:text-foreground">
                        Forgot?
                      </Link>
                    </span>
                  </FieldLabel>
                  <Input id="login-password" type="password" required autoComplete="current-password" value={password}
                    onChange={(e) => setPassword((e.target as HTMLInputElement).value)}
                    placeholder="Your password" />
                </Field>

                {oauthErrorMessage && !error && (
                  <Alert variant="error">
                    <AlertDescription>{oauthErrorMessage}</AlertDescription>
                  </Alert>
                )}
                {error && (
                  <Alert variant="error">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
                {emailNotVerified && (
                  <Alert>
                    <AlertDescription className="flex items-center justify-between gap-2">
                      <span>Need a new verification email?</span>
                      <Button type="button" onClick={handleResend} disabled={resendingVerify} variant="outline" size="xs" className="shrink-0 text-xs">
                        {resendingVerify ? "Sending…" : "Resend"}
                      </Button>
                    </AlertDescription>
                  </Alert>
                )}
                {resentMsg && <Alert><AlertDescription>{resentMsg}</AlertDescription></Alert>}
              </div>
            </CardPanel>
            <CardFooter className="flex-col gap-4">
              <Button type="submit" loading={loading} className="w-full">
                {desktopClient ? "Sign in to desktop" : "Sign in"}
              </Button>
              <p className="text-center text-sm text-muted-foreground">
                Don&apos;t have an account?{" "}
                <Link
                  href={signupHref}
                  className="text-foreground underline underline-offset-4 hover:text-foreground/80"
                >
                  Sign up
                </Link>
              </p>
            </CardFooter>
          </form>
        </Card>
      </div>
    </div>
  );
}
