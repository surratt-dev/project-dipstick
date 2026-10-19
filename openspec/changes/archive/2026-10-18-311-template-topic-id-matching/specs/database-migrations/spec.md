## ADDED Requirements

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
