-- Migration 7: Add partial unique constraint on team_memberships
--
-- Required by TEAM-006 (POST /api/v1/teams/:teamId/managers).
-- The TEAM-006 handler uses:
--
--   INSERT INTO team_memberships (user_id, team_id, role)
--   VALUES ($1, $2, 'engineering_manager')
--   ON CONFLICT (user_id, team_id) WHERE removed_at IS NULL
--   DO UPDATE SET role = 'engineering_manager'
--   RETURNING id, (xmax = 0) AS is_new_row
--
-- The ON CONFLICT target requires a partial unique constraint on
-- (user_id, team_id) WHERE removed_at IS NULL. Without it the upsert fails
-- at runtime with a "there is no unique or exclusion constraint matching
-- the ON CONFLICT specification" error — not a compile-time error.
--
-- The existing UNIQUE(team_id, user_id) constraint in migration 2 is a full
-- constraint, not a partial one. It prevents ALL duplicate (team_id, user_id)
-- pairs, including soft-deleted rows (removed_at IS NOT NULL). The partial
-- constraint below allows the same user to be re-added to a team after their
-- prior membership has been soft-deleted, while still preventing duplicate
-- active memberships.
--
-- NOTE: The existing full constraint team_memberships_unique on (team_id, user_id)
-- is retained. Both constraints coexist: the full constraint prevents any
-- duplicate (team_id, user_id) pair regardless of removed_at; the partial
-- constraint is required specifically as the ON CONFLICT target in TEAM-006.
-- If the product ever requires re-adding soft-deleted members, the full
-- constraint would need to be reviewed. For now, retaining both is safe.

-- Up
CREATE UNIQUE INDEX IF NOT EXISTS team_memberships_active_unique
    ON team_memberships (user_id, team_id)
    WHERE removed_at IS NULL;

-- Down
-- DROP INDEX IF EXISTS team_memberships_active_unique;
