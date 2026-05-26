"use client";

import { Sidebar as HeroSidebar, useSidebar } from "@heroui-pro/react/sidebar";
import { Menu } from "lucide-react";
import { Sidebar } from "@/components/sidebar";
import { Button } from "@/components/heroui-pro/button";
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
      data-template-pass="heroui-pro-template-chat"
      collapsible="none"
      open
      toggleShortcut={false}
      variant="sidebar"
      className="relative flex h-screen !min-h-0 overflow-hidden bg-background text-foreground"
    >
      <Sidebar
        serverSlug={server.slug}
        serverId={server.id}
        serverName={server.name}
        serverIconUrl={server.iconUrl}
      />
      <HeroSidebar.Main
        data-testid="workspace-main"
        className="flex !min-h-0 flex-1 flex-col overflow-hidden bg-background"
      >
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background px-3 md:hidden">
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
    <Button
      type="button"
      aria-label="Open workspace navigation"
      variant="outline"
      size="icon-sm"
      className="h-8 w-8 shrink-0 text-muted-foreground"
      onClick={() => setMobileOpen(true)}
    >
      <Menu className="h-4 w-4" />
    </Button>
  );
}
