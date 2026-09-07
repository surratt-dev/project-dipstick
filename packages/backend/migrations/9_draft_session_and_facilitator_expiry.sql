-- Migration 9: Add 'draft' session status and facilitator access expiry column
--
-- Implements Decision 3 (draft session pre-access) and Decision 4 (post-session
-- grace window) from design.md — enforce-access-control-on-team-content.
--
-- Changes:
--   1. Add 'draft' value to the session_status enum.
--   2. Add facilitator_access_expires_at TIMESTAMPTZ NULL to sessions.
--   3. Add index on sessions(facilitator_id, team_id, status) for Path 3 auth.
--   4. Add index on team_memberships(user_id, team_id) for Path 1/2 auth.
--
-- All changes are additive / backward-compatible:
--   - Existing sessions rows are unaffected (facilitator_access_expires_at = NULL).
--   - NULL facilitator_access_expires_at correctly returns false for any > NOW()
--     comparison, so existing rows do not inadvertently grant grace window access.
--   - The 'draft' enum value addition does not affect rows using other statuses.
--
-- Rollback: altering a PostgreSQL enum is not directly reversible via a simple
-- DROP VALUE. To roll back: rename the type and recreate it without 'draft',
-- then update any columns that used it. See operations runbook for the procedure.

-- 1. Add 'draft' to the session_status enum
ALTER TYPE session_status ADD VALUE IF NOT EXISTS 'draft' BEFORE 'lobby';

-- 2. Add the facilitator_access_expires_at column (nullable, so existing rows
--    default to NULL — which correctly means no grace window is active).
ALTER TABLE sessions
    ADD COLUMN IF NOT EXISTS facilitator_access_expires_at TIMESTAMPTZ NULL;

-- 3. Index on sessions(facilitator_id, team_id, status) — supports the Path 3
--    authorization query that checks for an active session by this facilitator
--    on the requested team across multiple status values.
CREATE INDEX IF NOT EXISTS idx_sessions_facilitator_team_status
    ON sessions (facilitator_id, team_id, status);

-- 4. Index on team_memberships(user_id, team_id) — supports the Path 1 and
--    Path 2 authorization queries that check membership by user and team.
--    The partial index idx_team_memberships_user_active (user_id WHERE removed_at
--    IS NULL) from migration 3 covers user lookups but not the combined
--    (user_id, team_id) predicate used in the authorization helper's single query.
CREATE INDEX IF NOT EXISTS idx_team_memberships_user_team
    ON team_memberships (user_id, team_id);
