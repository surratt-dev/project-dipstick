# Tasks review: Solution Architect (Ingrid Sollenberger)

Scope: task ordering and dependencies in `tasks.md`, read against `design.md` and `proposal.md`.

Verdict: the section order (gate, helper, registry, handler, tests, docs, release) is broadly sound. The core dependency chain holds: helper field first, then registry, then handler. Six items need splitting or reordering before implementation starts. None changes the design.

## Must fix

**1. Task 0.2 is ambiguous about what is committed, and it overlaps task 3.2.**
- 0.2 says "commit the baseline snapshots" before the handler edit. 3.2 is the test that asserts the snapshot, and it also covers "every failure path". Failure paths do not exist until 2.1 and 2.2 are built.
- A reader could read 0.2 as "commit a test that cannot yet be written".
- Split it in two:
  - **0.2 (own commit, handler untouched):** the snapshot fixtures (status, `Content-Type`, body) for both reasons, plus a test that asserts them on the pre-change handler. It must be run and shown green.
  - **3.2:** the failure-path variants (insert error, timeout, missing users row) added after the handler change. They assert against the same committed fixtures.
- Add a rule that 0.2's fixtures are never regenerated in a later commit. A snapshot "update" in the handler commit would defeat the point.

**2. Task 1.1 says "land with 3.7 as one commit", but 3.7 sits two sections later.**
- Move 3.7 (TOPIC-003..007 pass unchanged) into section 1 as 1.1b, or merge it into 1.1.
- Add the helper's direct assertion (already in 1.1) to that same commit.
- Run the TOPIC-003..007 tests before and after the helper change. Passing only after is weak evidence that they are unchanged.

**3. Tasks 2.1 and 2.2 are in the wrong order, and 2.2 hides a refactor.**
- 2.1 describes the handler calling an insert wrapped in `withTimeout`, then emitting. 2.2 then adds `runDenialAuditStep`, the try/catch that supplies the fail-open behaviour. As written, 2.1 builds a handler whose failure semantics are undefined: an insert error would propagate as a 500 until 2.2 lands.
- 2.2 also lifts `sqlstateOf(err)` out of `withAdminAuditFailureSignal`. That edits the fail-closed admin path, which is the highest-risk code in this change.
- Reorder into three steps, each with its own green test run:
  - **2.0 (pure refactor):** lift `sqlstateOf`. No behaviour change. The #259 admin tests must pass untouched, including the admin insert-failure-returns-500 case now in 3.3.
  - **2.1:** add `runDenialAuditStep` and the local insert function. Write them together, since one is meaningless without the other. Include the "try/catch wraps only the insert" constraint.
  - **2.2:** the handler deny branch: call insert-step, emit the event, apply the floor, send, in that order.

**4. Two tasks are verification, not construction, and 3.6 contains a spike that could invalidate itself.**
- **3.6:** "Deleted users row with a live session: first verify the session middleware reaches TOPIC-002" is a precondition check inside a test task. It decides which test shape is built. Pull it up into the section 0 gate as 0.3, with the result recorded. The same applies to D10's stated risk.
- **2.3** ("confirm no query touches teams/topics/annotations") is an assertion already owned by 3.1 and 3.5. Delete 2.3, or reword it as a pointer to those tests. As written it is a manual check with no artifact.

**5. Task 3.9 (`trustProxy`, rate limit) can change the design, so it should not come last.**
- If `request.ip` is not trustworthy, or no limiter covers the route, the Security and Engineer reviewers may want a different `actor_ip` source or a mitigation before the handler is written (D10 and the write-amplification risk).
- It is an investigation, not an implementation test. Move it to the section 0 gate as a read-only finding. The resulting statement is then reused in the PR text.
- 3.8 (the `audit_log` read sweep) is lower risk but has the same shape. Keep it in the PR, but run it before 2.x. A found non-admin read of the whole table would change the visibility requirement, not just the docs.

**6. The tests are batched at the end instead of following their dependency.**
- 3.1 to 3.5 each depend on only one build step. Examples: the 3.1 call-order and floor-clock tests depend on 2.2; the 3.3 failure tests on 2.1; the 3.4 no-added-query test on 2.2; the 3.5 no-leakage test on 2.2.
- Nothing is wrong with the content. But writing them last invites a build-then-retrofit pattern, and the call-order test (the main timing safeguard) is easiest to get wrong retrofitted.
- Recommend writing each test group with the step it exercises. Suggested mapping:
  - After 1.1: helper assertion and the TOPIC-003..007 run.
  - After 2.0: admin 500 regression.
  - After 2.1: failure, timeout and fail-open tests (3.3).
  - After 2.2: call order, floor clock, snapshot, no-leakage (3.1, 3.2, 3.4, 3.5).
  - After all unit tests are green: real-Postgres integration (3.6).
- Keep 3.6 (integration) last among the tests. It needs the registry entry, helper, handler and the real schema, so it is correctly last.

## Smaller points

- **1.2 (registry) has no dependency on 1.1.** They can be done in either order. Registry before handler is right, because the handler's emitted event keys are typed against it. Keep 1.2 before section 2 and note that it is independent of 1.1.
- **1.2 also pins the denial and failure event key sets in a comment.** The test in 3.1 is the real pin. Say so, so the comment is not the only enforcement.
- **4.3 (sync delta specs) should come after section 2 and 3 are green**, not merely after the code exists, so the spec text describes behaviour that actually passes. It is correctly placed; just note the dependency.
- **4.1 (`docs/deployment.md`)** references follow-up numbers and the event counts. Counts depend on 1.2 being final. Fine where it is. It also depends on 5.2 only for placeholders, so it need not wait for it.
- **5.2 (follow-up issue numbers)** replaces placeholders in the proposal and design. That is a doc edit after 4.4 validation, so re-run validation (4.4) after 5.2, or move 5.2 ahead of 4.4.
- **5.3 (usability pass)** needs a built, running change. Correctly last, but state that it cannot run until 5.1 passes.

## Proposed order

0. Gate: 0.1 (done); 0.2 snapshot fixtures plus passing pre-change test, own commit; 0.3 session-middleware reachability finding; 0.4 `trustProxy` and rate-limit finding; 0.5 `audit_log` read sweep.
1. Helper: 1.1 `actorGlobalRole` plus direct assertion plus TOPIC-003..007 unchanged (one commit); 1.2 registry entries.
2. Handler: 2.0 lift `sqlstateOf` (refactor commit, admin tests green); 2.1 `runDenialAuditStep` plus insert; 2.2 deny-branch wiring.
3. Tests, each group landing with its build step as mapped in point 6, then the real-Postgres integration (3.6) last.
4. Docs and specs: 4.1, 4.2, 5.2 (issue numbers), 4.3, then 4.4 validation.
5. Release gate: 5.1, then 5.3.

## No issue

- The dependency direction of the helper change (additive, authorized variant untouched) is sound.
- Keeping the 403 baseline before the handler edit is the right instinct. It is only mis-specified, as noted in point 1.
- The single-statement insert (D4) removes the role-read step, so there is no hidden task for it.
