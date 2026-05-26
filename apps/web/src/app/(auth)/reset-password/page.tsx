"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Card, CardHeader, CardTitle, CardDescription, CardPanel, CardFooter } from "@/components/heroui-pro/card";
import { Button } from "@/components/heroui-pro/button";
import { Input } from "@/components/heroui-pro/input";
import { Field, FieldLabel } from "@/components/heroui-pro/field";
import { Alert, AlertDescription } from "@/components/heroui-pro/alert";

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">Loading…</div>}>
      <ResetForm />
    </Suspense>
  );
}

function ResetForm() {
  const sp = useSearchParams();
  const router = useRouter();
  const token = sp.get("token") ?? "";
  const [pwd, setPwd] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pwd !== pwd2) { setError("Passwords don't match"); return; }
    if (!token) { setError("Reset link is missing the token"); return; }
    setLoading(true); setError(null);
    try {
      const { error } = await authClient.resetPassword({ newPassword: pwd, token });
      if (error) { setError(error.message ?? "Reset failed"); return; }
      router.push("/login?reset=ok");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-sm mx-4">
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">Set a new password</CardTitle>
            <CardDescription>Pick something you'll remember.</CardDescription>
          </CardHeader>
          <form onSubmit={handleSubmit}>
            <CardPanel>
              <div className="space-y-4">
                <Field>
                  <FieldLabel>New password</FieldLabel>
                  <Input type="password" required minLength={8} value={pwd}
                    onChange={(e) => setPwd((e.target as HTMLInputElement).value)} />
                </Field>
                <Field>
                  <FieldLabel>Confirm</FieldLabel>
                  <Input type="password" required value={pwd2}
                    onChange={(e) => setPwd2((e.target as HTMLInputElement).value)} />
                </Field>
                {error && <Alert variant="error"><AlertDescription>{error}</AlertDescription></Alert>}
              </div>
            </CardPanel>
            <CardFooter className="flex-col gap-4">
              <Button type="submit" loading={loading} className="w-full">Update password</Button>
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
