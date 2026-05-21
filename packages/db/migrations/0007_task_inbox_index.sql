-- Composite index for the per-assignee task inbox query.
--
-- Hot path: inbox.ts groups open tasks per assignee + sorts by createdAt
-- desc. The existing ix_tasks_assignee covers (assignee_id, status) which
-- helps the filter but forces a sort step on createdAt. As task volume
-- grows that's an O(N log N) sort on each request.
--
-- This covering index lets the planner read rows in createdAt-desc order
-- directly. Drop the older partial index in the same migration since the
-- new one strictly dominates it.

CREATE INDEX IF NOT EXISTS ix_tasks_assignee_kind_status_created
  ON tasks (assignee_id, assignee_type, status, created_at DESC);

DROP INDEX IF EXISTS ix_tasks_assignee;
