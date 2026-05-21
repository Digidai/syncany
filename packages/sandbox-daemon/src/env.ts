/**
 * Shared env-scrubbing for any subprocess spawned by the daemon.
 *
 * Daemon secrets (bearer token, transient git access tokens) MUST NEVER
 * reach bash / git / future tool subprocesses. An agent that runs
 * `echo $RALTIC_SANDBOX_TOKEN` could otherwise exfiltrate its auth bearer
 * via stdout, which the agent loop relays back into the conversation.
 *
 * Codex review (HIGH/MED) caught this on both bash and git handlers;
 * centralised here to make the deny-list one source of truth.
 */
const SECRET_ENV_VARS = new Set([
  "RALTIC_SANDBOX_TOKEN",
  "GIT_ASKPASS_TOKEN",
]);

export function buildChildEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (SECRET_ENV_VARS.has(k)) continue;
    out[k] = v;
  }
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      // Agent-supplied env can OVERRIDE process env (legitimate use)
      // but still can't reintroduce a stripped secret.
      if (SECRET_ENV_VARS.has(k)) continue;
      out[k] = v;
    }
  }
  return out;
}
