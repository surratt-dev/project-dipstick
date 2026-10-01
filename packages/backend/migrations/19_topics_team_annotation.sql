-- Migration 19: team annotation ("Our team's definition") on topics, and its
-- session snapshot column
--
-- Implements topic-annotation design.md Migration Plan and Decision 4
-- (specs/topic-annotation/spec.md "A team's topic carries an optional team
-- annotation with editor provenance").
--
-- topics gains the team's free-text definition plus provenance of the last
-- change (who/when), following the archived_by / restored_by precedent.
-- session_topics gains the snapshot column that SESSION-005 / SESSION-012
-- read; it is populated by #175's session_topics write, never read live from
-- topics.
--
-- All four columns are nullable with no default and no backfill, so every
-- existing row reads NULL. There is deliberately NO length CHECK:
--   * the TOPIC-007 handler is the single enforcement point (500 UTF-16 code
--     units after trim); Postgres char_length counts code points, so a CHECK
--     would be a different, looser rule;
--   * session_topics.topic_annotation must accept whatever its source held.
--
-- annotation_updated_by has no ON DELETE behaviour, like archived_by /
-- restored_by (user-erasure follow-up, design.md Risks).
--
-- Rollback: npm run db:migrate:down drops exactly these four columns.
--
-- Section markers are node-pg-migrate's real ones (as in migration 18), not
-- the bare markers of migrations 16/17, which the runner does not recognise.

-- Up Migration
ALTER TABLE topics
    ADD COLUMN team_annotation       text        NULL,
    ADD COLUMN annotation_updated_by uuid        NULL REFERENCES users(id),
    ADD COLUMN annotation_updated_at timestamptz NULL;
ALTER TABLE session_topics
    ADD COLUMN topic_annotation text NULL;

-- Down Migration
ALTER TABLE session_topics
    DROP COLUMN topic_annotation;
ALTER TABLE topics
    DROP COLUMN annotation_updated_at,
    DROP COLUMN annotation_updated_by,
    DROP COLUMN team_annotation;
