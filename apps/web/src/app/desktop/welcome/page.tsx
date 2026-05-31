import type { Metadata } from "next";
import { ArrowRight, KeyRound, Laptop, MessageSquare } from "lucide-react";
import type { ElementType } from "react";

import { MarketingButton } from "@/components/marketing/marketing-button";
import { RalticLogo } from "@/components/raltic-logo";
import { Card, CardPanel } from "@/components/heroui-pro/card";
import { Chip } from "@/components/heroui-pro/chip";

export const metadata: Metadata = {
  title: "Raltic Desktop",
  description: "Connect this computer to a Raltic workspace.",
  robots: {
    index: false,
    follow: false,
  },
};

const steps = [
  {
    icon: Laptop,
    title: "Use this computer as the local bridge",
    body: "Keep agent processes on this computer while the workspace stays in Raltic.",
  },
  {
    icon: KeyRound,
    title: "Create a scoped machine key",
    body: "After sign-in, Raltic saves a workspace-specific key for the desktop bridge.",
  },
  {
    icon: MessageSquare,
    title: "Return to your channels",
    body: "Once connected, the app opens your workspace with local agents available.",
  },
];

export default function DesktopWelcomePage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-5xl items-center px-6 py-10 sm:px-8">
        <section className="grid w-full gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
          <div className="max-w-xl">
            <div className="mb-8 flex items-center gap-3">
              <RalticLogo size={44} idSuffix="desktop-welcome" />
              <div>
                <p className="font-heading text-xl font-semibold">
                  Raltic Desktop
                </p>
                <Chip size="sm" variant="soft" color="warning" className="mt-1">Internal beta</Chip>
              </div>
            </div>

            <h1 className="font-heading text-4xl font-semibold leading-tight sm:text-5xl">
              Connect this computer to your workspace.
            </h1>
            <p className="mt-5 max-w-lg text-base leading-7 text-muted-foreground sm:text-lg">
              Raltic Desktop runs the local bridge for Claude Code and Codex agents, then brings you back to the channels where the work happens.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <MarketingButton href="/desktop/launch" variant="desktop-primary" className="!gap-2">
                Get started
                <ArrowRight className="size-4" aria-hidden="true" />
              </MarketingButton>
              <MarketingButton href="/desktop?from=desktop-welcome#install" variant="desktop-secondary">
                Beta install notes
              </MarketingButton>
            </div>
          </div>

          <Card className="p-5">
            <CardPanel className="space-y-3 p-0">
              {steps.map((step) => <WelcomeStep key={step.title} {...step} />)}
            </CardPanel>
          </Card>
        </section>
      </div>
    </main>
  );
}

function WelcomeStep({
  icon: Icon,
  title,
  body,
}: {
  icon: ElementType<{ className?: string }>;
  title: string;
  body: string;
}) {
  return (
    <Card className="grid grid-cols-[2.75rem_1fr] gap-3 p-4 shadow-none">
      <CardPanel className="grid grid-cols-[2.75rem_1fr] gap-3 p-0">
        <div className="flex size-11 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-700 dark:text-cyan-400">
          <Icon className="size-5" aria-hidden="true" />
        </div>
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{body}</p>
        </div>
      </CardPanel>
    </Card>
  );
}
