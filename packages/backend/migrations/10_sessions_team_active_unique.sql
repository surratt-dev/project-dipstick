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
-- file itself. This relies on each .sql migration file running in its own
-- transaction, which is NOT node-pg-migrate's default: by default it wraps
-- ALL pending migrations for a run into one single transaction
-- (--single-transaction=true). packages/backend/package.json's db:migrate
-- script passes --no-single-transaction specifically so each file commits
-- independently -- required here because migration 9 adds 'draft' to the
-- session_status enum, and Postgres forbids using a newly-added enum value
-- in the same transaction it was added in (error 55P04, "unsafe use of new
-- value ... New enum values must be committed before they can be used").
-- On a fresh database, migrations 9 and 10 would otherwise run back-to-back
-- in the same batch transaction and this migration's own guard query (which
-- compares status to 'draft') would fail to even execute. Do not remove
-- --no-single-transaction from db:migrate while this migration's guard
-- references 'draft'.
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
-- ever reached, not a silent index-creation failure. Also re-verified against
-- a genuinely fresh database (migrations 1-10 from empty, matching CI's
-- Integration Tests job) after adding --no-single-transaction: migration
-- completes cleanly, and the guard above still fires correctly when re-run
-- manually against duplicate rows.

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
