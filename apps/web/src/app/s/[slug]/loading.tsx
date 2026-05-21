/**
 * Workspace-level loading boundary. Next.js renders this during any
 * async navigation under /s/[slug]/* before the page's data resolves.
 *
 * Kept intentionally minimal — the workspace shell (sidebar + nav) is
 * already painted by the layout, so this only fills the inner page
 * region. A spinner would feel heavy when the actual fetch is usually
 * sub-second; a soft skeleton bar matches the rest of the design.
 */
export default function WorkspaceLoading(): React.ReactElement {
  // flex-1 + h-full forces the loader to claim the full message-area
  // slot (parent is a row-flex card). Without flex-1 the wrapper sizes
  // to its content (~120px) and justify-center looks pinned to the top-
  // left instead of the obvious "middle of the empty pane".
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex h-full min-h-0 w-full flex-1 items-center justify-center"
    >
      <div className="flex items-center gap-2 text-sm text-muted-foreground motion-reduce:animate-none">
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-muted-foreground/40 motion-reduce:animate-none" />
        <span>Loading…</span>
      </div>
    </div>
  );
}
