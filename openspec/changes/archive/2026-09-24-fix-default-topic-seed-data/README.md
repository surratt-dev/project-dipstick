# fix-default-topic-seed-data

**Status:** Stub — not yet proposed. Filed by `inline-team-creation` (tasks.md task 1.1), per Marcus Delgado's (Business Analyst) `propose-review-ba.md` finding that the prerequisite gate needed a real artifact to check against.

**Owner:** whoever picks up `inline-team-creation` is responsible for turning this stub into a real proposal and merging it first — this is a formal merge dependency, not an optional nice-to-have.

## Why this is a prerequisite, not part of `inline-team-creation`

`packages/backend/migrations/4_seed_data.sql` currently seeds six default topics (one per `entities-and-relationships.md` Topic Area) into the sentinel `__default_topics__` team's `topics` rows. The Topic Management use case's Acceptance Criteria (`requirements/use cases/08 - Topic Management - Use Cases.md`) canonically enumerate twelve. Marcus confirmed directly that the twelve-item AC is correct and the seed migration is stale scaffolding, not an intentional simplification.

`inline-team-creation` builds the mechanism that copies `is_default = true` rows from the sentinel team into a newly created team. That mechanism is agnostic to whether it's copying six rows or twelve — it has no code-level dependency on this fix. But it has a hard *data* dependency: it cannot be demoed, or considered verified against real data, until the sentinel team's rows are actually correct. Bundling the seed-content fix into `inline-team-creation` would make one change responsible for two independently reviewable claims ("the copy mechanism is correct" and "the twelve-topic list is correct").

## Merge gate

`inline-team-creation`'s tasks.md 4.3/4.4 adds a real-data integration test that queries the actual seeded `topics` rows for `team_id = '00000000-0000-0000-0000-000000000001'` and asserts twelve rows matching the AC-verbatim prompts, vote types, and `display_order` from the Topic Management use case. That test fails against the current six-topic seed. **This change must merge, and that test must pass, before `inline-team-creation` merges.**

## Scope to design when this change is picked up

- A new migration (after `10_sessions_team_active_unique.sql`) replacing the six `INSERT INTO topics` rows in `4_seed_data.sql`'s pattern with the twelve AC-verbatim topics: prompt text, vote type (Finger / Roman / Modified Roman), `display_order`, and `first_session_description` for each, taken verbatim from `requirements/use cases/08 - Topic Management - Use Cases.md`'s Acceptance Criteria.
- Down-migration reverting to... nothing meaningful to revert to (the six-topic seed was wrong) — most likely an idempotent no-op or a straightforward row replacement in reverse, decided when this is designed.
- A regression test pinning the seeded prompts to those exact twelve strings, independent of and in addition to the real-data integration test `inline-team-creation` adds against this same data.
- Confirm whether any already-created team (via test fixture or manual seeding) has a topic set copied from the stale six-topic sentinel rows, and whether those need a data-correction pass — likely out of scope for a pre-launch application with no real teams yet, but worth a one-line confirmation before this ships.
