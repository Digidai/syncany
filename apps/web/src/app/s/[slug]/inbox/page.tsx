"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api, type Server } from "@/lib/api";
import { notifyThrown } from "@/lib/notify";
import { Inbox as InboxIcon, MessageSquare, ListChecks, Hash, Lock, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/heroui-pro/button";

/**
 * Unified inbox — answers "what's waiting for me right now".
 *
 * Aggregates unread DMs + open task assignments for the current
 * workspace. Mentions land in a Phase 2 expansion (needs a schema column
 * so the mention lookup doesn't full-scan messages).
 *
 * Server-side does the heavy lifting (joins + filters + sort); this
 * page is a thin list view. Items are clickable links straight to the
 * source channel — clicking marks the corresponding DM as read on the
 * server's next /channels/:id/read poll, so the inbox shrinks as you
 * triage.
 */
type InboxItem = Awaited<ReturnType<typeof api.getInbox>>["items"][number];

export default function InboxPage() {
  const { slug } = useParams<{ slug: string }>();
  const [server, setServer] = useState<Server | null>(null);
  // Tri-state — `null` = still loading, `Item[]` = loaded (possibly empty),
  // `Error` = load failed. The previous `setItems([])` on failure showed
  // the "You're caught up" empty state to users whose inbox actually had
  // unread items the server just couldn't reach. Misleading.
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [loadError, setLoadError] = useState<Error | null>(null);
  // Reload counter so the retry button re-fires the effect.
  const [reloadCount, setReloadCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    setItems(null);
    (async () => {
      try {
        const data = await api.getServerBySlug(slug);
        if (cancelled) return;
        setServer(data.server);
        const inbox = await api.getInbox(data.server.id);
        if (cancelled) return;
        setItems(inbox.items);
      } catch (e) {
        if (cancelled) return;
        notifyThrown("Couldn't load inbox", e);
        setLoadError(e instanceof Error ? e : new Error(String(e)));
      }
    })();
    return () => { cancelled = true; };
  }, [slug, reloadCount]);

  if (!server) {
    return <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-b px-6 py-4">
        <div className="mx-auto flex max-w-5xl items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-700 dark:text-cyan-400">
            <InboxIcon className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold">Inbox</h1>
            <p className="text-xs text-muted-foreground">
              Direct messages and tasks waiting on you in {server.name}.
            </p>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto flex max-w-5xl flex-col gap-3">
          {loadError && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center">
              <p className="text-sm font-medium text-destructive-foreground">Couldn't load inbox</p>
              <p className="mt-1 text-xs text-muted-foreground break-words">{loadError.message}</p>
              <Button
                type="button"
                onClick={() => setReloadCount((n) => n + 1)}
                variant="outline"
                size="sm"
                className="mt-4"
              >
                Try again
              </Button>
            </div>
          )}

          {!loadError && items === null && (
            <p className="text-sm text-muted-foreground">Loading…</p>
          )}

          {!loadError && items && items.length === 0 && (
            <div className="rounded-lg border border-dashed p-8 text-center">
              <InboxIcon className="mx-auto h-8 w-8 text-muted-foreground/60" aria-hidden="true" />
              <p className="mt-3 text-sm font-medium">You're caught up.</p>
              <p className="mt-1 text-xs text-muted-foreground">
                No unread DMs and no open tasks assigned to you. Nice.
              </p>
            </div>
          )}

          {!loadError && items && items.length > 0 && (
            <ul className="space-y-2">
              {items.map((item) => (
                <InboxRow key={item.id} item={item} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function InboxRow({ item }: { item: InboxItem }) {
  const Icon = item.kind === "task" ? ListChecks : MessageSquare;
  const channelIcon = item.channelType === "private" ? Lock : item.channelType === "dm" ? MessageSquare : Hash;
  const ChannelIcon = channelIcon;
  return (
    <li>
      <Link
        href={item.href}
        className="flex items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-accent/30 hover:border-foreground/20"
      >
        <div className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
          item.kind === "task"
            ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
            : "bg-cyan-500/10 text-cyan-700 dark:text-cyan-400",
        )}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <ChannelIcon className="h-3 w-3" aria-hidden="true" />
            <span className="truncate">{item.channelType === "dm" ? "Direct message" : `#${item.channelName}`}</span>
            <span aria-hidden="true">·</span>
            <span className="rounded-full bg-muted px-1.5 py-px text-[9px] font-medium uppercase tracking-wider">
              {item.kind}
            </span>
            <time className="ml-auto shrink-0">{relativeTime(item.createdAt)}</time>
          </div>
          <p className="mt-1 text-sm leading-snug line-clamp-2">
            {item.preview}
          </p>
        </div>
        <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground/50" aria-hidden="true" />
      </Link>
    </li>
  );
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ms).toLocaleDateString();
}
