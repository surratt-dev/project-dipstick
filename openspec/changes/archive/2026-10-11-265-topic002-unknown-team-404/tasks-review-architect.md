# Tasks review: Solution Architect (Ingrid Sollenberger)

Scope: ordering against architectural dependencies, and tasks to split or reorder. I read `tasks.md`, `design.md` and `proposal.md`. I do not review domain or UX.

## Verdict

The skeleton is sound: gate, backend, integration, frontend, docs, release. The security-relevant dependency (authorization before existence, existence before the admin arm) matches D1. I found no task that needs an artifact that is never built. There are several ordering defects, mostly about when the suite is red, duplicated ownership, and checks that run too late. None is blocking if the fixes below are made.

## Findings

### A. Reorder

1. **Delta specs are checked too late (4.3 after the tests).** AC 4 says the key sets must "equal the exact lists in the spec", and 1.1 and 1.3 pin those lists. The spec is the source of truth for the tests, so it must be settled before 1.1. Move the spec authoring and hand-check to the gate as a new 0.5. Keep 4.3 only as the final re-check. Move 4.2 (`team-content-access` needs no edit) to the gate too. It is read-only and informs scope.

2. **The structural test runs first at 5.1.** D5 says "run `team-not-found-envelope-structural.test.ts` early, since it may count call sites". Add it to gate task 0.2 as a baseline run. Run it again immediately after 1.2, not only at the release gate. Finding a call-site count failure at 5.1 means reworking the handler after everything else is built.

3. **1.2 leaves the suite red until later tasks, and the dependency is not stated.** After 1.2:
   - `content.test.ts` admin-order fixtures break (0.4 sizes this).
   - Integration `team_found = false` cases break (not repaired until 2.1).
   - Key-set pins are only repaired in 1.3.
   
   Either land 1.2, 1.2a and 1.3 as one commit (recommended; the handler, its comments and the key removal are one coherent edit of the same lines), or state that the intermediate commits are red. A reviewer bisecting should not land on a red tree.

4. **4.4 needs the PR number and date, which do not exist until the PR is opened.** Mark 4.4 as depending on the PR being open (or use a placeholder to fill in at 5.1). Also, 4.4's retention note is only meaningful after 4.5's answer, so run 4.5 early. It is a human task with latency, so start it at the beginning (in parallel with the gate) rather than in section 4. 5.2 should list 4.5's answer as a precondition.

5. **Frontend (section 3) has no dependency on the backend.** Per the migration plan the frontend degrades against an old backend. State that section 3 can run in parallel with sections 1 and 2, and that only the shared envelope shape is the contract. This reduces the critical path. The integration tests in section 2 are the only part that truly needs 1.2 and 1.3.

6. **0.4 must precede 1.1, not just 1.2.** It sizes fixture churn that 1.1's test design depends on (SQL-text dispatch vs positional). The text says "before editing the handler". Say "before writing 1.1's admin cases". Likewise 0.1 (baseline multiset) has to be captured before any test edit, since the 1.1 multiset-equality test encodes it.

### B. Split

7. **1.1 is one task carrying about 20 assertions across five concerns.** It cannot be reviewed or ticked off meaningfully. Split into:
   - 1.1a: 404 behaviour (facilitator and admin, envelope, `no-store`, timing-floor spy, non-canonical id, standing facilitator is 404 not 403).
   - 1.1b: audit and query-shape (delta 0, no `admin.*` or `topic.*` event, admin runs no membership or role-set query, facilitator SQL-text multiset equality, team-name read failure gives 500 with no audit row).
   - 1.1c: guard tests that should already pass (existing, deactivated, template and zero-topic 200; participant and member-facilitator identical 403 and zero `teams` queries; `FACILITATOR_IS_TEAM_MEMBER` unchanged). These are characterization tests and will not fail first. "Failing tests first" is inaccurate for them. Label them so, and run them against the unmodified handler to prove the baseline.
   - 1.1d: key-set pins (no `team_found` / `teamFound`). These fail only after 1.3 and are the true "fail first" for AC 4.

8. **Merge 1.4 (TOPIC-001 regression) into 1.1c.** It is a guard test with no code change and the same nature as the other guards. As a separate numbered step after the implementation it reads as work that follows 1.3.

9. **1.2a is a comment edit in the same hunk as 1.2.** Fold it into 1.2 (or into the combined commit in finding 3). As a separate task it can be skipped. Add a grep check that the stale phrases are gone. 1.3's `audit-logger.ts` comment fix belongs with the same combined change.

### C. Duplicate or ambiguous ownership

10. **`topic-annotation-integration.test.ts` L364 is assigned in both 1.3 and 2.1.** Own it once. Because it is an integration test, 2.1 is the right place, and 1.3 should only touch `content.test.ts`. The same applies to the `team_found: true` `toMatchObject` assertions. List each file once.

11. **3.1 mixes characterization tests and failing tests.** The quiet-refetch cases are expected to pass already (`fetchAllTopics` never calls `setError`). Only the `TEAM_NOT_FOUND` initial-load cases fail first. Split them. 3.2 then has a conditional ("if the quiet-refetch test shows a path that blanks the screen, drop that path"). That conditional must be decided immediately after the characterization run, before the implementation, so the scope decision is made once and not discovered halfway through 3.2.

12. **3.3 is a review step, not a task with an output.** Give it a concrete check (a diff touches only `loadTopics` and one constant) or move it into 5.1.

### D. Release gate

13. **5.1 and 5.2 ordering is fine, but make the preconditions explicit.** 5.2 (Brian) needs 4.4 and 4.5 recorded in the PR body, and 5.1 green. Priya's copy review in 5.1 must follow 3.2 (the string exists). State that 5.2 blocks merge only, not further implementation, as the proposal says.

## Proposed order

1. Gate: 0.1, 0.2 (plus baseline run of the structural test), 0.3, 0.4, 0.5 (spec authoring and hand-check, 4.2). Start 4.5 (human) now.
2. Backend: 1.1c (guards, must pass), 1.1a, 1.1b, 1.1d (red), then combined 1.2, 1.2a and 1.3 (green), then re-run the structural test.
3. Integration: 2.1 (owns the L364 edit).
4. Frontend, parallelizable with 1 and 2: 3.1a characterization, scope decision, 3.1b failing tests, 3.2, 3.3.
5. Docs: 4.1, 4.3 final re-check, 4.4 (after the PR is open).
6. Release: 5.1, then 5.2.

## Architectural notes (no change requested)

- The D1 ordering claim "an unauthorized caller triggers zero `teams` queries" is pinned by a test in 1.1. It is the one control that stops a later refactor from reintroducing an enumeration oracle, so it should be among the first backend tests written (1.1c), not the last.
- The admin 500 path now precedes the membership and role-set reads. The test is included in 1.1. Confirm it asserts fail-closed behaviour (no body data and no audit row), not just the status code.
- The accepted residuals (no trace of admin probes, existing 403 flood) are correctly routed to the 5.2 gate and are not hidden in implementation tasks.
