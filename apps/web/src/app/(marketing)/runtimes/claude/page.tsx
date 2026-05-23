import type { Metadata } from "next";
import { RuntimePage } from "@/components/marketing/runtime-page";
import { RUNTIME_DOCS } from "@/components/marketing/runtime-data";

export const metadata: Metadata = {
  title: "Claude Code in Raltic — multiplayer Claude for your team",
  description: "Run Claude Code in a team channel instead of a private terminal. Bring your own Anthropic auth — Raltic never sees your keys.",
  alternates: { canonical: "https://raltic.com/runtimes/claude" },
  openGraph: {
    title: "Claude Code, multiplayer",
    description: "Anthropic Claude Code in a Raltic channel. Your repo + key stay local; only chat crosses the wire.",
    url: "https://raltic.com/runtimes/claude",
  },
};

export default function ClaudeRuntimePage() {
  return <RuntimePage doc={RUNTIME_DOCS.claude} />;
}
