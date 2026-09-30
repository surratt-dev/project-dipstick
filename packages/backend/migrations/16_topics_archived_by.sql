-- Migration 16: Add topics.archived_by provenance column
--
-- Implements design.md Decision 6 (remove-topic).
--
-- Facilitator-visible provenance ("who archived this topic and when") is a
-- first-class table column, not an audit-log read path -- audit_log.metadata
-- is an unindexed JSONB blob, and building a product-facing read path
-- (TOPIC-002, called every time a facilitator opens the Topic Management
-- screen) against the audit log's storage shape is the wrong architectural
-- boundary. archived_at already exists (migration 2); this migration adds
-- the matching actor column.
--
-- Additive, nullable, no backfill: no shipped endpoint has ever archived a
-- topic before TOPIC-004 (this change), so every existing topics row already
-- has archived_by = NULL, which is the correct value for a row that has
-- never been archived.
--
-- Rollback: a normal migration revert (drop the column). No data-loss risk.

-- Up
ALTER TABLE topics
    ADD COLUMN IF NOT EXISTS archived_by uuid NULL REFERENCES users(id);

-- Down
-- ALTER TABLE topics DROP COLUMN IF EXISTS archived_by;
