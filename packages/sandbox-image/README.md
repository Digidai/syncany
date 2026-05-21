# @raltic/sandbox-image

Container image for the per-Agent sandbox. One instance per Agent in the
cloud runtime. Holds only:

- `bash`, `git`, `github-cli`, `curl`, `jq`, `ripgrep`, `python3`, `uv`, build tools
- `@raltic/sandbox-daemon` (Hono HTTP RPC, bound to `:8080`)
- `tini` as PID 1

No AI CLI (Claude Code / Codex / Gemini / OpenCode) is preinstalled —
those are optional sidecar images attached only when the user picks a
`runtime_mode` that requires them (see DESIGN_agent_platform_v2 §4.1).

## Build

```bash
pnpm --filter @raltic/sandbox-image build
pnpm --filter @raltic/sandbox-image size
```

Target: `~350 MB`. If it drifts upward by more than 10% in a PR, inspect
`apk add` lines and ensure no dev-only deps slipped in.

## Run locally

```bash
pnpm --filter @raltic/sandbox-image run:dev
# Daemon listens on :8080. Health probe:
curl http://localhost:8080/health
```

## Deploy

Pushed to CF Containers registry from the api Worker's wrangler config
(see `apps/api/wrangler.jsonc` `containers` block — P1 wires this up).
