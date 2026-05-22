/**
 * Long-term memory tools — filesystem-backed, agent-curated.
 *
 * Architecture: every cloud agent's sandbox container ships with a
 * persistent /workspace mount. We carve out /workspace/.memory/ as a
 * structured memory tree the agent reads/writes through these tools.
 *
 *   .memory/
 *     CLAUDE.md             ← injected into every session prompt (≤4 KiB)
 *     people/<userId>.md    ← one file per person the agent knows
 *     projects/<slug>.md    ← one file per project/topic
 *     decisions/YYYY-MM-DD-<slug>.md   ← immutable decision records
 *     scratch/<date>.md     ← ephemeral working notes
 *
 * Why filesystem, not Vectorize? Embeddings are lossy for the kinds of
 * facts agents need to recall verbatim ("Gene's email is …"). Files
 * give us cheap, time-indexed, grep-able, agent-curated storage. The
 * agent decides what's important — no auto-RAG noise stuffed into
 * context. See docs/DESIGN_agentic_memory.md for full rationale.
 *
 * Vectorize (P3-W2) is layered on top as a *search tool* — never as
 * an automatic context-stuffer.
 */
import { tool } from "ai";
import { z } from "zod";
import type { ToolDispatchCtx, ToolRegistry } from "./registry.js";

const MEMORY_ROOT = "/workspace/.memory";
const CATEGORIES = ["person", "project", "decision", "scratch"] as const;
type Category = (typeof CATEGORIES)[number];

// Caps protect the daemon from accidental abuse — a runaway agent
// shouldn't be able to fill the workspace with 100 MiB of notes.
const MAX_BODY_BYTES = 20_000;
const MAX_TITLE_BYTES = 120;
const MAX_RECALL_RESULTS = 20;

// Slugify a free-form title into a safe filename. Idempotent.
function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")     // strip diacritics
    .replace(/[^a-z0-9一-鿿]+/gi, "-")  // keep CJK; collapse rest to '-'
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "untitled";
}

/**
 * Compute the canonical path for a memory entry.
 *
 * - person/project/decision use category-specific layout.
 * - scratch is date-bucketed so an agent can spew without manual
 *   filename choice.
 *
 * subjectId, when provided, becomes the filename — gives stable
 * identity for "the file about Gene" across multiple updates. Without
 * subjectId we fall back to slug(title) which can collide; agents are
 * expected to pass subjectId for person/project.
 */
// Map singular category → plural folder name. Explicit so 'person' →
// 'people' (not 'persons') reads naturally.
const CATEGORY_FOLDER: Record<Category, string> = {
  person: "people",
  project: "projects",
  decision: "decisions",
  scratch: "scratch",
};

function computeMemoryPath(opts: {
  category: Category;
  title: string;
  subjectId?: string;
}): string {
  const slug = opts.subjectId ? slugify(opts.subjectId) : slugify(opts.title);
  const folder = CATEGORY_FOLDER[opts.category];
  if (opts.category === "scratch") {
    // Scratch is genuinely ephemeral and agents will retitle generously
    // ("notes", "ideas"). Stamp with HHmmss so two same-day same-title
    // notes don't overwrite each other (codex P3-W1 LOW finding).
    const iso = new Date().toISOString();             // 2026-05-22T13:45:09.123Z
    const day = iso.slice(0, 10);
    const time = iso.slice(11, 19).replace(/:/g, "");  // 134509
    return `${MEMORY_ROOT}/${folder}/${day}-${time}-${slug}.md`;
  }
  if (opts.category === "decision") {
    // Decision is append-only: one record per day per title IS the
    // intended contract (a "decision" by definition doesn't change).
    // Same-day same-title overwrite reflects "we updated our minds";
    // for genuinely new decisions pick a different title.
    const day = new Date().toISOString().slice(0, 10);
    return `${MEMORY_ROOT}/${folder}/${day}-${slug}.md`;
  }
  return `${MEMORY_ROOT}/${folder}/${slug}.md`;
}

function formatMemoryEntry(opts: {
  title: string;
  body: string;
  subjectId?: string;
}): string {
  // Front-matter so recall can show structured headers in listings
  // without parsing the markdown body. Keep it tiny — agents read
  // these back themselves and we don't want to bloat tokens.
  const fm: string[] = ["---", `title: ${opts.title.replace(/\n/g, " ")}`];
  if (opts.subjectId) fm.push(`subject_id: ${opts.subjectId}`);
  fm.push(`updated_at: ${new Date().toISOString()}`);
  fm.push("---", "");
  return fm.join("\n") + opts.body;
}

/**
 * /workspace/.memory paths are agent-controlled but we still defend
 * against traversal in case the daemon's resolveWithinWorkspace ever
 * mis-fires (defense in depth). Rejects anything outside MEMORY_ROOT.
 */
function assertWithinMemoryRoot(p: string): void {
  // Daemon already normalizes + path-escape-guards, but we mirror the
  // contract here so unit tests don't have to spin up a container to
  // catch a malformed path string.
  if (!p.startsWith(MEMORY_ROOT + "/") && p !== MEMORY_ROOT) {
    throw new Error(`memory path must be under ${MEMORY_ROOT}: ${p}`);
  }
  if (p.includes("..")) {
    throw new Error(`memory path must not contain ..: ${p}`);
  }
}

export function memoryTools(ctx: ToolDispatchCtx): ToolRegistry {
  const sandbox = () => ctx.ensureSandbox();

  return {
    memory_remember: tool({
      description:
        "Persist a durable note to your long-term memory. Use for facts, decisions, or context you'll want to recall in future sessions — even days or weeks from now. Choose category carefully: 'person' (notes about a specific user/agent), 'project' (notes about a topic/initiative), 'decision' (immutable decision records, append-only), 'scratch' (ephemeral working notes, may be cleaned). Provide subjectId when category is person/project so updates land in the same file.",
      inputSchema: z.object({
        category: z.enum(CATEGORIES),
        title: z.string().min(1).max(MAX_TITLE_BYTES),
        subjectId: z.string().min(1).max(200).optional(),
        body: z.string().min(1).max(MAX_BODY_BYTES),
      }),
      execute: async ({ category, title, subjectId, body }) => {
        const path = computeMemoryPath({ category, title, ...(subjectId ? { subjectId } : {}) });
        assertWithinMemoryRoot(path);
        const client = await sandbox();
        const content = formatMemoryEntry({
          title,
          body,
          ...(subjectId ? { subjectId } : {}),
        });
        const res = await client.fileWrite(path, content);
        return { ok: true, path, bytes: res.bytes };
      },
    }),

    memory_recall: tool({
      description:
        "Search your long-term memory by keyword. Returns matching files with their full content (front-matter + body). Use this BEFORE asking the user for context you might have stored, so you don't repeat questions across sessions.",
      inputSchema: z.object({
        query: z.string().min(1).max(500),
        category: z.enum(CATEGORIES).optional(),
        limit: z.number().int().positive().max(MAX_RECALL_RESULTS).optional(),
      }),
      execute: async ({ query, category, limit }) => {
        const client = await sandbox();
        const searchRoot = category
          ? `${MEMORY_ROOT}/${CATEGORY_FOLDER[category]}`
          : MEMORY_ROOT;
        const max = limit ?? 5;
        // Grep first to find candidate files; then fileRead the top N.
        // Cheaper than reading every file in the tree and embedding
        // search client-side.
        const grepRes = await client.grep(query, {
          path: searchRoot,
          ignoreCase: true,
          maxMatches: max * 3,                 // headroom for dedup
        }).catch(() => ({ matches: [] as { path: string }[] }));
        const seen = new Set<string>();
        const paths: string[] = [];
        for (const m of grepRes.matches) {
          if (paths.length >= max) break;
          if (seen.has(m.path)) continue;
          seen.add(m.path);
          paths.push(m.path);
        }
        const entries: Array<{ path: string; content: string; truncated: boolean }> = [];
        for (const p of paths) {
          try {
            const r = await client.fileRead(p, "utf-8");
            entries.push({
              path: p,
              content: r.content,
              truncated: r.truncated ?? false,
            });
          } catch { /* skip unreadable */ }
        }
        return { matched: entries.length, entries };
      },
    }),

    memory_list: tool({
      description:
        "List entries in your long-term memory. Use to browse what you've stored — recall by keyword if you want full content.",
      inputSchema: z.object({
        category: z.enum(CATEGORIES).optional(),
        limit: z.number().int().positive().max(100).optional(),
      }),
      execute: async ({ category, limit }) => {
        const client = await sandbox();
        const max = limit ?? 50;
        const dirs = category
          ? [`${MEMORY_ROOT}/${CATEGORY_FOLDER[category]}`]
          : CATEGORIES.map(c => `${MEMORY_ROOT}/${CATEGORY_FOLDER[c]}`);
        const out: Array<{ category: string; path: string; name: string }> = [];
        for (const d of dirs) {
          try {
            const r = await client.fileList(d);
            for (const e of r.entries) {
              if (out.length >= max) break;
              if (e.kind !== "file") continue;
              out.push({
                category: d.split("/").pop() ?? "",
                path: `${d}/${e.name}`,
                name: e.name,
              });
            }
          } catch {
            // Directory may not exist yet — that's fine, just empty.
          }
        }
        return { count: out.length, entries: out };
      },
    }),

    memory_forget: tool({
      description:
        "Delete a memory entry by path. Use memory_recall or memory_list first to find the exact path. Decisions should generally NOT be forgotten — they're append-only history.",
      inputSchema: z.object({
        path: z.string().min(1).max(4096),
      }),
      execute: async ({ path }) => {
        assertWithinMemoryRoot(path);
        const client = await sandbox();
        // Daemon has no delete RPC yet (P0 file ops were read/write/edit/list).
        // We overwrite with a tombstone marker so memory_recall stops surfacing
        // the entry but the path is auditable. Real deletion can land later
        // alongside a daemon /file/delete endpoint.
        const tombstone =
          "---\nstatus: forgotten\nforgotten_at: " + new Date().toISOString() + "\n---\n";
        const res = await client.fileWrite(path, tombstone);
        return { ok: true, path, bytes: res.bytes, note: "tombstoned (delete RPC pending)" };
      },
    }),
  };
}

// Exports for tests + reflection consumers
export { MEMORY_ROOT, CATEGORIES, CATEGORY_FOLDER, computeMemoryPath, slugify, assertWithinMemoryRoot, formatMemoryEntry };
export type { Category };
