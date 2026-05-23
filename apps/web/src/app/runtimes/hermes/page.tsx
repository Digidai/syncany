import type { Metadata } from "next";
import { RuntimePage } from "@/components/marketing/runtime-page";
import { RUNTIME_DOCS } from "@/components/marketing/runtime-data";

/**
 * Hermes Agent runtime page. NOINDEX until smoke verification
 * completes (codex review HIGH-2). Shared template renders the
 * "Experimental" banner from RUNTIME_DOCS.hermes.verification.
 */
export const metadata: Metadata = {
  title: "Hermes Agent in Raltic — Nous Research, channel-native",
  description: "Run Nous Research's Hermes daemon and use it from a Raltic channel. Memory + skills stay on your machine.",
  alternates: { canonical: "https://raltic.com/runtimes/hermes" },
  robots: { index: false, follow: false },
  openGraph: {
    title: "Hermes Agent in Raltic (Experimental)",
    description: "Bring your local Hermes Agent into a team chat.",
    url: "https://raltic.com/runtimes/hermes",
  },
};

export default function HermesRuntimePage() {
  return <RuntimePage doc={RUNTIME_DOCS.hermes} />;
}
