"use client";

import { useState } from "react";
import { signUp } from "@/lib/auth-client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardTitle, CardDescription, CardPanel, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const { error } = await signUp.email({
        email,
        password,
        name: displayName || email.split("@")[0],
      });
      if (error) {
        const code = (error as { code?: string }).code ?? "";
        if (code === "USER_ALREADY_EXISTS" || /already exists|already registered/i.test(error.message ?? "")) {
          setError("That email is already registered. Sign in or reset your password.");
        } else {
          setError(error.message ?? "Sign-up failed");
        }
        return;
      }
      // Email verification is required: don't try to navigate to /, just inform.
      setError("Check your inbox to verify your email, then sign in.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-sm mx-4">
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">Syncany</CardTitle>
            <CardDescription>Create your account</CardDescription>
          </CardHeader>
          <form onSubmit={handleSignup}>
            <CardPanel>
              <div className="space-y-4">
                <Field>
                  <FieldLabel>Display name</FieldLabel>
                  <Input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName((e.target as HTMLInputElement).value)}
                    placeholder="Your name"
                  />
                </Field>

                <Field>
                  <FieldLabel>Email</FieldLabel>
                  <Input
                    type="email"
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
                    value={password}
                    onChange={(e) => setPassword((e.target as HTMLInputElement).value)}
                    required
                    placeholder="At least 6 characters"
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
                  href="/login"
                  className="text-foreground underline underline-offset-4 hover:text-foreground/80"
                >
                  Sign in
                </Link>
              </p>
            </CardFooter>
          </form>
        </Card>
      </div>
    </div>
  );
}
