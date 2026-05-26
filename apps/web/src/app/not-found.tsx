import Link from "next/link";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/heroui-pro/button";

export default function NotFound(): React.ReactElement {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8">
      <div className="max-w-md text-center">
        <Link href="/" className="inline-flex items-center gap-2 font-semibold tracking-tight">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500 to-amber-500 text-white shadow-sm">
            <Sparkles className="h-4 w-4" />
          </span>
          Raltic
        </Link>
        <h1 className="mt-8 text-4xl font-semibold tracking-tight">Page not found</h1>
        <p className="mt-3 text-muted-foreground">
          The page you&apos;re looking for doesn&apos;t exist or was moved.
        </p>
        <div className="mt-8 flex justify-center gap-3 text-sm">
          <Button render={<Link href="/" />}>Go home</Button>
          <Button variant="outline" render={<Link href="/login" />}>Sign in</Button>
        </div>
      </div>
    </div>
  );
}
