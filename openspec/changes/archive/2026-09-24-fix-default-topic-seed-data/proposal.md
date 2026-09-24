## Why

`packages/backend/migrations/4_seed_data.sql` seeds six default topics into the sentinel `__default_topics__` team (`00000000-0000-0000-0000-000000000001`), but `requirements/use cases/08 - Topic Management - Use Cases.md`'s Acceptance Criteria for "Assign Default Topic Set to New Team" calls for twelve — "Production Code" and "Test Suite" are each supposed to be split into four facets, and the current seed collapses each to a single row. A team's first session — where first-session mode (OR-5.2) is meant to walk them through the full intent of each question — currently shows a thinner ritual than the one that's documented and thinner than the one this Health Check was originally run as. This also blocks `inline-team-creation` (#44) directly: its default-topic-provisioning integration test asserts twelve seeded rows against the real sentinel data, which fails against the current six-row seed.

## What Changes

- Add migration `11_default_topics_correction.sql`, replacing the six `INSERT INTO topics` rows for the sentinel `__default_topics__` team with the twelve rows required by the AC — correct `name`, `prompt`, `vote_type`, `display_order`, and `first_session_description` for each, including item 12's `prompt` resolved to the existing seed's full question text ("Overall, is this project trending up, steady, or down?") rather than the AC's bare "Project Trend" label, per Marcus Delgado's review of `assess.md`.
- Add a down-migration that deletes the twelve corrected rows and re-inserts migration 4's original six rows for the sentinel team, restoring that migration's exact original state (a plain delete alone would leave zero rows, not six, since the up-migration itself deletes migration 4's six rows before inserting the twelve corrected ones).
- Add a regression test pinning all twelve seeded topics' `name`, `prompt`, `vote_type`, and `display_order` against the real sentinel-team data, so this can't silently drift again.
- Update `openspec/specs/database-migrations/spec.md`'s "Default topics are seeded" scenario, which currently describes five stale topics (matching neither the current six-row seed nor the corrected twelve), to reflect the twelve canonical default topics.

This is a data-correctness fix to seed content. No new table, column, endpoint, or code path is introduced, and no already-created team is affected — no team-creation code path exists on `main` today, so nothing has ever copied the stale six-topic seed into a real team.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `database-migrations`: The "Seed data applied via migration" requirement's "Default topics are seeded" scenario changes from asserting five stale default topics (`Production Code, Test Suite, Pipeline, Technology Stack, Pairing`) to asserting the twelve canonical default topics required by the Topic Management use case's Acceptance Criteria, each with its correct `name`, `prompt`, `vote_type`, and `display_order`.

## Impact

- **Code:** `packages/backend/migrations/11_default_topics_correction.sql` (new). No changes to `packages/backend/migrations/4_seed_data.sql` itself — corrections land as a new migration, not an edit to an already-applied one.
- **Tests:** New regression test pinning the twelve seeded topics' `name`, `prompt`, `vote_type`, and `display_order` against the real sentinel-team data.
- **Docs:** `openspec/specs/database-migrations/spec.md` ("Default topics are seeded" scenario).
- **Sequencing:** This change claims migration number `11`. It is a merge prerequisite for `#44` (`inline-team-creation`), whose stashed work also referenced `11` for an unrelated migration (`11_teams_name_unique_normalized.sql`) that only exists in a stash, not on `main` — no actual collision today, but `#44` will need to renumber to `12` when it resumes.
- **Not in scope:** No corrective data pass for already-created teams (none exist on `main` with copied default topics), and no edit to the stale `requirements/BRD.md` seed-count prose (flagged as a separate documentation follow-up).
