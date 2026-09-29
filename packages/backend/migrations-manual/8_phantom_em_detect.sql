-- Phantom EM Relationship Detection
--
-- NOT AUTO-RUN. This file lives in migrations-manual/, not migrations/, so
-- node-pg-migrate never discovers or executes it (same convention as
-- 8_rollback.sql — see that file's header and GitHub issue #39). This is not
-- a schema migration; it is a manually-invoked, read-only ops query.
--
-- To run this query:
--   dotenv -e ../../.env -- psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations-manual/8_phantom_em_detect.sql
--
-- What this does:
--   Implements Decision H/G from the archived restrict-team-005-em-promotion
--   change (openspec/changes/archive/2026-09-16-restrict-team-005-em-promotion/design.md).
--   TEAM-005 (PATCH /api/v1/teams/:teamId/members/:userId/role) could, before
--   the 2026-09-16 fix (PR #118, commit 2d678a7), be used to establish a new
--   Engineering Manager relationship without going through TEAM-006
--   (POST /api/v1/teams/:teamId/managers), which is the only endpoint that
--   writes a team.manager_established audit_log entry. This query finds any
--   currently-active EM membership row with no such entry backing it — a
--   relationship that may have been established through the closed bypass
--   rather than through TEAM-006's intended path.
--
--   This is Decision G's ongoing, on-demand detection control, not a one-shot
--   remediation query. It is read-only and safe to run any number of times,
--   by anyone with read access, in any environment.
--
-- Known limitation (Decision 4, this change's design.md): this query joins
-- purely on (user_id, team_id) against the current team_memberships row, so
-- it cannot see a row that was legitimately established once, later demoted,
-- and then illegitimately re-promoted through the closed bypass —
-- team_memberships has no role-change history, only a mutated-in-place
-- current row. A "0 found" result means no pair-level gap exists today; it
-- does not mean every current EM row's provenance is provably legitimate
-- back through every role transition.
--
-- This query does not write anything. There is no companion "annotate"
-- action for this script — see 8_phantom_em_annotate.sql for the separate,
-- deliberately-invoked historical-annotation query (Decision I).

-- STOP: confirm this is the environment you intend to query before reading
-- any further output below.
SELECT current_database() AS database, inet_server_addr() AS host, now() AS checked_at;

-- Detection query (Decision H/G, this change's design.md Decision 4):
-- active EM memberships with no backing team.manager_established audit entry.
SELECT
  u.email,
  t.name AS team_name,
  tm.user_id,
  tm.team_id,
  tm.joined_at
FROM team_memberships tm
JOIN users u ON u.id = tm.user_id
JOIN teams t ON t.id = tm.team_id
LEFT JOIN audit_log al ON al.operation = 'team.manager_established'
                       AND al.target_user_id = tm.user_id
                       AND al.team_id = tm.team_id
WHERE tm.role = 'engineering_manager'
  AND tm.removed_at IS NULL
  AND al.id IS NULL;
