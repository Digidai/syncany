# Squads — Design

## Why

Multica's squads pattern: assign work to a GROUP (with a leader agent),
the leader routes to the right member. `@FrontendTeam` instead of
`@alice-or-bob-or-carol`. Stable mention across team turnover.

For our channel-first product, the chat equivalent is:

- `@DevTeam` in #general → leader agent picks the right specialist
  (DesignerAgent for UX questions, BackendAgent for API questions,
  etc.) and the specialist replies.
- A human asks `@OpsSquad can someone get me logs for prod` → leader
  routes to whoever's oncall.

## Data model

```sql
CREATE TABLE squads (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,           -- @mention handle: "DevTeam"
  name TEXT NOT NULL,           -- display name
  description TEXT,
  leader_agent_id TEXT NOT NULL REFERENCES agents(id),
  created_by TEXT NOT NULL REFERENCES user(id),
  created_at INTEGER NOT NULL,
  UNIQUE(server_id, slug)
);

CREATE TABLE squad_members (
  squad_id TEXT NOT NULL REFERENCES squads(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL,
  member_type TEXT NOT NULL CHECK (member_type IN ('human', 'agent')),
  added_at INTEGER NOT NULL,
  PRIMARY KEY (squad_id, member_id)
);
CREATE INDEX ix_squad_members_member ON squad_members(member_id);
```

## Invocation

`@DevTeam` mention in a channel:
1. Resolves to squad's leader_agent_id
2. Bridge dispatches the message to the leader's runtime
3. Leader's system prompt is augmented with the member roster + their
   roles, so the leader's reply can either:
   a) answer directly if it's the right specialist
   b) post `routing to @backend-agent: <restated question>` which then
      tags the target agent (existing @mention path)

## Out of scope for v0

- Auto-routing logic (squad leader just gets the mention; explicit
  routing in reply is the v0 mechanism)
- Squad-level permissions (channels still gate access)
- Squad-of-squads
- Roster auto-suggestions

## Migration scaffolding

Same as skills — designed first, migration + endpoints + UI in a
dedicated PR.
