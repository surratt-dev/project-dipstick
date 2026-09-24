# Architecture Review: fix-default-topic-seed-data implementation

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Reviewing:** `packages/backend/migrations/11_default_topics_correction.sql`, `packages/backend/src/__tests__/default-topics-seed-integration.test.ts`, `openspec/specs/database-migrations/spec.md` (applied delta)
**Date:** 2026-09-24

---

## Verdict

Approve. The implementation is correct, and it is correct precisely because the implementer deviated from what `design.md` and `proposal.md` literally describe for the down-migration. That deviation was the right call — not a stylistic preference, but a necessity, since the documented approach would not satisfy the change's own `tasks.md` 1.5 verification requirement, and would violate the project's own unmodified "Migration rollback support" requirement. `design.md` (and `proposal.md`) should be corrected to match the implementation, not the reverse.

This is a data-correctness fix with no schema change, no new code path, and no architectural surface. My review scope here is narrow by design — I'm confirming the down-migration judgment call and that the artifacts are now internally consistent — not opining on content, naming, or domain choices, which are Marcus's and Devon's territory and were already resolved in `assess.md`/`assess-review.md`.

## What I verified directly

I did not take the task descriptions at their word. I read the up- and down-migration SQL directly, diffed both against source (`assess.md`'s pinned table and the live `4_seed_data.sql`), and ran the actual migration round-trip against real Postgres myself.

- **Up-migration content: exact match, all twelve rows.** I compared `name`, `prompt`, `vote_type`, `display_order`, and `first_session_description` for all twelve rows in `11_default_topics_correction.sql` against `assess.md`'s table and its drafted descriptions (as corrected by `assess-review.md` for item 12). Every field matches, including the six verbatim-carried `first_session_description` values and the six newly drafted ones. Item 12 correctly carries `name = 'Project Trend'` and `prompt = 'Overall, is this project trending up, steady, or down?'` — Marcus's resolution, not the AC's bare label.
- **The applied spec delta matches source.** `openspec/specs/database-migrations/spec.md`'s "Default topics are seeded" scenario is byte-identical to the change's delta file and to the AC line in `requirements/use cases/08 - Topic Management - Use Cases.md` (line 39) for every name/prompt/vote-type triple.
- **The down-migration deviation is correct, and necessary.** Here is the actual defect in the design as written:
  - `tasks.md` 1.1 requires the up-migration to **delete** migration 4's six original rows, then insert the twelve corrected ones.
  - `design.md`'s Decisions section and `proposal.md`'s "What Changes" both describe the down-migration as a **plain `DELETE FROM topics WHERE team_id = ...`** deleting only the twelve rows this migration added — "symmetric" with migration 4's own down-migration pattern.
  - But `tasks.md` 1.5 requires that running `db:migrate:down` leaves "the sentinel team's topics table ... to the prior six-row state seeded by migration 4."
  - These are mutually exclusive. Since the up-migration deletes the original six rows, a down-migration that only deletes the twelve new rows leaves **zero** rows, not six. The "symmetric plain DELETE" design would fail 1.5's own acceptance bar the moment it was tested — not a matter of taste, a coding error waiting to happen.
  - The implementer's actual down-migration — delete the twelve, then re-insert migration 4's six rows verbatim — is the only approach that satisfies 1.5, and it is also the only approach that satisfies the project's own **unmodified** "Migration rollback support" requirement in `openspec/specs/database-migrations/spec.md` ("Each migration file SHALL include a down migration that reverses the up migration" / "the database returns to the state before that migration was applied"). A plain delete-only down-migration would have shipped a rollback that violates a standing, unrelated requirement.
- **I independently confirmed the round-trip against real Postgres**, not just by reading the SQL:
  1. Confirmed migration 11 was already applied (`pgmigrations` table lists it as the 11th row) and queried the live `topics` table for the sentinel team: exactly twelve rows, matching the pinned table field-for-field, in `display_order` 1–12.
  2. Ran `npm run db:migrate:down` (packages/backend). It executed cleanly.
  3. Queried the sentinel team's `topics` rows post-down: exactly six rows, and every field (`name`, `prompt`, `vote_type`, `display_order`, `first_session_description`) is byte-for-byte identical to migration 4's original `INSERT` block — I diffed the query output against `4_seed_data.sql` directly, not from memory.
  4. Confirmed migration 4's own sentinel rows (`teams`, `users`, `application_settings`) were untouched by the down-migration — counts of 1, 1, 3 respectively, as required by `tasks.md` 1.3's explicit "do not delete" instruction.
  5. Re-ran `npm run db:migrate` to bring the environment back up. Confirmed twelve rows again and `pgmigrations` shows migration 11 re-applied. Environment is restored to the state it was in before my review.
- **Regression test: real pattern match, not a superficial one.** I compared `default-topics-seed-integration.test.ts` against `facilitator-error-states-integration.test.ts` directly. Both probe Postgres reachability with a short-timeout connection attempt, `console.warn` a clear, actionable skip message (including the exact remediation commands) rather than failing or silently passing, and gate the suite with `describe.skipIf`. The test pins all twelve topics' `name`, `prompt`, `vote_type`, and `display_order` against a real query ordered by `display_order`, and asserts `toHaveLength(12)` before the per-row checks — drift in either direction (extra/missing rows or field mismatch) fails loudly. I ran it directly against the live database: 1 passed, 16ms.
- **Scope discipline.** `git status` on this branch shows exactly three touched paths: the new migration, the new test, and the modified spec file (plus the change's own `openspec/changes/` artifacts). No incidental edits to `4_seed_data.sql`, application code, or unrelated specs — consistent with `proposal.md`'s stated Impact section and with a change that has zero code-path surface.

## Findings

### 1. `design.md` and `proposal.md` misstate the down-migration approach — needs a documentation fix, not a code fix

`design.md`'s Decisions section states: *"Down-migration semantics required no call... the down-migration simply deletes the twelve corrected rows for the sentinel team, symmetric with the existing seed's down-migration pattern."* Its Migration Plan section repeats this characterization ("Rollback is the migration's own down-migration ... which is safe and symmetric since it only touches the sentinel team's own rows" — true of the *rows touched*, but silent on the fact that restoring state requires re-inserting the original six). `proposal.md`'s "What Changes" section says the same thing plainly: *"Add a symmetric down-migration that deletes the twelve default-topic rows for the sentinel team (mirroring migration 4's `DELETE FROM topics WHERE team_id = ...` pattern)."*

None of this is what was built, and none of it would have passed `tasks.md` 1.5. Recommend updating both documents' down-migration language to describe what's actually implemented: delete the twelve corrected rows, then re-insert migration 4's original six rows verbatim, so that `db:migrate:down` genuinely restores the pre-migration-11 state rather than leaving the sentinel team with zero default topics. `tasks.md` 1.3's own wording ("mirroring migration 4's `DELETE FROM topics ...` pattern") has the same defect and should be corrected alongside — 1.3 and 1.5 currently contradict each other, and 1.5 is the one that's right.

This is a paperwork fix, not a re-implementation. The code is correct; the design record just needs to stop claiming something the code doesn't do (and, more importantly, shouldn't do).

### 2. No other issues found

No schema change, no new code path, no authentication/authorization surface, no real-time or Redis boundary, no deployment change — none of the areas in my standing review scope are touched by this change. I have nothing further to flag.

## Recommendation

Ship the code as implemented. Before or alongside merge, correct `design.md`'s Decisions and Migration Plan sections and `proposal.md`'s "What Changes" bullet to describe the actual down-migration (delete-then-reinsert-original-six), and fix the same misstatement in `tasks.md` 1.3 so it no longer contradicts 1.3's sibling task 1.5. This is documentation hygiene, not a merge blocker in the sense of code risk — but the design record should never describe a rollback that its own acceptance criteria show would be broken.
