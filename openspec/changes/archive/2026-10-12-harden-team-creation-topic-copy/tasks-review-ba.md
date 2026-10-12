# Tasks Review (Business Analyst): harden-team-creation-topic-copy (#215)

Reviewer: Marcus Delgado, Senior Business Analyst
Inputs: `tasks.md`, `proposal.md`, both delta specs, and `design.md` (D8, declined-trigger and risks sections) for cross-reference.
Focus: do the tasks, taken together, cover every capability and condition in the proposal, and is anything lost between requirement and task?

## Verdict

Coverage is good. All eight proposal "What Changes" items and all twelve conditions (C1-C12) have at least one task, and I found no capability with no task at all. I found **two real gaps** (G1, G2), **four smaller translation losses** (L1-L4), and some **traceability housekeeping** (T1-T3). None is blocking if the owner accepts the one-line additions below. G1 and G2 are the ones I would fix before implementation starts.

## Capability-to-task trace

| Proposal item or condition | Task(s) | Result |
|---|---|---|
| Single definition of the canonical set (D1, D6) | 2.1, 2.2, 3.1, 4.3b | Covered |
| Copy takes active defaults only, numbered 1..n (D2) | 2.2, 4.2, 4.3, 4.3a | Covered |
| Restore list driven by template-side status only (D5) | 3.1, 4.6, 4.7 | Covered |
| Anomaly signal V1-V4 (D3, D11) | 2.3, 4.4 | Covered, with L2 and G1 below |
| Zero active defaults keeps its contract (D4) | 2.4, 4.5 | Covered |
| Invariants test (D8) | 4.0, 4.10 | Covered, with G2 below |
| #188 regression suite update (C9) | 4.9 | Covered |
| Declined trigger on record (D9, C10) | 5.1, 5.2, 5.3 | Covered |
| One-time data check (D7) | 1.1, 1.2 | Covered, with T1 below |
| C1 | 4.2 | Covered |
| C2 | 4.4 | Covered, with G1 and L2 |
| C3 | 4.5 | Covered |
| C4 and required duplicate test | 4.3, 4.3a | Covered |
| C5, C6 | 4.6 | Covered |
| C7 | 4.7 | Covered |
| C8 | 4.10 | Covered, with G2 |
| C9 | 4.9 | Covered |
| C10 | 5.1, 5.2 | Covered |
| C11 | 4.3 (inline) | Covered |
| C12 | 4.8 (inline) | Covered |
| PR statement that the lock change is wording-only | 6.2a | Covered |
| No frontend, shared or migration change | 6.2 | Covered |

## Gaps

**G1. "No facilitator-visible behaviour" (D11) is never asserted for the damaged-template case.**
The proposal and the anomaly requirement both say no banner, copy or response field is added. Task 2.3 states "no response change", but the only task that checks a response is 4.8, and it covers a *healthy* template. Nothing proves that creation against a damaged template returns the same status and body shape as a healthy one. This is the most likely place for a well-meaning implementer to leak a diagnostic into the response, and it is a stated non-goal. Suggested fix: add to 4.4 an assertion that the 201 response for an anomalous template has the same keys and shape as the healthy response, and contains no anomaly field.

**G2. The invariants test has no check that it can actually fail.**
The invariants spec has two scenarios whose THEN clause is "the invariants test fails and names the invariant" (archived default; changed prompt). Task 4.10 says "each failure naming its invariant" but nothing in the tasks demonstrates a failing run. A guard that has never been seen to fail is the cheap substitute for the declined trigger, so it carries real weight. Suggested fix: add to 4.10 a one-time verification (recorded in the PR) that temporarily archives a template default, then changes a prompt, in a scratch database or inside a rolled-back transaction, and that the failure message names "no non-active default" and "baseline content" respectively. A tiny table-driven test over a pure invariant-checker function would also do it, if the implementer prefers.

## Smaller translation losses

**L1. Spec scenarios with no named task.** Three delta-spec scenarios have no corresponding task or explicit "existing coverage" note:
- "Editing a team's copied topics does not affect the canonical defaults or any other team".
- "A later change to the canonical defaults does not retroactively affect an already-created team".
- "Topic-copy failure prevents team creation from completing" (the generic copy failure, as opposed to the empty-template case in 4.5).

These may well be satisfied by existing tests or by the architecture, but the tasks should say so. Suggested fix: one line in section 4 naming the existing test(s) that cover each, or a short test. The second one matters to me as topic-history preservation: the proposal promises the change "never deletes, archives or rewrites an existing team's topics", and no task checks that creating a new team leaves other teams' topic rows untouched. A cheap assertion in 4.8 (an existing team's topic ids, statuses and positions are identical before and after a second team is created) would cover both.

**L2. The combined-anomaly scenario and `topicIds` ordering.** The spec scenario "Anomalous template creates the team and logs once" (archived default plus a position gap, `topicIds` holds the archived default's id) is not named in 4.4, which tests anomaly types one at a time. The spec also requires `topicIds` in canonical order then id, de-duplicated; 4.4 tests the cap but not the ordering or de-duplication (a row that is both a duplicate-position row and a non-active default would appear once). Suggested fix: add the combined case and an ordering and de-duplication row to the 4.4 table-driven unit tests.

**L3. The browser spot check (6.3) does not test the thing this change alters.** The proposal is explicit that no UI consumes `defaultTopicsNotActive`; the topic management screen shows the team's own archived list. Task 6.3 says "archive one of the team's own defaults, confirm it appears under restore, restore it". That exercises the existing archived-topics list and would pass with or without this change. It is a fine smoke test for "team creation still works and shows twelve topics in order", but it should not be recorded as verification of C5-C7. Suggested fix: reword 6.3 to say what it verifies (creation unchanged, twelve topics in order, existing archive and restore still work) and that C5-C7 are verified by the API tests only. This keeps us from over-claiming FR-8.6, which the proposal itself warns against.

**L4. The D7 check can only see one of the two silent harms.** The proposal's Why section names two silent failures: resurrected archived defaults and a reordered baseline. The SQL in 1.2 detects the first (names not in the active template set) but not the second. This matches the proposal's wording (the proposal only promises a name check, and the change is forward-only), so it is not a defect in the tasks. I mention it so nobody reads a count of 0 as "no silent drift ever happened". Suggested fix: one clause in the 1.2 result line, "count = 0 means no resurrected-name rows; reordering is not checked".

## Traceability housekeeping

- **T1.** Task 1.2 must be completed or explicitly marked "not run" before merge, but section 6 (verification before merge) has no line that checks it. Add a 6.x item: "1.2 result or reason recorded; remediation issue number recorded if count > 0".
- **T2.** Tasks refer to D- and C- numbers in places but several tasks (2.1, 3.1, 4.1, 4.4's anomaly list) do not say which spec requirement they satisfy. Not blocking. Adding the requirement title or condition number to each section 4 task would make the chain from requirement to test checkable by someone who has not read the exploration notes.
- **T3.** Task 4.4 notes that a failing anomaly check logs `template_anomaly_check_failed`. That log message is in the design but not in the proposal or the spec's requirement text, so a reader tracing from the spec alone will not find it. Suggested fix: a sentence in the anomaly requirement, or confirm in the design that it is an implementation detail and leave it.

## Things I checked and found sound

- The zero-active-defaults path (2.4, 4.5) carries the full C3 list: exact 500, code, message, `correlationId` in body, no template id, stack or SQL, no persisted rows, error-level entry.
- The duplicate-position test (4.3a) is specified as required and at function level, and the proposal's Impact section gives the reason a route-level version is impossible. Nothing is lost there.
- The restore-list requirement's key trap (status filter on `dt` only, never on the team's row) is preserved as an explicit instruction in task 3.1 and tested by the C6 pair in 4.6.
- The declined-trigger follow-up (5.2) keeps the "decision lapses if these lines are lost" condition, which was the reviewers' main concern about D9.
- Test isolation (4.0) is carried through, including the clean-up rule for extra template rows.

## Recommended order of fixes

1. G1 and G2 (small additions to 4.4 and 4.10).
2. L1 (name the existing coverage or add the cross-team assertion in 4.8).
3. L3 and T1 (wording only).
4. L2, L4, T2, T3 at the owner's discretion.
