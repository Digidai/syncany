# OpenClaw + Hermes smoke test runbook

The code in `packages/agent-runtime/src/{openclaw,hermes}.ts` was
written from public docs without local CLI access. Before shipping
real user traffic to these runtimes, someone with the daemons
installed must run through this checklist and capture any drift
between the assumed CLI shapes and reality.

## Prereqs

```sh
# OpenClaw
npm i -g openclaw
openclaw onboard --install-daemon
openclaw gateway status         # expect: daemon up

# Hermes
curl -sSL https://hermes-agent.nousresearch.com/install.sh | sh
hermes status --json            # expect: daemon up + json body
```

## 1. Capture real CLI surface

### OpenClaw

```sh
openclaw --version
openclaw agent --help > docs/SAMPLES_openclaw_help.txt
openclaw agent --message "say hi in one word" --json \
  > docs/SAMPLES_openclaw_hello.jsonl
THREAD=$(jq -r 'select(.thread).thread' docs/SAMPLES_openclaw_hello.jsonl | head -1)
openclaw agent --message "and again?" --thread "$THREAD" --json \
  > docs/SAMPLES_openclaw_resume.jsonl
```

### Hermes

```sh
hermes --version
hermes status --json > docs/SAMPLES_hermes_status.json
hermes agent --help > docs/SAMPLES_hermes_help.txt
hermes agent --message "say hi in one word" --json \
  > docs/SAMPLES_hermes_hello.jsonl
SESSION=$(jq -r 'select(.session).session' docs/SAMPLES_hermes_hello.jsonl | head -1)
hermes agent --message "and again?" --session "$SESSION" --json \
  > docs/SAMPLES_hermes_resume.jsonl
```

## 2. Diff against assumptions

Open `packages/agent-runtime/src/openclaw.ts` and
`packages/agent-runtime/src/hermes.ts`. The "SMOKE TEST REQUIRED"
comments call out exactly which arguments + event types are assumed.
Cross-reference each against the captured `*_help.txt` and
`*_hello.jsonl` and update.

Specifically verify:

- [ ] **OpenClaw** flags: `--message`, `--thread`, `--system`, `--model`, `--thinking`, `--json`
- [ ] **OpenClaw** event types: `agent_message`, `reasoning`, `tool_use`, `turn.completed`, `thread.started`, `error`
- [ ] **OpenClaw** tool names from real tool calls — update `describeOpenClawTool()` if names differ
- [ ] **Hermes** flags: `--message`, `--session`, `--system`, `--mode`, `--json`
- [ ] **Hermes** event types: `agent_message`, `tool.start`, `skill.start`, `memory_recall`, `turn.completed`
- [ ] **Hermes** tool / skill names from real runs

## 3. Bridge integration test (gated)

```sh
export RALTIC_RUN_OPENCLAW_INTEGRATION=1
export RALTIC_RUN_HERMES_INTEGRATION=1
pnpm -F @raltic/bridge-core test
```

The integration test (TODO: add at `apps/bridge/test/`) should:
1. Instantiate each runtime
2. Call `detect()` — assert binary + daemon both up
3. Call `spawn()` with a one-turn prompt
4. Subscribe to `activity` events — assert at least one `text`
   event with non-empty content arrives within 30s
5. Call `getResumeKey()` — assert non-null thread/session id
6. Send a second turn with the resume key — assert reply mentions
   the first turn's context
7. Call `shutdown()` — assert no leaked processes

## 4. End-to-end web test

1. Run the bridge: `pnpm dev:bridge`
2. raltic.com → settings → runtimes — expect 4 rows: claude, codex,
   openclaw, hermes. The two new ones show "Ready" status.
3. Create a new agent → pick runtime: OpenClaw → save.
4. DM the new agent → send "hello". Reply within ~30s; activity
   feed shows tool/skill events if the agent uses them.
5. Repeat with runtime: Hermes.

## 5. Failure-mode spot-checks

- [ ] Stop the openclaw gateway → settings page shows "daemon
  offline" within 30s
- [ ] Invalid provider key in the daemon → next agent message
  surfaces a CLEAR error in the chat (not a silent stall)
- [ ] Kill the daemon mid-turn → bridge surfaces "agent crashed"
  + user can retry

## 6. Lock down the contract

Commit captured samples at `docs/SAMPLES_*.jsonl`. Extend the unit
tests at `packages/agent-runtime/test/{openclaw,hermes}.test.ts`
to replay real events through the parsers — locks down the contract
against future CLI version changes.
