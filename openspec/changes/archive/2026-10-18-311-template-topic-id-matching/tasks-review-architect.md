# Tasks review: Architect (Ingrid Sollenberger)

Scope: tasks.md read against proposal.md, design.md and the three delta specs, after the fallback rewrite (no unique index, no ON CONFLICT, no reactivation, no RAISE NOTICE). Verdict: the design is sound and proportionate. The task list is close, but it has two real ordering defects (1.1 and 1.3 assume things that do not exist yet) and several stale or contradictory lines left over from the rewrite.

## A. Ordering and unbuilt-assumption findings

**A1 (must fix). Section 1 says "no code written until done" but 1.3 writes code, and that code cannot run yet.**
1.3 changes `maintenance-test-hygiene.ts#restoreWholeTemplate` to `SET template_topic_id = NULL`. That column does not exist until migration 24 (2.1) is applied to the test database. Move the helper fix into section 2, after 2.1. Keep only the read-only part of 1.3 in section 1: record that `template-snapshot.ts` is safe, and run the `DELETE FROM topics` grep. Also relabel section 1 "Pre-checks (read-only)" so the "no code" rule is true.

**A2 (must fix). 1.1 depends on a statement that is written in 2.1.**
1.1 asks for "the runbook count query on a dry run of the backfill". Neither the backfill nor the count query exists at that point, and the count is the post-backfill unlinked total. Add a first task in section 2 (2.0): draft the backfill statement and the two runbook queries (count, row-level listing) as SQL, review them, and then run 1.1 against each environment. Make 1.1 a merge gate (the proposal already calls it a pre-merge gate) rather than a "before any code" gate. It does not block coding the migration, and it needs the migration's own SQL. Say explicitly that the dry run is read-only (SELECT form of the ranking, or a transaction that rolls back). Nobody should run the writing statement in production to get a count.

**A3 (should fix). One home for the runbook queries.**
2.2 tests "the runbook count query", and 5.2 puts the same query into `docs/deployment.md`. Name the source of truth. For example, the SQL lives in a test fixture or a migration-adjacent file, and the doc copies it, with a test or checklist item showing the two match. Without this the doc and the tested query will drift, and the doc is what the operator runs.

**A4 (should fix). 3.3 asserts read-path behaviour from section 4.**
3.3 says "`defaultTopicsNotActive` afterwards omits those defaults". That assertion cannot pass until 4.1/4.2 land. Either move that line into 4.3, or put section 4 before the assertion. The archived-plus-active-linked-rows case already appears in 4.3. Let 3.3 cover only what the copy path does: linked rows, counts, archived rows untouched.

**A5 (should fix). 4.2's precondition is checked after the implementation.**
"Confirm the active-rows read selects `name` for every active row, unfiltered and unlimited" is a precondition of the suppression design (Decision 8). Make it the first step of section 4 (a read, no code), so a surprise is found before 4.1 is written.

**A6 (should fix). The mock-shape update is a hidden coupling.**
The `content.test.ts` mocked row shape (new team-name column) must change in the same commit as 4.1. Otherwise the suite is red between 4.1 and 4.3. Move it from 4.3 to 4.1.

**A7 (should fix). The new "only copyCanonicalDefaults writes `template_topic_id`" structural test (3.2) and the test-side writers.**
The 1.3 helper fix writes `template_topic_id` in `src/routes/__tests__/helpers/`, and the migration tests seed links. The existing scanner covers production source and excludes tests and migrations (its header says so). 3.2 should state that the new test inherits that exclusion and that its regex covers `UPDATE ... SET template_topic_id` and `INSERT ... (template_topic_id)` forms. It should also include one negative self-test (a fixture string with a rogue writer fails). Otherwise the test is untested.

**A8 (minor). 6.1 and 3.2 disagree.**
6.1 requires `template-writer-structural` to "pass unmodified". 3.2 says the new test is "built on" its scanner infrastructure. If that means extracting a shared helper from the file, the file is modified. Say which: extract to a shared helper (and the existing test's assertions stay byte-identical), or copy the scanner into a new file. I prefer the shared helper. Reword 6.1 to "assertions unmodified".

**A9 (minor). 1.2 is a docs-section prerequisite, not a pre-check.**
The `RENAME_NOTICE` grep serves 5.1 and 5.2. Move it to the head of section 5. The Priya Nair sign-off in 5.1 is a long-lead human gate, so start it early in parallel (draft the text on day one). Do not leave it until the end.

## B. Splits and reorders (recommended final shape)

1. Section 1 (read-only): snapshot helper check and delete grep; no-deletes / no-`is_default=false` greps (1.4); open the active-rows-read check.
2. Section 2: 2.0 draft backfill and runbook queries; 2.1 migration file; 2.2 helper fix `restoreWholeTemplate`; 2.3 migration tests; 2.4 sentinel drift test. Then 1.1 counts against each environment (merge gate, can run while sections 3 to 5 proceed).
3. Section 3 (copy): 3.1 as written; 3.2 structural tests; 3.3 copy-path tests only.
4. Section 4: split 4.3, which is the largest task in the list. Suggested slices:
   - 4.3a link-based read (rename invisible, archived linked offered under team name, custom same-name no longer hides, archived-plus-active linked, archived template omitted, two-team read, no `templateTopicId` in any response)
   - 4.3b suppression (active same-name custom or other-default, normalized compare, 409 `TOPIC_NAME_ACTIVE` on forced restore)
   - 4.3c unlinked entry on TOPIC-005 gives 404 and writes nothing (belongs with the provisioning "Unlinked legacy default" scenario)
   - 4.3d "no route log line emits the topic row wholesale" and "confirm existing #299 coverage" (checks, not tests; list them as review checks)
5. Section 5: 5.1 notice (start early), 5.2 docs checklist, 5.3 PR note.
6. Section 6: add the missing items listed in C.

Also merge 4.1 and 4.2. They edit one function and cannot be reviewed separately.

## C. Work in the design or proposal that has no task

- **Staging measurement of the migration** (proposal Residual risks: "measure in staging before release"; `VALIDATE` scans `topics`; 200ms `lock_timeout`). Add a task: run migration 24 on a production-sized copy, record duration and that no lock-timeout error occurs.
- **EXPLAIN check** (Decision 4: no plain index "unless `EXPLAIN` on seeded data shows a need"). Add a short task to run it on the lateral join and the RESTRICT check, and record the result. Otherwise "unless EXPLAIN shows" is never evaluated.
- **Rolling-deploy re-run is a deploy-time action, not a code task.** Make it an explicit post-merge checklist item (post-drain run under the migration DB role, ticket entry, second run updates 0). Today it appears only inside the 5.2 docs checklist.
- **Down migration rehearsal**: 2.2 tests down-then-up; also record the manual `down 24` check in the PR, since rollback is "redeploy the previous build, optionally run down 24".

## D. Stale or inconsistent leftovers from the fallback rewrite

Searched all of proposal, design, tasks and specs for: unique index, ON CONFLICT, DO UPDATE, reactivat*, RAISE NOTICE, "notice", restored_by, 23505. Most hits are correct negations or rationale. These are the ones that need action:

| Where | Problem | Fix |
|---|---|---|
| tasks.md 1.5 | "Architect decision recorded ...: RESTRICT and the CHECK kept; unique index, `ON CONFLICT` and no plain index ... per the fallback." Garbled (reads as if the index is kept), and it is not a task: the decision is already in design.md. | Delete 1.5, or replace with "Confirm design.md Decision 4 is the agreed shape" (a checkbox with no work). |
| design.md "Risks / Trade-offs": "Copy becomes two statements and breaks E8 -> structural assertion on the SQL." | Stale. The copy is one statement (Decision 6, spec). It is a leftover from the earlier two-statement variant. | Reword: "Someone adds a second statement or a conflict clause to the copy -> structural assertion on the SQL (3.2)." |
| specs/database-migrations "Empty database" scenario: "THEN it succeeds and reports a count of 0" | Stale. The migration reports nothing (no RAISE NOTICE); the count comes from the runbook query. Contradicts the requirement text and the next-but-one scenario. | "it succeeds and the runbook count query returns 0". |
| proposal.md Review disposition, B1 line: "Decided `ON CONFLICT ... DO UPDATE` reactivation ... Scenario added." | Stale text sits in the record, with the supersession only noted in a trailing paragraph. A reader of the bullet alone gets the wrong design. | Prefix the bullet "[Superseded by the Architect fallback; see last paragraph]" or strike the behaviour clause. |
| proposal.md Executive line: "Unique index and CHECK: accepted conditionally; marked for Architect confirmation with the fallback above" | Half stale: the index is dropped, the CHECK is kept, and the confirmation is done (the "Architect confirmed" bullet above). | Update to "index dropped, CHECK kept; confirmed." |
| design.md Decision 5 reason: the CHECK is "kept because it backs the backfill" | Imprecise. In migration 24 the CHECK is added after the backfill, so it can only validate it after the fact and roll the whole transaction back (a fail-loud net, which is fine). It protects the later operator re-run, which runs with the CHECK in place. | Reword to "validates the backfill (fail-loud, whole file rolls back) and constrains the operator re-run". |
| proposal.md Why / What Changes | Clean. No stale unique-index or reactivation text found. | None. |
| specs/default-topic-provisioning | Clean. "Reactivates the same row" appears only for team-owned restore, which is correct. | None. |
| design.md Decisions 4 and 15, Review disposition | The mentions of `restored_by` / `updated_at` / "reactivation" are the rationale for rejecting the index. Correct as history. | None. |

## E. Architectural sign-off notes

- Dependency order of the product work is correct: schema (migration 24) before copy (3), copy before read (4), read before docs (5). A new build against the unmigrated schema cannot happen because migrations run first; an old build on the migrated schema is safe (additive, nullable). Both are stated in the Migration Plan and need no task.
- No task assumes the unique index any more, and nothing downstream (4.x, 6.x) relies on `ON CONFLICT` behaviour. The 4.x ordering `(status='active') DESC, id LIMIT 1` correctly carries the weight the index used to.
- Scope control is good: 6.2 is an effective stop condition. Add `routes/topics.ts` (assign-defaults gate) to the "files that must be unchanged" check, since design Decision 6 relies on it as-is.
- The one residual architectural caution is already recorded: the link has no database uniqueness, so #310 must decide on the index before it relies on one-row-per-default. I suggest adding a line to #310's issue now (not in this change's files) so the deferral is not lost.
