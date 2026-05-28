"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AppLayout } from "@heroui-pro/react/app-layout";
import { Navbar } from "@heroui-pro/react/navbar";
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
  useVisualViewportHeight();
  const router = useRouter();

  return (
    <AppLayout
      data-testid="workspace-shell"
      data-visual-pass="heroui-pro-v2"
      data-template-pass="heroui-pro-template-chat"
      data-shell-system="heroui-pro-app-layout"
      navigate={router.push}
      scrollMode="page"
      sidebarCollapsible="none"
      sidebarOpen
      toggleShortcut={false}
      sidebarVariant="sidebar"
      className="raltic-workspace-layout relative flex !min-h-0 overflow-hidden bg-background text-foreground"
      style={{ height: "var(--raltic-visual-viewport-height)" }}
      navbar={
        <Navbar.Root
          aria-label="Workspace"
          height="3rem"
          maxWidth="full"
          className="raltic-workspace-mobile-navbar shrink-0 border-b border-border bg-background px-3"
        >
          <Navbar.Header className="flex w-full items-center gap-2">
            <AppLayout.MenuToggle
              aria-label="Open workspace navigation"
              className="h-8 w-8 shrink-0 text-foreground"
              size="sm"
              variant="outline"
            >
              <Menu className="h-4 w-4" />
            </AppLayout.MenuToggle>
            <Navbar.Brand className="min-w-0 flex-1 overflow-hidden text-sm font-medium">
              <span className="block truncate">{server.name}</span>
            </Navbar.Brand>
          </Navbar.Header>
        </Navbar.Root>
      }
      sidebar={
        <Sidebar
          serverSlug={server.slug}
          serverId={server.id}
          serverName={server.name}
          serverIconUrl={server.iconUrl}
        />
      }
    >
      <div
        data-testid="workspace-main"
        className="flex h-full !min-h-0 flex-1 flex-col overflow-hidden bg-background"
      >
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {children}
        </div>
      </div>
    </AppLayout>
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
          if (isKeyboardTarget(active)) {
            active.scrollIntoView({ block: "end", inline: "nearest" });
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
