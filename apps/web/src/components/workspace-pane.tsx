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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Folder, FileText, ChevronRight, ChevronDown, Loader2, FolderTree, Terminal, RefreshCw } from "lucide-react";
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
  const lastAgentIdRef = useRef<string | null>(null);

  // Reset when agent changes.
  useEffect(() => {
    if (agent?.id !== lastAgentIdRef.current) {
      setTree(null);
      setTreeError(null);
      setActiveFile(null);
      setExpanded(new Set([""]));
      setTerminalTail("");
      lastAgentIdRef.current = agent?.id ?? null;
    }
  }, [agent?.id]);

  // Load root tree on mount + on agent change + on refresh.
  useEffect(() => {
    if (!isCloud || !agent) return;
    let cancelled = false;
    setTreeError(null);
    api.listAgentWorkspace(agent.id, ".").then(({ entries }) => {
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
  }, [agent?.id, isCloud, refreshKey]);

  // Poll recent terminal output every 5s (low-frequency; users mostly
  // glance at this rather than watch). Replace with WS stream in P1+.
  useEffect(() => {
    if (!isCloud || !agent) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    async function poll() {
      try {
        const { tail } = await api.getAgentTerminal(agent!.id);
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
  }, [agent?.id, isCloud]);

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

      <div className="flex-1 overflow-hidden">
        <div className="flex h-full flex-col">
          <div className="max-h-1/2 flex-1 overflow-auto px-2 py-2">
            {tree ? (
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
