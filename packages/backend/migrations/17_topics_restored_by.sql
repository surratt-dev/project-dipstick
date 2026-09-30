-- Migration 17: Add topics.restored_by / topics.restored_at provenance columns
--
-- Implements design.md Decision 4 (re-add-removed-topic).
--
-- Facilitator-visible provenance ("who restored this topic and when") is a
-- first-class table column, matching the archived_by/archived_at precedent
-- (migration 16) rather than an audit-log read path. The restore transaction
-- sets both and leaves archived_at/archived_by untouched -- preserved, not
-- cleared, per design.md Decision 4.
--
-- Additive, nullable, no backfill: no shipped endpoint has ever restored a
-- topic before TOPIC-005 (this change), so every existing topics row already
-- has restored_by = NULL / restored_at = NULL, which is the correct value
-- for a row that has never been restored.
--
-- Rollback: a normal migration revert (drop the columns). No data-loss risk.

-- Up
ALTER TABLE topics
    ADD COLUMN IF NOT EXISTS restored_by uuid NULL REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS restored_at timestamptz NULL;

-- Down
-- ALTER TABLE topics DROP COLUMN IF EXISTS restored_by;
-- ALTER TABLE topics DROP COLUMN IF EXISTS restored_at;
