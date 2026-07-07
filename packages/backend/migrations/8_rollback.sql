-- Migration 8 Rollback: Restore role_change_audit and remove audit_log
--
-- This script must be validated in a non-production environment before the
-- production deployment gate is cleared (task 2a.11).
--
-- Prerequisites:
--   1. A backup of role_change_audit data exists from before migration 8 ran.
--      (Migration 8 migrated role_change_audit rows into audit_log before dropping
--      the table. The migration data is preserved in audit_log until this rollback
--      runs — extract rows WHERE operation = 'team.role_changed' to restore.)
--   2. Application code has been reverted to the pre-migration-8 version (i.e.,
--      the TEAM-005 handler writes to role_change_audit, not audit_log).
--
-- What this rollback does:
--   1. Recreates role_change_audit with its original schema (from migration 6)
--   2. Restores migrated records from audit_log WHERE operation = 'team.role_changed'
--   3. Drops audit_log (including all TEAM-006 audit records if any were written)
--   4. Removes the partial unique index from migration 7 (required by TEAM-006
--      ON CONFLICT clause — safe to remove if TEAM-006 is rolled back)
--
-- WARNING: This rollback destroys all TEAM-006 audit records and all non-role-change
-- audit records written to audit_log since migration 8 ran. It also removes the
-- partial unique index that enables TEAM-006's idempotent upsert. Only run this
-- rollback when rolling back Phase 2 entirely.

-- Step 1: Recreate role_change_audit
CREATE TABLE role_change_audit (
    id                  uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id       uuid            NOT NULL REFERENCES users(id),
    actor_global_role   text            NOT NULL,
    actor_ip            text            NOT NULL,
    subject_user_id     uuid            NOT NULL REFERENCES users(id),
    team_id             uuid            NOT NULL REFERENCES teams(id),
    from_role           membership_role NOT NULL,
    to_role             membership_role NOT NULL,
    changed_at          timestamptz     NOT NULL DEFAULT now()
);

CREATE INDEX idx_role_change_audit_team_id ON role_change_audit(team_id);
CREATE INDEX idx_role_change_audit_actor ON role_change_audit(actor_user_id);
CREATE INDEX idx_role_change_audit_subject ON role_change_audit(subject_user_id);
CREATE INDEX idx_role_change_audit_changed_at ON role_change_audit(changed_at);

-- Step 2: Restore migrated records from audit_log
-- Rows written to audit_log by migration 8's INSERT SELECT have
-- operation = 'team.role_changed' and metadata with from_role/to_role.
INSERT INTO role_change_audit (
    actor_user_id,
    actor_global_role,
    actor_ip,
    subject_user_id,
    team_id,
    from_role,
    to_role,
    changed_at
)
SELECT
    actor_user_id,
    actor_global_role,
    COALESCE(actor_ip::text, '0.0.0.0'),
    target_user_id,
    team_id,
    (metadata->>'from_role')::membership_role,
    (metadata->>'to_role')::membership_role,
    timestamp
FROM audit_log
WHERE operation = 'team.role_changed'
  AND target_user_id IS NOT NULL
  AND team_id IS NOT NULL
  AND metadata ? 'from_role'
  AND metadata ? 'to_role';

-- Step 3: Drop audit_log (all Phase 2+ audit records are lost)
DROP TABLE audit_log;

-- Step 4: Remove the partial unique index from migration 7
-- (TEAM-006's ON CONFLICT clause requires this index; it is safe to drop
-- when rolling back TEAM-006 together with Phase 2)
DROP INDEX IF EXISTS team_memberships_active_unique;
