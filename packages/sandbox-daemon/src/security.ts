import { resolve, normalize, sep, dirname } from "node:path";
import { realpath, lstat } from "node:fs/promises";

/**
 * Resolve a user-supplied path against the workspace root and verify it
 * stays inside that root. Returns the absolute, normalized path on success.
 *
 * Why this is critical: Read/Write/Edit/Bash all take a `path` from the
 * agent (= the LLM). Without this check the agent could request
 * "../../etc/passwd" or "/etc/shadow" and the container's own
 * /workspace-only convention would be silently bypassed. Container
 * filesystem isolation gives us defense-in-depth, but this is the
 * first line.
 *
 * Throws on:
 *   - escape attempts (`../` traversal, absolute paths outside root)
 *   - null bytes (POSIX path injection)
 *   - empty string
 */
/** Errors thrown by security checks carry status=400 so the daemon's
 *  centralised onError maps them to "bad request" instead of "internal". */
export class PathError extends Error {
  readonly status = 400 as const;
  constructor(message: string) {
    super(message);
    this.name = "PathError";
  }
}

export function resolveWithinWorkspace(workspaceRoot: string, userPath: string): string {
  if (typeof userPath !== "string" || userPath.length === 0) {
    throw new PathError("path must be a non-empty string");
  }
  if (userPath.includes("\0")) {
    throw new PathError("path must not contain null bytes");
  }
  const rootAbs = resolve(workspaceRoot);
  // Resolve relative to root; if userPath is absolute, resolve uses it
  // verbatim, which is exactly the escape case we need to detect.
  const candidate = normalize(resolve(rootAbs, userPath));
  // Ensure candidate sits inside root (trailing sep prevents
  // `/workspace2` matching `/workspace` by prefix).
  const rootWithSep = rootAbs.endsWith(sep) ? rootAbs : rootAbs + sep;
  if (candidate !== rootAbs && !candidate.startsWith(rootWithSep)) {
    throw new PathError(`path escapes workspace root: ${userPath}`);
  }
  return candidate;
}

/**
 * Lexical check + realpath-based symlink escape detection.
 *
 * The base `resolveWithinWorkspace` only normalises the path string.
 * If /workspace contains a symlink (`/workspace/leak -> /etc`), the
 * lexical check passes but a subsequent `readFile` would follow the
 * symlink and read /etc/passwd. realpath() resolves the symlink chain
 * and we re-verify the *real* target sits inside the *real* workspace.
 *
 * For paths whose final component does not yet exist (e.g. write to a
 * new file), we realpath the parent directory instead — the leaf would
 * be created at that real location.
 *
 * NOTE: this resolution is async (touches disk) so callers in handlers
 * must `await` it. Use `resolveWithinWorkspace` only when you do NOT
 * subsequently touch the FS, otherwise prefer this hardened variant.
 */
export async function resolveSafeForFs(workspaceRoot: string, userPath: string): Promise<string> {
  const lexical = resolveWithinWorkspace(workspaceRoot, userPath);
  const rootReal = await realpath(resolve(workspaceRoot));
  const rootWithSep = rootReal.endsWith(sep) ? rootReal : rootReal + sep;

  // If the target itself is a symlink, refuse — we never silently follow
  // links inside the workspace either (a workspace-internal symlink to
  // /etc would otherwise be legal under a pure realpath check below).
  try {
    const st = await lstat(lexical);
    if (st.isSymbolicLink()) {
      throw new PathError(`refusing to follow symlink: ${userPath}`);
    }
  } catch (e: unknown) {
    // ENOENT is fine for writes / mkdirp; bubble anything else.
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }

  // Resolve the real path of the deepest existing ancestor and recompose.
  let probe = lexical;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const realProbe = await realpath(probe);
      // The realpath either equals what's left in lexical (no symlink in
      // chain) or resolved through one. Either way, the FINAL real
      // location is realProbe + the trailing segments we stripped off.
      const tail = lexical.slice(probe.length);
      const realFinal = normalize(realProbe + tail);
      if (realFinal !== rootReal && !realFinal.startsWith(rootWithSep)) {
        throw new PathError(`path escapes workspace via symlink: ${userPath}`);
      }
      return realFinal;
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      const parent = dirname(probe);
      if (parent === probe) throw new PathError(`cannot resolve: ${userPath}`);
      probe = parent;
    }
  }
}
