# Tasks Review: Enforce Access Control on Team Content
**Reviewer:** Marcus Delgado, Senior Business Analyst
**Date:** 2026-07-07
**Artifacts reviewed:** tasks.md, proposal.md (post-review version, 2026-07-07)
**Review scope:** Coverage — do the tasks, taken together, implement all capabilities stated in the proposal? Is anything lost in translation from requirements to tasks?

---

## Overall Assessment

The task list is coherent and detailed. Each group maps cleanly to an implementation concern, and the sequencing note on Group 4 correctly enforces the dependency on serializer contracts before endpoint integration. The unit and integration test tasks are well-placed.

That said, there are four findings that need to be addressed before implementation begins. Two are material gaps — the named prerequisites have no task representation, and the `facilitator-live-session-error-states` capability has no Group 10 coverage. Two are traceability errors — the proposal's internal cross-references for cache prohibition point to wrong task numbers, and the privacy constraint on Error State 4 is partially incomplete in Task 9.5. None of these are foundational problems with the task design, but they are clear enough to act on before any group is marked in progress.

---

## 1. The Six Capabilities — Task Coverage and Cross-Group Fragmentation

The proposal names four capabilities explicitly in the Capabilities section, plus two that emerge from the What Changes list with their own task groups (facilitator session-scoped access and Application Admin boundary). All six have corresponding tasks. The concern is not missing coverage — it is that one capability is spread across groups in a way that makes verification difficult.

| Capability | Groups | Assessment |
|---|---|---|
| `team-content-access` — authorization helper | 2 | Well-contained |
| `team-content-access` — access matrix / serializers | 4 | Well-contained |
| `team-content-access` — HTTP endpoint integration + cache prohibition | 5, 6 | Acceptable; Groups 5 and 6 are adjacent and clearly related |
| Application Admin access boundary | 3 | Well-contained |
| `websocket-session-authorization` | 8 | Well-contained |
| Facilitator session-scoped access (draft + grace window) | 1 (schema), 7 (lifecycle) | Acceptable; Group 1 is schema scaffolding for Group 7's logic |
| `facilitator-live-session-error-states` | 9 | Well-contained |
| `session-participation` (modified) | 2, 5, 10 | Fragmented — see below |

### `session-participation` fragmentation is the only coverage verification problem

The modified `session-participation` capability — the system-wide dual-check pattern — is implemented across three groups: Task 2.3 (implements it), Task 5.9 (verifies no application-session caching for role changes), and Task 10.7 (E2E test). No single location in the task list serves as the verifiable acceptance point for this capability.

The practical risk is that Task 2.3 can be ticked off without Task 10.7 being scheduled, and the modified capability would appear complete while the acceptance criterion remains untested. The proposal added this acceptance criterion explicitly in response to my earlier review issue 2.3, which makes it important that the criterion doesn't get detached from its implementation.

**Recommendation:** Add a cross-reference note on Task 2.3 pointing to Task 10.7 as the acceptance verification for the dual-check pattern, or group all three tasks into a named section. The goal is that a reader checking coverage of `session-participation` cannot close Group 2 without knowing that 10.7 is required.

---

## 2. Named Prerequisites — Not Represented as Tasks

This is the most material finding. The proposal's Named Prerequisites table lists three blocking prerequisites with specific owners and gating requirements. None of them appear in tasks.md. They cannot be ticked off, they are not in sequence with the groups they gate, and there is no mechanism in the current task list that prevents Group 1, Group 8, or Group 9 from starting before their prerequisites are satisfied.

| Prerequisite | Gates | Status in tasks.md |
|---|---|---|
| Use case amendment (Marcus Delgado): replace "Access does not persist after session ends" with grace window language; add `draft` as valid access path in Alternate Flows | Group 1 begins | No task |
| WebSocket latency bound (Engineering lead): state a measurable maximum latency for the timer-based fallback in "no more than X seconds from database commit" form | Group 8 begins | No task |
| Facilitator error state UX sign-off (Priya Nair): review and approve error message text and recovery path for all four named error states | Group 9 begins | No task |

These prerequisites have owners and are time-bound to specific groups. As untracked items outside the task list, they are at risk of being resolved informally — or not at all — before implementation runs past them.

**Required action:** Add three tasks, one per prerequisite, placed immediately before the group each gates. Suggested placement:

- Before Group 1: *"Amend use case 01 - Identity and Access - Use Cases.md: replace the Notes statement 'Access does not persist after the session ends' with language reflecting the 30-minute facilitator grace window; add `draft` session as a valid access path in the Alternate Flows section. Owner: Marcus Delgado."*
- Before Group 8: *"Engineering lead to specify a measurable maximum latency for the WebSocket timer-based fallback (e.g., 'no more than 60 seconds from database commit to event cessation') or confirm delivery-time checks are achievable without a timer. The bound must be stated in 'no more than X seconds from database commit' form before any Group 8 task is marked in progress."*
- Before Group 9: *"Priya Nair to review and approve error message text and recovery path for all four named facilitator error states (proposal.md, Capabilities section, `facilitator-live-session-error-states`). No Group 9 task may be marked in progress until sign-off is confirmed."*

Without task representation, "Status: Open" in the proposal table is the only tracking mechanism — and that field does not update as the implementation proceeds.

---

## 3. Task 9 — Completeness Against the Four Named Error States

Task 9 implements all four named error states and has a verification task (9.6) for each. The implementation coverage is correct. Two narrower issues follow.

### 3.1 Error State 4 privacy constraint: team ID omitted from Task 9.5

The `facilitator-live-session-error-states` capability in the proposal states: "the response body must not include the requested team ID, team name, or any identifier that confirms the team exists."

Task 9.5 reads: "Verify that Error State 4 response does not mention Team A by name or confirm Team A's existence."

The task covers name and existence confirmation but does not explicitly call out the team ID. "Confirm Team A's existence" might be read broadly enough to include the ID, but a developer writing a test for this task would naturally check for the name, not necessarily for a numeric or UUID identifier in the response body. The proposal's privacy constraint is precise; the task is less so.

**Recommended fix:** Revise Task 9.5 to read: "Verify that Error State 4 response does not include Team A's team ID, team name, or any other identifier that confirms Team A's existence."

### 3.2 Priya Nair sign-off has no gating mechanism in Group 9

The proposal states: "Facilitator error message text and recovery path UX must be reviewed and approved by Priya Nair before Group 9 implementation begins (see Named Prerequisites)." Group 9 has no task or note that reflects this gate. As written, an implementer could begin Task 9.1 without knowing that Priya's sign-off is required first.

This is addressed by the prerequisite task recommended in Finding 2 above. If that task is added, Group 9 acquires the gate it needs.

---

## 4. Cache Prohibition — Three Layers Are Present, Cross-References Are Wrong

All three cache prohibition layers have corresponding tasks:
- HTTP layer (`Cache-Control: no-store`): Task 5.7
- ORM-level query cache prohibition: Task 5.8
- Application-session cache prohibition: Task 5.9

The coverage is correct. The problem is that the proposal text cross-references the wrong task numbers.

In the Capabilities section under `team-content-access`, the proposal states:

> "HTTP-layer prohibition (Cache-Control: no-store) is covered by Task 4.7. ORM-level query cache prohibition and application-session cache prohibition must be separately verified — see Tasks 4.8 and 4.9."

In the Review Feedback Resolutions section, it states:

> "Tasks 4.8 and 4.9 have been added to tasks.md to cover ORM-level and application-session cache prohibition verification, which Task 4.7 (HTTP layer only) did not address."

These references are incorrect. In tasks.md, the 4.x tasks are serializer work:
- Task 4.7 is the serializer unit test (not an HTTP cache task)
- Task 4.8 is the TypeScript type-distinctness check
- Task 4.9 is the named layer-removal integration tests

The cache prohibition tasks are 5.7, 5.8, and 5.9 — in Group 5 (HTTP Endpoint Integration). The proposal's cache prohibition cross-references are synchronized to a prior version of the task list and do not match the current tasks.md.

**Required action:** Update the proposal's Capabilities section and Review Feedback Resolutions section to reference Tasks 5.7, 5.8, and 5.9 (not 4.7, 4.8, and 4.9) for the three cache layers. The underlying task coverage is correct; only the cross-references need to be corrected.

**End-to-end verification of cache prohibition is also present:** Task 10.6 (role change takes effect without re-authentication) and Task 10.8 (ORM-level cache via query logging) provide integration-level verification of the behavioral and mechanism requirements. This is adequate.

---

## 5. Group 10 — End-to-End Coverage Across the Six Capabilities

Group 10 provides integration-level coverage of five of the six capabilities. One capability is absent.

| Capability | Group 10 task(s) | Status |
|---|---|---|
| `team-content-access` — authorization paths and role shapes | 10.1, 10.5, 10.7 | Covered |
| `team-content-access` — consistent 403/404 | 10.2 | Covered |
| `team-content-access` — cache prohibition | 10.6, 10.8 | Covered |
| Application Admin access boundary + audit trail | 10.9 | Covered |
| `websocket-session-authorization` — revocation | 10.3 | Covered (revocation path) |
| `websocket-session-authorization` — all four events, all role types | None | Partial — see below |
| `session-participation` (modified) — dual-check | 10.7 | Covered |
| Facilitator session-scoped access — draft + grace window scenarios | 10.1, 10.4 | Covered |
| `facilitator-live-session-error-states` | None | Missing |

### 5.1 `facilitator-live-session-error-states` has no Group 10 task

Task 9.6 requires "facilitator UX tests for each named error state." These are unit/component-level tests, not integration-level E2E tests. Group 10 does not include any test that exercises the four error states through the full stack — authorization failure during reveal, historical data unavailability returned as empty-state (not 403), session status transition producing a non-blocking banner, and cross-team denial with the required message text.

Group 10's scope is "End-to-End Authorization Tests," and the four facilitator error states are end-to-end behaviors. An error state test that only passes because the correct message was returned at the component level, without verifying the full request path, is not an E2E test.

**Recommended fix:** Add a task to Group 10 — for example, "10.10 Test facilitator-live-session-error-states end-to-end: verify each of the four named error states through a direct API call (no frontend), confirming correct message content, HTTP status code, and that the live session is not interrupted for Error States 1 and 2." This makes the capability visible in the E2E group alongside the others.

### 5.2 WebSocket E2E coverage is limited to revocation

Task 10.3 tests that a removed subscriber stops receiving events. It does not test that an authorized subscriber receives the correct event payload, or that an unauthorized subscriber is correctly denied. Group 8 (Task 8.10) covers this at an integration level for all four events, so the coverage exists — but it exists in the implementation group rather than the E2E group.

This is a lower-priority finding than 5.1. The four-event coverage in Task 8.10 is substantive. The question is whether Group 10's role is to re-verify it at a higher level. I would prefer a note on Task 10.3 that explicitly references Task 8.10 as the four-event coverage rather than leaving it implicit.

---

## 6. Items That Are Correctly Implemented

The following are working well and require no action:

- **Group 4's sequencing note** is correctly placed and its dependency statement is clear. The named integration tests in 4.9 (layer-removal tests for both auth and serializer) are exactly the right form: they exist to prove that each protective layer is necessary, not just present.
- **Task 2.4's SQL check** is fully specified in the task text, matching the grant path logic described in the proposal. No ambiguity for the implementer.
- **Task 2.8's boundary conditions** (grace window at expiry and just before, `draft` within and beyond 24 hours) are enumerated explicitly. This is the right level of specificity for a unit test task.
- **Task 7.4's split between lazy expiry (security property) and background cleanup (operational)** is a clear and correct distinction. Making that distinction explicit in the task text prevents a misreading where the background task is treated as required for security.
- **Tasks 3.4 and 3.5** correctly specify that audit log writes use `grant.actorGlobalRole` from the grant object rather than re-querying the users table — this is a subtle but important detail that prevents a double-read and ensures the audit entry reflects the access claim that was evaluated.

---

## Summary of Actions Required

| Finding | Action | Priority |
|---|---|---|
| Three named prerequisites have no task representation | Add one blocking task per prerequisite, placed before the group each gates | Required before any group begins |
| Proposal cross-references Tasks 4.7/4.8/4.9 for cache prohibition, but those task numbers belong to Group 4 serializer work; actual cache tasks are 5.7/5.8/5.9 | Correct cross-references in proposal.md | Required for traceability |
| `facilitator-live-session-error-states` has no Group 10 E2E task | Add Task 10.10 for E2E coverage of the four error states | Required before Group 10 begins |
| Task 9.5 does not explicitly name the team ID as an excluded field in the Error State 4 privacy check | Add "team ID" to Task 9.5's verification criteria | Required before Group 9 begins |
| `session-participation` implementation is split across Groups 2, 5, and 10 with no cross-references | Add a cross-reference on Task 2.3 pointing to Task 10.7 as the acceptance verification | Recommended |
| Task 10.3's WebSocket revocation test does not reference Task 8.10 as the four-event coverage source | Add a note on Task 10.3 referencing Task 8.10 | Recommended |

---

*This review covers requirements and business analysis traceability only. Technical architecture, security control adequacy, and implementation approach are in scope for other reviewers on this change.*
