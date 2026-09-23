-- Migration 10: Concurrent-session protection for session-creation-existing-team
--
-- design.md Decision D3: a facilitator cannot create a session for a team
-- that already has a non-terminal session. Enforced with a database-level
-- partial unique index, not an app-level check-then-insert (which has the
-- same race window session-participation's dual-check precedent already
-- rejects this pattern for).
--
-- Five non-terminal statuses out of session_status's seven values are
-- covered: 'draft', 'lobby', 'pre_session', 'active', 'wrap_up'. The other
-- two ('complete', 'abandoned') are terminal. 'abandoned' is included in the
-- enum but no code path transitions a session to it today (confirmed by
-- inspection) -- if a future change starts writing 'abandoned' mid-session,
-- this index's status list must be reconsidered deliberately.
--
-- Self-enforcing migration guard: rather than a manual pre-check an operator
-- is expected to run before this migration, the guard lives in the migration
-- file itself. node-pg-migrate runs each .sql migration inside its own
-- transaction by default (this migration needs no CONCURRENTLY, so that
-- default holds), so a violation aborts the whole migration transaction and
-- fails the deploy loudly.
--
-- Manual verification (tasks.md task 1.3 -- no prior precedent in this
-- codebase for automated migration tests, so this is documented here
-- instead): in a local dev DB with this migration already applied, run in a
-- transaction that is rolled back afterward: DROP INDEX
-- sessions_team_active_unique, INSERT two sessions for the same team_id with
-- statuses 'draft' and 'lobby', then re-run the DO $$ ... $$ guard block
-- above verbatim. Confirmed: the guard raises "sessions_team_active_unique:
-- pre-existing duplicate non-terminal sessions found" and aborts, leaving
-- the index (and the database) unchanged once the transaction is rolled
-- back. This proves the guard -- not just the index -- is what closes the
-- gap: an operator who reruns this migration file against a database with
-- pre-existing duplicates gets a loud failure before CREATE UNIQUE INDEX is
-- ever reached, not a silent index-creation failure.

DO $$
BEGIN
  IF EXISTS (
    SELECT team_id FROM sessions
    WHERE status IN ('draft', 'lobby', 'pre_session', 'active', 'wrap_up')
    GROUP BY team_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'sessions_team_active_unique: pre-existing duplicate non-terminal sessions found';
  END IF;
END $$;

CREATE UNIQUE INDEX sessions_team_active_unique
  ON sessions (team_id)
  WHERE status IN ('draft', 'lobby', 'pre_session', 'active', 'wrap_up');
