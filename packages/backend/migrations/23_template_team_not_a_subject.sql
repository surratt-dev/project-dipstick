-- Migration 23: the template team is never a session, membership or join-link
-- subject (#214)
--
-- Implements openspec/changes/template-team-not-usable design.md D4
-- (specs/default-topic-provisioning "The database refuses template rows in
-- sessions, memberships and join links", "Existing template rows are
-- neutralised once and preserved where terminal" and "The template cleanup is
-- serialised with the constraints and audited").
--
-- '00000000-0000-0000-0000-000000000001' is DEFAULT_TOPICS_TEAM_ID
-- (src/sessions/default-topics.ts), the __default_topics__ template team. It
-- holds the canonical default topics and is not a team. It is also the id of
-- the seeded system user (4_seed_data.sql), which is the actor of the cleanup
-- audit rows below.
--
-- Order, in one transaction:
--   1. Lock sessions, team_memberships and join_links (ACCESS EXCLUSIVE, the
--      mode ADD CONSTRAINT needs anyway) BEFORE the cleanup, so the previous
--      build cannot commit a new template row between the cleanup and the
--      constraints, and there is no lock upgrade mid-transaction.
--   2. Cleanup, every UPDATE before the constraints exist (Postgres enforces a
--      NOT VALID check on updates of existing rows): revoke template links,
--      soft-remove template memberships, abandon non-terminal template
--      sessions, and clamp completed template sessions' unexpired facilitator
--      access to now() (this closes evaluateTeamAccess's path-3 facilitator
--      grant). Terminal sessions and votes are otherwise kept, frozen. Each
--      table that changed gets one team.template_cleanup audit_log row listing
--      the changed row ids with their prior values; prior values are read by
--      a CTE in the same statement as the UPDATE, so they are pre-update.
--      With no template rows nothing changes and no audit row is written.
--   3. Add the three <table>_not_template_team CHECKs NOT VALID: enforced for
--      every new INSERT and UPDATE at once, without a scan.
--   4. VALIDATE each one only where its table holds no template row (a fresh
--      database, CI). A table that keeps frozen history stays NOT VALID, which
--      is expected; the constraint is still enforced.
--
-- Frozen rows (design.md D4, security A1): an UPDATE of a kept template row
-- fails the whole statement. Retention and anonymisation jobs must delete
-- template rows or exclude them. DELETE still works.
--
-- The migration publishes no WebSocket or Redis change. A socket on a session
-- it abandons stays open until the next reauthorization sweep (5 minutes), so
-- deploy in a window with no running sessions when the pre-deploy check (H1)
-- finds a non-terminal template session.
--
-- Locking: lock_timeout 200ms (migration 22's value and rationale: below the
-- 400 ms transactional audit timeout and the 500 ms fail-open audit timer).
-- On a lock timeout this migration rolls back on its own; re-run it. Table
-- names are unqualified on purpose so the migration test can run it against
-- scratch copies through search_path. Run with --no-single-transaction (npm
-- run db:migrate does).
--
-- Rollback: the down section drops the three constraints only. The cleanup is
-- deliberately not reversed. With the previous build, a rollback restores the
-- pre-change exposure until this migration is re-applied.

-- Up Migration
SET LOCAL lock_timeout = '200ms';

LOCK TABLE sessions, team_memberships, join_links IN ACCESS EXCLUSIVE MODE;

-- Step 2a: revoke every template join link that is not already revoked.
WITH prior AS (
  SELECT id, revoked_at FROM join_links
   WHERE team_id = '00000000-0000-0000-0000-000000000001' AND revoked_at IS NULL
),
changed AS (
  UPDATE join_links SET revoked_at = now()
   WHERE id IN (SELECT id FROM prior)
  RETURNING id
)
INSERT INTO audit_log (actor_user_id, actor_global_role, actor_ip, operation, team_id, metadata)
SELECT '00000000-0000-0000-0000-000000000001', 'system', NULL, 'team.template_cleanup',
       '00000000-0000-0000-0000-000000000001',
       jsonb_build_object(
         'table', 'join_links',
         'migration', '23_template_team_not_a_subject',
         'rows', jsonb_agg(jsonb_build_object('id', prior.id, 'revoked_at', prior.revoked_at) ORDER BY prior.id))
  FROM prior JOIN changed ON changed.id = prior.id
HAVING count(*) > 0;

-- Step 2b: soft-remove every active template membership.
WITH prior AS (
  SELECT id, user_id, role, removed_at FROM team_memberships
   WHERE team_id = '00000000-0000-0000-0000-000000000001' AND removed_at IS NULL
),
changed AS (
  UPDATE team_memberships SET removed_at = now()
   WHERE id IN (SELECT id FROM prior)
  RETURNING id
)
INSERT INTO audit_log (actor_user_id, actor_global_role, actor_ip, operation, team_id, metadata)
SELECT '00000000-0000-0000-0000-000000000001', 'system', NULL, 'team.template_cleanup',
       '00000000-0000-0000-0000-000000000001',
       jsonb_build_object(
         'table', 'team_memberships',
         'migration', '23_template_team_not_a_subject',
         'rows', jsonb_agg(jsonb_build_object(
           'id', prior.id, 'user_id', prior.user_id, 'role', prior.role, 'removed_at', prior.removed_at)
           ORDER BY prior.id))
  FROM prior JOIN changed ON changed.id = prior.id
HAVING count(*) > 0;

-- Step 2c: abandon non-terminal template sessions, and clamp completed ones'
-- unexpired facilitator access to now(). The two UPDATEs touch disjoint rows.
WITH prior AS (
  SELECT id, status, facilitator_access_expires_at FROM sessions
   WHERE team_id = '00000000-0000-0000-0000-000000000001'
     AND (status IN ('draft', 'lobby', 'pre_session', 'active', 'wrap_up')
          OR (status = 'complete' AND facilitator_access_expires_at > now()))
),
abandoned AS (
  UPDATE sessions SET status = 'abandoned', abandoned_at = now()
   WHERE id IN (SELECT id FROM prior WHERE status IN ('draft', 'lobby', 'pre_session', 'active', 'wrap_up'))
  RETURNING id
),
clamped AS (
  UPDATE sessions SET facilitator_access_expires_at = LEAST(facilitator_access_expires_at, now())
   WHERE id IN (SELECT id FROM prior WHERE status = 'complete')
  RETURNING id
)
INSERT INTO audit_log (actor_user_id, actor_global_role, actor_ip, operation, team_id, metadata)
SELECT '00000000-0000-0000-0000-000000000001', 'system', NULL, 'team.template_cleanup',
       '00000000-0000-0000-0000-000000000001',
       jsonb_build_object(
         'table', 'sessions',
         'migration', '23_template_team_not_a_subject',
         'rows', jsonb_agg(jsonb_build_object(
           'id', prior.id, 'status', prior.status,
           'facilitator_access_expires_at', prior.facilitator_access_expires_at)
           ORDER BY prior.id))
  FROM prior JOIN (SELECT id FROM abandoned UNION ALL SELECT id FROM clamped) changed ON changed.id = prior.id
HAVING count(*) > 0;

-- Step 3: the constraints, NOT VALID (no scan; enforced from now on).
ALTER TABLE sessions ADD CONSTRAINT sessions_not_template_team
  CHECK (team_id <> '00000000-0000-0000-0000-000000000001'::uuid) NOT VALID;
ALTER TABLE team_memberships ADD CONSTRAINT team_memberships_not_template_team
  CHECK (team_id <> '00000000-0000-0000-0000-000000000001'::uuid) NOT VALID;
ALTER TABLE join_links ADD CONSTRAINT join_links_not_template_team
  CHECK (team_id <> '00000000-0000-0000-0000-000000000001'::uuid) NOT VALID;

COMMENT ON CONSTRAINT sessions_not_template_team ON sessions IS
  'The __default_topics__ template team (DEFAULT_TOPICS_TEAM_ID, src/sessions/default-topics.ts) is never a session subject (#214).';
COMMENT ON CONSTRAINT team_memberships_not_template_team ON team_memberships IS
  'The __default_topics__ template team (DEFAULT_TOPICS_TEAM_ID, src/sessions/default-topics.ts) never has members (#214).';
COMMENT ON CONSTRAINT join_links_not_template_team ON join_links IS
  'The __default_topics__ template team (DEFAULT_TOPICS_TEAM_ID, src/sessions/default-topics.ts) never has join links (#214).';

-- Step 4: validate where no template row remains.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM sessions WHERE team_id = '00000000-0000-0000-0000-000000000001') THEN
    ALTER TABLE sessions VALIDATE CONSTRAINT sessions_not_template_team;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM team_memberships WHERE team_id = '00000000-0000-0000-0000-000000000001') THEN
    ALTER TABLE team_memberships VALIDATE CONSTRAINT team_memberships_not_template_team;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM join_links WHERE team_id = '00000000-0000-0000-0000-000000000001') THEN
    ALTER TABLE join_links VALIDATE CONSTRAINT join_links_not_template_team;
  END IF;
END $$;

RESET lock_timeout;

-- Down Migration
ALTER TABLE join_links DROP CONSTRAINT join_links_not_template_team;
ALTER TABLE team_memberships DROP CONSTRAINT team_memberships_not_template_team;
ALTER TABLE sessions DROP CONSTRAINT sessions_not_template_team;
