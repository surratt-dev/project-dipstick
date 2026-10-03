# Tasks Review: Business Analyst (Marcus Delgado)

**Artifact:** `tasks.md` (with `proposal.md` and the three spec deltas)
**Focus:** Do the tasks cover every capability in the proposal and every spec scenario, without losing anything between requirement and task?
**Verdict:** **Approve once B1 and B2 are fixed.** Both are small wording fixes to existing tasks. Neither needs a new task section.

I checked the tasks against the existing test files as well as the specs. Two of my findings only show up there: the current fixtures do not do what the task wording assumes.

---

## Blocking

### B1: The main defect case (EM by both signals, path 2) has no unit test that checks the "no query ran" clause

The first `team-content-access` scenario is the defect in #187: a user with `global_role = engineering_manager` **and** an `engineering_manager` membership. It requires a `403` **and** that "neither the `topics` query nor the customization-lock check is executed."

Task 4.1 says to flip the existing test "is present regardless of caller role — engineering_manager grant" (`content.test.ts` ~357) and add the call-count/SQL check. The task reads as though that test is the path-2 case. It is not. That test uses `mockMemberGrant("engineering_manager")`, and that helper (line 59) hard-codes `global_role: "engineer"`. So the test exercises **path 2'**, which 4.2(a) already covers.

As written, then:
- Path 2' gets two unit tests (4.1 and 4.2(a)).
- Path 2, the case real managers will actually hit, gets only the S1 integration test (4.6). That test checks the status and the annotation text, not the "no query ran" clause.

**Fix:** In 4.1, require the flipped test to use the 4.0 helper with `globalRole = "engineering_manager"` and `membershipRole = "engineering_manager"`. State whether `team.access_grant_mismatch` should fire there; for path 2 I expect it not to. 4.2(a) then stays the only path-2' unit case.

### B2: Task 4.0's list of TOPIC-001 member-path tests to migrate is missing one

Task 4.0 lists three member-grant TOPIC-001 tests to move onto the new fixture (~316, ~331, ~370). A fourth exists: `"does not select team_annotation or its provenance"` (`content.test.ts` ~818, the R7 describe block at ~815). It also calls `mockMemberGrant("participant")` and then queues positional mocks.

Once the new membership read is added, the topic-row mock is consumed by `readActiveMembershipRole`. That read returns a row with no `role`, so the predicate denies, and the test fails with `403` instead of `200`. Task 6.2 would catch the failure, but 4.0 reads as a complete list. This is also the unit test behind the `topic-annotation` scenario "TOPIC-001 carries no annotation fields". If an implementer "fixed" it the wrong way (for example by loosening the status assertion), that scenario would lose its unit coverage without anyone noticing.

**Fix:** Add ~818 to 4.0's list. Also add `expect(res.statusCode).toBe(200)` as the first assertion, for the same reason given in 4.9 (it already has one, so just keep it).

---

## Non-blocking

- **N1: The S1 rewrite (4.6) needs to say which assertions go.** The S1 test at `topic-annotation-integration.test.ts` ~533–542 also calls `res.json().topics.some(...)` and loops over `topics`. On a `403` body, `topics` is undefined, so those lines will throw. 4.6 should say: remove the `topics` assertions, keep `not.toContain(annotation text)`, and add `not.toContain("isCustomizationLocked")` plus a check that the topic name is absent. That last check is what the spec scenario "No annotation text reaches a denied engineering manager" asks for ("any topic name, or `isCustomizationLocked`"). No task currently asserts that the topic **name** is absent from the response body.
- **N2: Template-team EM (4.8) covers membership only.** The scenario says "by membership or global role". Add the global-EM-with-participant-membership variant to 4.8, or note that 4.2(b) covers the logic and 4.8 only proves the template team ID is not special-cased.
- **N3: The denial event's metadata contract is specified but not tested.** The spec says the `topic.config_read_denied_role` event carries `userId, teamId, grantPath, actorGlobalRole, membershipRole, reason`, never topic data, and is emitted *before* the response. Tasks 4.1/4.2 assert only that the event fired and its `reason`. Add one assertion (in 4.1 is fine) on the exact metadata key set. A future "helpful" addition of topic IDs to the event would then fail a test instead of depending on review.
- **N4: The 200 regressions in 4.3 should assert the response body.** The spec scenarios for participant, facilitator, and global-facilitator-with-participant-membership all say "`200` with `teamId`, the team's active topics, and `isCustomizationLocked`". 4.3 says only "200, no denial event". Ask for `teamId`, a non-empty `topics`, and a boolean `isCustomizationLocked` in each case. That is the lock-spec requirement "present on every 200 for every admitted caller", and only the original member and facilitator tests check it today.
- **N5: Half of the modified admin scenario has no task.** "Application Admin reads topic configuration through TOPIC-002, not TOPIC-001" has a TOPIC-002 half: the admin receives the configuration. Existing tests cover it (`content.test.ts` ~719–767, `topic-add-admin-integration.test.ts` ~147). The traceability just needs a line in 6.2 naming them as the regression evidence, so the scenario does not look untested.
- **N6: The release summary line is not assigned.** The proposal drafts a release summary line ("TOPIC-001 now denies engineering managers and Application Admins … No user-visible change."). Task 6.5 puts only the Follow-ups pointer in the PR body. Add the summary line to 6.5, or the exec review's "one line in the release summary" condition gets lost.
- **N7: There is no check for "never the cross-team facilitator message".** This is covered implicitly, because 4.5 requires a body identical to the null-grant denial. That is acceptable. I am noting it so nobody weakens 4.5 to "same status" later.

---

## Proposal capability → task traceability

| Proposal item | Tasks | Status |
|---|---|---|
| Explicit allow-list, future grant variants denied | 3.1 (`never` default), 3.3 | Covered |
| OR-semantics EM definition | 3.1, 3.2, 4.1, 4.2(a–d) | Covered (see B1) |
| Facilitator grant not denied by membership; facilitator with EM membership denied | 3.1, 3.2, 4.2(d), 4.3 | Covered |
| Unconditional, pure predicate | 3.1, 4.11, 6.3, 6.4 | Covered |
| Non-revealing denial (envelope, no-store, timing, no queries, log event) | 3.3, 3.5, 4.1, 4.5 | Covered (see N3) |
| Admin denial confirmed, audit row kept | 4.4, 5.1, 5.5 | Covered |
| Contract reconciled (note, scope line, 403/404 rows, path-id note, matrix) | 5.1, 5.3, 5.4, 5.5 | Covered |
| camelCase deferred with an "As built" note and tripwire | 5.2, 4.9 | Covered |
| Stale "admits engineering managers" text removed (contract, spec, `content.ts`, `topic.ts`, S1 comment) | 5.2, delta spec, 3.4, 5.6, 4.6, grep in 6.3 | Covered |
| `readActiveMembershipRole` export + unit test | 2.1, 2.2 | Covered |
| New audit event name | 3.5 | Covered |
| Fixture migration for positional mocks | 4.0 | **Incomplete (B2)** |
| Follow-ups referenced in the PR | 6.5 | Covered |
| Release summary line | none | **Gap (N6)** |

## Spec scenario → task traceability

### `team-content-access` (ADDED requirement)

| # | Scenario | Tasks | Status |
|---|---|---|---|
| 1 | EM by membership and global role denied (no topics/lock query) | 4.1, 4.6 | **Gap (B1)**: 4.1's fixture is path 2', and 4.6 does not check the query clause |
| 2 | EM membership, non-EM global role denied (+ mismatch event, `membership_em`) | 4.2(a), 4.7 | Covered |
| 3 | Global EM, participant membership denied (`global_em`) | 4.2(b), 4.7 | Covered |
| 4 | Global facilitator with EM membership denied (+ mismatch event) | 4.2(d) | Covered |
| 5 | Global facilitator with participant membership → 200 | 4.3 | Covered (see N4) |
| 6 | Facilitator drifted to EM denied | 4.2(c) | Covered |
| 7 | Participant member keeps access (engineer, senior_engineer) | 4.3 | Covered (see N4) |
| 8 | Eligible facilitator keeps access | 4.3, existing ~344, 4.8 (`topics-integration`) | Covered |
| 9 | Admin denied with one audit row | 4.4 | Covered |
| 10 | Admin with EM membership takes the admin path | 4.4 | Covered |
| 11 | Non-canonical teamId → 404 before gate | 4.10 | Covered |
| 12 | EM denial indistinguishable from no-relationship denial | 4.5 | Covered |
| 13 | Failed membership read does not admit | 4.12, 2.2, 3.2 | Covered |
| 14 | No annotation text, topic name, or lock flag reaches a denied EM | 4.6, 4.7, 4.1 | Partial (see N1: topic name not checked) |
| 15 | Template-team EM denied; participant still gets 200 | 4.8 | Partial (see N2: global-role variant) |
| 16 | No configuration value can admit EMs | 4.11, 6.3, 6.4 | Covered |
| — | Requirement text: missing or unrecognised membership role denies | 4.2(e), 3.1 equality | Covered |
| — | Requirement text: `team.access_grant_mismatch` still fires | 4.2(a), 4.2(d) | Covered |
| — | Requirement text: event metadata and its exclusions | 3.5 | Specified, not tested (N3) |

### `team-content-access` (MODIFIED: Application Admin requirement)

| Scenario | Tasks | Status |
|---|---|---|
| Admin can access membership list | unchanged, existing tests | Not affected |
| Admin denied trend data | unchanged | Not affected |
| Admin self-add detectable | unchanged | Not affected |
| Admin reads via TOPIC-002, not TOPIC-001 | 4.4 (TOPIC-001 half); TOPIC-002 half covered by existing tests | Covered by existing tests, which no task names (N5) |

### `topic-annotation` (MODIFIED)

| Scenario | Tasks | Status |
|---|---|---|
| TOPIC-001 carries no annotation fields | Existing R7 unit (~818) + integration (~457), run under 6.2 | Covered, **but the unit test breaks unless B2 is fixed** |
| EM never sees the annotation through TOPIC-001 | 4.6, 4.7 | Covered (see N1) |
| Requirement text: tripwire test must be flipped on purpose | 4.9 | Covered |

### `topic-customization-lock` (MODIFIED)

| Scenario | Tasks | Status |
|---|---|---|
| Locked team includes `isCustomizationLocked: true` | 4.0 (migrates ~316) | Covered |
| Unlocked team includes `isCustomizationLocked: false` | 4.0 (migrates ~331) | Covered |
| Denied caller gets no lock state; lock check not run | 4.1, 4.2 (SQL/call-count check), 3.3 | Covered |
| Requirement text: flag present for every admitted caller | existing ~344 (facilitator), 4.3 | Partial (see N4) |

---

## Closing note

Requirements to tasks is in good shape. Every behavioural clause I added at proposal review (B1 and N1–N8 there) has a task. The two blocking items are both cases where the task text assumes something about the existing test fixtures that is not true. This is exactly the kind of thing that turns into "the test passed, so the scenario is covered" when it is not. Fix the two task descriptions, and I have no objection to implementation starting.
