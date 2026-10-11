# Tasks review: Business Analyst (Marcus Delgado)

Change: 264-topic-002-audit-non-admin-denials
Inputs read: tasks.md, proposal.md, design.md (D1 and test plan), both delta specs, propose-review-ba.md, issue #264.

## Verdict

Approve with required changes. Coverage is good. Every acceptance criterion in #264 maps to at least one task, and every proposal capability (row and event, unchanged response and timing, fail-open, admitted callers pay nothing, visibility and labelling, team-content-access reconciliation) has implementation and test tasks. The earlier BA asks from the proposal review are mostly honoured: REST contract task, strict validate, lint/test/build gate, three named integration cases, no-added-query and no-leakage unit tests.

Gaps are in spec scenarios that no task asserts, and in two proposal commitments that fall between tasks. None needs rework of the design.

## Issue #264 acceptance criteria trace

| AC | Task(s) | Status |
|---|---|---|
| One row, agreed operation, columns, exact metadata; one event with pinned key set | 1.2, 2.1, 3.1 | Covered, but column values only partly asserted (see R1) |
| Call order insert < event < floor < reply | 3.1 | Covered |
| Fail-open/closed behaves as decided | 2.2, 3.3 | Covered |
| Admitted facilitator runs no added query (SQL text) | 3.4 | Covered |
| No team name, topic names, ids, annotation text in row or event | 3.5 | Covered |
| Integration: participant, EM with participant membership, member facilitator; right `reason` and `actor_roles` | 3.6 | Covered |
| 403 status, message, body unchanged | 0.2, 3.2 | Covered, and stronger than the issue asks (baseline committed first) |
| Specs, REST contract, audit-logger comment updated; validate --strict | 1.2, 4.2, 4.3, 4.4 | Covered |
| Audit-visibility guard (#262) still holds | 3.8 | Covered as interim evidence only; #262 guard does not exist yet. Acceptable, and the task says so |
| lint, test, build | 5.1 | Covered |

## Required changes

**R1. Row column values are under-asserted.** The spec requires `team_id` = requested id, `actor_user_id` = caller, `actor_global_role` = the decision's role (and `'unknown'` when absent), and `actor_ip` = `request.ip`. The EM scenario explicitly requires `actor_global_role = 'engineering_manager'`. Task 3.1 pins only `metadata`, event keys and `actor_roles`; 3.6 asserts only `reason` and `actor_roles`. Add to 3.1 and 3.6: assert `actor_user_id`, `team_id`, `actor_global_role` (per case) and `actor_ip` on the row. Also have the 3.6 `actor_roles` fixture use a multi-element array in non-alphabetical order, otherwise "stored order" is not actually proven.

**R2. "No read of `teams`" is a confirmation, not a test (2.3).** The spec scenario "A team id that names no team" says no query reads `teams`. 3.1 or 3.6 should assert it (SQL-text check on the recorded queries for a denied request). 2.3 as written can pass by eyeballing.

**R3. `docs/deployment.md` informational labelling is missing from 4.1.** The visibility spec scenario "The informational labelling is documented" requires both `audit-logger.ts` and `docs/deployment.md` to state that `FACILITATOR_IS_TEAM_MEMBER` rows are informational. 1.2 covers the code comment; 4.1 covers only the log-only list, event counts, #131 and retention. Add the informational statement (and the "no one treats volume as a signal" sentence) to 4.1. This is the main promise made to Rachel Okonkwo, so it should not be left to implicit inclusion.

**R4. Proposal Follow-up 2 (member-facilitator route to definitions, P3) has no task.** 5.2 files only Follow-up 1, #TBD-A and #TBD-B. Either add it to 5.2 or state explicitly that it is a non-blocking product question handed to Product, with a named owner. As it stands it can silently disappear, which is the traceability loss I care about.

**R5. The "Required by Security before the issue is closed" condition on #TBD-A is not carried into tasks.** The proposal says the bounded-volume follow-up is required before #264 closes. 5.2 just says the user files it. Add a note that the PR must not auto-close #264 (no `Closes #264`) until #TBD-A exists and is linked, or restate the condition as a gate on 5.2.

**R6. Record the deviation from the issue's "Fail closed" heading where reviewers will see it.** The proposal records it. The issue heading and item 3 still read "fail closed (500)" and mention a "role-set read" failure that no longer exists as a separate step (folded into the insert, D4). Add a task: put a short comment on #264 and a line in the PR description stating the ruling (Security P1, fail-open), that the role read is part of the insert, and that the older test-plan line "forced role read failure" is obsolete. Otherwise an auditor comparing the PR to the issue sees an unexplained miss against the AC wording. Also confirm design.md's test-plan section (which still lists "role read, insert, event" ordering and "forced role read failure") is brought in line with D4 so the tasks and design do not disagree.

## Smaller observations

1. **Traceability.** Tasks do not cite the spec requirements or issue ACs they satisfy. A one-line "Covers:" tag per test task (for example 3.6 covers AC "integration", spec scenarios "participant", "EM", "member-facilitator", "no users row") would make the chain from need to task checkable. Not blocking.
2. **Admitted-facilitator writes no row.** The spec scenario "a facilitator with no membership is admitted and writes no `topic.config_list_denied` row" is covered only through the SQL-text check in 3.4. Fine, but say so, or add a one-line integration assertion in 3.6.
3. **Test location.** The issue says unit tests live in `content.test.ts` on the #259 SQL-routed fixture. Only 3.4 names the fixture. State the file and fixture once in section 3.
4. **Dependency order.** 5.2 and 5.3 are human gates (the user files issues, Priya pass) but sit after 5.1 with no indication they block merge. Mark them as merge blockers (or explicitly not), and note that placeholder replacement in proposal and design is an edit someone must make; as written it "happens" without an owner.
5. **5.3 pass condition.** "Response time not visibly different" is subjective. Acceptable for a usability pass, but pair it with the objective floor-clock test in 3.1 and say so, so the human check is not the only evidence.
6. **No frontend change.** The proposal promises no banner, toast or response text. 3.2 checks response fields and headers. A one-line confirmation that the diff touches no frontend files would close the "no surveillance in the room" constraint.
7. **Compliance driver.** The proposal asks the VP of Engineering to record any compliance date. It is an open question with no task. Low priority; add to 5.2 as an ask, or leave it.

## Ritual and persona check

No effect on the simultaneous reveal, facilitator control surface, outlier logic, action items or topic history. The ritual constraints in the proposal (no-manager rule, no surveillance in the room, not a performance tool) each have a verifying task: 3.2, 3.8, and the no-leakage tests. The facilitator-from-another-team rule is preserved by 3.7 and the 3.6 member-facilitator case. Good.

## Summary of requested edits to tasks.md

- 3.1, 3.6: assert all row columns; multi-element out-of-order `actor_roles` fixture (R1)
- 2.3 / 3.1: make "no `teams` read" an assertion (R2)
- 4.1: add informational labelling for `FACILITATOR_IS_TEAM_MEMBER` (R3)
- 5.2: add Follow-up 2 and the "do not close #264 until #TBD-A exists" gate (R4, R5)
- New task: issue comment and PR line recording the fail-open ruling and the folded role read; align design.md test plan with D4 (R6)
