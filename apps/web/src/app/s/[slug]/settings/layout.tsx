"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useParams } from "next/navigation";
import { Building2, Users, Hash, KeyRound, User as UserIcon } from "lucide-react";
import { api, type Server } from "@/lib/api";
import { notifyThrown } from "@/lib/notify";
import { cn } from "@/lib/utils";

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
  const mounted = useRef(true);
  const requestSeq = useRef(0);
  useEffect(() => () => { mounted.current = false; }, []);

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
      <div className="mx-auto mt-12 max-w-md space-y-3 rounded-lg border p-6 text-center">
        <p className="text-sm font-medium">Couldn&apos;t load this workspace.</p>
        <p className="text-xs text-muted-foreground break-all">{loadError}</p>
        <button
          onClick={loadServer}
          className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!server) {
    return <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <SettingsContext.Provider value={{ server, refreshServer: loadServer }}>
      <div className="flex flex-1 overflow-hidden">
        {/* Left tab nav. min-w-0 + sticky on mobile collapses to a horizontal
            scroll bar so narrow screens still navigate without scrolling
            past the content. */}
        <nav
          aria-label="Settings sections"
          className="hidden w-56 shrink-0 overflow-y-auto border-r p-3 sm:block"
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
                  <Link
                    href={href}
                    className={cn(
                      "group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                      active
                        ? "bg-cyan-500/10 text-cyan-700 dark:text-cyan-400"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                  >
                    <t.Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="truncate">{t.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Mobile tab strip — horizontal scroll with a right-edge fade so
            users can tell more tabs exist past the viewport. mask-image
            applies the gradient to the scroll container without adding a
            DOM overlay (which would interfere with touch scroll). */}
        <div
          className="sm:hidden border-b"
          style={{
            maskImage: "linear-gradient(to right, black calc(100% - 1.5rem), transparent)",
            WebkitMaskImage: "linear-gradient(to right, black calc(100% - 1.5rem), transparent)",
          }}
        >
          <ul className="flex gap-1 overflow-x-auto px-2 py-2">
            {TABS.map((t) => {
              const href = `/s/${slug}/settings/${t.slug}`;
              const active = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <li key={t.slug}>
                  <Link
                    href={href}
                    className={cn(
                      "flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs",
                      active
                        ? "bg-cyan-500/10 text-cyan-700 dark:text-cyan-400"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                  >
                    <t.Icon className="h-3.5 w-3.5" aria-hidden="true" />
                    {t.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="flex-1 overflow-y-auto">
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
    <div className="mx-auto max-w-5xl space-y-6 p-6 sm:p-8">
      <header>
        <h1 className="text-xl font-semibold">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </header>
      {children}
    </div>
  );
}
