"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useParams } from "next/navigation";
import { Building2, Users, Hash, KeyRound, Plug, User as UserIcon } from "lucide-react";
import { api, type Server } from "@/lib/api";
import { notifyThrown } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { Button } from "@/components/heroui-pro/button";
import { Card, CardPanel } from "@/components/heroui-pro/card";

// ---------------------------------------------------------------------------
// Shared context — every tab needs server { id, slug, role }. Fetched once
// here so switching tabs is instant (no per-tab refetch flicker).
// ---------------------------------------------------------------------------

interface SettingsContextValue {
  server: Server;
  /** Force a re-fetch of the server record. Call after rename/icon change so
   *  every tab (and the page <title>) sees the new value. */
  refreshServer: () => Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function useSettings(): SettingsContextValue {
  const v = useContext(SettingsContext);
  if (!v) throw new Error("useSettings must be used inside the settings layout");
  return v;
}

// ---------------------------------------------------------------------------
// Tab navigation. Active tab inferred from pathname rather than stored as
// state so back/forward and direct URL load both work.
// ---------------------------------------------------------------------------

const TABS = [
  { slug: "workspace", label: "Workspace",         Icon: Building2 },
  { slug: "members",   label: "Members & invites", Icon: Users },
  { slug: "agents",    label: "Channels & agents", Icon: Hash },
  // "Runtimes" reframes the per-laptop bridge concept around what
  // actually matters to the user: the compute environment that runs
  // their agents (Claude/Codex/Gemini/Copilot CLIs on a machine). The
  // underlying schema column is still `machine_keys`; we keep the
  // route slug "keys" so deep-links from emails / past wizards still
  // resolve, but the label + page heading say Runtimes.
  { slug: "keys",      label: "Runtimes",          Icon: KeyRound },
  { slug: "connectors", label: "Connectors",       Icon: Plug },
  { slug: "account",   label: "Account",           Icon: UserIcon },
] as const;

export default function SettingsLayout({ children }: { children: ReactNode }) {
  const { slug } = useParams<{ slug: string }>();
  const pathname = usePathname();
  const [server, setServer] = useState<Server | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Mounted ref + request id so the exported `loadServer` (used by retry
  // button and by `refreshServer` after a rename) also survives unmount /
  // overlapping calls. Initial slug-change effect uses its own cancelled
  // flag below — both arrive at the same invariant: only the latest
  // request's response is allowed to mutate state.
  const mounted = useRef(false);
  const requestSeq = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  async function loadServer() {
    const seq = ++requestSeq.current;
    setLoadError(null);
    try {
      const data = await api.getServerBySlug(slug);
      if (!mounted.current || seq !== requestSeq.current) return;
      setServer(data.server);
    } catch (e) {
      if (!mounted.current || seq !== requestSeq.current) return;
      const msg = e instanceof Error ? e.message : String(e);
      setLoadError(msg);
      notifyThrown("Couldn't load workspace", e);
    }
  }

  // Slug-change effect — fires loadServer through the same guarded path.
  useEffect(() => { loadServer(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [slug]);

  if (loadError && !server) {
    return (
      <Card className="mx-auto mt-12 max-w-md">
        <CardPanel className="space-y-3 p-6 text-center">
          <p className="text-sm font-medium">Couldn&apos;t load this workspace.</p>
          <p className="break-all text-xs text-muted-foreground">{loadError}</p>
          <Button
            type="button"
            onClick={loadServer}
            variant="outline"
            size="sm"
          >
            Retry
          </Button>
        </CardPanel>
      </Card>
    );
  }

  if (!server) {
    return (
      <Card className="m-auto w-full max-w-sm border-dashed text-center !shadow-none">
        <CardPanel className="text-sm text-muted-foreground">Loading…</CardPanel>
      </Card>
    );
  }

  return (
    <SettingsContext.Provider value={{ server, refreshServer: loadServer }}>
      <div className="flex h-full w-full min-w-0 flex-1 flex-col overflow-hidden sm:flex-row">
        {/* Left tab nav. min-w-0 + sticky on mobile collapses to a horizontal
            scroll bar so narrow screens still navigate without scrolling
            past the content. */}
        <nav
          aria-label="Settings sections"
          className="hidden w-60 shrink-0 overflow-y-auto border-r border-border/70 bg-sidebar p-2.5 sm:block"
        >
          <h2 className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Settings
          </h2>
          <p className="mb-3 px-2 text-xs text-muted-foreground truncate" title={server.name}>
            {server.name}
          </p>
          <ul className="space-y-0.5">
            {TABS.map((t) => {
              // Match `/s/<slug>/settings/<t.slug>` AND any deeper subpath
              // (none today, but future-proofs sub-tabs).
              const href = `/s/${slug}/settings/${t.slug}`;
              const active = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <li key={t.slug}>
                  <Button
                    render={<Link href={href} />}
                    variant={active ? "secondary" : "ghost"}
                    size="sm"
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "h-8 w-full justify-start gap-2 rounded-[8px] border-l-2 px-2.5 text-sm",
                      active
                        ? "border-accent bg-[var(--accent-soft)] text-[var(--accent-soft-foreground)]"
                        : "border-transparent text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
                    )}
                  >
                    <t.Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="truncate">{t.label}</span>
                  </Button>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Mobile tab grid — all settings destinations stay visible on
            narrow screens instead of hiding later tabs behind horizontal
            scroll. */}
        <nav aria-label="Settings sections" className="border-b border-border/70 bg-background/85 sm:hidden">
          <ul className="grid grid-cols-2 gap-1 px-2 py-2 min-[440px]:grid-cols-3">
            {TABS.map((t) => {
              const href = `/s/${slug}/settings/${t.slug}`;
              const active = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <li key={t.slug} className="min-w-0">
                  <Button
                    render={<Link href={href} />}
                    variant={active ? "secondary" : "ghost"}
                    size="sm"
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "h-8 w-full justify-start gap-1.5 rounded-[8px] border-l-2 px-2.5 text-xs",
                      active
                        ? "border-accent bg-[var(--accent-soft)] text-[var(--accent-soft-foreground)]"
                        : "border-transparent text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
                    )}
                  >
                    <t.Icon className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="truncate">{t.label}</span>
                  </Button>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain scroll-pb-32 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          {children}
        </div>
      </div>
    </SettingsContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Shared section shell — every tab page wraps content in this so spacing,
// max-width, and h1 placement stay uniform.
// ---------------------------------------------------------------------------

// max-w-5xl (1024px) is the shared content-column width across the app.
// Earlier this was max-w-2xl (672px) which felt orphaned in the middle of
// a wide content area; the new width matches the agent profile and tasks
// pages so navigating between them doesn't make the gutters jump around.
export function SettingsSection({
  title, description, children,
}: { title: string; description?: string; children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 p-4 sm:space-y-6 sm:p-8">
      <header>
        <h1 className="text-lg font-semibold sm:text-xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </header>
      {children}
    </div>
  );
}
