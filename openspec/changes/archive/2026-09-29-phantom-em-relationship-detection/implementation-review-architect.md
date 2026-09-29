# Implementation Review — Solution Architect

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Change:** `phantom-em-relationship-detection`
**Scope of this review:** does the implementation match design.md's Decisions 1-9 (all resolved, no open questions), and is it consistent with this codebase's existing patterns for manually-invoked ops scripts and self-skipping integration tests.

## Verdict

**Approved.** The implementation matches design.md exactly on every decision I checked, including the two decisions I made myself at design review (8 and 9). I found no deviations that need correction before this moves forward. One task-tracking gap (not a code defect) is noted below and should be closed before this change is considered ready to archive.

## Boundary check

Confirmed no application/TypeScript code was touched, as proposal.md and design.md both claim. The only new files are:
- `packages/backend/migrations-manual/8_phantom_em_detect.sql`
- `packages/backend/migrations-manual/8_phantom_em_annotate.sql`
- `packages/backend/src/__tests__/phantom-em-relationship-detection.test.ts` (new test file — not a modification of existing app code)
- `openspec/changes/phantom-em-relationship-detection/query-result.md`

No file under `packages/backend/src/routes/` or elsewhere in application code was modified. This is exactly the boundary design.md's Impact section commits to.

## Pattern consistency

- **Header-comment convention vs. `8_rollback.sql`:** both new scripts follow the same shape — title, `NOT AUTO-RUN` note explaining the `migrations-manual/` placement and its origin in GitHub issue #39, an exact copy-pasteable invocation, a "What this does" section, and (where relevant) explicit prerequisites/limitations. Consistent.
- **Test self-skip pattern vs. `default-topic-provisioning-integration.test.ts`:** the new test file follows the same `isPostgresReachable()` / `describe.skipIf(!canRun)` / `DATABASE_URL` env-fallback shape. It correctly extends the pattern with an additional `isPsqlAvailable()` gate, which is necessary here (unlike the reference file) because these scripts use `\if`/`:'var'` psql meta-syntax that the `pg` driver cannot execute directly — the test shells out to real `psql`. This is a justified, minimal extension, not a departure.

## Decision-by-decision verification

**Decision 8 (actor identity)** — implemented exactly as decided, all four mechanisms present in `8_phantom_em_annotate.sql`:
1. Existence guard on `operator_user_id` only (`\if :{?operator_user_id} \else \echo ... \quit \endif`, lines 60-64) — matches the design's own code sample, which scopes the guard to `operator_user_id` specifically, not `actor_global_role`.
2. Quoted-literal substitution used throughout (`:'operator_user_id'::uuid`, `:'actor_global_role'`) — no bare `:name` form anywhere.
3. Identity-echo check (`SELECT id, email FROM users WHERE id = :'operator_user_id';`, line 72) present after the environment check and before the `INSERT`, exactly as Decision 8's stated statement order requires.
4. The exact copy-pasteable invocation (header lines 15-19) is transcribed verbatim from Decision 8 point 4.

One observation, not a defect: `actor_global_role` has no existence guard of its own (only `operator_user_id` does), and nothing validates that the value passed actually equals the fixed literal `'system:production_data_engineer'` — it is trusted via the transcribed invocation string. I confirmed this is what Decision 8 itself specifies (point 2's code sample lists `:'actor_global_role'` as a substituted parameter, not a hardcoded SQL literal), so this is not a deviation. If `actor_global_role` were omitted entirely, `psql` would leave `:'actor_global_role'` unsubstituted and the statement would fail with a hard syntax error — a loud failure, not a silent wrong value, consistent with this change's own risk philosophy. I don't require a change here.

**Decision 9 (notification sentence)** — checked verbatim in both places it needs to appear:
- `8_phantom_em_annotate.sql` header (lines 49-51)
- `query-result.md` (lines 30-32, with backticks around `<environment>`/`<timestamp>` matching design.md's own markdown formatting; the SQL comment version drops backticks appropriately since SQL comments aren't markdown)

Both match design.md Decision 9's sentence exactly, word for word.

**`operation = 'team.role_changed'` filter** — present (`8_phantom_em_annotate.sql` line 101) with the load-bearing inline comment (lines 76-83) explaining the `team.role_change_denied` collision it prevents, matching Decision 5's framing that this predicate is load-bearing, not stylistic.

**tasks.md 4.1's four fixture rows** — all four are built in the test file and each is consumed by the task that was supposed to use it:
1. Base phantom case (lines 117-120, 130-137) — consumed by 4.2's positive match (line 187: `expect(output).toContain(phantomEmail)`) and 4.3's annotation.
2. Removed-membership variant (lines 125-128) — consumed by 4.2's exclusion check (line 188: `expect(output).not.toContain(removedEmail)`).
3. Pre-cutoff `team.role_change_denied` row with random, unrelated `target_user_id`/`team_id` (lines 139-151) — this construction is deliberate and correct: because these UUIDs aren't tied to any real user/team, if the `operation` filter were ever silently dropped, this row would still match the annotate query's other predicates (metadata shape + pre-cutoff timestamp) and inflate the result count from 1 to 2, which the test's own `toHaveLength(1)` / `new_annotations_inserted | 1` assertions (lines 199, 212) would catch. This is exactly the property tasks.md 4.3 requires the fixture to prove.
4. Already-annotated row (lines 153-172) — the pre-seeded annotation deliberately omits `annotated_timestamp` from its metadata (only the real script's `jsonb_build_object` includes it), which is how the re-query at lines 201-207 distinguishes a genuinely new annotation from the pre-seeded one. If the `NOT EXISTS` idempotency guard ever failed, this fixture would produce a second real annotation row (with `annotated_timestamp` present), pushing the count from 1 to 2 and failing the test. Correctly exercises the idempotency guard, distinct from 4.4's full second-run test.

I verified the `audit_log` schema (`packages/backend/migrations/8_audit_log.sql`) directly rather than taking the test's assumptions at face value: `actor_user_id` is `NOT NULL` with no FK (matches design's rationale for why a stale UUID isn't caught by a constraint), `target_user_id`/`team_id` are nullable (supports fixture 4's `NULL, NULL` annotation-of-an-annotation row), `metadata` is `JSONB`. No mismatch between the scripts/tests and the actual shipped schema.

I also independently confirmed the `#109` reference inside the annotation script's `note` field is the correct GitHub issue number for the archived `restrict-team-005-em-promotion` change (verified against that change's own proposal.md and design.md, which both cite issue #109) — not a typo'd or fabricated reference.

## Finding: tasks.md is stale relative to actual completion state

tasks.md's Verification section (4.1-4.4) is entirely unchecked, but the pipeline coordinator has already confirmed the test suite (which is exactly tasks 4.1-4.4) passes 3/3 against real Postgres + real psql. This isn't a code defect, but it is a documentation/tracking gap this change lineage has specifically struggled with before (the original 2026-09-23 deadline slipped silently in part because pipeline state didn't reflect reality). Recommend checking off 4.1-4.4 in tasks.md before this change is archived, so a future reader doesn't have to re-derive that verification already happened from a Slack-style side-channel confirmation.

Tasks 5.2 (handoff) and 5.3 (deadline confirmation/tracking mechanism) remain correctly unchecked — those are real outstanding deliverables that happen outside this pipeline's access, not tracking gaps.

## Summary

No corrections required. The two scripts, the test file, and query-result.md are a faithful, verified implementation of design.md's Decisions 1-9, staying inside the boundary the proposal committed to (no application code touched). Recommend the pipeline update tasks.md's Verification checkboxes to reflect the passing test suite before archiving.
