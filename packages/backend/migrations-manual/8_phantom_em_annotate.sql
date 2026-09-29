-- Phantom EM Relationship — Historical Annotation
--
-- NOT AUTO-RUN. This file lives in migrations-manual/, not migrations/, so
-- node-pg-migrate never discovers or executes it (same convention as
-- 8_rollback.sql — see that file's header and GitHub issue #39). This is not
-- a schema migration; it is a manually-invoked ops script that writes one
-- additive audit_log row per match it finds.
--
-- Run this only AFTER reviewing 8_phantom_em_detect.sql's output. These are
-- two separate, deliberately-invoked scripts — never run this as a
-- consequence of running the detection script. This script performs a write
-- against an append-only audit table; look first, then decide, as a second
-- and separate action, to run this.
--
-- To run this script:
--   dotenv -e ../../.env -- psql "$DATABASE_URL" \
--     -v operator_user_id='<your users.id UUID>' \
--     -v ON_ERROR_STOP=1 \
--     -f migrations-manual/8_phantom_em_annotate.sql
--
-- operator_user_id is REQUIRED — your own users.id (the operator's real
-- application account), not a placeholder or sentinel value. There is no
-- default; the script refuses to run without it (see the \if guard below).
-- actor_global_role is a fixed literal hardcoded in the INSERT below by
-- design.md Decision 8 — it is not an operator-supplied parameter.
--
-- What this does:
--   Implements Decision I from the archived restrict-team-005-em-promotion
--   change (openspec/changes/archive/2026-09-16-restrict-team-005-em-promotion/design.md).
--   Before the 2026-09-16 fix (PR #118, commit 2d678a7), TEAM-005 could
--   record a participant -> engineering_manager transition as an ordinary
--   'team.role_changed' audit_log entry, even though it represents the same
--   kind of event TEAM-006 now records as 'team.manager_established'. This
--   script finds those historical rows and inserts one additive
--   'team.manager_established_retroactive_annotation' row per match,
--   referencing the original row's id. It never modifies or deletes the
--   original row — audit_log is append-only in this codebase, and this
--   script must never be the first write path that violates that.
--
--   Re-running this script after a successful pass inserts zero new rows
--   (see the WHERE NOT EXISTS guard below) — this has been verified against
--   fixture data, not merely inspected (design.md Decision 6).
--
-- If this script's detection counterpart (8_phantom_em_detect.sql) found any
-- phantom relationships, notify Rachel Okonkwo, VP of Engineering, directly
-- by email or an equivalent out-of-band human channel — no automated
-- transport exists for this (design.md Decision 9). Use this sentence
-- verbatim, filling in the bracketed values:
--
--   Query 1 flagged N phantom EM relationship(s) in <environment> as of
--   <timestamp>. This is a notification, not a request for action — no
--   remediation has been taken and none is authorized by this message.
--
-- This is escalation, not remediation: this message does not authorize, and
-- this script does not perform, any revocation or modification of a flagged
-- team_memberships row.

-- Existence guard (design.md Decision 8): refuse to run at all if
-- operator_user_id was not supplied, rather than proceeding with a confusing
-- syntax error or a silently-empty substitution.
\if :{?operator_user_id}
\else
  \echo ERROR: operator_user_id is required. Invoke with -v operator_user_id=<uuid>.
  \quit
\endif

-- STOP: confirm this is the environment you intend to write to before
-- proceeding any further.
SELECT current_database() AS database, inet_server_addr() AS host, now() AS checked_at;

-- STOP: confirm this is you before proceeding. If no row comes back,
-- operator_user_id is wrong -- stop and fix it before running the INSERT below.
SELECT id, email FROM users WHERE id = :'operator_user_id';

-- Guarded annotation INSERT (design.md Decision 5/6/8).
--
-- The operation = 'team.role_changed' predicate is load-bearing, not
-- stylistic: TEAM-005's post-fix blocked path (teams.ts:821-847) writes
-- 'team.role_change_denied' rows with an identical metadata shape
-- ({ from_role: "participant", to_role: "engineering_manager" }). Omitting
-- this filter would also match every blocked promotion attempt after
-- 2026-09-16 and annotate them as completed historical promotions,
-- manufacturing phantom annotations on the exact table this change exists
-- to make trustworthy. Do not drop or "simplify" this predicate.
--
-- Wrapped in a CTE so the result reports a labeled count instead of psql's
-- bare "INSERT 0 0" line, which looks identical whether it means "already
-- done" or "silently matched nothing".
WITH inserted AS (
  INSERT INTO audit_log (actor_user_id, actor_global_role, operation, target_user_id, team_id, metadata)
  SELECT
    :'operator_user_id'::uuid, 'system:production_data_engineer',
    'team.manager_established_retroactive_annotation',
    al.target_user_id, al.team_id,
    jsonb_build_object(
      'annotated_audit_log_id', al.id,
      'annotated_timestamp', al.timestamp,
      'note', 'This team.role_changed event is now understood to represent an ' ||
              'EM-establishment event predating the restrict-team-005-em-promotion fix (#109).'
    )
  FROM audit_log al
  WHERE al.operation = 'team.role_changed'
    AND al.metadata->>'from_role' = 'participant'
    AND al.metadata->>'to_role' = 'engineering_manager'
    AND al.timestamp < '2026-09-16T20:46:16-04:00'
    AND NOT EXISTS (
      SELECT 1 FROM audit_log ann
      WHERE ann.operation = 'team.manager_established_retroactive_annotation'
        AND ann.metadata->>'annotated_audit_log_id' = al.id::text
    )
  RETURNING id
)
SELECT count(*) AS new_annotations_inserted FROM inserted;
