# Reusable Skills — Design

## Why

Multica's pitch is "agents compound skills over time." For a chat-first
product like ours, the equivalent is **agents reuse named operations**
across conversations. Examples our users have asked for:

- "@DeployFrontend — push the current branch to prod" — sequence: gh
  push, gh pr create, monitor CI, post status.
- "@CodeReview — review the open PR" — sequence: gh pr view, grep for
  patterns, post inline comments.
- "@DigestStandup — summarize yesterday's #engineering channel" —
  query D1, run prompt template, post in #standups.

Without skills, every conversation re-explains the operation. With
skills, an agent can `@DeployFrontend` and the agent's response
template/system prompt gets augmented with the skill's recipe + tool
list.

## Data model

```sql
CREATE TABLE skills (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,                  -- @-mention handle: "DeployFrontend"
  name TEXT NOT NULL,                  -- display name
  description TEXT,                    -- one-line shown in @-picker
  system_prompt_delta TEXT NOT NULL,   -- text injected into agent's
                                        -- system prompt when invoked
  required_tools TEXT,                 -- comma-sep CLI names (gh, kubectl…)
  created_by TEXT NOT NULL REFERENCES user(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(server_id, slug)              -- @handles unique per workspace
);
CREATE INDEX ix_skills_server ON skills(server_id);
```

## Invocation

User types `@DeployFrontend ship the staging branch` in a channel.

Message-area parses `@SkillName` mentions before send:
- looks up skill by (channel.serverId, slug)
- prepends a system-prompt-delta block to the next agent reply

Bridge's agent-manager reads the skill via boot payload (server lists
all skills) so dispatch is hot-path.

## Out of scope for v0

- Skill versioning (just edit-in-place for now)
- Skill marketplace / sharing across workspaces
- Skill auto-suggestion ("agent thinks DeployFrontend matches")
- Required-tool runtime validation (just informational text)

## Migration scaffolding

Migration `00xx_skills.sql` lands when the API + UI ship. NOT in
this PR — we're documenting intent first so the data model is reviewed
before code.
