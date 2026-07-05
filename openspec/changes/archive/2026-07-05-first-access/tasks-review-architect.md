# Architect Review: Task Ordering — First Access
**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Date:** 2026-07-05
**Change:** first-access

---

## Summary

The task list has the right work identified. The ordering has several problems that will cause rework if executed as written. The most significant issues are: a typed error class used by Task 1 is defined in Task 14; a schema investigation that determines whether additional implementation is required precedes no other task; and an implementation task that augments an event is sequenced after the test task that verifies that event. These are not sequencing preferences — they are dependency inversions that require revisiting completed work when the later task arrives.

The structural classification of Tasks 11–15 under the "Test Tasks" heading is also incorrect and should be corrected before implementation begins, to avoid confusion about what is being built versus what is being verified.

---

## Findings by Question

### 1. Task 1 (missing-claims validation) must precede tests that invoke the callback with empty claims — is this ordering clear?

**Yes, at a coarse level. No, at the fine level.**

Task 1 is in the Implementation Tasks section; Task 5 is in the Test Tasks section. The section ordering is correct. However, the ordering is only clear if Task 14 is resolved first (see finding 2 below). Task 5 tests that the validation throws correctly and that `mapAuthError` maps the result to an appropriate error category. If Task 14's `MissingClaimError` class and `mapAuthError` update are not yet in place when Task 5 is written, the test is either written against a generic Error (and must be revised later) or cannot be written at all against the typed surface. The dependency chain is:

**Task 14 → Task 1 → Task 5**

That chain is not visible in the current task list.

---

### 2. Task 14 (MissingClaimError class) is a dependency of Task 1 — should Task 14 come first?

**Yes. Task 14 should precede Task 1.**

As written, Task 1 adds the validation guard and Task 14 then refactors it to use a typed error class. This creates a two-pass implementation of a single feature: first write the validation with a generic Error, then reopen and revise it. That is unnecessary rework.

The design document is explicit that missing-claims validation should use a typed `MissingClaimError` with a `claim` field to enable structured logging of which claim was absent without including PII. This is not an optional enhancement — it is the mechanism that satisfies the no-PII logging constraint in the callback's catch block. `mapAuthError` must recognize `MissingClaimError` before the catch block can emit the correct audit event. All of this is required for Task 1 to be complete.

**Recommendation:** Move Task 14 to precede Task 1. Revise Task 1's description to state that it uses the `MissingClaimError` type established in Task 14, eliminating the "update the missing-claims validation added in Task 1" clause from Task 14.

---

### 3. Task 12 (session fixation fix) is independent — does its ordering matter?

**Not for correctness. It matters for conflict avoidance and structural clarity.**

Task 12 is independent: it modifies only the session lifecycle portion of `auth.ts` and has no functional dependency on Tasks 1, 2, or any other task. It can be executed at any point.

However, Tasks 1, 2, and 12 all modify `auth.ts`. If they are executed in parallel or in rapid succession, they will produce merge conflicts in the same file. The practical recommendation is to execute Task 12 first (it is the smallest, most self-contained change), then proceed with Tasks 1 and 2.

The more significant structural issue is classification: Task 12 is an implementation task — a security fix — listed under the "Test Tasks" heading. This is a misclassification. It should appear in the Implementation Tasks section alongside Tasks 1–4.

---

### 4. Task 2 (server-side no-team redirect) adds a team membership query to the callback — does this create ordering dependencies with Tasks 1 and 12?

**Yes, with Task 1. No consequence with Task 12.**

Task 2 extends the callback flow after `resolveOrCreateAccount` completes. Task 1 adds a guard before `resolveOrCreateAccount` is called. They operate on different segments of the same handler function. The dependency is one-directional: Task 1's guard must be in place before Task 2's query code is added, because the semantics of the callback are:

1. Validate claims (Task 1) — if invalid, abort here
2. Resolve account
3. Query team memberships and set redirect (Task 2)

If Task 2 is implemented without Task 1, the callback has no early exit for empty claims, and any test invoking Task 2's redirect logic could inadvertently create an account from an empty-claim token. This is the identity confusion risk the design explicitly calls out.

**Recommendation:** Task 1 must be merged before Task 2. Enforce this sequencing explicitly.

There is no consequential ordering dependency between Task 12 and Task 2. Task 12's change (session lifecycle) and Task 2's change (post-resolution redirect logic) operate on different sections of the handler.

---

### 5. Task 3 (no-team guard in frontend) depends on session data with teamMemberships — is there a dependency on Task 2?

**The dependency exists but is indirect and requires clarification.**

Task 3 adds a frontend guard that reads `teamMemberships` from the session context. The session context is populated from the `/auth/session` endpoint, not directly from the callback that Task 2 modifies. The design document states that the team membership query in Task 2 should use "the same live-data pattern used in the `/auth/session` endpoint" — implying that endpoint already returns `teamMemberships`.

If `/auth/session` already returns `teamMemberships`, Task 3 can be implemented and tested independently of Task 2. If it does not — if `teamMemberships` is populated by Task 2 into the session store and the frontend reads it from there — then Task 3 depends on Task 2.

This dependency is implicit in the current task descriptions. The tasks do not state where `session.teamMemberships` originates or whether the `/auth/session` endpoint currently returns it.

**Recommendation:** Before implementation begins, confirm whether `/auth/session` already returns `teamMemberships`. If it does, Tasks 2 and 3 are independent and can be sequenced in any order. If it does not, Task 2 must precede Task 3 and the task descriptions must say so.

---

### 6. Are test tasks (5–10, 15) appropriately ordered after the implementation tasks they test?

**Mostly. One inversion exists.**

Tasks 5–9 test implementations from Tasks 1–4 and pre-existing code. Their position after the implementation tasks is correct.

**Task 10 tests the `first_access_created` event format** — specifically that it includes `userId`, `oidcSubject`, and `oidcIssuer` and does not include PII. But Task 13 adds `sourceIp` and `correlationId` to that same event and is listed after Task 10.

If Task 10 is written before Task 13, it will assert that the event does not include `sourceIp` or `correlationId` (because they are not yet present). When Task 13 is then implemented, Task 10's test either fails (if Task 13 adds required fields and the test asserts a fixed field set) or passes incorrectly (if the test only checks that certain PII is absent). In either case, the test must be revised.

**Inversion to correct: Task 13 should precede Task 10.**

Task 15 (audit log level independence) is listed as a "Test Task" but is an implementation investigation with a potential fix. Its position at the end of the list is acceptable — it is not a dependency for any other task — but its classification is wrong.

---

### 7. Task 16 (schema check) is a prerequisite for understanding whether truncation is needed — should it come first?

**Yes. Task 16 should be the first task executed.**

Task 16 checks whether `display_name` and `email` in the `users` table are `VARCHAR(n)`-constrained. If they are, truncation logic must be added to `resolveOrCreateAccount` before the upsert.

`resolveOrCreateAccount` is called in the main implementation path (by Tasks 1 and 2, after Task 1's guard passes). If a `VARCHAR` constraint exists and truncation is not in place, any authentication where the `sub` claim is used as the `display_name` fallback (longer than the column width) will produce a database error. That error is not currently mapped to a specific log entry — it would surface as a generic database failure. The design document identifies this explicitly as a risk.

More directly: if Task 16 reveals a `VARCHAR` constraint, additional implementation is required in `resolveOrCreateAccount` before any task that exercises the upsert path should be considered complete. That makes Task 16 a prerequisite for Tasks 1 and 2.

**Recommendation:** Execute Task 16 first, before any implementation task. Its outcome either confirms no additional work is required or expands the scope of the implementation tasks that follow.

---

## Recommended Execution Order

The following order resolves all identified dependency inversions:

1. **Task 16** — Confirm users table schema VARCHAR limits. Determines whether truncation must be added before any upsert path is complete.
2. **Task 14** — Implement `MissingClaimError` typed class and update `mapAuthError`. Required before Task 1 can be written against the correct error interface.
3. **Task 12** — Replace `destroy()+regenerate()` with `regenerate()` alone. Self-contained security fix; execute early to clear `auth.ts` before the larger changes in Tasks 1 and 2.
4. **Task 1** — Add missing-claims validation to the authentication callback. Must follow Tasks 14 and 12; must precede Task 2 and all tests.
5. **Task 2** — Implement server-side no-team redirect. Must follow Task 1.
6. **Task 3** — Add no-team guard in frontend. May follow Task 2; confirm whether it depends on Task 2's session data or on the pre-existing `/auth/session` endpoint.
7. **Task 4** — Verify `/no-team` route layout isolation. Independent; can execute in parallel with Tasks 1–3.
8. **Task 11** — Add `isNewUser` constraint comment. Implementation task; execute before test tasks.
9. **Task 13** — Add `sourceIp` and `correlationId` to `first_access_created`. Must precede Task 10.
10. **Task 5** — Tests for missing-claims rejection. Follows Tasks 14, 1.
11. **Task 6** — Tests for server-side no-team redirect. Follows Task 2.
12. **Task 7** — Tests for no-team guard. Follows Task 3.
13. **Task 8** — Routing-layer test for no navigation on `/no-team`. Follows Task 4.
14. **Task 9** — Verify account-resolver tests for sub/iss matching. Independent; can execute at any point after Task 1 is complete.
15. **Task 10** — Verify audit logging for `first_access_created`. Must follow Task 13.
16. **Task 15** — Evaluate audit log level independence. Investigation with potential implementation; execute late but before this change is considered closed.

---

## Structural Issues to Correct in tasks.md

The following are classification errors that should be corrected before implementation begins:

- Tasks 11, 12, 13, 14, and 16 are listed under the "Test Tasks" heading. All five are implementation tasks (code changes, code comments, or prerequisite investigations that determine implementation scope). They should be reclassified under "Implementation Tasks" or under a clearly labeled "Implementation — Supporting" section.
- Task 15 is an investigation task with a potential implementation outcome. It is neither a pure test task nor a pure implementation task. Label it as "Investigation / Fix" or similar to set correct expectations.
- The current two-section structure (Implementation Tasks, Test Tasks) does not accommodate the mix of work in this change. Consider three sections: Investigation (Tasks 16, 15), Implementation (Tasks 14, 12, 1, 2, 3, 4, 11, 13), and Verification/Test (Tasks 5, 6, 7, 8, 9, 10).

---

## Constraints That Must Not Shift

Regardless of execution order, the following invariants from the design must be preserved:

- Task 1's validation guard is the first substantive logic in the callback — it must precede any call to `resolveOrCreateAccount`. No reordering of tasks changes this.
- Task 1 must be merged and in production (or in the same atomic deployment) as Task 2. Deploying Task 2 without Task 1 leaves the callback accepting empty-claim tokens and creating degenerate account records.
- Task 14's `mapAuthError` update must ship in the same deployment as Task 1. If Task 1 throws a `MissingClaimError` that `mapAuthError` does not recognize, the catch block will not produce the correct structured failure response.
- Task 16's findings determine whether `resolveOrCreateAccount` requires changes. If `VARCHAR` constraints exist, those changes are part of this change's scope and must be completed before any implementation that exercises the upsert path is closed.
