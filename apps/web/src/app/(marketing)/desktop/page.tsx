import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, ArrowRight, Download, ExternalLink, Monitor, RefreshCw } from "lucide-react";
import { MarketingFooter } from "@/components/marketing/footer";
import { MarketingButton } from "@/components/marketing/marketing-button";
import { Card, CardHeader, CardPanel } from "@/components/heroui-pro/card";
import { Chip } from "@/components/heroui-pro/chip";

const RELEASES_URL = "https://github.com/Digidai/raltic/releases";

export const metadata: Metadata = {
  title: "Raltic Desktop Beta · Internal test build",
  description: "Download the unsigned Raltic Desktop beta for internal testing. Manual install only; signed public releases come later.",
  alternates: { canonical: "https://raltic.com/desktop" },
  robots: { index: false, follow: false },
  openGraph: {
    type: "website",
    title: "Raltic Desktop Beta",
    description: "Unsigned internal test builds for Raltic Desktop.",
    url: "https://raltic.com/desktop",
  },
};

type DesktopBetaPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function DesktopBetaPage({ searchParams }: DesktopBetaPageProps) {
  const params = await searchParams;
  const fromDesktopWelcome = params?.from === "desktop-welcome";

  return (
    <>
      <main className="bg-black text-white">
        {fromDesktopWelcome ? <DesktopReturnBar /> : null}
        <Card render={<section className="border-b border-zinc-900 px-6 pt-28 pb-16 sm:pt-36" />} className="w-full rounded-none border-0 shadow-none">
          <CardPanel className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[1fr_360px] lg:items-start">
            <div>
              <Chip size="sm" variant="soft" color="warning" className="gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-300" aria-hidden="true" />
                Internal beta
              </Chip>
              <h1 className="mt-7 max-w-3xl text-balance text-5xl font-medium leading-[1.05] text-white sm:text-6xl">
                Raltic Desktop beta
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-zinc-300">
                A test build for connecting this computer to Raltic without
                running a separate terminal bridge. It is unsigned today, so
                installation has extra macOS / Windows warnings.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <MarketingButton href={RELEASES_URL} target="_blank" rel="noreferrer" variant="nav-primary" className="!h-10 !gap-2 !px-4">
                  Open GitHub Releases <ExternalLink className="h-4 w-4" />
                </MarketingButton>
                <MarketingButton href="#install" variant="secondary" className="!h-10 !gap-2 !border-zinc-700 !bg-transparent !px-4 hover:!border-zinc-500 hover:!bg-zinc-950">
                  Read install notes <ArrowRight className="h-4 w-4" />
                </MarketingButton>
              </div>
            </div>

            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-md border border-zinc-800 bg-black">
                    <Monitor className="h-5 w-5 text-cyan-300" />
                  </div>
                  <div>
                    <p className="font-medium text-white">Current status</p>
                    <p className="text-sm text-zinc-500">Manual beta install</p>
                  </div>
                </div>
              </CardHeader>
              <CardPanel className="space-y-3 text-sm">
                <StatusRow label="Code signing" value="Not enabled" />
                <StatusRow label="Auto-update" value="Not promised for beta" />
                <StatusRow label="Distribution" value="GitHub pre-release" />
                <StatusRow label="Audience" value="Named testers only" />
              </CardPanel>
            </Card>
          </CardPanel>
        </Card>

        <Card render={<section id="install" className="px-6 py-16" />} className="w-full rounded-none border-0 shadow-none">
          <CardPanel className="mx-auto max-w-6xl">
            <div className="mb-8 flex items-center gap-2 text-sm font-medium text-zinc-300">
              <Download className="h-4 w-4 text-cyan-300" />
              Install path
            </div>
            <div className="grid gap-4 lg:grid-cols-3">
              <Step
                n="1"
                title="Download from GitHub"
                body="Open Releases and choose the newest Raltic Desktop beta asset for your Mac. Apple Silicon users usually want the arm64 DMG or ZIP."
              />
              <Step
                n="2"
                title="Open despite warnings"
                body="Because the beta is unsigned, macOS may require right-click Open or removing quarantine. This is expected for internal testing."
              />
              <Step
                n="3"
                title="Connect this computer"
                body="Sign in, return to the desktop launch screen, then click Connect this computer. The app creates a workspace-scoped bridge key."
              />
            </div>
          </CardPanel>
        </Card>

        <Card render={<section className="border-y border-zinc-900 bg-zinc-950/55 px-6 py-14" />} className="w-full rounded-none border-0 shadow-none">
          <CardPanel className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[1fr_1fr]">
            <Card>
              <CardHeader>
                <div className="mb-4 flex items-center gap-2 text-sm font-medium text-amber-200">
                  <AlertTriangle className="h-4 w-4" />
                  Unsigned beta warnings
                </div>
              </CardHeader>
              <CardPanel className="pt-0">
                <ul className="space-y-3 text-sm leading-6 text-zinc-400">
                  <li>macOS Gatekeeper may say the app cannot be opened or is from an unidentified developer.</li>
                  <li>Windows SmartScreen may show Unknown Publisher until Windows signing is added.</li>
                  <li>Do not treat this as the public release channel.</li>
                </ul>
              </CardPanel>
            </Card>
            <Card>
              <CardHeader>
                <div className="mb-4 flex items-center gap-2 text-sm font-medium text-cyan-200">
                  <RefreshCw className="h-4 w-4" />
                  Updates during beta
                </div>
              </CardHeader>
              <CardPanel className="pt-0">
                <p className="text-sm leading-6 text-zinc-400">
                  Install new beta versions manually from GitHub Releases. The
                  production auto-update channel will be enabled after signed and
                  notarized releases are available.
                </p>
              </CardPanel>
            </Card>
          </CardPanel>
        </Card>
      </main>
      <MarketingFooter />
    </>
  );
}

function DesktopReturnBar() {
  return (
    <Card
      render={<div className="border-b border-cyan-400/20 bg-black/90 px-6 py-3 backdrop-blur-xl" />}
      className="w-full rounded-none border-0 bg-transparent"
    >
    
      <CardPanel className="px-0">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Link
            href="/desktop/welcome"
            className="inline-flex items-center gap-2 text-sm font-semibold text-cyan-100 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to desktop setup
          </Link>
          <p className="text-xs text-zinc-500">Install notes opened inside Raltic Desktop</p>
        </div>
      </CardPanel>
    </Card>
  );
}

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <Card className="bg-zinc-950/70 px-0">
      <CardPanel className="grid grid-cols-2 gap-3 py-3">
        <dt className="text-zinc-500">{label}</dt>
        <dd className="text-right text-zinc-200">{value}</dd>
      </CardPanel>
    </Card>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <Card>
      <CardPanel>
        <div className="flex h-8 w-8 items-center justify-center rounded-md border border-zinc-800 bg-black text-sm font-medium text-cyan-300">
          {n}
        </div>
        <h2 className="mt-5 text-lg font-medium text-white">{title}</h2>
        <p className="mt-3 text-sm leading-6 text-zinc-400">{body}</p>
      </CardPanel>
    </Card>
  );
}
