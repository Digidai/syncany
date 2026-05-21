/**
 * Thin client for the per-Agent sandbox container's HTTP RPC.
 *
 * Lives on the DO side. Talks to packages/sandbox-daemon over the
 * Cloudflare Service binding (Container DO routes the request to the
 * underlying container). Bearer token is rotated per-container at
 * provisioning time and held on the DO.
 *
 * Why a dedicated client (not just `fetch`)?
 *   - Centralised error-shape unwrap (sandbox returns { error: { code, message } })
 *   - Single place to enforce per-RPC timeout / cap response size
 *   - Easy mock in unit tests for the DO
 */

import type {
  BashResult,
  EditResult,
  FileReadResult,
  GitResult,
  GrepMatch,
} from "@raltic/sandbox-daemon/types";

export class SandboxClient {
  constructor(
    private readonly container: DurableObjectStub,
    private readonly bearer: string,
  ) {}

  // ── File ──────────────────────────────────────────────────────────────
  fileRead(path: string, encoding: "utf-8" | "base64" = "utf-8"): Promise<FileReadResult> {
    return this.call<FileReadResult>("/file/read", { path, encoding });
  }
  fileWrite(path: string, content: string, encoding: "utf-8" | "base64" = "utf-8"): Promise<{ ok: true; path: string; bytes: number }> {
    return this.call("/file/write", { path, content, encoding });
  }
  fileEdit(path: string, oldStr: string, newStr: string, replaceAll = false): Promise<EditResult> {
    return this.call<EditResult>("/file/edit", { path, oldStr, newStr, replaceAll });
  }
  fileList(path: string): Promise<{ path: string; entries: Array<{ name: string; kind: string }> }> {
    return this.call("/file/list", { path });
  }

  // ── Bash ──────────────────────────────────────────────────────────────
  bashExec(command: string, opts?: { cwd?: string; env?: Record<string, string>; timeoutMs?: number }): Promise<BashResult> {
    return this.call<BashResult>("/bash/exec", { command, ...opts });
  }

  // ── Search ────────────────────────────────────────────────────────────
  grep(pattern: string, opts?: { path?: string; glob?: string; fixedString?: boolean; ignoreCase?: boolean; maxMatches?: number }): Promise<{ matches: GrepMatch[] }> {
    return this.call("/grep", { pattern, ...opts });
  }
  glob(pattern: string, opts?: { path?: string; maxResults?: number }): Promise<{ paths: string[] }> {
    return this.call("/glob", { pattern, ...opts });
  }

  // ── Git ───────────────────────────────────────────────────────────────
  gitClone(url: string, path: string, opts?: { token?: string; depth?: number }): Promise<GitResult> {
    return this.call<GitResult>("/git/clone", { url, path, ...opts });
  }
  gitCommit(path: string, message: string, opts?: { authorName?: string; authorEmail?: string; files?: string[] }): Promise<GitResult> {
    return this.call<GitResult>("/git/commit", { path, message, ...opts });
  }
  gitPush(path: string, opts?: { remote?: string; branch?: string; token?: string }): Promise<GitResult> {
    return this.call<GitResult>("/git/push", { path, ...opts });
  }
  gitStatus(path: string): Promise<GitResult> {
    return this.call<GitResult>("/git/status", { path });
  }

  // ── Liveness ──────────────────────────────────────────────────────────
  async health(): Promise<boolean> {
    try {
      const res = await this.container.fetch("https://sandbox/health");
      return res.ok;
    } catch {
      return false;
    }
  }

  // ── Internal ──────────────────────────────────────────────────────────
  private async call<T>(path: string, body: unknown): Promise<T> {
    const res = await this.container.fetch(`https://sandbox${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.bearer}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      // Sandbox returns { error: { code, message } } for 4xx / 5xx.
      const j = await res.json().catch(() => null) as { error?: { code: string; message: string } } | null;
      const code = j?.error?.code ?? `HTTP_${res.status}`;
      const msg = j?.error?.message ?? res.statusText;
      const err = new Error(`sandbox ${path}: ${code} — ${msg}`);
      (err as Error & { status: number; code: string }).status = res.status;
      (err as Error & { status: number; code: string }).code = code;
      throw err;
    }
    return res.json() as Promise<T>;
  }
}
