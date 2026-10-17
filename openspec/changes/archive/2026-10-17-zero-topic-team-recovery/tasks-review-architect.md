# Tasks review: Solution Architect (Ingrid Sollenberger)

Scope: task ordering against architectural dependencies, and tasks that should be split or reordered. I did not review the domain, UX or the other reviews. Inputs: tasks.md, design.md, proposal.md.

## Verdict

The group-level order (gate, backend, shared, room-open, frontend, docs, post-release) is sound and the design itself is well bounded. The defects are inside group 2 and at the group 2/3/5 seams: several tasks assume things built by a later task, and the "tests first" rule is applied to 2.1 only. Needs revision before implementation starts. Nothing here requires a design change.

## Blocking findings (forward dependencies)

**B1. 2.2 and 2.3 depend on 2.9, which comes after them.**
- 2.2 says "admin-only authorization with denial audit per 2.9". 2.3 writes the `topic.defaults_assign_failed` row "via the same helper" that 2.9(a) extracts. 2.2 also emits `topic.defaults_assigned`, which 2.9(b) registers in `auth/audit-logger.ts`. If `emitAuditEvent` validates operation names, 2.2 cannot go green before 2.9(b).
- Fix: move the helper extraction, the TOPIC-002 refactor and the operation registration (2.9 a and b) ahead of 2.1/2.2, as their own task. Do it as its own commit. It touches shipped, security-reviewed #264 code, it is the riskiest refactor in the change, and it is the only part with a PO fallback (design D9). Risk-first ordering also surfaces a "cut" decision before the dependent tasks are built on it.
- The fallback ("drop the 403 audit, log-only for the 500") is currently expensive because 2.2 and 2.3 are written against the helper. Have 2.2 and 2.3 call one narrow seam (`recordDenial` / `recordFailure`), so cutting B2 is a swap of the seam body, not a rewrite. Say so in the task.

**B2. 3.1 cannot satisfy its own verification step.**
- `canAssignDefaults: boolean` is required in the shared type. 3.1 verifies "shared package and both consumers type-check", but the backend TOPIC-002 handler does not set the field until 3.2, and existing frontend fixtures and mocks of `GetAllTopicsResponse` will not compile either.
- Fix: either merge 3.1 and 3.2 into one task, or have 3.1 include updating every fixture and make the backend change in the same commit. Separately, the assign-defaults response type (`{ topicCount }`) is needed by 2.2 and the frontend client, so split it out and land it before 2.2.

**B3. 5.2 (required props) breaks the build until 5.3 lands.**
- `canAssign`, `assigning` and `onAssign` are required on `ActiveTopicsEmptyState`, so every call site, `TopicManagementPage.tsx` included, fails type-check after 5.2 alone. The required props are the right design. Merge 5.2 and 5.3 into one commit boundary, or order them with an explicit note that 5.2 is not green alone.

**B4. Missing task: the frontend API client call.**
- No task adds the client function for `POST .../assign-defaults`, or the parsing of its machine-readable codes (`TEAM_HAS_ACTIVE_TOPICS`, `DEFAULT_TOPICS_UNAVAILABLE`, `ASSIGN_DEFAULTS_FAILED`, 429/503). 5.3 assumes it exists. Add a task before 5.3, with a unit test per code mapping. The "unknown 500 code gets the generic line" rule is the architectural safeguard here and needs a test at the client boundary.

## Ordering and TDD-consistency findings

**O1. "Tests first" is inconsistent within group 2.**
- 2.1 is red-first. But 2.3 (empty template), 2.5 (success audit), 2.6 (no-leak, lock untouched), 2.7 (template guard) and 2.4 are written after 2.2, which already implements them. 2.1 also lists "audit-insert failure rolls back" and "throwing `emitAuditEvent` still 201", which overlaps 2.5. As written, 2.2's "verify the 2.1 tests pass" cannot hold unless 2.2 also implements 2.3's and 2.5's behavior.
- Fix: either fold 2.3, 2.5, 2.6 and 2.7's tests into the red-first step (a single failing suite, then one implementation task), or state that 2.2 delivers the happy path and refusals only, and that 2.3 and 2.5 are red-then-green increments. Pick one. Do not leave the overlap.
- Remove the duplication between 2.3 ("failed insert leaves the 500 and emits `topic.audit_write_failed`") and 2.9's tests of the same behavior.

**O2. 2.9 is too large for one checkbox; split it.**
It bundles five separable pieces with different dependencies and different cut-ability:
1. Helper extraction plus TOPIC-002 refactor plus op registration (precedes 2.1; see B1).
2. Per-actor denial-audit limiter (new Redis-backed component, own key namespace, own failure mode, own log event).
3. Wiring the 403 audit into the route and its tests.
4. The empty-template failure row (belongs with 2.3).
5. Real-Postgres cast test for both callers. Mandatory, because fail-open hides cast errors. It belongs with item 1 so the extraction is proven before anything builds on it.
6. Filing the TOPIC-002 follow-up. Move it to the consolidated follow-ups (see F1).

**O3. 2.6 should be split.** It covers four unrelated concerns: response no-leak, rate-limit passthrough, the permanent lock-gate source test, and the "no admin sequence reaches zero" invariant. The invariant test is independent of the new route (it guards existing `TOPIC_LAST_ACTIVE` plus the lock gate). It can be written first and run at the start of group 2 to prove the precondition the whole carve-out rests on. If it finds a path, the design is invalid, and that is better known before building. Its "git diff shows no change to the lock gate" duplicates 7.2.

**O4. 2.10 is independent of the endpoint and conflicts with 3.2.**
- It fixes a pre-existing defect in `routes/content.ts` and is independently shippable. 3.2 edits the same handler. Place 2.10 and 3.2 adjacently, or put 2.10 before the endpoint as a standalone fix that can merge on its own. Only its end-to-end "assign, then GET all" assertion needs 2.2. The rest can use direct fixtures, and that split lets the fix land even if the endpoint slips.

**O5. Group 3 has no docs task, but the preamble says each group lands its own docs.** 2.8 documents the endpoint; nothing documents the `canAssignDefaults` flag on TOPIC-002. Add it to 2.8 or to group 3. Also, 2.8 should follow the 2.9 split, since it documents `NOT_AN_ADMIN` and the error vocabulary.

**O6. 1.3 is mislabeled as a pre-build gate.** It says "implementation may proceed, merge waits", so it is a merge gate, not a build gate, yet it sits in a group headed "stop if any item fails". Move it to the end (or the Workflow follow-up) so no one blocks on it. Ratification items 5 and 8 decide whether 2.0 and the helper extraction stand, which is a reason to put the extraction first (B1), so a rejection is cheap.

**O7. Group 1 is described as "read-only" but is not.** 1.1 records results in the file, 1.2 "fixes any error" in the specs, and 1.5 can add a task. Say "no production code" instead. Also note where a conditional 1.5 task would be inserted (group 4, same file as 4.1) and what blocks on it.

**O8. 2.0 bundles two things.** `copyCanonicalDefaults` returning ids plus the new error is a change to shared team-creation code (needs the "existing tests unmodified" regression guard). `isApplicationAdmin` is a new auth predicate. Separate them. The predicate is also consumed by 3.2, so it is a cross-group dependency that deserves its own line.

**O9. 4.1 and 4.2.** 4.1 is independent of the endpoint and can run in parallel with group 2. 4.2 genuinely depends on 2.2 and 4.1. Mark 4.1 as parallelizable. Note for 4.1: its mocking of `topic-lock-helper` as a whole module is a known trap, so the lock-state read after ROLLBACK needs a test that fails if the read moves back inside the transaction.

## Gaps (missing tasks)

- **G1. Escape-at-render verification.** The proposal accepts "template content propagates to a team that did not review it" on the strength of existing escape-at-render. 6.2 lists it only as a checklist item. No task verifies it for the consumers that now receive the text (Topic Management, session snapshot, audit/log consumers). Add a small test or a recorded check.
- **G2. Deploy ordering.** The migration plan says deploy backend and shared types before the frontend. No task or checklist item records this, or the rollback (remove route and flag). Add it to 6.2's checklist.
- **G3. Limiter failure behavior.** Redis unavailable means the topic-write limiter returns fail-closed 503 and the denial limiter fails to "no row". 2.9 tests the second; nothing tests that the two limiters interact correctly (a 403 caller consumes no topic-write budget). Add one test.

## Follow-up consolidation

**F1.** Follow-ups are scattered: 2.9 (TOPIC-002 bound), 2.10 (restore collision), 5.4/7.5 (draft copy), 7.4, 7.6. File them all in one task, 7.4, and have the earlier tasks only record "to be filed". 7.4's instruction to "reference its number in the proposal" is an edit to an already-reviewed artifact, so make it explicit.

**F2.** 6.4 repeats 1.2. Keep 6.4 and make 1.2 say "baseline run".

## Proposed order

1. Group 1 (1.1, 1.2, 1.4, 1.5, 5.4 read-only look). 1.3 moves to a merge gate at the end.
2. Invariant test from 2.6 (guards the premise).
3. Denial-audit helper extraction, TOPIC-002 refactor, op registration, real-Postgres cast test (2.9 part 1).
4. `copyCanonicalDefaults` ids and error (2.0a), `isApplicationAdmin` (2.0b), assign-defaults response type (3.1a).
5. One red-first suite for the route (2.1, 2.3, 2.5, 2.6 remainder, 2.7), then 2.2, then 2.9 limiter and 403 wiring.
6. 2.4 real-Postgres concurrency, then 2.10 plus 3.1b/3.2 together (flag type, handler, parity tests), then 2.8 docs.
7. 4.1 (can start earlier in parallel), 4.2.
8. API client task (B4), 5.1, then 5.2 and 5.3 as one unit, 5.5.
9. Group 6, then 7.x and consolidated follow-ups, then the merge gate (old 1.3).

## What is already right

Server-side authorization with a live role read, the precondition checked under the advisory lock after the lock as a fresh statement, the no-migration finding, deploy order for the fail-closed flag, the permanent source tests for the lock gate, and the real-Postgres concurrency test being non-skippable are all well sequenced and match my concerns about authorization enforced at the server and a defined behavior under failure. The Redis-outage behavior (503 fail-closed) is stated in design Risks; I would like it carried into the runbook (6.2) as a named scenario, since I will not sign off on a runbook that omits it.
