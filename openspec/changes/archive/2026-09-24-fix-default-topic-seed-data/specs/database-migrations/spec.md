## MODIFIED Requirements

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
