import type { Metadata } from "next";
import { RuntimePage } from "@/components/marketing/runtime-page";
import { RUNTIME_DOCS } from "@/components/marketing/runtime-data";

/**
 * OpenClaw runtime page. Marked NOINDEX until smoke verification
 * completes (codex review HIGH-2). The body content runs through the
 * shared template, which renders the "Experimental" banner
 * conditionally based on RUNTIME_DOCS.openclaw.verification.
 */
export const metadata: Metadata = {
  title: "OpenClaw in Raltic — your local daemon, channel-native",
  description: "Point Raltic at your existing OpenClaw daemon. Provider keys stay in your daemon — Raltic never sees them.",
  alternates: { canonical: "https://raltic.com/runtimes/openclaw" },
  robots: { index: false, follow: false },
  openGraph: {
    title: "OpenClaw in Raltic (Experimental)",
    description: "Bring your local-first OpenClaw daemon into a team chat.",
    url: "https://raltic.com/runtimes/openclaw",
  },
};

export default function OpenClawRuntimePage() {
  return <RuntimePage doc={RUNTIME_DOCS.openclaw} />;
}
