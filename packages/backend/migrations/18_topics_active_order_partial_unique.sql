-- Migration 18: display_order uniqueness among a team's ACTIVE topics only
--
-- Implements reorder-topics design.md Decision 1 (specs/remove-topic/spec.md
-- "Display-order uniqueness applies only among a team's active topics").
--
-- Replaces the topics_team_order UNIQUE (team_id, display_order, status)
-- table constraint with a partial unique index on (team_id, display_order)
-- WHERE status = 'active'. The old key included status, so archived rows
-- competed with each other for positions they never use: archive position
-- 11, add a custom topic (which takes 11), archive it, and the second
-- archive failed with 23505 (surfacing as a 500).
--
-- An archived topic's display_order is not meaningful and not maintained:
-- the archived list orders by archived_at, and restore re-appends at the end
-- of the active order.
--
-- The existing non-unique idx_topics_team_active (3_create_indexes.sql) has
-- exactly the new index's columns and predicate, so it is dropped here as
-- superseded; the rollback recreates it.
--
-- No data change on the way up: the old key already guaranteed uniqueness
-- among active rows, so the index build cannot fail on existing data.
--
-- Rollback: npm run db:migrate:down (runs the section below the down
-- marker). It first re-spreads archived rows per team to distinct negative
-- display_order values, because archived rows may share a position once
-- this migration is in place and the full three-column key could not be
-- re-added otherwise. Archived positions carry no meaning, so nothing is
-- lost.
--
-- Section markers are node-pg-migrate's real ones (as in migrations 4, 11,
-- 12), not the bare markers of migrations 16/17, which the runner does not
-- recognise.

-- Up Migration
ALTER TABLE topics DROP CONSTRAINT topics_team_order;
DROP INDEX idx_topics_team_active;
CREATE UNIQUE INDEX topics_team_active_order
    ON topics (team_id, display_order) WHERE status = 'active';

-- Down Migration
UPDATE topics t
   SET display_order = -r.rn
  FROM (SELECT id,
               row_number() OVER (PARTITION BY team_id ORDER BY archived_at, id) AS rn
          FROM topics
         WHERE status = 'archived') r
 WHERE t.id = r.id;
DROP INDEX topics_team_active_order;
CREATE INDEX idx_topics_team_active ON topics (team_id, display_order) WHERE status = 'active';
ALTER TABLE topics ADD CONSTRAINT topics_team_order UNIQUE (team_id, display_order, status);
