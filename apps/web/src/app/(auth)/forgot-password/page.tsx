"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { Card, CardHeader, CardTitle, CardDescription, CardPanel, CardFooter } from "@/components/heroui-pro/card";
import { Button } from "@/components/heroui-pro/button";
import { Input } from "@/components/heroui-pro/input";
import { Field, FieldLabel } from "@/components/heroui-pro/field";
import { Alert, AlertDescription } from "@/components/heroui-pro/alert";

const RESEND_COOLDOWN_MS = 30_000;

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Anchor the cooldown to a wall-clock target so a backgrounded tab
  // (whose setTimeout is throttled) doesn't artificially extend the wait.
  const [resendReadyAt, setResendReadyAt] = useState<number>(0);
  const [now, setNow] = useState<number>(() => Date.now());

  // Tick `now` while a cooldown is active. Effect re-runs only when
  // `resendReadyAt` changes (a new send), NOT on every tick — otherwise
  // the interval gets torn down + recreated 4×/sec for the entire 30s.
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError(null);
    try {
      const { error } = await authClient.requestPasswordReset({
        email,
        redirectTo: `${location.origin}/reset-password`,
      });
      if (error) {
        setError(error.message ?? "Failed to send reset email");
        return;
      }
      setSent(true);
      setResendReadyAt(Date.now() + RESEND_COOLDOWN_MS);
      setNow(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }

  const canSubmit = !loading && cooldown === 0;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-sm mx-4">
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">Reset your password</CardTitle>
            <CardDescription>We&apos;ll email you a link to set a new one.</CardDescription>
          </CardHeader>
          <form onSubmit={handleSubmit}>
            <CardPanel>
              <div className="space-y-4">
                <Field>
                  <FieldLabel>Email</FieldLabel>
                  <Input type="email" required autoComplete="email" value={email}
                    onChange={(e) => setEmail((e.target as HTMLInputElement).value)}
                    placeholder="you@example.com" />
                </Field>
                {error && <Alert variant="error"><AlertDescription>{error}</AlertDescription></Alert>}
                {sent && (
                  <Alert>
                    <AlertDescription>
                      If that email is registered, a reset link is on its way.
                      Check your spam folder if it doesn&apos;t arrive in a minute.
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            </CardPanel>
            <CardFooter className="flex-col gap-4">
              <Button type="submit" loading={loading} className="w-full" disabled={!canSubmit}>
                {cooldown > 0 ? `Resend in ${cooldown}s` : sent ? "Resend reset link" : "Send reset link"}
              </Button>
              <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground">
                Back to sign in
              </Link>
            </CardFooter>
          </form>
        </Card>
      </div>
    </div>
  );
}
