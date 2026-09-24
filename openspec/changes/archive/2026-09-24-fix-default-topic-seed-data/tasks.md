## 1. Migration

- [x] 1.1 Create `packages/backend/migrations/11_default_topics_correction.sql`. In the up migration, delete the six existing default-topic rows for the sentinel `__default_topics__` team (`00000000-0000-0000-0000-000000000001`) and insert the twelve corrected rows, using the exact `name`, `prompt`, `vote_type`, `display_order`, and `first_session_description` values from `assess.md`'s table (as updated per `assess-review.md`'s item-12 resolution) and `specs/database-migrations/spec.md` in this change.
- [x] 1.2 Confirm item 12's `prompt` is `"Overall, is this project trending up, steady, or down?"` (not the bare "Project Trend" label) and its `name` is `"Project Trend"` — this is the one content correction from `assess-review.md`.
- [x] 1.3 Add the down migration: delete the twelve corrected rows for the sentinel team, then re-insert migration 4's original six rows verbatim, restoring that migration's exact original state (a plain delete alone would leave zero rows, failing 1.5's acceptance bar). Do not delete the sentinel `teams`, `users`, or `application_settings` rows — those belong to migration 4 and are untouched by this change.
- [x] 1.4 Run `npm run db:migrate` against a fresh database and confirm the sentinel team ends up with exactly twelve `topics` rows with `is_default = true`.
- [x] 1.5 Run `npm run db:migrate:down` and confirm the sentinel team's topics table returns to the prior six-row state seeded by migration 4 (i.e. this migration's rows are fully removed, migration 4's are untouched).

## 2. Regression Test

- [x] 2.1 Add `packages/backend/src/__tests__/default-topics-seed-integration.test.ts`, following the real-Postgres integration pattern used in `packages/backend/src/routes/__tests__/facilitator-error-states-integration.test.ts` (self-skips with a clear console message when Postgres is unreachable, rather than failing or silently passing).
- [x] 2.2 Query `topics` for the sentinel team (`team_id = '00000000-0000-0000-0000-000000000001'`, `is_default = true`) ordered by `display_order`, and assert exactly twelve rows are returned.
- [x] 2.3 Assert each row's `name`, `prompt`, `vote_type`, and `display_order` matches the pinned twelve-item table exactly (item-for-item, not just count), so any future drift between the seed and the Acceptance Criteria fails this test instead of going unnoticed.

## 3. Documentation

- [x] 3.1 Apply the MODIFIED "Default topics are seeded" scenario from `specs/database-migrations/spec.md` (this change) to `openspec/specs/database-migrations/spec.md`.
