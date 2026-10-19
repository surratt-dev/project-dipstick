-- Runbook SQL for topics.template_topic_id (#311, migration 24).
-- Single source of truth: migration 24 embeds the backfill verbatim, the
-- migration tests run all three statements, and docs/deployment.md copies them
-- verbatim (a test asserts both). Statements are separated by "-- name:" lines.
-- 00000000-0000-0000-0000-000000000001 is DEFAULT_TOPICS_TEAM_ID.

-- name: count
SELECT count(*)::int AS unlinked_defaults
  FROM topics
 WHERE is_default = true
   AND template_topic_id IS NULL
   AND team_id <> '00000000-0000-0000-0000-000000000001'::uuid;

-- name: listing
SELECT team_id, id, name
  FROM topics
 WHERE is_default = true
   AND template_topic_id IS NULL
   AND team_id <> '00000000-0000-0000-0000-000000000001'::uuid
 ORDER BY team_id, name, id;

-- name: backfill
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
