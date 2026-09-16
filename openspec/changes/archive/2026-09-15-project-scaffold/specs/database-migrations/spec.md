## ADDED Requirements

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
