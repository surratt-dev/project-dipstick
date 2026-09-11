-- Migration 8: Replace role_change_audit with general-purpose audit_log table
--
-- Decision 9 (design.md — establish-manager-team-relationship):
-- This migration creates the audit_log table, migrates TEAM-005's existing
-- audit writes to it, and drops role_change_audit — all as one atomic change.
-- Splitting these into separate migrations would leave a window where TEAM-005
-- is writing to a table that no longer exists, or where TEAM-006 audit writes
-- go to a table that TEAM-005 has not yet vacated.
--
-- Why a new table instead of extending role_change_audit:
-- The role_change_audit schema (from_role/to_role, subject_user_id) is
-- incompatible with TEAM-006 audit fields (operation, target_user_id).
-- Extending it with nullable columns produces a table serving two incompatible
-- record shapes. The audit_log table handles both operations cleanly and
-- positions the system for future audit requirements without schema gymnastics.
--
-- Rollback: restore role_change_audit from backup or reverse migration (see
-- migrations-manual/8_rollback.sql — deliberately NOT in this migrations/
-- directory, so node-pg-migrate never auto-discovers and runs it; see that
-- file's header and GitHub issue #39 for why this matters). The rollback
-- script must be validated in a non-production environment before Phase 2
-- ships to production (task 2a.11).

-- Up

-- Step 1: Create the audit_log table
CREATE TABLE audit_log (
    id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Actor fields — stored as text/inet for audit durability (not FKs, so records
    -- remain stable even if the referenced user is later deactivated or deleted)
    actor_user_id       UUID            NOT NULL,
    actor_global_role   TEXT            NOT NULL,
    actor_ip            INET,
    -- Operation being audited
    operation           TEXT            NOT NULL,
    -- Target — both nullable because not all operations have a target user or team
    target_user_id      UUID,
    team_id             UUID,
    -- Timestamp with time zone; DEFAULT now() covers cases where the application
    -- does not supply an explicit timestamp
    timestamp           TIMESTAMPTZ     NOT NULL DEFAULT now(),
    -- Extensible metadata for operation-specific fields (e.g., from_role/to_role
    -- for role changes, session_id for EM access events)
    metadata            JSONB
);

-- Indexes supporting post-incident review queries
CREATE INDEX idx_audit_log_actor      ON audit_log (actor_user_id);
CREATE INDEX idx_audit_log_target     ON audit_log (target_user_id) WHERE target_user_id IS NOT NULL;
CREATE INDEX idx_audit_log_team       ON audit_log (team_id) WHERE team_id IS NOT NULL;
CREATE INDEX idx_audit_log_operation  ON audit_log (operation);
CREATE INDEX idx_audit_log_timestamp  ON audit_log (timestamp);

-- Step 2: Migrate TEAM-005's existing audit records from role_change_audit
-- to audit_log. The operation value 'team.role_changed' matches the structured
-- log event name used by emitAuditEvent — consistent across DB and log records.
-- from_role and to_role are preserved in the metadata JSONB column.
--
-- IF EXISTS guard: migration 6 had a runnable -- Down section that node-pg-migrate
-- v7 executed as part of Up (the entire SQL file is treated as Up). On a fresh DB
-- where migration 6 ran and immediately dropped role_change_audit, this block is
-- skipped — there are no records to migrate. On an existing DB where role_change_audit
-- holds data, the block runs normally.
DO $$
BEGIN
  IF EXISTS (
    SELECT FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'role_change_audit'
  ) THEN
    INSERT INTO audit_log (
        actor_user_id,
        actor_global_role,
        actor_ip,
        operation,
        target_user_id,
        team_id,
        timestamp,
        metadata
    )
    SELECT
        actor_user_id,
        actor_global_role,
        actor_ip::inet,
        'team.role_changed',
        subject_user_id,
        team_id,
        changed_at,
        jsonb_build_object('from_role', from_role, 'to_role', to_role)
    FROM role_change_audit;

    -- Step 3: Drop role_change_audit in the same block as the INSERT above so
    -- both changes are atomic. If the INSERT fails, the DROP does not execute
    -- and no audit records are lost.
    DROP TABLE role_change_audit;
  END IF;
END $$;

-- Down (reference — execute manually via migrations-manual/8_rollback.sql)
-- See migrations-manual/8_rollback.sql for the validated rollback procedure.
-- Do NOT add a DROP TABLE audit_log here; this comment is intentional.
-- Do NOT add a runnable rollback .sql file to this migrations/ directory —
-- node-pg-migrate auto-discovers and runs every file here (see issue #39).
-- The rollback requires restoring role_change_audit from backup first.
