"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { Card, CardHeader, CardTitle, CardDescription, CardPanel, CardFooter } from "@raltic/ui/components/ui/card";
import { Button } from "@raltic/ui/components/ui/button";

interface Preview {
  server: { id: string; name: string; slug: string; description: string | null };
  role: string;
}

export default function InvitePage() {
  const params = useParams();
  const router = useRouter();
  const inviteId = params.id as string;
  const session = authClient.useSession();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.previewInvite(inviteId);
        if (!cancelled) setPreview(data);
      } catch (e) {
        if (!cancelled) setError(e instanceof ApiError ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [inviteId]);

  async function handleAccept() {
    setAccepting(true); setError(null);
    try {
      const res = await api.acceptInvite(inviteId);
      // `?welcome=joined` triggers a one-time toast on landing pointing
      // out the user's own personal workspace (top-left switcher) — most
      // invitees don't realize they have one and otherwise wonder why
      // their own agents are "missing" from this workspace's sidebar.
      router.push(`/s/${res.serverSlug}?welcome=joined`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
      setAccepting(false);
    }
  }

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">Loading…</div>;
  }

  if (error || !preview) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-8">
        <div className="max-w-sm w-full text-center">
          <h1 className="text-xl font-semibold">Invite unavailable</h1>
          <p className="mt-2 text-sm text-muted-foreground">{error}</p>
          <Link href="/" className="mt-4 inline-block text-sm underline">Go home</Link>
        </div>
      </div>
    );
  }

  if (!session.data?.user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="w-full max-w-sm mx-4">
          <Card>
            <CardHeader className="text-center">
              <CardTitle>Join {preview.server.name}</CardTitle>
              <CardDescription>{preview.server.description ?? "You've been invited."}</CardDescription>
            </CardHeader>
            <CardPanel>
              <p className="text-center text-sm text-muted-foreground">
                Sign in or create an account to accept this invite.
              </p>
            </CardPanel>
            <CardFooter className="flex-col gap-2">
              <Link href={`/login?next=${encodeURIComponent(`/invite/${inviteId}`)}`}
                className="block w-full rounded bg-foreground px-4 py-2 text-center text-sm text-background hover:opacity-90">
                Sign in
              </Link>
              <Link href={`/signup?next=${encodeURIComponent(`/invite/${inviteId}`)}`}
                className="block w-full rounded border px-4 py-2 text-center text-sm hover:bg-accent">
                Create account
              </Link>
            </CardFooter>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-sm mx-4">
        <Card>
          <CardHeader className="text-center">
            <CardTitle>Join {preview.server.name}</CardTitle>
            <CardDescription>
              {preview.server.description ?? `You've been invited to /${preview.server.slug}.`}
            </CardDescription>
          </CardHeader>
          <CardPanel>
            <p className="text-center text-sm text-muted-foreground">
              You'll join as <strong>{preview.role}</strong>.
            </p>
            {error && <p className="mt-2 text-center text-sm text-destructive-foreground">{error}</p>}
          </CardPanel>
          <CardFooter className="flex-col gap-2">
            <Button onClick={handleAccept} loading={accepting} className="w-full">Accept invite</Button>
            <Link href="/" className="text-xs text-muted-foreground hover:text-foreground">Decline</Link>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
