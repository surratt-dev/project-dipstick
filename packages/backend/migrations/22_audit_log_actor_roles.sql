-- Migration 22: audit_log.actor_roles (#245, expand step)
--
-- Implements openspec/changes/store-idp-role-set design.md D6 and D9.
--
-- The actor's full role set, highest precedence first, as TEXT[] (not the
-- enum) for the same durability reason as actor_global_role. Written only by
-- the two sign-in rows (auth.first_access_created, auth.role_claim_mapped);
-- every other operation leaves it NULL. Its content is application-
-- guaranteed, not database-enforced.
--
-- Locking (D9): a nullable ADD COLUMN with no default is metadata-only.
-- lock_timeout 200ms is deliberately below the 400 ms transactional audit
-- statement timeout and the 500 ms fail-open audit timer, so an audit INSERT
-- queued behind this migration still completes. On a lock timeout this
-- migration rolls back on its own (migration 21 is already committed); re-run
-- it. Run with --no-single-transaction (npm run db:migrate does).
--
-- Rollback: redeploy the previous build first; the down section drops exactly
-- this column. Run it before 21's down section, never after.

-- Up Migration
SET LOCAL lock_timeout = '200ms';

ALTER TABLE audit_log ADD COLUMN actor_roles TEXT[] NULL;

COMMENT ON COLUMN audit_log.actor_roles IS
  'NULL means the actor''s role set was not captured for this operation. It does not mean the actor had no roles. Populated only for auth.first_access_created and auth.role_claim_mapped as of migration 22.';

RESET lock_timeout;

-- Down Migration
ALTER TABLE audit_log DROP COLUMN actor_roles;
