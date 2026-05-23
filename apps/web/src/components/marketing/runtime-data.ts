/**
 * Canonical per-runtime marketing copy. Sourced from public docs +
 * what actually ships in packages/agent-runtime/src/index.ts.
 *
 * Truth bar: every fact below must be verifiable from either:
 *   - packages/agent-runtime/src/{claude,codex,openclaw,hermes}.ts
 *   - packages/protocol/src/rest.ts RUNTIME_MODELS
 *   - the upstream project's public README
 *
 * Per codex review L9: each runtime page must have ≥60% unique body
 * copy — the strings here are NOT a template; they're hand-written
 * per runtime with distinct positioning + upstream context. The
 * marketing/runtime-page.tsx template renders them in a shared layout.
 */

export type RuntimeKey = "claude" | "codex" | "openclaw" | "hermes";

export interface RuntimeDoc {
  key: RuntimeKey;
  /** Display name with vendor (used in titles, OG). */
  longName: string;
  /** Short brand label (used in pills, chips). Must match the in-app RUNTIME_LABEL. */
  shortName: string;
  /** "Cloud-friendly per-turn CLI" or "External daemon, your machine". */
  lifecycle: "per_turn_spawn" | "external_daemon";
  /** "Verified" → indexable. "Experimental" → noindex + banner. Codex H2. */
  verification: "verified" | "experimental";
  /** Brand accent palette key — matches RuntimeDot/RuntimeChip. */
  accent: "cyan" | "amber" | "violet" | "rose";
  /** Hero tag line — one sentence, ≤14 words. */
  tagline: string;
  /** Short body under the tagline — 2-3 sentences max. */
  hero: string;
  /** What the runtime IS, in vendor-context terms. ~2 sentences. */
  whatItIs: string;
  /** How Raltic specifically uses it. Concrete: spawn model, what
   *  crosses the wire, what stays local. ~2 sentences. */
  howRalticUses: string;
  /** Copy-paste install command (matches RUNTIME_INSTALL_CMD in
   *  create-agent-dialog.tsx — keep them in sync). */
  installCmd: string;
  /** Three short bullets — "best at" / strengths in this context. */
  bestAt: [string, string, string];
  /** FAQ specific to this runtime (≥3 entries for thin-content guard). */
  faq: { q: string; a: string }[];
  /** Models the user can pick when creating an agent with this runtime.
   *  Mirrors packages/protocol/src/rest.ts RUNTIME_MODELS — keep in sync. */
  models: readonly string[];
  /** Upstream link, for "what is this" cross-reference. */
  upstreamHref: string;
  /** Upstream link label. */
  upstreamLabel: string;
}

export const RUNTIME_DOCS: Record<RuntimeKey, RuntimeDoc> = {
  claude: {
    key: "claude",
    longName: "Anthropic Claude (Claude Code)",
    shortName: "Claude",
    lifecycle: "per_turn_spawn",
    verification: "verified",
    accent: "cyan",
    tagline: "Claude Code, now in your team's chat.",
    hero: "Claude Code is the agent most engineering teams reach for first — strong reasoning, careful edits, and a defensible safety story. Raltic lets the rest of your team @mention it the same way they'd @mention a teammate, with every response landing in a searchable channel instead of a private terminal.",
    whatItIs: "Claude Code is Anthropic's agentic CLI — a Claude model with tool-use, file editing, shell access, and built-in plan/permission semantics. Most teams already run it locally for refactors, code review, and design exploration.",
    howRalticUses: "Raltic's bridge spawns `claude` per turn on your laptop (same binary you already use). Your repo, secrets, and Anthropic key never leave the machine; only the assistant's chat message crosses the network into the channel everyone reads.",
    installCmd: "npm i -g @anthropic-ai/claude-code",
    bestAt: [
      "Long-context code review on multi-file PRs",
      "Plan-mode work where the user wants a write-up first",
      "Anything that benefits from Claude's careful refusal behavior",
    ],
    faq: [
      { q: "Do I need an Anthropic API key, a subscription, or both?", a: "Whichever your Claude Code install already uses. Raltic doesn't see it. If `claude` works in your terminal, it works as a Raltic runtime." },
      { q: "Which Claude model runs?", a: "Sonnet by default; Opus and Haiku selectable per agent in the create / edit dialog. Each agent pins its own model." },
      { q: "How is this different from Anthropic's Projects?", a: "Projects is a 1:1 chat in Anthropic's UI. Raltic puts Claude in a team channel where humans + other agents can collaborate in the same thread." },
    ],
    models: ["sonnet", "opus", "haiku"],
    upstreamHref: "https://docs.anthropic.com/claude/docs/claude-code",
    upstreamLabel: "Anthropic Claude Code docs",
  },
  codex: {
    key: "codex",
    longName: "OpenAI Codex",
    shortName: "Codex",
    lifecycle: "per_turn_spawn",
    verification: "verified",
    accent: "amber",
    tagline: "GPT-5 series in a team channel.",
    hero: "OpenAI's Codex CLI is fast, opinionated, and great at codegen-heavy work. Raltic wires it into shared channels so the engineer who wrote the prompt isn't the only one who sees the answer.",
    whatItIs: "Codex is OpenAI's terminal-native agent built on the GPT-5 family. It writes, edits, and tests code with shell + file tools, and ships with an MCP server for extension.",
    howRalticUses: "Raltic invokes `codex` per turn with your OpenAI auth (env or `codex login`). The agent runs on your laptop against your repo; only its replies stream into Raltic. Provider keys stay yours.",
    installCmd: "npm i -g @openai/codex && codex login",
    bestAt: [
      "Fast iteration on small, focused edits",
      "Codegen scaffolding (new components, API endpoints, tests)",
      "Anything where you'd reach for GPT-5.5 / GPT-5.4 in the terminal",
    ],
    faq: [
      { q: "Which OpenAI model runs?", a: "Pick from gpt-5.5, gpt-5.4, or gpt-5.3-codex-spark when creating the agent. Each agent pins one model." },
      { q: "What if I'm rate-limited?", a: "Raltic surfaces the rate-limit error in the channel; the agent retries on next mention. Nothing is silently dropped." },
      { q: "Can the same workspace mix Codex and Claude agents?", a: "Yes. Per-agent runtime + model; they share channels and can @mention each other in the same thread." },
    ],
    models: ["gpt-5.5", "gpt-5.4", "gpt-5.3-codex-spark"],
    upstreamHref: "https://github.com/openai/codex",
    upstreamLabel: "OpenAI Codex on GitHub",
  },
  openclaw: {
    key: "openclaw",
    longName: "OpenClaw",
    shortName: "OpenClaw",
    lifecycle: "external_daemon",
    verification: "experimental",
    accent: "violet",
    tagline: "Your local-first AI daemon, in your team's chat.",
    hero: "OpenClaw is a multi-channel agent daemon you already run on your laptop. Raltic adds a team-chat surface on top — your daemon handles every provider round-trip, Raltic never sees your keys.",
    whatItIs: "OpenClaw is a local-first AI assistant daemon (npm `openclaw`) that fronts a gateway you start with `openclaw onboard --install-daemon`. The CLI talks to your daemon, which talks to whichever providers you've configured.",
    howRalticUses: "Raltic invokes `openclaw agent --message ... --json` per turn against your already-running daemon. We never store or proxy provider keys for OpenClaw — your daemon is the trust boundary. If the daemon's offline, Raltic surfaces a clear \"daemon not running\" status in the agent settings.",
    installCmd: "npm i -g openclaw && openclaw onboard --install-daemon",
    bestAt: [
      "Teams that already standardize on OpenClaw locally",
      "Workflows where the daemon's router picks providers automatically",
      "Setups where the user wants their own credential governance",
    ],
    faq: [
      { q: "Why is this marked Experimental?", a: "Raltic's OpenClaw integration shipped against the public CLI docs without a local install in our CI. Smoke verification (docs/SMOKE_TESTS_openclaw_hermes.md) is required before we'll index this page or recommend the runtime for production-critical work." },
      { q: "Does Raltic store an OpenClaw API key?", a: "No. There is no Raltic-side OpenClaw key. Provider keys live in your daemon's config; Raltic only talks to the local CLI." },
      { q: "What if my daemon picks a different model than I configured in Raltic?", a: "OpenClaw's router decides per-turn. The model you pin in Raltic is passed as `--model`; the daemon may override based on its own routing rules." },
    ],
    models: ["auto", "claude-sonnet-4-6", "gpt-5.4", "gemini-2.5-pro"],
    upstreamHref: "https://www.npmjs.com/package/openclaw",
    upstreamLabel: "openclaw on npm",
  },
  hermes: {
    key: "hermes",
    longName: "Hermes Agent (Nous Research)",
    shortName: "Hermes",
    lifecycle: "external_daemon",
    verification: "experimental",
    accent: "rose",
    tagline: "Nous Research's self-improving agent, channel-native.",
    hero: "Hermes Agent runs as a persistent daemon on your machine with its own memory and skills. Raltic wraps a team chat around it so the agent's wins (and its memory) accrue where the team can see and steer them.",
    whatItIs: "Hermes Agent is Nous Research's locally-installable agent with built-in persistent memory and a skill system. You install it via the project's curl-bash one-liner; the daemon manages its own routing.",
    howRalticUses: "Raltic spawns the `hermes` CLI per turn against your running daemon. Memory + skills stay daemon-side — Raltic surfaces them as `Recalling memory` / `Using skill: X` chips in the channel, but never reads or stores the memory contents.",
    installCmd: "curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash",
    bestAt: [
      "Long-running personal agents with persistent memory",
      "Workflows where the agent's skill library is the core value",
      "Setups where the user wants the daemon to handle routing",
    ],
    faq: [
      { q: "Why is this marked Experimental?", a: "Same reason as OpenClaw: integration was implemented from public docs without a local smoke pass. See docs/SMOKE_TESTS_openclaw_hermes.md for what verification needs to cover before we drop the experimental tag." },
      { q: "What model does Hermes use?", a: "The router on your daemon decides. Raltic exposes \"auto\" and \"router-default\" as model options, both of which mean \"let the daemon choose\"." },
      { q: "Where does Hermes' memory live?", a: "On your machine, managed by the daemon. Raltic only sees the per-turn chat replies. We don't store, sync, or back up Hermes memory." },
    ],
    models: ["auto", "router-default"],
    upstreamHref: "https://hermes-agent.nousresearch.com/",
    upstreamLabel: "Hermes Agent (Nous Research)",
  },
};
