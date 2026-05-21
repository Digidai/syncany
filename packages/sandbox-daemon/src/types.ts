/**
 * Shared types for the sandbox-daemon RPC surface.
 *
 * These types are the contract between the daemon (running inside the
 * per-Agent container) and the RalticAgent DO that calls it. Keep them
 * narrow — the smaller the surface, the smaller the audit burden.
 */

export interface AppOptions {
  /** Workspace root. Defaults to /workspace inside the container.
   *  Tests pass a temp dir to isolate the daemon from the host FS. */
  workspaceRoot: string;
  /** Pre-shared bearer token the DO supplies via `Authorization`.
   *  Daemon refuses any request without an exact match. Rotate by
   *  spawning a new daemon (container restart). */
  bearerToken: string;
  /** Soft cap on a single bash invocation (ms). Default 30000 in prod;
   *  tests use shorter to keep CI fast. The container's higher-level
   *  task timeout (D3) lives in the DO, not here. */
  bashTimeoutMs?: number;
  /** Hard cap on a single response payload (bytes). Default 10 MiB.
   *  Stops a runaway grep / cat from eating the WS frame budget. */
  maxResponseBytes?: number;
}

export interface FileReadResult {
  path: string;
  content: string;
  encoding: "utf-8" | "base64";
  bytes: number;
  truncated: boolean;
}

export interface EditResult {
  path: string;
  occurrences: number;
}

export interface GrepMatch {
  path: string;
  line: number;
  text: string;
}

export interface BashResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

export interface GitResult {
  ok: boolean;
  sha?: string;
  output: string;
}
