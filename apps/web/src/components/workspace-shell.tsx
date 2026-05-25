"use client";

import { Sidebar as HeroSidebar, useSidebar } from "@heroui-pro/react/sidebar";
import { Menu } from "lucide-react";
import { Sidebar } from "@/components/sidebar";
import type { Server } from "@/lib/api";

export function WorkspaceShell({
  children,
  server,
}: {
  children: React.ReactNode;
  server: Server;
}) {
  return (
    <HeroSidebar.Provider
      data-testid="workspace-shell"
      data-visual-pass="heroui-pro-v2"
      collapsible="none"
      open
      toggleShortcut={false}
      variant="floating"
      className="relative flex h-screen !min-h-0 overflow-hidden bg-[linear-gradient(135deg,#f8fafc_0%,#eef7f8_48%,#fff7ed_100%)]"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(rgba(15,23,42,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,0.03)_1px,transparent_1px)] bg-[size:32px_32px] dark:hidden"
      />
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 hidden bg-zinc-950 dark:block">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:32px_32px]" />
      </div>

      <Sidebar
        serverSlug={server.slug}
        serverId={server.id}
        serverName={server.name}
        serverIconUrl={server.iconUrl}
      />
      <HeroSidebar.Main
        data-testid="workspace-main"
        className="m-2 ml-2 flex !min-h-0 flex-1 flex-col overflow-hidden rounded-[1.35rem] border border-white/70 bg-white/95 shadow-[0_24px_80px_-36px_rgba(15,23,42,0.45),0_0_0_1px_rgba(255,255,255,0.72)] backdrop-blur-xl md:ml-0 dark:border-white/10 dark:bg-zinc-950/90 dark:shadow-[0_24px_80px_-36px_rgba(0,0,0,0.75)]"
      >
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-zinc-200/70 bg-white/90 px-3 md:hidden dark:border-white/10 dark:bg-zinc-950/90">
          <WorkspaceMobileMenuButton />
          <div className="min-w-0 text-sm font-medium">{server.name}</div>
        </div>
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {children}
        </div>
      </HeroSidebar.Main>
    </HeroSidebar.Provider>
  );
}

function WorkspaceMobileMenuButton() {
  const { setMobileOpen } = useSidebar();

  return (
    <button
      type="button"
      aria-label="Open workspace navigation"
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border bg-white text-muted-foreground shadow-sm hover:bg-zinc-50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-white/10 dark:bg-zinc-900 dark:hover:bg-zinc-800"
      onClick={() => setMobileOpen(true)}
    >
      <Menu className="h-4 w-4" />
    </button>
  );
}
