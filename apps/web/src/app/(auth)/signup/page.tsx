"use client";

import { Suspense, useEffect, useState } from "react";
import { MailCheckIcon, ExternalLinkIcon } from "lucide-react";
import { signUp, authClient } from "@/lib/auth-client";
import { safeNext } from "@/lib/safe-redirect";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Card, CardHeader, CardTitle, CardDescription, CardPanel, CardFooter } from "@raltic/ui/components/ui/card";
import { Button } from "@raltic/ui/components/ui/button";
import { Input } from "@raltic/ui/components/ui/input";
import { Field, FieldLabel } from "@raltic/ui/components/ui/field";
import { Alert, AlertDescription } from "@raltic/ui/components/ui/alert";

const MIN_PASSWORD_LENGTH = 8;
const HAS_GOOGLE = !!process.env.NEXT_PUBLIC_GOOGLE_ENABLED;
const RESEND_COOLDOWN_MS = 30_000;

export default function SignupPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Loading…</div>}>
      <SignupInner />
    </Suspense>
  );
}

function SignupInner() {
  const sp = useSearchParams();
  const nextPath = safeNext(sp.get("next")) ?? "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  // `sentTo` holds the verified email address that we sent the link to.
  // Non-null means we're in the post-signup "check your inbox" state.
  // Stored separately from `email` so editing the field later doesn't
  // change what we display in the success panel (and "Use different email"
  // can reset it cleanly).
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);

  // Resend cooldown, anchored to wall clock so backgrounded tabs don't
  // artificially extend the wait. Pattern lifted from forgot-password.
  const [resendReadyAt, setResendReadyAt] = useState<number>(0);
  const [now, setNow] = useState<number>(() => Date.now());
  const [resendLoading, setResendLoading] = useState(false);
  const [resendNotice, setResendNotice] = useState<string | null>(null);
  useEffect(() => {
    if (resendReadyAt <= Date.now()) return;
    const t = setInterval(() => {
      const t0 = Date.now();
      setNow(t0);
      if (t0 >= resendReadyAt) clearInterval(t);
    }, 250);
    return () => clearInterval(t);
  }, [resendReadyAt]);
  const cooldown = Math.max(0, Math.ceil((resendReadyAt - now) / 1000));

  async function handleGoogle() {
    if (oauthLoading) return;
    setOauthLoading(true);
    try {
      await authClient.signIn.social({ provider: "google", callbackURL: nextPath });
    } finally { setOauthLoading(false); }
  }

  function verifyCallback() {
    return nextPath !== "/"
      ? `/verify-email?next=${encodeURIComponent(nextPath)}`
      : "/verify-email";
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const { error } = await signUp.email({
        email,
        password,
        // Use trimmed display name; fall back to email local-part only if empty
        // so the user is at least mildly recognizable in @mentions.
        name: displayName.trim() || email.split("@")[0],
        callbackURL: verifyCallback(),
      });
      if (error) {
        const code = (error as { code?: string }).code ?? "";
        if (code === "USER_ALREADY_EXISTS" || /already exists|already registered/i.test(error.message ?? "")) {
          setError("That email is already registered. Sign in or reset your password.");
        } else if (code === "PASSWORD_TOO_SHORT" || /password.*short/i.test(error.message ?? "")) {
          setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
        } else {
          setError(error.message ?? "Sign-up failed");
        }
        return;
      }
      setSentTo(email);
      setResendReadyAt(Date.now() + RESEND_COOLDOWN_MS);
      setNow(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    if (!sentTo || cooldown > 0 || resendLoading) return;
    setResendLoading(true);
    setResendNotice(null);
    try {
      const { error } = await authClient.sendVerificationEmail({
        email: sentTo,
        callbackURL: verifyCallback(),
      });
      if (error) {
        setResendNotice(error.message ?? "Couldn't resend — try again in a minute.");
        return;
      }
      setResendNotice("Sent again — check your inbox.");
      setResendReadyAt(Date.now() + RESEND_COOLDOWN_MS);
      setNow(Date.now());
    } catch (e) {
      setResendNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setResendLoading(false);
    }
  }

  function handleUseDifferentEmail() {
    setSentTo(null);
    setResendNotice(null);
    setResendReadyAt(0);
    // Keep `email` so the user can edit rather than re-type from scratch,
    // but clear the password — most likely cause of "use different email"
    // is hitting USER_ALREADY_EXISTS; keeping the plaintext password
    // around to re-submit against a different identity is a security
    // smell (and password managers will autofill again anyway).
    setPassword("");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-sm mx-4">
        {sentTo ? (
          <CheckInboxCard
            email={sentTo}
            cooldown={cooldown}
            resendLoading={resendLoading}
            resendNotice={resendNotice}
            onResend={handleResend}
            onUseDifferentEmail={handleUseDifferentEmail}
            nextPath={nextPath}
          />
        ) : (
          <Card>
            <CardHeader className="text-center">
              <CardTitle className="text-2xl">Raltic</CardTitle>
              <CardDescription>Create your account</CardDescription>
            </CardHeader>
            <form onSubmit={handleSignup}>
              <CardPanel>
                <div className="space-y-4">
                  {HAS_GOOGLE && (
                    <>
                      <Button type="button" variant="outline" className="w-full"
                        onClick={handleGoogle} loading={oauthLoading} disabled={oauthLoading}>
                        Continue with Google
                      </Button>
                      <div className="relative">
                        <div className="absolute inset-0 flex items-center"><div className="w-full border-t" /></div>
                        <div className="relative flex justify-center text-[10px] uppercase tracking-wider">
                          <span className="bg-card px-2 text-muted-foreground">or</span>
                        </div>
                      </div>
                    </>
                  )}
                  <Field>
                    <FieldLabel>Display name</FieldLabel>
                    <Input
                      type="text"
                      autoComplete="name"
                      value={displayName}
                      onChange={(e) => setDisplayName((e.target as HTMLInputElement).value)}
                      placeholder="Your name (shown to teammates)"
                    />
                  </Field>

                  <Field>
                    <FieldLabel>Email</FieldLabel>
                    <Input
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail((e.target as HTMLInputElement).value)}
                      required
                      placeholder="you@example.com"
                    />
                  </Field>

                  <Field>
                    <FieldLabel>Password</FieldLabel>
                    <Input
                      type="password"
                      autoComplete="new-password"
                      minLength={MIN_PASSWORD_LENGTH}
                      value={password}
                      onChange={(e) => setPassword((e.target as HTMLInputElement).value)}
                      required
                      placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                    />
                  </Field>

                  {error && (
                    <Alert variant="error">
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  )}
                </div>
              </CardPanel>
              <CardFooter className="flex-col gap-4">
                <Button type="submit" loading={loading} className="w-full">
                  Create account
                </Button>
                <p className="text-center text-sm text-muted-foreground">
                  Already have an account?{" "}
                  <Link
                    href={nextPath !== "/" ? `/login?next=${encodeURIComponent(nextPath)}` : "/login"}
                    className="text-foreground underline underline-offset-4 hover:text-foreground/80"
                  >
                    Sign in
                  </Link>
                </p>
              </CardFooter>
            </form>
          </Card>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Post-signup "check your inbox" panel.
//
// Why a dedicated card rather than an inline Alert on the form:
//   1) The verification email is mandatory — staying on the form implies the
//      user can still edit fields and resubmit, but resubmitting the same
//      email just returns USER_ALREADY_EXISTS. Switching surfaces tells the
//      user "you are done here, go to your inbox".
//   2) The next action is OUT of the app (mail client). The CTA needs to
//      reflect that — a deep link to their webmail provider beats a generic
//      "Resend" button.
//   3) "Resend" is a recovery action, not the primary one. Demoting it to a
//      secondary button (with cooldown) avoids users spamming the mailer.
// ---------------------------------------------------------------------------
function CheckInboxCard({
  email, cooldown, resendLoading, resendNotice,
  onResend, onUseDifferentEmail, nextPath,
}: {
  email: string;
  cooldown: number;
  resendLoading: boolean;
  resendNotice: string | null;
  onResend: () => void;
  onUseDifferentEmail: () => void;
  nextPath: string;
}) {
  const mailbox = mailboxFor(email);
  return (
    <Card role="status" aria-live="polite">
      {/* CardHeader is a CSS Grid (single column by default). Use
          `justify-items-center` — the grid analog of items-center — to
          actually horizontally center the icon ball. `items-center`
          alone only changes vertical align-items and leaves the icon
          left-aligned. */}
      <CardHeader className="justify-items-center text-center">
        <div className="mb-2 flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <MailCheckIcon className="size-6" aria-hidden="true" />
        </div>
        <CardTitle className="text-2xl">Check your inbox</CardTitle>
        <CardDescription>
          We sent a verification link to
          <br />
          <span className="font-medium text-foreground break-all">{email}</span>
        </CardDescription>
      </CardHeader>
      <CardPanel>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Click the link in the email to finish signing up. It can take a
            minute to arrive — check your spam folder if you don&apos;t see it.
          </p>
          {resendNotice && (
            <Alert>
              <AlertDescription>{resendNotice}</AlertDescription>
            </Alert>
          )}
        </div>
      </CardPanel>
      <CardFooter className="flex-col gap-3">
        {mailbox && (
          <Button
            className="w-full"
            render={<a href={mailbox.url} target="_blank" rel="noopener noreferrer" />}
          >
            Open {mailbox.label}
            <ExternalLinkIcon className="ms-1 size-4" />
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={onResend}
          loading={resendLoading}
          disabled={cooldown > 0 || resendLoading}
        >
          {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend email"}
        </Button>
        <div className="flex w-full items-center justify-between text-sm">
          <button
            type="button"
            onClick={onUseDifferentEmail}
            className="text-muted-foreground hover:text-foreground"
          >
            Use a different email
          </button>
          <Link
            href={nextPath !== "/" ? `/login?next=${encodeURIComponent(nextPath)}` : "/login"}
            className="text-muted-foreground hover:text-foreground"
          >
            Already verified? Sign in
          </Link>
        </div>
      </CardFooter>
    </Card>
  );
}

// Map common email providers to their webmail URL so the primary CTA goes
// straight to the inbox the user actually checks. Falls back to null (i.e.
// no "Open" button) for self-hosted / corporate domains where guessing
// would point at the wrong place.
function mailboxFor(email: string): { label: string; url: string } | null {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return null;
  if (domain === "gmail.com" || domain === "googlemail.com") {
    return { label: "Gmail", url: "https://mail.google.com" };
  }
  if (domain === "outlook.com" || domain === "hotmail.com" || domain === "live.com" || domain === "msn.com") {
    return { label: "Outlook", url: "https://outlook.live.com/mail" };
  }
  if (domain === "yahoo.com" || domain === "ymail.com") {
    return { label: "Yahoo Mail", url: "https://mail.yahoo.com" };
  }
  if (domain === "icloud.com" || domain === "me.com" || domain === "mac.com") {
    return { label: "iCloud Mail", url: "https://www.icloud.com/mail" };
  }
  if (domain === "proton.me" || domain === "protonmail.com") {
    return { label: "Proton Mail", url: "https://mail.proton.me" };
  }
  // Foxmail is Tencent-owned and shares QQ Mail's backend — same webmail.
  if (domain === "qq.com" || domain === "foxmail.com" || domain === "vip.qq.com") {
    return { label: "QQ 邮箱", url: "https://mail.qq.com" };
  }
  if (domain === "163.com" || domain === "126.com" || domain === "yeah.net") {
    return { label: "网易邮箱", url: "https://mail.163.com" };
  }
  if (domain === "sina.com" || domain === "sina.cn") {
    return { label: "新浪邮箱", url: "https://mail.sina.com.cn" };
  }
  if (domain === "sohu.com") {
    return { label: "搜狐邮箱", url: "https://mail.sohu.com" };
  }
  if (domain === "aliyun.com") {
    return { label: "阿里云邮箱", url: "https://mail.aliyun.com" };
  }
  if (domain === "139.com") {
    return { label: "139 邮箱", url: "https://mail.10086.cn" };
  }
  return null;
}
