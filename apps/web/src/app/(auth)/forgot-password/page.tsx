"use client";

import { useState } from "react";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { Card, CardHeader, CardTitle, CardDescription, CardPanel, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }

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
                  <Input type="email" required value={email}
                    onChange={(e) => setEmail((e.target as HTMLInputElement).value)}
                    placeholder="you@example.com" />
                </Field>
                {error && <Alert variant="error"><AlertDescription>{error}</AlertDescription></Alert>}
                {sent && (
                  <Alert>
                    <AlertDescription>
                      If that email is registered, a reset link is on its way.
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            </CardPanel>
            <CardFooter className="flex-col gap-4">
              <Button type="submit" loading={loading} className="w-full" disabled={sent}>
                {sent ? "Sent" : "Send reset link"}
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
