-- Migration 24: topics.template_topic_id, the durable link from a team's
-- default topic to the template default it was copied from (#311)
--
-- Implements openspec/changes/311-template-topic-id-matching design.md
-- Decisions 1, 2, 5 and 11 (specs/database-migrations, default-topic-provisioning).
--
-- Why: a team's copy of a default was recognised only by name, so a template
-- rename (#216) or a same-named custom topic (#197) broke or fooled the match.
-- The link records identity ("copied from that template default"); it is never
-- used to propagate template edits to a team (BRD 6.4).
--
-- Legacy rows: team defaults created before this migration (migrations 4 and 11
-- deleted and reinserted template rows) may have no matching template row.
-- Those rows stay NULL ("unlinked"); that is expected. #310 and the runbook in
-- docs/deployment.md handle them. The unlinked count comes from the runbook
-- count query, not from this migration, which emits nothing (no RAISE NOTICE,
-- no id, team id or name in any output).
--
-- Template defaults are archived, never deleted: the FK is ON DELETE RESTRICT,
-- so a delete of a referenced template row is refused (SQLSTATE 23503).
--
-- Transaction model: a .sql file is sent as one multi-statement query even
-- under --no-single-transaction, so this file runs as one implicit
-- transaction. A failure part-way leaves nothing applied. IF NOT EXISTS and
-- drop-if-exists only make a manual replay safe; they are not a partial-failure
-- strategy.
--
-- Locking: SET LOCAL lock_timeout = '200ms' first and RESET last, as migrations
-- 22 and 23 (below the pool statement timeout). VALIDATE CONSTRAINT scans topics.
-- If a lock times out the migration rolls back on its own; re-run it.
--
-- The CHECK uses the sentinel literal for DEFAULT_TOPICS_TEAM_ID
-- (src/sessions/default-topics.ts); template-team-migration-integration.test.ts
-- asserts they are equal.
--
-- Rollback: the down section drops the CHECK and then the column; no user data
-- is lost because the link is recomputable by re-running the backfill.

-- Up Migration
SET LOCAL lock_timeout = '200ms';

ALTER TABLE topics
  ADD COLUMN IF NOT EXISTS template_topic_id uuid NULL REFERENCES topics(id) ON DELETE RESTRICT;

-- Backfill: one statement, idempotent, raw "=" on name. Keep it identical to
-- the "backfill" statement in test-fixtures/template-link-runbook.sql
-- (a test asserts this). In-statement uniqueness (no team row linked twice, no
-- two team rows linked to one template row) rests on the one-winner-per-
-- (team, name) ranking (rn = 1), NOT on the NOT EXISTS, which sees only the
-- pre-statement snapshot. Do not remove the ranking.
WITH team_rows AS (
  SELECT id, team_id, name,
         row_number() OVER (PARTITION BY team_id, name ORDER BY (status = 'active') DESC, id) AS rn
    FROM topics
   WHERE is_default = true
     AND template_topic_id IS NULL
     AND team_id <> '00000000-0000-0000-0000-000000000001'::uuid
),
template_rows AS (
  SELECT id, name,
         row_number() OVER (PARTITION BY name ORDER BY (status = 'active') DESC, id) AS rn
    FROM topics
   WHERE is_default = true
     AND team_id = '00000000-0000-0000-0000-000000000001'::uuid
)
UPDATE topics t
   SET template_topic_id = tr.id
  FROM team_rows c
  JOIN template_rows tr ON tr.name = c.name AND tr.rn = 1
 WHERE t.id = c.id
   AND c.rn = 1
   AND NOT EXISTS (
     SELECT 1 FROM topics x
      WHERE x.team_id = c.team_id AND x.template_topic_id = tr.id
   );

ALTER TABLE topics DROP CONSTRAINT IF EXISTS topics_template_link_valid;
ALTER TABLE topics ADD CONSTRAINT topics_template_link_valid
  CHECK (template_topic_id IS NULL
         OR (is_default AND team_id <> '00000000-0000-0000-0000-000000000001'::uuid)) NOT VALID;
ALTER TABLE topics VALIDATE CONSTRAINT topics_template_link_valid;

COMMENT ON COLUMN topics.template_topic_id IS
  'The template default this team default was copied from (#311). Identity only; never used to propagate template edits.';

RESET lock_timeout;

-- Down Migration
ALTER TABLE topics DROP CONSTRAINT topics_template_link_valid;
ALTER TABLE topics DROP COLUMN template_topic_id;
