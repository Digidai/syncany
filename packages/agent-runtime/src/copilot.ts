/**
 * GitHub Copilot CLI runtime — SCAFFOLD ONLY (pending full implementation).
 *
 * See gemini.ts header for the rationale on having a scaffold-first
 * file in the tree; same story applies here.
 *
 * GitHub Copilot CLI specifics worth keeping in mind for the eventual
 * full integration:
 *   - Model is routed by the user's GitHub Copilot entitlement, NOT
 *     by a per-request `--model` arg the way claude/codex accept. The
 *     `agents.model` column for Copilot agents should be treated as a
 *     hint at most.
 *   - Auth lives in `~/.config/github-copilot/` after `copilot auth
 *     login` (or `gh auth login` with the Copilot extension). detect()
 *     can probe for that path's existence as a coarse auth check.
 *   - Pricing is per-seat (no per-token), so we don't need to track
 *     completion-cost metrics like we do for claude/codex.
 */
import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { AgentRuntime, DetectResult, RuntimeCapabilities, RuntimeSession, SpawnOpts } from "./types.js";

export class CopilotRuntime implements AgentRuntime {
  readonly id = "copilot" as const;
  readonly displayName = "GitHub Copilot";
  // Copilot's CLI doesn't surface a model list — the user's GitHub
  // entitlement decides at request time. We expose a single nominal
  // "default" so the UI agent-create flow has something to display.
  readonly capabilities: RuntimeCapabilities = {
    models: ["default"],
    defaultModel: "default",
    permissionModes: ["default"],
    conversational: true,
    resumable: false,
    supportsShellTools: false,
  };

  async detect(): Promise<DetectResult> {
    try {
      const res = spawnSync("copilot", ["--version"], { encoding: "utf-8", timeout: 3000 });
      if (res.status !== 0) {
        return { error: "GitHub Copilot CLI not installed" };
      }
      const version = (res.stdout || res.stderr).trim().split("\n")[0] ?? null;
      // Auth check: presence of the standard Copilot auth file. Coarse
      // but cheap; the deep "is the token still valid" check requires
      // a network probe which we don't do during boot detection.
      const authPath = join(homedir(), ".config", "github-copilot");
      const authed = existsSync(authPath);
      return { version, authed, authMethod: authed ? "oauth" : "none" };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  spawn(_opts: SpawnOpts): RuntimeSession {
    throw new Error(
      "[copilot] runtime spawn not implemented yet — agents with runtime=copilot cannot be dispatched. " +
      "Track: packages/agent-runtime/src/copilot.ts",
    );
  }
}
