# database-migrations

## Purpose

Defines requirements for the versioned database migration system using `node-pg-migrate`, including the full initial schema, seed data, and rollback support.

## Requirements

### Requirement: Versioned migration system
The project SHALL use `node-pg-migrate` to manage PostgreSQL schema changes. All migrations SHALL be SQL files stored under `packages/backend/migrations/` and version-controlled alongside application source code. No schema change SHALL be applied to the database by any means other than running the migration tool.

#### Scenario: Migrations run against a fresh database
- **WHEN** `npm run db:migrate` is executed with a `DATABASE_URL` pointing to an empty PostgreSQL database
- **THEN** all migrations are applied in order, the schema is created, and the migration tool reports success

#### Scenario: Migrations are idempotent
- **WHEN** `npm run db:migrate` is run against a database that already has all migrations applied
- **THEN** the tool reports that no new migrations were applied and exits successfully without error

#### Scenario: Migration tool is available as an npm script
- **WHEN** `npm run db:migrate` is run from the project root or `packages/backend`
- **THEN** `node-pg-migrate` executes with the `DATABASE_URL` environment variable as the connection string

---

### Requirement: Full schema applied via initial migration
The initial migration SHALL apply the complete PostgreSQL schema as designed in `requirements/design/database-schema.md`. This includes all enum types, all tables, all indexes, and all CHECK constraints.

#### Scenario: All tables exist after migration
- **WHEN** migrations are applied to a fresh database
- **THEN** the following tables exist: `users`, `teams`, `team_memberships`, `application_settings`, `topics`, `sessions`, `session_topics`, `session_participants`, `votes`, `action_items`, `action_item_history`, `outlier_threshold_overrides`

#### Scenario: All enum types exist after migration
- **WHEN** migrations are applied to a fresh database
- **THEN** the following PostgreSQL enum types exist: `user_role`, `vote_type`, `session_status`, `action_item_status`, `topic_status`, `session_topic_status`, `membership_role`

#### Scenario: CHECK constraints are enforced
- **WHEN** an INSERT into `votes` is attempted with a `vote_value` of 5 and `vote_type` of `finger`
- **THEN** the database rejects the insert with a constraint violation error

---

### Requirement: Seed data applied via migration
A seed migration SHALL insert the default application settings and the canonical default topic set. Seed data SHALL be applied through the migration system, not through a separate seeding script, so that the database state is reproducible from migrations alone.

#### Scenario: Default topics are seeded
- **WHEN** migrations including the seed migrations are applied to a fresh database
- **THEN** the `topics` table contains exactly the twelve default topics for the sentinel `__default_topics__` team, each with the correct `name`, `prompt`, `vote_type`, `display_order`, `is_default = true`, and `first_session_description`:
  1. `Production Code — Adding Features` — "How easy is it to add features to production code?" (`finger`)
  2. `Production Code — Reasoning` — "How easy is it to reason about production code?" (`finger`)
  3. `Production Code — Active Development` — "How would you rate the code under active development?" (`finger`)
  4. `Production Code — Entire Project` — "How would you rate the code for the entirety of the project?" (`finger`)
  5. `Test Suite — Effectiveness` — "Is the test suite effective?" (`finger`)
  6. `Test Suite — Consistency` — "Is the test suite consistent?" (`roman`)
  7. `Test Suite — Active Development` — "How would you rate the tests under active development?" (`finger`)
  8. `Test Suite — Entire Project` — "How would you rate the tests for the entirety of the project?" (`finger`)
  9. `Pipeline` — "Confidence in the pipeline" (`finger`)
  10. `Technology Stack` — "Are you comfortable with the technology stack?" (`roman`)
  11. `Pairing` — "How effective is pairing?" (`finger`)
  12. `Project Trend` — "Overall, is this project trending up, steady, or down?" (`modified_roman`)

#### Scenario: Application settings are seeded
- **WHEN** migrations including the seed migration are applied to a fresh database
- **THEN** the `application_settings` table contains entries for `outlier_threshold_individual` (value: `1.5`), `staleness_threshold_sessions` (value: `2`), and `trend_chart_minimum_sessions` (value: `3`)

---

### Requirement: Migration rollback support
Each migration file SHALL include a down migration that reverses the up migration. The migration tool SHALL support rolling back the most recent migration via `npm run db:migrate:down`.

#### Scenario: Down migration reverses up migration
- **WHEN** `npm run db:migrate:down` is run after applying all migrations
- **THEN** the most recent migration is reversed and the database returns to the state before that migration was applied

#### Scenario: Full rollback and re-apply is clean
- **WHEN** all migrations are rolled back and then re-applied
- **THEN** the resulting schema is identical to the schema produced by applying all migrations from scratch

---

### Requirement: Access control schema migration

The access control schema migration (introduced by the `enforce-access-control-on-team-content` change) SHALL add the `draft` value to the `session_status` PostgreSQL enum, add the `facilitator_access_expires_at TIMESTAMPTZ NULL` column to the `sessions` table, and add the supporting indexes for the authorization helper queries.

**`draft` session status:** The `session_status` enum SHALL include `'draft'` as a valid value. `draft` indicates a session that a facilitator has created for preparation purposes but has not yet opened to participants. The authorization helper uses `s.status = 'draft' AND s.created_at + INTERVAL '24 hours' > NOW()` to determine whether a draft session still grants facilitator access. The `draft` value must be added before the `lobby` value in any ordering-sensitive migration.

**`facilitator_access_expires_at` column:** The `sessions` table SHALL include `facilitator_access_expires_at TIMESTAMPTZ NULL`. This column is set server-side when a session transitions to `complete`: `facilitator_access_expires_at = NOW() + INTERVAL '30 minutes'`. It is NULL for sessions that have never reached `complete` status. It MUST NOT be writable by any client-facing endpoint.

**Indexes for authorization helper:**
- `CREATE INDEX ON sessions(facilitator_id, team_id, status)` — supports the Path 3 facilitator authorization query.
- `CREATE INDEX ON team_memberships(user_id, team_id)` — supports Path 1 and Path 2 authorization queries (if not already present).

#### Scenario: draft session_status value exists after migration

- **WHEN** the access control schema migration is applied
- **THEN** the `session_status` enum includes the value `'draft'`
- **AND** a `sessions` row with `status = 'draft'` can be inserted without a constraint violation

#### Scenario: facilitator_access_expires_at column exists on sessions after migration

- **WHEN** the access control schema migration is applied
- **THEN** the `sessions` table has a `facilitator_access_expires_at` column of type `TIMESTAMPTZ` that is nullable
- **AND** existing session rows have `NULL` in that column

#### Scenario: Authorization helper indexes exist after migration

- **WHEN** the access control schema migration is applied
- **THEN** an index on `sessions(facilitator_id, team_id, status)` exists
- **AND** an index on `team_memberships(user_id, team_id)` exists

---

### Requirement: Join links table migration
Migration `5_create_join_links.sql` SHALL create the `join_links` table with columns: `id` (UUID primary key, default `gen_random_uuid()`), `team_id` (UUID, NOT NULL, FK to `teams`), `token` (VARCHAR(64), NOT NULL, UNIQUE), `created_by` (UUID, NOT NULL, FK to `users`), `created_at` (TIMESTAMPTZ, NOT NULL, default `NOW()`), `expires_at` (TIMESTAMPTZ, NOT NULL), and `revoked_at` (TIMESTAMPTZ, nullable). An index `idx_join_links_token` SHALL exist on the `token` column.

#### Scenario: Join links table created
- **WHEN** migration 5 is applied
- **THEN** the `join_links` table exists with all specified columns, foreign key constraints to `teams` and `users`, and a unique constraint and index on `token`

#### Scenario: Join links table included in full migration run
- **WHEN** `npm run db:migrate` is run against a fresh database
- **THEN** the `join_links` table is created along with all other tables

### Requirement: Migration 24 adds and backfills topics.template_topic_id reversibly

Migration 24 SHALL run as one implicit transaction (a `.sql` file is sent as one multi-statement query even under `--no-single-transaction`), so a failure part-way leaves nothing applied; the header SHALL say so. It SHALL, in this order: `SET LOCAL lock_timeout = '200ms'` (reset at the end, as migration 23); add the nullable column `topics.template_topic_id` with a foreign key to `topics(id)` `ON DELETE RESTRICT` (`IF NOT EXISTS`); run one backfill statement; add the invariant CHECK (a link only on `is_default = true` rows outside the template team, the sentinel literal cast `::uuid`; dropped-if-exists then added `NOT VALID`, then `VALIDATE CONSTRAINT`). It SHALL NOT create a unique index on the link (deferred to #310) and SHALL NOT use `RAISE NOTICE` for its count. It SHALL use the `-- Up Migration` / `-- Down Migration` markers and carry a header giving the rationale, the legacy-rows explanation, the rule that template defaults are archived and never deleted, and a one-sentence "Rollback:".

The backfill SHALL, with one rule: for each non-template team and template-default name, rank that team's unlinked `is_default` rows with a raw-equal name (active first, then lowest id) and the template default rows of that name, active or archived (active first, then lowest id), and link the top team row to the top template row, unless the team already has a row linked to that template row; all other rows stay NULL. As a backfill rule (not a database guarantee), no team row is linked to more than one template row and no team ends with two backfilled rows linked to one template row. It SHALL never delete, relabel or rename a row, SHALL be idempotent, and SHALL emit nothing containing an id, team id or name. The unlinked `is_default` count is produced by the runbook count query, not by the migration.

The Down section SHALL drop the CHECK, then the column, losing no user data. A sentinel drift test SHALL assert that `DEFAULT_TOPICS_TEAM_ID` equals the literal in the migration.

#### Scenario: Backfill on seeded data links exactly the expected rows
- **GIVEN** seeded data with: a matching default; a default whose template row was renamed; a custom topic named like a default; a template name with two template rows (one active, one archived) and a team with two same-name default rows (one active, one archived); a default whose only template row is archived; and an already linked row
- **WHEN** the migration runs
- **THEN** the matching default and the archived-template match are linked; the custom topic and the renamed-template row are NULL; in the two-and-two case the team's active row links to the active template row and the team's archived row stays NULL, and the archived template row receives no link; the already linked row is unchanged

#### Scenario: A second run changes nothing, including a linked row with an unlinked sibling
- **GIVEN** a team holding a linked "Pulse" and an unlinked, same-name archived "Pulse"
- **WHEN** the backfill is run again
- **THEN** zero rows are updated, the sibling stays NULL, and no error occurs

#### Scenario: The backfill never links twice
- **GIVEN** a team with two same-name default rows and a template with two same-name rows (the four-row case)
- **THEN** exactly one team row is linked, to exactly one template row, and a re-run changes nothing

#### Scenario: The count comes from the runbook query, with no identifiers in the migration output
- **WHEN** the migration runs on data with unlinked defaults
- **THEN** its output contains no team id, row id or topic name
- **AND** the runbook count query returns the number of unlinked `is_default` team rows

#### Scenario: Empty database
- **WHEN** the migration runs with no teams or no template defaults
- **THEN** it succeeds and the runbook count query returns 0

#### Scenario: A failure leaves nothing applied, and a manual replay succeeds
- **GIVEN** the real migration file with a deliberately failing last statement
- **THEN** the column is absent afterwards
- **AND** replaying the Up statements on an already migrated database completes with no error

#### Scenario: The sentinel literal matches the constant
- **THEN** the literal in the CHECK equals `DEFAULT_TOPICS_TEAM_ID`, and the CHECK refuses a link on a template-team row

#### Scenario: The migration is reversible
- **WHEN** down then up is run on seeded data
- **THEN** the schema returns to the pre-migration shape after down, links are recomputed after up, and no topic, session or vote data is lost

#### Scenario: Rolling-deploy rows are fixed by re-running the backfill
- **GIVEN** a team created by a pre-migration instance after the migration ran (NULL links)
- **WHEN** the backfill is re-run by the operator under the migration DB role, and then run once more
- **THEN** its defaults are linked by the first re-run and the second updates 0 rows
