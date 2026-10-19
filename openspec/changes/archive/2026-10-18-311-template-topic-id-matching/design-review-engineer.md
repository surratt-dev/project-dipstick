# Design review: Full Stack Engineer (Marcus Oyelaran)

Change: 311-template-topic-id-matching. Reviewed design.md, proposal.md, tasks.md, specs/ deltas against packages/backend (migrations 2, 16, 17, 18, 23; `sessions/default-topics.ts`; `routes/content.ts`; `routes/topics.ts`; test helpers).

**Verdict: implementable as designed, with three fixes before build (E1, E2, E3) and a handful of smaller ones.** The boundaries are clean (one SQL edit in the copy, one query plus mapping in content.ts, a constant, one migration). The riskiest piece, the single-statement ON CONFLICT, is sound in Postgres. The migration's "re-runnable per step" premise is the part I would correct.

## Verified OK

1. **ON CONFLICT inference with a partial unique index.** `ON CONFLICT (team_id, template_topic_id) WHERE template_topic_id IS NOT NULL` infers `CREATE UNIQUE INDEX ... WHERE template_topic_id IS NOT NULL` correctly; the predicate in the conflict target is required and implies the index predicate. It must be a unique index, not a constraint with a different shape; the design's index qualifies. If the index is absent the statement errors at plan time (42P10), so the "if the index is dropped, so is the clause" coupling in Decision 6 is real and should be a test (the E8 structural assertion can pin both together).
2. **INSERT ... SELECT with `row_number() OVER`, plus ON CONFLICT DO UPDATE.** Legal. "Cannot affect row a second time" cannot happen: source ids are unique, so `(team_id, template_topic_id)` pairs are unique within the statement.
3. **RETURNING** returns rows from both the insert and the DO UPDATE branch (DO NOTHING is the one that skips rows). `topicCount` / `topic_count` semantics in Decision 6 are correct.
4. **Columns exist:** `display_order` (migration 2), `restored_at` (migration 17), `restored_by` (17), `archived_by` (16), `archived_at` (2). `status` is an enum; the `'active'` literal coerces.
5. **The other unique index does not break the upsert.** `topics_team_active_order` (migration 18, `(team_id, display_order) WHERE status='active'`) is a non-arbiter index, so a violation would be a 23505, not a conflict. It cannot fire here: assign-defaults is gated on zero active rows under the per-team advisory lock (routes/topics.ts ~l.1263), so every active row after the statement is a reactivated or inserted one with a distinct `row_number()` position. Worth one sentence in Decision 6 and a test with an archived linked row plus a missing one, because this safety depends on the gate and silently breaks if anyone relaxes it.
6. **Callers.** `copyCanonicalDefaults` is the single copy; no non-test `DELETE FROM topics` or `DELETE FROM teams` exists in `src/`, so RESTRICT cannot bite production code today (task 1.4 can be closed with that grep).
7. **Migration 24 conventions.** Next number is correct (23 is latest). `-- Up Migration` / `-- Down Migration` markers match 18 and 23. Naming `24_template_topic_id.sql` fits.
8. **Rolling deploy** (old build on new schema): old INSERT omits the new nullable column, so it works; the NULL-link window and re-run check are the right handling.

## Findings

### E1 (must fix): the migration is effectively one transaction; the "every step re-runnable after partial failure" model is wrong and one step may be unsafe

`db:migrate` passes `--no-single-transaction`, which stops node-pg-migrate wrapping the whole run, but a `.sql` migration is still sent as one multi-statement simple query, which Postgres executes as an implicit transaction. Migration 23's own header says "Order, in one transaction" and relies on `SET LOCAL lock_timeout`, which is only meaningful inside one. So a mid-file failure rolls the file back; nothing is left half-applied. Consequences:

- The drop-if-exists-then-add dance for the CHECK and the "re-run after a simulated partial failure" test (task 2.2) test a state that cannot normally occur. Keep `IF NOT EXISTS` where cheap, but drop the partial-failure test, or say plainly that it models a manual replay.
- Anything that cannot run in a transaction block is unavailable: `CREATE INDEX CONCURRENTLY` fails. The design uses plain `CREATE UNIQUE INDEX`, which is right, but then the file takes a SHARE lock on `topics` (blocks writes) for the build plus ACCESS EXCLUSIVE for the ADD CONSTRAINT scan. Follow 23: `SET LOCAL lock_timeout = '200ms'` and `RESET` at the end, and say so in the header. topics is small, so this is fine, but the header should state the locking like 23 does.
- Reason for the apply test: run the real file with a deliberately failing last statement and assert the column is absent, to pin the actual behaviour instead of the assumed one.

### E2 (must fix): add the CHECK `NOT VALID` then `VALIDATE`, as migration 23 does

Decision 5 says NOT VALID is unnecessary because the backfill only sets compliant rows. True for the data, but a plain `ADD CONSTRAINT ... CHECK` takes ACCESS EXCLUSIVE for the whole validation scan, while `NOT VALID` + `VALIDATE` holds ACCESS EXCLUSIVE only momentarily and then SHARE UPDATE EXCLUSIVE for the scan (in one implicit transaction this advantage shrinks, but the lock is still held for less time at the strongest level). More importantly it is the established idiom in the previous migration and costs two lines. Also: the CHECK's `team_id <> '000...01'` literal should be cast `::uuid` like 23 (`team_id <> '...'::uuid`); both work, but match it. Decision 5's claim that a test asserts the constant equals the migration literal "for migration 23" should be verified: I found no such assertion by grep in `src`; the relevant test is `template-team-migration-integration.test.ts`. Either point at it or make the extension a task, not a "if cheap".

### E3 (must fix): DO UPDATE leaves stale provenance and skips `updated_at`

Single restore (routes/topics.ts l.1727 and maintenance l.394) sets `restored_at`, `restored_by` and (maintenance) `updated_at = now()`. The design's `SET status='active', display_order=..., restored_at=now()` leaves `restored_by` pointing at whoever restored the row last time (or NULL while `restored_at` is new) and `updated_at` unchanged. The archived-list API returns `restoredBy`, so this is a visible inconsistency. Fix: also set `restored_by = NULL` (assign-defaults is initiated by an actor, but the copy function has no user parameter; adding one widens the signature that team creation also calls, so NULL is the smaller choice) or accept an optional actor argument. Always set `updated_at = now()` (no trigger exists; I checked migrations). Say what `archived_at`/`archived_by` do: they stay, matching restore (the design already notes this), fine.

### E4 (should fix): the test snapshot helper and RESTRICT

I read `template-lock.ts`, `template-snapshot.ts`, `maintenance-test-hygiene.ts`, `real-db.ts`.

- `acquireTemplateLock` is only a cross-process advisory lock; it does not delete or re-insert rows, so it is not itself a problem.
- `template-snapshot.ts#restoreStatements` deletes only template rows with `is_default = false` that are not in the snapshot. Linked rows require `is_default = true` (the CHECK), and the copy only reads default rows, so nothing links to these. Safe, and ids are preserved by UPDATE-in-place. Task 1.3 can be answered "no change needed" for this helper.
- **`maintenance-test-hygiene.ts#restoreWholeTemplate` is the real exposure.** It runs `DELETE FROM topics WHERE team_id = SENTINEL AND created_at >= startedAt AND NOT (id = ANY(...))`. Those rows include default template rows that a maintenance test added (admin "add default"). Tests that then create a team copy that new row, producing a linked team row; if the hygiene delete runs before that team is cleaned up (cleanup order is per-file and teams are deleted in `RealDb.cleanup`, which runs in a different hook), the delete fails with 23503 and the whole file goes red. Fix options: (a) in the hygiene restore, first `DELETE FROM topics WHERE template_topic_id = ANY(created template ids)` or `UPDATE ... SET template_topic_id = NULL`; (b) ensure teams are cleaned before the template restore. Pick (a), it is order-independent. Note that (a) must itself obey the CHECK (setting NULL is always allowed).
- `RealDb.cleanup` deletes a team's topics with `DELETE FROM topics WHERE team_id = $1`; deleting child rows is fine under RESTRICT.
- Any other test file that deletes template rows directly should be found with `grep -rn "DELETE FROM topics" src` (only the helpers above showed up; the seed test uses the lock but no deletion by my grep). Add this grep result to task 1.3 so the check is concrete.

### E5 (should fix): backfill statement and runbook details

- `RAISE NOTICE` is not in use in any existing migration, and node-pg-migrate does not necessarily print server notices. Putting the count in a `DO $$ ... RAISE NOTICE` block works only if the runner surfaces notices; verify, or write the count to `audit_log` like 23 does (a `team.template_cleanup`-style row would need an operation allowlist check; the audit_log inventory test from #313 exists, so a new operation name must be added to it). Cheapest: keep NOTICE, and have the PR task 1.1 dry run produce the count via the runbook query, not from the migration log. Say that explicitly so nobody depends on the NOTICE being visible.
- The ranking uses `(status='active') DESC, id` on candidates and on template rows. `id` is a uuid (random), so "lowest id" is arbitrary but deterministic. That is acceptable; just do not describe it as "oldest". If you want a meaningful tie-break use `created_at, id`.
- The backfill is written once as a single UPDATE with window functions over a CTE; make sure the NOT EXISTS is evaluated against the pre-statement snapshot (it is), which is why in-statement uniqueness relies on the one-winner-per-(team,name) ranking, not on the NOT EXISTS. State that in the comment so a later editor does not remove the ranking.
- The unique index is created after the backfill in the same implicit transaction, so a pathological duplicate would abort the whole migration (good: fail loud) rather than leave a dangling column. Mention it.

### E6 (should fix): `defaultTopicsNotActive` mapping

- The current query is the LEFT JOIN LATERAL at content.ts l.982; the handler maps `team_topic_id ?? default_topic_id` and `default_topic_name`. The new code needs the team row's name added to the SELECT and a changed mapping; `content.test.ts` mocks `db.query` in a fixed sequence (l.1137, l.1296) with a row shape, so those mocks need the new column. Task 4.3 mentions content.test.ts; add "update mocked row shape" explicitly.
- `normalizeTopicNameForMatch` lives in `packages/shared` (src/types/topic.ts, exported from index), and `frontend/src/pages/addCustomTopic.ts` uses it; it is not in backend `src`. Import from the shared package in content.ts. Confirm the backend already depends on `@dipstick/shared` there (planDefaultRestore does).
- Suppression "over the active rows the handler already reads": confirm the active query selects `name` for every active row (not only those displayed) before relying on it; if the active read is filtered or limited, suppression silently weakens.
- The edge "a linked archived row suppressed by an active row other than itself": an active row linked to a different template default having the same name is covered by the rule as written ("other than the entry's own linked row"); the test list includes it. Good.

### E7 (consider): plain index on `template_topic_id`

Postgres needs an index on the referencing column to avoid a seq scan on every delete or update of a referenced template row (the RESTRICT check). The unique index leads with `team_id`, so it does not serve a lookup by `template_topic_id` alone. Template deletes are rare and the table is small, so deferring to EXPLAIN as Decision 4 says is fine, but note that the lateral join is served by the unique index `(team_id, template_topic_id)` already, so the plain index would be only for the FK check; that probably means it is not needed.

### E8 (minor)

- Down migration "drop index, CHECK, column": order CHECK, index, column; dropping the column drops dependants automatically but be explicit. `DROP COLUMN` after an `ADD COLUMN IF NOT EXISTS` is fine. Note the Down section deliberately does not restore anything, which matches 23's style.
- The structural test "exactly one `INSERT INTO topics` containing `template_topic_id`" is brittle against whitespace; match with a regex on the SQL text rather than substring counts.
- `design.md` Decision 6's accepted edge (two reactivated rows sharing a name after a rename of an archived copy) is real and #299 only guards single restore. A cheap mitigation inside the same statement is not available (DO UPDATE cannot see sibling rows). Leaving it accepted is fine; the fallback also removes it.
- Decision 14 (unlinked entry id answers 404 on restore): consistent with `WHERE id = $1 AND team_id = $2`; I did not find a path that would create a row from a template id.

## Summary of requested changes

| # | Severity | Change |
|---|----------|--------|
| E1 | must | Correct the transaction model in Decision 11 and task 2.2; add lock_timeout like 23; adjust the partial-failure test |
| E2 | must | CHECK as NOT VALID then VALIDATE; cast the literal; point at a real constant/literal test or add a task |
| E3 | must | DO UPDATE also sets `restored_by = NULL` and `updated_at = now()` |
| E4 | should | Fix `maintenance-test-hygiene.ts#restoreWholeTemplate` for RESTRICT; record that `template-snapshot.ts` is safe |
| E5 | should | Do not depend on RAISE NOTICE visibility; tie-break wording; comment on ranking vs NOT EXISTS |
| E6 | should | Update mocked row shapes in content.test.ts; import the normalizer from shared; confirm active rows are read in full |
| E7 | consider | No plain index unless EXPLAIN shows a need |
| E8 | minor | Down order, regex-based structural test |
