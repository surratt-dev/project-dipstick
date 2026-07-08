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
- **WHEN** migrations including the seed migration are applied to a fresh database
- **THEN** the `topics` table contains exactly the five default topics: Production Code, Test Suite, Pipeline, Technology Stack, and Pairing — each with the correct `vote_type`, `prompt`, `is_default = true`, and `first_session_description`

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
