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
      collapsible="none"
      open
      toggleShortcut={false}
      className="relative flex h-screen !min-h-0 overflow-hidden bg-background p-2"
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 dark:hidden">
        <div className="absolute -top-40 left-1/3 h-[420px] w-[680px] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,_rgba(6,182,212,0.10),_transparent_65%)]" />
        <div className="absolute -bottom-32 right-[-120px] h-[360px] w-[480px] rounded-full bg-[radial-gradient(ellipse_at_center,_rgba(245,158,11,0.08),_transparent_65%)]" />
      </div>

      <Sidebar
        serverSlug={server.slug}
        serverId={server.id}
        serverName={server.name}
        serverIconUrl={server.iconUrl}
      />
      <main
        data-testid="workspace-main"
        className="flex flex-1 flex-col overflow-hidden rounded-2xl border bg-card shadow-[0_1px_0_rgba(0,0,0,0.02),0_8px_24px_-12px_rgba(0,0,0,0.08)]"
      >
        <div className="flex h-12 shrink-0 items-center gap-2 border-b px-3 md:hidden">
          <WorkspaceMobileMenuButton />
          <div className="min-w-0 text-sm font-medium">{server.name}</div>
        </div>
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {children}
        </div>
      </main>
    </HeroSidebar.Provider>
  );
}

function WorkspaceMobileMenuButton() {
  const { setMobileOpen } = useSidebar();

  return (
    <button
      type="button"
      aria-label="Open workspace navigation"
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => setMobileOpen(true)}
    >
      <Menu className="h-4 w-4" />
    </button>
  );
}
