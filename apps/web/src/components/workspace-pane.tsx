"use client";

/**
 * Workspace IDE pane — right-side panel in channel/DM page that shows
 * a cloud-mode agent's /workspace contents. Read-only viewer for P1:
 *   - File tree of /workspace (via api.getAgentWorkspace)
 *   - File content viewer (click a file to inspect)
 *   - Live terminal output stream (recent tail of bash_exec invocations)
 *
 * Why no Monaco / xterm.js (yet):
 *   Both add 1-2 MiB to the web bundle. For P1 we ship a textarea-style
 *   read-only viewer + plain <pre> terminal log. Monaco / xterm upgrade
 *   lands in P1+ polish once we have evidence users actually edit /
 *   interact with the terminal from the pane.
 *
 * Scope:
 *   - Cloud-mode agents only (runtimeMode !== 'bridge'). Bridge agents
 *     keep their workspace on the user's local disk; nothing to show.
 *   - When a DM channel has exactly one agent member, that agent's
 *     workspace is the natural target. Channel with multiple agents
 *     would need a picker — defer to P1+.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Folder, FileText, ChevronRight, ChevronDown, Loader2, FolderTree, Terminal, RefreshCw, Brain } from "lucide-react";
import { api, type Agent } from "@/lib/api";
import { notifyThrown } from "@/lib/notify";
import { cn } from "@/lib/utils";

interface Props {
  /** Agent whose workspace to show. Cloud-mode only — null/empty pane
   *  for bridge agents. */
  agent: Agent | null;
}

interface TreeNode {
  name: string;
  kind: "dir" | "file" | "symlink" | "other";
  /** Absolute path within /workspace (no leading slash). */
  path: string;
  /** Loaded children for directories; null = not loaded yet. */
  children?: TreeNode[];
}

export function WorkspacePane({ agent }: Props) {
  // Cloud-only — bridge agents render the empty state.
  const isCloud = agent && agent.runtimeMode !== "bridge";
  const agentId = agent?.id ?? null;

  const [tree, setTree] = useState<TreeNode | null>(null);
  // Tri-state: null = loading, TreeNode = loaded, Error = failed.
  // Without this the pane shows "Loading…" forever on root-load failure
  // (codex round 3 MED). Refresh button on the header re-tries.
  const [treeError, setTreeError] = useState<Error | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set([""]));
  const [activeFile, setActiveFile] = useState<{ path: string; content: string; truncated: boolean } | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [terminalTail, setTerminalTail] = useState<string>("");
  const [refreshKey, setRefreshKey] = useState(0);
  // 'files' shows /workspace tree; 'memory' shows .memory/ entries
  // flattened across categories with click-to-view. Two-tab nav keeps
  // memory discoverable without burying it inside a dotfile folder.
  const [view, setView] = useState<"files" | "memory">("files");
  const [memoryEntries, setMemoryEntries] = useState<Array<{ category: string; name: string; path: string }> | null>(null);
  const [memoryError, setMemoryError] = useState<Error | null>(null);
  const lastAgentIdRef = useRef<string | null>(null);

  // Reset when agent changes.
  useEffect(() => {
    if (agentId !== lastAgentIdRef.current) {
      setTree(null);
      setTreeError(null);
      setActiveFile(null);
      setExpanded(new Set([""]));
      setTerminalTail("");
      setMemoryEntries(null);
      setMemoryError(null);
      lastAgentIdRef.current = agentId;
    }
  }, [agentId]);

  // Load memory entries when the Memory tab is active. Cheap (one
  // listAgentWorkspace call per category) and we don't auto-poll
  // (memory changes are agent-driven; refresh button handles it).
  useEffect(() => {
    if (!isCloud || !agentId || view !== "memory") return;
    let cancelled = false;
    setMemoryError(null);
    (async () => {
      const cats = ["people", "projects", "decisions", "scratch"] as const;
      const out: Array<{ category: string; name: string; path: string }> = [];
      const realErrors: Error[] = [];
      for (const c of cats) {
        try {
          const { entries } = await api.listAgentWorkspace(agentId, `.memory/${c}`);
          for (const e of entries) {
            if (e.kind !== "file") continue;
            out.push({ category: c, name: e.name, path: `.memory/${c}/${e.name}` });
          }
        } catch (e) {
          // Distinguish "directory doesn't exist yet" (expected for a
          // new agent) from real errors. The api returns ENOENT-like
          // shapes from the sandbox daemon — surface anything else as
          // a real error so users see auth / network failures instead
          // of an incorrect "empty memory" state (codex P3-W1 LOW).
          const msg = e instanceof Error ? e.message : String(e);
          if (/not\s*found|ENOENT|404/i.test(msg)) continue;
          realErrors.push(e instanceof Error ? e : new Error(msg));
        }
      }
      if (cancelled) return;
      if (realErrors.length > 0 && out.length === 0) {
        // All categories failed for a non-missing-dir reason — surface
        // the first error so the user sees it.
        setMemoryError(realErrors[0]!);
        return;
      }
      setMemoryEntries(out);
    })();
    return () => { cancelled = true; };
  }, [agentId, isCloud, view, refreshKey]);

  // Load root tree on mount + on agent change + on refresh.
  useEffect(() => {
    if (!isCloud || !agentId) return;
    let cancelled = false;
    setTreeError(null);
    api.listAgentWorkspace(agentId, ".").then(({ entries }) => {
      if (cancelled) return;
      setTree({
        name: "/workspace",
        kind: "dir",
        path: "",
        children: entries.map(e => ({
          name: e.name,
          kind: e.kind,
          path: e.name,
        })),
      });
    }).catch((e) => {
      if (cancelled) return;
      // Don't toast — pane error block surfaces the failure with a
      // retry affordance, no need to spam a toast on every channel switch.
      setTreeError(e instanceof Error ? e : new Error(String(e)));
    });
    return () => { cancelled = true; };
  }, [agentId, isCloud, refreshKey]);

  // Poll recent terminal output every 5s (low-frequency; users mostly
  // glance at this rather than watch). Replace with WS stream in P1+.
  useEffect(() => {
    if (!isCloud || !agentId) return;
    const currentAgentId = agentId;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    async function poll() {
      try {
        const { tail } = await api.getAgentTerminal(currentAgentId);
        if (cancelled) return;
        setTerminalTail(tail);
      } catch { /* swallow — terminal is best-effort */ }
      if (cancelled) return;
      timer = setTimeout(poll, 5000);
    }
    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [agentId, isCloud]);

  // Track in-flight dir listings so rapid open/close/reopen doesn't fan
  // out duplicate requests (codex MED). Cleared after settle.
  const inFlightDirsRef = useRef<Set<string>>(new Set());

  const toggle = useCallback(async (node: TreeNode) => {
    if (node.kind !== "dir") return;
    const isOpen = expanded.has(node.path);
    const next = new Set(expanded);
    if (isOpen) {
      next.delete(node.path);
      setExpanded(next);
      return;
    }
    next.add(node.path);
    setExpanded(next);
    if (node.children) return;                            // already loaded
    if (inFlightDirsRef.current.has(node.path)) return;   // a sibling load is already pending
    if (!agent) return;
    const agentIdAtStart = agent.id;
    inFlightDirsRef.current.add(node.path);
    try {
      const { entries } = await api.listAgentWorkspace(agentIdAtStart, node.path || ".");
      // Drop response if agent changed under us — protects against
      // commit-after-unmount / agent switch (codex HIGH analog).
      if (lastAgentIdRef.current !== agentIdAtStart) return;
      setTree((prev) => prev ? patchTree(prev, node.path, entries.map(e => ({
        name: e.name,
        kind: e.kind,
        path: node.path ? `${node.path}/${e.name}` : e.name,
      }))) : prev);
    } catch (e) {
      notifyThrown("Couldn't list directory", e);
    } finally {
      inFlightDirsRef.current.delete(node.path);
    }
  }, [expanded, agent]);

  const openFile = useCallback(async (path: string) => {
    if (!agent) return;
    // Capture agent id at request start so the response we commit
    // belongs to the agent the user was viewing when they clicked
    // (codex HIGH — stale read could re-show a file from the prior agent).
    const agentIdAtStart = agent.id;
    setLoadingFile(true);
    try {
      const { content, truncated } = await api.readAgentFile(agentIdAtStart, path);
      if (lastAgentIdRef.current !== agentIdAtStart) return;
      setActiveFile({ path, content, truncated });
    } catch (e) {
      notifyThrown("Couldn't read file", e);
    } finally {
      if (lastAgentIdRef.current === agentIdAtStart) setLoadingFile(false);
    }
  }, [agent]);

  if (!isCloud) {
    return (
      <aside className="hidden w-80 shrink-0 flex-col border-l bg-muted/20 lg:flex">
        <header className="flex items-center gap-2 border-b px-4 py-3">
          <FolderTree className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Workspace</h3>
        </header>
        <div className="flex flex-1 items-center justify-center p-6 text-center">
          <p className="text-xs text-muted-foreground">
            {agent
              ? "This agent runs on your local bridge — its workspace lives on your machine."
              : "Pick a cloud agent to see its workspace."}
          </p>
        </div>
      </aside>
    );
  }

  return (
    <aside className="hidden w-80 shrink-0 flex-col border-l bg-muted/20 lg:flex">
      <header className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <FolderTree className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Workspace</h3>
        </div>
        <button
          type="button"
          onClick={() => setRefreshKey(k => k + 1)}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Refresh"
          aria-label="Refresh workspace"
        >
          <RefreshCw className="h-3 w-3" />
        </button>
      </header>

      <div role="tablist" aria-label="Workspace view" className="flex border-b text-[11px]">
        <button
          role="tab"
          type="button"
          aria-selected={view === "files"}
          onClick={() => setView("files")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 transition-colors",
            view === "files"
              ? "border-b-2 border-foreground font-medium text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <FolderTree className="h-3 w-3" /> Files
        </button>
        <button
          role="tab"
          type="button"
          aria-selected={view === "memory"}
          onClick={() => setView("memory")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 transition-colors",
            view === "memory"
              ? "border-b-2 border-foreground font-medium text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Brain className="h-3 w-3" /> Memory
        </button>
      </div>

      <div className="flex-1 overflow-hidden">
        <div className="flex h-full flex-col">
          <div className="max-h-1/2 flex-1 overflow-auto px-2 py-2">
            {view === "memory" ? (
              memoryEntries === null && !memoryError ? (
                <p className="px-2 py-1 text-xs text-muted-foreground">Loading…</p>
              ) : memoryError ? (
                <div className="space-y-2 px-2 py-2 text-xs">
                  <p className="text-destructive-foreground">Couldn&apos;t load memory.</p>
                  <p className="break-words text-muted-foreground">{memoryError.message}</p>
                </div>
              ) : memoryEntries && memoryEntries.length === 0 ? (
                <p className="px-2 py-2 text-xs text-muted-foreground">
                  This agent hasn&apos;t written any long-term memory yet. As you chat, it&apos;ll
                  start recording durable facts here automatically (or via its <code>memory_remember</code> tool).
                </p>
              ) : (
                <MemoryList
                  entries={memoryEntries ?? []}
                  activePath={activeFile?.path ?? null}
                  onOpen={openFile}
                />
              )
            ) : tree ? (
              <TreeRow node={tree} depth={0} expanded={expanded} onToggle={toggle} onOpenFile={openFile} />
            ) : treeError ? (
              <div className="space-y-2 px-2 py-2 text-xs">
                <p className="text-destructive-foreground">Couldn&apos;t load workspace.</p>
                <p className="break-words text-muted-foreground">{treeError.message}</p>
                <button
                  type="button"
                  onClick={() => setRefreshKey(k => k + 1)}
                  className="rounded border px-2 py-1 text-[11px] font-medium hover:bg-accent"
                >
                  Retry
                </button>
              </div>
            ) : (
              <p className="px-2 py-1 text-xs text-muted-foreground">Loading…</p>
            )}
          </div>

          {activeFile && (
            <div className="border-t bg-card">
              <div className="flex items-center justify-between px-3 py-2 text-[11px]">
                <span className="truncate font-mono text-muted-foreground">{activeFile.path}</span>
                <button onClick={() => setActiveFile(null)} className="text-muted-foreground hover:text-foreground">×</button>
              </div>
              <pre className="max-h-64 overflow-auto px-3 pb-2 text-[11px] font-mono leading-relaxed">
                {loadingFile ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <>
                    {activeFile.content}
                    {activeFile.truncated && (
                      <span className="block pt-2 text-amber-600">{"[truncated — file > 5 MiB]"}</span>
                    )}
                  </>
                )}
              </pre>
            </div>
          )}

          {terminalTail && (
            <div className="border-t bg-card">
              <div className="flex items-center gap-1.5 border-b px-3 py-2 text-[11px] text-muted-foreground">
                <Terminal className="h-3 w-3" />
                <span className="font-mono">Recent terminal output</span>
              </div>
              <pre className="max-h-40 overflow-auto bg-black px-3 py-2 text-[10.5px] font-mono leading-snug text-zinc-200">
                {terminalTail}
              </pre>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

/** Flat memory listing grouped by category. Click a row to view the
 *  same file viewer used by the Files tab. Memory tree is intentionally
 *  shallow (4 categories × N files) so a list reads better than a tree. */
function MemoryList({ entries, activePath, onOpen }: {
  entries: Array<{ category: string; name: string; path: string }>;
  activePath: string | null;
  onOpen: (path: string) => void;
}) {
  const grouped = entries.reduce<Record<string, typeof entries>>((acc, e) => {
    (acc[e.category] ||= []).push(e);
    return acc;
  }, {});
  const order = ["people", "projects", "decisions", "scratch"] as const;
  return (
    <div className="space-y-3">
      {order.map(cat => {
        const items = grouped[cat];
        if (!items?.length) return null;
        return (
          <section key={cat}>
            <h4 className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {cat}
            </h4>
            <ul>
              {items.map(item => (
                <li key={item.path}>
                  <button
                    type="button"
                    onClick={() => onOpen(item.path)}
                    aria-current={activePath === item.path ? "true" : undefined}
                    className={cn(
                      "w-full truncate rounded px-2 py-1 text-left text-[12px] hover:bg-accent",
                      activePath === item.path && "bg-accent font-medium",
                    )}
                    title={item.name}
                  >
                    {item.name.replace(/\.md$/, "")}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function TreeRow({ node, depth, expanded, onToggle, onOpenFile }: {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (n: TreeNode) => void;
  onOpenFile: (path: string) => void;
}) {
  const isOpen = expanded.has(node.path);
  return (
    <div>
      <button
        type="button"
        onClick={() => node.kind === "dir" ? onToggle(node) : onOpenFile(node.path)}
        style={{ paddingLeft: 4 + depth * 12 }}
        aria-expanded={node.kind === "dir" ? isOpen : undefined}
        aria-label={node.kind === "dir" ? `Folder ${node.name}` : `File ${node.name}`}
        className={cn(
          "flex w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-left text-[12px] transition-colors hover:bg-accent",
          depth === 0 && "font-medium text-muted-foreground",
        )}
      >
        {node.kind === "dir" ? (
          isOpen ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />
        ) : (
          <span className="w-3" aria-hidden="true" />
        )}
        {node.kind === "dir" ? (
          <Folder className="h-3 w-3 shrink-0 text-amber-600" />
        ) : (
          <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
        )}
        <span className="truncate">{node.name}</span>
      </button>
      {isOpen && node.children && (
        <div>
          {node.children.map((c) => (
            <TreeRow key={c.path} node={c} depth={depth + 1} expanded={expanded} onToggle={onToggle} onOpenFile={onOpenFile} />
          ))}
        </div>
      )}
    </div>
  );
}

function patchTree(root: TreeNode, atPath: string, children: TreeNode[]): TreeNode {
  if (root.path === atPath) {
    return { ...root, children };
  }
  if (!root.children) return root;
  // Only clone the subtree along the path we modified — siblings keep
  // their referential identity so React's reconciler can short-circuit
  // (codex LOW — perf at scale). If no child changed, return root as-is.
  let changed = false;
  const nextChildren = root.children.map(c => {
    if (atPath !== c.path && !atPath.startsWith(`${c.path}/`)) return c;
    const next = patchTree(c, atPath, children);
    if (next !== c) changed = true;
    return next;
  });
  return changed ? { ...root, children: nextChildren } : root;
}
