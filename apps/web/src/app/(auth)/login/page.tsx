"use client";

import { Suspense, useState } from "react";
import { signIn, authClient } from "@/lib/auth-client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardHeader, CardTitle, CardDescription, CardPanel, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { Alert, AlertDescription } from "@/components/ui/alert";

const HAS_GOOGLE = !!process.env.NEXT_PUBLIC_GOOGLE_ENABLED;

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
  const [emailNotVerified, setEmailNotVerified] = useState(false);
  const [resendingVerify, setResendingVerify] = useState(false);
  const [resentMsg, setResentMsg] = useState<string | null>(null);
  const router = useRouter();
  const sp = useSearchParams();
  const justReset = sp.get("reset") === "ok";

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
      router.push("/");
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
    await authClient.signIn.social({ provider: "google", callbackURL: "/" });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-sm mx-4">
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">Syncany</CardTitle>
            <CardDescription>Sign in to your workspace</CardDescription>
          </CardHeader>
          <form onSubmit={handleLogin}>
            <CardPanel>
              <div className="space-y-4">
                {justReset && (
                  <Alert>
                    <AlertDescription>Password updated. Sign in below.</AlertDescription>
                  </Alert>
                )}
                {HAS_GOOGLE && (
                  <>
                    <Button type="button" variant="outline" className="w-full" onClick={handleGoogle}>
                      Continue with Google
                    </Button>
                    <div className="relative">
                      <div className="absolute inset-0 flex items-center"><div className="w-full border-t" /></div>
                      <div className="relative flex justify-center text-[10px] uppercase tracking-wider"><span className="bg-card px-2 text-muted-foreground">or</span></div>
                    </div>
                  </>
                )}
                <Field>
                  <FieldLabel>Email</FieldLabel>
                  <Input type="email" required value={email}
                    onChange={(e) => setEmail((e.target as HTMLInputElement).value)}
                    placeholder="you@example.com" />
                </Field>
                <Field>
                  <FieldLabel>
                    <span className="flex items-center justify-between">
                      <span>Password</span>
                      <Link href="/forgot-password" className="text-[11px] text-muted-foreground hover:text-foreground">
                        Forgot?
                      </Link>
                    </span>
                  </FieldLabel>
                  <Input type="password" required value={password}
                    onChange={(e) => setPassword((e.target as HTMLInputElement).value)}
                    placeholder="Your password" />
                </Field>

                {error && (
                  <Alert variant="error">
                    <AlertDescription>
                      {error}
                      {emailNotVerified && (
                        <button type="button" onClick={handleResend} disabled={resendingVerify}
                          className="ml-2 underline">
                          {resendingVerify ? "Sending…" : "Resend verification"}
                        </button>
                      )}
                    </AlertDescription>
                  </Alert>
                )}
                {resentMsg && <Alert><AlertDescription>{resentMsg}</AlertDescription></Alert>}
              </div>
            </CardPanel>
            <CardFooter className="flex-col gap-4">
              <Button type="submit" loading={loading} className="w-full">
                Sign in
              </Button>
              <p className="text-center text-sm text-muted-foreground">
                Don&apos;t have an account?{" "}
                <Link href="/signup"
                  className="text-foreground underline underline-offset-4 hover:text-foreground/80">
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
