"use client";

import { useEffect } from "react";
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
  useVisualViewportHeight();

  return (
    <HeroSidebar.Provider
      data-testid="workspace-shell"
      data-visual-pass="heroui-pro-v2"
      data-template-pass="heroui-pro-template-chat"
      collapsible="none"
      open
      toggleShortcut={false}
      variant="sidebar"
      className="relative flex !min-h-0 overflow-hidden bg-background text-foreground"
      style={{ height: "var(--raltic-visual-viewport-height)" }}
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

function useVisualViewportHeight() {
  useEffect(() => {
    const root = document.documentElement;
    let frame = 0;
    let focusTimer: number | null = null;

    const update = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const visualViewport = window.visualViewport;
        const measuredHeight = visualViewport?.height ?? window.innerHeight;
        const height = measuredHeight > 0 ? Math.round(measuredHeight) : window.innerHeight;
        root.style.setProperty("--raltic-visual-viewport-height", `${height}px`);
        if (focusTimer) window.clearTimeout(focusTimer);
        focusTimer = window.setTimeout(() => {
          const active = document.activeElement;
          if (isKeyboardTarget(active) && !active.closest("[data-testid='message-composer']")) {
            active.scrollIntoView({ block: "nearest", inline: "nearest" });
          }
        }, 50);
      });
    };

    update();
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);

    return () => {
      window.cancelAnimationFrame(frame);
      if (focusTimer) window.clearTimeout(focusTimer);
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      root.style.removeProperty("--raltic-visual-viewport-height");
    };
  }, []);
}

function isKeyboardTarget(target: Element | null): target is HTMLElement {
  return target instanceof HTMLElement
    && target.matches("input, textarea, select, [contenteditable='true'], [role='textbox']");
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
