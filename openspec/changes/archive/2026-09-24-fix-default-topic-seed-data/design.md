## Context

`packages/backend/migrations/4_seed_data.sql` already establishes the pattern this change follows: `INSERT INTO topics (team_id, name, prompt, vote_type, display_order, is_default, first_session_description) VALUES (...)` rows against the sentinel `__default_topics__` team, with a symmetric `DELETE FROM topics WHERE team_id = ...` down-migration. The `topics` table already has every column this change needs. See `assess.md` for the full derivation of the twelve rows and their sourcing.

## Goals / Non-Goals

**Goals:**
- Replace the stale six-row default topic seed with the twelve rows the Topic Management use case's Acceptance Criteria requires, in the same migration shape as the seed it corrects.

**Non-Goals:**
- No schema change, no new code path, no new pattern.

## Decisions

No architectural decision is required for this change, and none is made here. This is explicitly confirmed, not merely assumed:

- **No new schema.** Every column this needs (`name`, `prompt`, `vote_type`, `display_order`, `is_default`, `first_session_description`) already exists on `topics`.
- **No new code path.** Nothing reads or writes topics data differently based on row count; the row count is not load-bearing anywhere in application logic.
- **No new pattern.** The new migration is `INSERT INTO topics (...)` in the same form as the migration it corrects, at the next sequential number (`11`).
- **Down-migration semantics.** The six-topic seed was wrong, but migration 4 still established a valid prior state that `topics_team_order`'s constraints and `tasks.md` 1.5's acceptance bar require restoring exactly: the down-migration deletes the twelve corrected rows and re-inserts migration 4's original six rows verbatim. A plain delete-only down (this change's original assumption) would leave the sentinel team with zero rows instead, which is not a valid revert.

This was verified independently by `assess-review.md` (Marcus Delgado, BA), whose only required change was a content correction (item 12's `prompt` wording), not a design or architectural finding.

## Risks / Trade-offs

- **[Risk] A future edit to the AC or the seed drifts the two out of sync again.** → Mitigation: the regression test in `tasks.md` pins all twelve topics' `name`, `prompt`, `vote_type`, and `display_order` against the real seeded data, so drift fails a test rather than going unnoticed.

## Migration Plan

Single new migration (`11_default_topics_correction.sql`) applied through the normal `npm run db:migrate` path. No data migration for existing teams is needed — no team on `main` has ever copied the stale six-topic set (confirmed in `assess.md`: no team-creation code path exists on `main` today). Rollback is the migration's own down-migration (`npm run db:migrate:down`), which is safe since it only touches the sentinel team's own rows and restores migration 4's exact original six-row state.

## Open Questions

None.
