-- Migration 6: Create role_change_audit table
--
-- Stores an append-only record of every team membership role change executed
-- via TEAM-005. Written in the same database transaction as the role UPDATE so
-- that a role change without an audit record is not a possible outcome.
--
-- Per Decision 7 in design.md:
--   - Records actor user ID, actor global_role AT THE TIME of the change
--     (not just the actor ID — we need to know whether they acted as admin or EM)
--   - Records actor IP, subject user ID, team ID, from-role, to-role, timestamp
--   - Append-only: no DELETE permission through the application layer
--   - Minimum 12-month retention (enforced operationally, not by this schema)

-- Up
CREATE TABLE role_change_audit (
    id                  uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id       uuid            NOT NULL REFERENCES users(id),
    -- global_role snapshot at change time — not a FK so the record is stable
    -- even if the enum were ever extended. Stored as text for audit durability.
    actor_global_role   text            NOT NULL,
    actor_ip            text            NOT NULL,
    subject_user_id     uuid            NOT NULL REFERENCES users(id),
    team_id             uuid            NOT NULL REFERENCES teams(id),
    from_role           membership_role NOT NULL,
    to_role             membership_role NOT NULL,
    changed_at          timestamptz     NOT NULL DEFAULT now()
);

-- Indexes support post-incident review queries by team, actor, and subject
CREATE INDEX idx_role_change_audit_team_id ON role_change_audit(team_id);
CREATE INDEX idx_role_change_audit_actor ON role_change_audit(actor_user_id);
CREATE INDEX idx_role_change_audit_subject ON role_change_audit(subject_user_id);
CREATE INDEX idx_role_change_audit_changed_at ON role_change_audit(changed_at);

-- Down: DROP TABLE role_change_audit; (execute via db:migrate:down — do not place runnable SQL here)
