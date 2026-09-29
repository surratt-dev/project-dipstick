# phantom-em-relationship-detection

## Purpose

TEAM-005 (`PATCH /api/v1/teams/:teamId/members/:userId/role`) could, before the 2026-09-16 fix (PR #118, commit `2d678a7`), be used to establish a new Engineering Manager relationship without going through TEAM-006 (`POST /api/v1/teams/:teamId/managers`) — the only endpoint that writes a `team.manager_established` `audit_log` entry. This capability provides the two source-controlled, manually-invoked SQL scripts that let an operator with production database access (i) detect any currently-active EM membership row lacking that backing audit entry, and (ii) separately annotate the historical `audit_log` rows misclassified as ordinary `team.role_changed` events before the fix, without touching any `team_memberships` row. Detection and annotation are on-demand controls, not a remediation program and not scheduled automation — closing the loop that the `restrict-team-005-em-promotion` change's Decisions H and I left as an operator-run follow-up.

## Requirements

### Requirement: Detection script is read-only, re-runnable, and human-readable

`packages/backend/migrations-manual/8_phantom_em_detect.sql` SHALL contain a single read-only `SELECT` query that flags any active `team_memberships` row with `role = 'engineering_manager'` and no corresponding `team.manager_established` `audit_log` entry for that `(user_id, team_id)` pair. The script SHALL contain no `INSERT`, `UPDATE`, or `DELETE` statement against any table. Its result set SHALL join through to `users.email` and `teams.name` rather than returning bare UUIDs.

#### Scenario: Detection script is safe to run any number of times

- **WHEN** `8_phantom_em_detect.sql` is run against the same database state more than once
- **THEN** each run returns the same result set, since the script performs no writes

#### Scenario: Detection script excludes removed memberships

- **WHEN** a `team_memberships` row has `role = 'engineering_manager'`, no backing `team.manager_established` audit entry, and `removed_at IS NOT NULL`
- **THEN** that row is not included in the detection query's result set, since a removed membership grants no current access

#### Scenario: Detection script output identifies affected people and teams without a follow-up lookup

- **WHEN** the detection query returns one or more rows
- **THEN** each row includes the affected user's email and the affected team's name, not only internal UUIDs

### Requirement: Annotation script is a separate file, structurally isolated from detection

`packages/backend/migrations-manual/8_phantom_em_annotate.sql` SHALL be a distinct file from the detection script, containing only the historical-annotation query and its guarded `INSERT`. Neither script SHALL invoke or embed the other. Running the detection script SHALL NOT, by itself, cause the annotation script's `INSERT` to execute.

#### Scenario: Detection and annotation require separate, deliberate invocations

- **WHEN** an operator runs `8_phantom_em_detect.sql`
- **THEN** no row is written to `audit_log`, and running `8_phantom_em_annotate.sql` requires a separate, explicit command

### Requirement: Annotation script targets exactly the historically mislabeled promotion rows

`8_phantom_em_annotate.sql` SHALL select `audit_log` rows matching all of: `operation = 'team.role_changed'`, `metadata->>'from_role' = 'participant'`, `metadata->>'to_role' = 'engineering_manager'`, and `timestamp` before the `restrict-team-005-em-promotion` fix's ship timestamp (`2026-09-16T20:46:16-04:00`, commit `2d678a7`, PR #118). The `operation = 'team.role_changed'` predicate SHALL be present explicitly in the query text and SHALL carry an inline comment stating that omitting it would also match `team.role_change_denied` rows, which share the same `metadata` shape but represent blocked (never-completed) promotion attempts.

#### Scenario: Post-fix blocked promotion attempts are never annotated

- **GIVEN** an `audit_log` row with `operation = 'team.role_change_denied'`, `metadata->>'from_role' = 'participant'`, and `metadata->>'to_role' = 'engineering_manager'`, timestamped after 2026-09-16T20:46:16-04:00
- **WHEN** `8_phantom_em_annotate.sql` is run
- **THEN** that row is not selected and no annotation is inserted for it

#### Scenario: A genuine historical mislabeled promotion is selected

- **GIVEN** an `audit_log` row with `operation = 'team.role_changed'`, `metadata->>'from_role' = 'participant'`, `metadata->>'to_role' = 'engineering_manager'`, timestamped before 2026-09-16T20:46:16-04:00
- **WHEN** `8_phantom_em_annotate.sql` is run
- **THEN** that row is selected as a candidate for annotation

### Requirement: Annotation writes are additive and idempotent

`8_phantom_em_annotate.sql`'s `INSERT` SHALL never modify or delete an existing `audit_log` row. Each inserted `team.manager_established_retroactive_annotation` row SHALL reference the original row's `id` in its `metadata`. The `INSERT` SHALL be guarded by a `WHERE NOT EXISTS` (or equivalent) check against that reference, such that re-running the script after a successful pass inserts zero additional rows for rows already annotated.

#### Scenario: Running the annotation script twice is safe

- **GIVEN** `8_phantom_em_annotate.sql` has already been run once against a given database state and completed successfully
- **WHEN** `8_phantom_em_annotate.sql` is run a second time against the same, unchanged data
- **THEN** zero new rows are inserted into `audit_log`

#### Scenario: Idempotency is verified before handoff, not assumed from inspection

- **WHEN** `8_phantom_em_annotate.sql` is validated prior to being handed to the Production Data Engineer
- **THEN** the validation includes actually running the script twice in sequence against a non-production copy of the schema or equivalent fixture data, and confirming the second run inserts zero rows

### Requirement: Both scripts report an unambiguous result and confirm their environment first

Both `8_phantom_em_detect.sql` and `8_phantom_em_annotate.sql` SHALL execute an environment sanity check (reporting at minimum the current database name and host) as their first statement, before touching any other table. `8_phantom_em_annotate.sql`'s final output SHALL report a labeled count of newly inserted rows (e.g. `new_annotations_inserted`), not a bare `INSERT 0 0` tally.

#### Scenario: Operator can confirm the target environment before either script does anything else

- **WHEN** an operator runs either script
- **THEN** the first output they see identifies the database and host the script is running against

#### Scenario: A no-op annotation run is unambiguous

- **WHEN** `8_phantom_em_annotate.sql` finds no unannotated matching rows
- **THEN** its output reports `new_annotations_inserted | 0` (or equivalent labeled zero), distinguishable from a silently failed match

### Requirement: Neither script performs remediation, revocation, or scheduling

Neither script SHALL contain an `UPDATE` or `DELETE` statement against `team_memberships`. Neither script SHALL contain a code path that automatically revokes, modifies, or notifies. Neither script SHALL be packaged as, or depend on, a scheduled/cron execution mechanism.

#### Scenario: Detection finding phantom relationships does not itself change any membership row

- **WHEN** `8_phantom_em_detect.sql` returns one or more rows
- **THEN** no `team_memberships` row is altered as a result of running the script

### Requirement: Annotation script's actor identity is a real operator, not a parameter or a sentinel

`8_phantom_em_annotate.sql`'s `INSERT` SHALL set `actor_user_id` to the operator's own `users.id`, supplied as a mandatory `psql -v operator_user_id=<uuid>` invocation parameter with no default. The script SHALL refuse to run, via an existence guard preceding any other statement, if `operator_user_id` is not supplied. The script SHALL set `actor_global_role` to the fixed literal `'system:production_data_engineer'` hardcoded in the `INSERT` statement — it SHALL NOT be an operator-supplied `-v` parameter. After the environment sanity check and before the `INSERT`, the script SHALL run an identity-echo check (`SELECT id, email FROM users WHERE id = :'operator_user_id'`) so a wrong-but-well-formed UUID is caught visibly rather than inserted silently.

#### Scenario: Annotation refuses to run without an operator identity

- **WHEN** `8_phantom_em_annotate.sql` is invoked without `-v operator_user_id=<uuid>`
- **THEN** the script prints an error identifying `operator_user_id` as required and quits before running any query against `audit_log`

#### Scenario: A wrong operator UUID is caught before the write

- **WHEN** `8_phantom_em_annotate.sql` is invoked with an `operator_user_id` that is a well-formed UUID but does not match any `users.id`
- **THEN** the identity-echo check returns no row, giving the operator a visible signal to stop before the `INSERT` runs

### Requirement: A named location and field list exists for recording what the scripts found

`openspec/changes/phantom-em-relationship-detection/query-result.md` SHALL exist as a template with fields for: run date, environment confirmed (from the sanity check output), operator, Query 1 (detection) row count and the human-readable rows if non-zero, Query 2 (annotation) row count, and notification recipient/channel if Query 1 found anything.

#### Scenario: An operator completing a run has a defined place to record the outcome

- **WHEN** the Production Data Engineer finishes running both scripts against production
- **THEN** they fill in `query-result.md`'s fields rather than inventing an ad hoc report format
