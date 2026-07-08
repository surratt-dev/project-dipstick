# Architectural Task Ordering Review
**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Change:** enforce-access-control-on-team-content
**Date:** 2026-07-07

---

## Summary Verdict

The overall sequencing logic is sound. The migration of Serializer Contracts to Group 4 (before HTTP Endpoint Integration in Group 5) is correct and properly justified by the sequencing note in Group 4. The authorization helper (Groups 1–2) correctly precedes everything that consumes it.

Three issues require resolution before implementation begins. One of them is a blocking gap that would allow content endpoints to reach production in violation of a stated design requirement. The other two are sequencing violations in Group 3 that will either produce untestable tasks or require the implementer to silently defer them to Group 5.

---

## Finding 1 — BLOCKING: Timing Oracle Measurement Has No Task

**What Decision 7 requires:**

Decision 7 of design.md is unambiguous:

> "This is a blocking design requirement, not a known limitation. All content endpoint responses — both authorized and denied — must apply a constant minimum response time floor. The floor must be set at no less than the 95th or 99th percentile of authorized-request latency under realistic database load, not the mean."

And:

> "Required before any content endpoint is deployed to production:
> 1. Measure the latency distribution of authorized requests to the highest-latency content endpoint under realistic database load.
> 2. Select a constant minimum response time floor equal to the 95th or 99th percentile.
> 3. Implement the floor as a constant minimum applied to all responses.
> 4. Document the measurement results and the selected floor value."

**What the task list contains:**

Nothing. No task in any group covers measurement, floor selection, floor implementation, or documentation of these results. The Q-timing-oracle open question is marked "closed" in design.md on the grounds that the requirement is established — but closing the question did not produce tasks that implement the requirement.

**The consequence:**

Group 5 integrates authorization into the first content endpoints. There is no gate between Group 5 completion and production deployment of those endpoints. An implementer who completes all ten groups and passes all tests has done everything the task list asks — and has not satisfied Decision 7.

**Required fix:**

Add a task group (or insert tasks into Group 5) that covers, in order:
1. Measure authorized-request latency distribution on the highest-latency content endpoint under realistic load. Record the 95th and 99th percentile values.
2. Select the floor value. Document the selection and the measurement data it is based on.
3. Implement the constant minimum response time floor applied to all responses on all content endpoints.
4. Verify that an unauthorized (403) response is not detectably faster than an authorized (200) response at the selected floor.

This work must gate production deployment of the first content endpoint, not follow it. If the implementation team cannot implement the floor before the first endpoint is deployed, that is an explicit deferral decision that must be named and approved — not a gap in the task list.

---

## Finding 2 — Tasks in Group 3 Have a Forward Dependency on Group 5

**The problem:**

Group 3 is placed before Group 5. Two tasks in Group 3 require the authorization helper to already be integrated into session content endpoint handlers — but that wiring is done in Group 5, not before.

**Task 3.2:**

> "Update session content endpoint handlers to treat an `admin` grant as unauthorized: when the handler receives `{ path: 'admin' }` from the helper, it returns 403."

A handler can only "receive `{ path: 'admin' }` from the helper" if the helper is being called from that handler. Calling the helper from content handlers is the work of Group 5. As written, Task 3.2 cannot be completed in Group 3 — the infrastructure it modifies does not yet exist.

**Task 3.5:**

> "Add `audit_log` writes for any Application Admin request to a session content endpoint, regardless of HTTP response code."

Same issue. An audit write for an admin request to a session content endpoint requires that endpoint to be calling the helper and returning a grant. That happens in Group 5.

**Task 3.7 (partial):**

The integration test "Application Admin gets... 403 on session history, 403 on trend data, 403 on action items" requires the session content endpoints to be integrated with the authorization helper. The "200 on membership list" assertion does not require Group 5. The test as written cannot pass in Group 3.

**What is correctly placed in Group 3:**

Tasks 3.1, 3.3, and 3.4 do not have this problem. The admin route guard for administrative data (Task 3.3) and the audit writes for administrative data reads (Task 3.4) operate on endpoints that predate this change and are not session content endpoints. These can and should stay in Group 3.

**Required fix (choose one):**

Option A — Move Tasks 3.2, 3.5, and the session-content portion of 3.7 into Group 5. Group 5 is where the handler wiring happens; admin-boundary enforcement logic belongs alongside the handler integration. Leave Tasks 3.1, 3.3, 3.4, and 3.6 in Group 3. Split Task 3.7 so that the administrative data assertions are in Group 3 and the session content 403 assertions are in Group 5.

Option B — Add a sequencing note to Group 3 that explicitly states Tasks 3.2, 3.5, and 3.7 (session-content assertions) cannot be started until Group 5 is complete. This preserves the group structure but makes the non-linear dependency visible to the implementer.

Option A is structurally cleaner. Option B is acceptable if group renumbering is disruptive. Either way, the dependency must be stated explicitly rather than left for the implementer to discover.

---

## Finding 3 — Group 3 Precedes the Serializers (Group 4) That Its Integration Tests Require

**Task 3.7:**

> "Write integration tests: Application Admin gets 200 on membership list, 403 on session history, 403 on trend data, 403 on action items."

A 200 on the membership list requires only the admin route guard (Task 3.3). A 403 on session history requires both the authorization helper (Group 2) and the endpoint integration (Group 5) — and the endpoint integration requires the serializers (Group 4) to produce a correct 200 for other roles, which validates that the endpoint is wired correctly.

This is a secondary consequence of Finding 2. If 3.7's session-content assertions are deferred until after Group 5 (as recommended in Finding 2), this dependency is automatically resolved.

---

## Finding 4 — Task 4.9 Placement Is Correct

The named integration tests (`facilitator-unrevealed-topic`, `facilitator-revealed-topic`, `layer-removal-serializer-check`, `layer-removal-auth-check`) are acceptance criteria for the two-layer enforcement model. They require the authorization helper (Groups 1–2) and the serializers (Group 4). They do not require HTTP endpoint infrastructure from Group 5.

The sequencing note in Group 4 makes this explicit: "The named integration tests in this group are acceptance criteria before any endpoint integration begins." This is architecturally correct. The reveal/pre-reveal enforcement contract is a property of the serializer module, testable at the module level without an HTTP context.

The `layer-removal-auth-check` test ("Bypass the authorization check → test must fail") is implementable as a direct invocation of the serializer with a mock grant, bypassing the helper call, which demonstrates that the auth layer is structurally necessary. No endpoint is required.

Task 4.9 stays where it is.

---

## Finding 5 — Group 8 Dependency on HTTP Integration Stability Is Implicit, Not Stated

The migration plan in design.md says: "WebSocket integration: Add delivery-time checks to the four named events after the HTTP endpoint integration is complete and stable."

The task list places Group 8 after Group 7, which is after Group 5. The ordering is correct. The issue is that nothing in the Group 8 task descriptions states this dependency. An implementer who reads only the task list could attempt Group 8 concurrently with Group 5.

Task 8.4 specifically calls "the authorization helper" and the team membership check from Path 1/2 — it references the helper module (Groups 1–2), not the HTTP integration. But the helper's stability under load is validated through the HTTP endpoint tests in Group 5. Pushing WebSocket delivery-time checks against an authorization helper that has not yet passed HTTP-level integration tests is a sequencing risk.

**Recommended fix:**

Add a sequencing note to Group 8, parallel to the one in Group 4, stating that Group 8 begins after Group 5 integration tests pass and after the named prerequisite (WebSocket latency bound from the engineering lead) is resolved. The named prerequisite is currently listed in proposal.md but not reflected anywhere in tasks.md as a gate condition.

---

## Finding 6 — Named Prerequisites Are Not Gated in the Task List

Three named prerequisites are documented in proposal.md:

| Prerequisite | Required Before |
|---|---|
| Use case amendment (Marcus Delgado) | Group 1 begins |
| WebSocket latency bound (Engineering lead) | Group 8 begins |
| Facilitator error state UX sign-off (Priya Nair) | Group 9 begins |

None of these appear in tasks.md as gate conditions or checklist items. An implementer who does not read proposal.md has no in-tasks reminder that Group 1 cannot begin without the use case amendment, that Group 8 cannot begin without the latency bound decision, or that Group 9 cannot begin without Priya's sign-off.

These are not implementation tasks, so they should not be task items in the numbered groups. But they should appear at the top of tasks.md as explicit prerequisites with the same visibility they have in proposal.md. If they are not met, the implementation team should be blocked — not just uninformed.

---

## Cross-Group Dependency Matrix — As-Built Assessment

| Dependency | Status |
|---|---|
| Groups 1–2 complete before Groups 4–10 call the helper | Satisfied by ordering |
| Group 4 complete before Group 5 integrates serializers | Satisfied; sequencing note makes it explicit |
| Group 5 complete before Group 8 (WebSocket) builds on stable helper | Satisfied by ordering; dependency is implicit, not stated (Finding 5) |
| Group 5 complete before Group 9 (facilitator error states) modifies endpoint behavior | Satisfied by ordering |
| Group 8 complete before Group 9 (Error State 3 pushes a WebSocket banner) | Satisfied by ordering |
| Timing oracle measurement before first content endpoint reaches production | NOT SATISFIED — no task exists (Finding 1) |
| Tasks 3.2, 3.5, 3.7 (session-content assertions) require Group 5 | NOT SATISFIED — tasks are in Group 3, before Group 5 (Findings 2–3) |
| Named prerequisites gate their respective groups | NOT SATISFIED — not reflected in task list (Finding 6) |

---

## Action Items for the Implementation Team

**Before implementation begins:**

1. Add named prerequisites from proposal.md as explicit gate conditions at the top of tasks.md. Confirm status of the use case amendment with Marcus Delgado before Group 1 is marked in-progress.

**Before Group 5 is marked complete:**

2. Add tasks for the timing oracle measurement, floor selection, floor implementation, and documentation required by Decision 7. These tasks are a prerequisite to any content endpoint reaching production, not a follow-on item.

**Before or during Group 5 re-sequencing:**

3. Resolve the Group 3 forward dependency on Group 5 using Option A (move Tasks 3.2, 3.5, and session-content assertions of 3.7 to Group 5) or Option B (add an explicit sequencing note in Group 3). Document the choice.

**Before Group 8 begins:**

4. Add a sequencing note to Group 8 stating that it begins after Group 5 integration tests pass and after the engineering lead has supplied the WebSocket latency bound.

5. Confirm the WebSocket latency bound prerequisite has been resolved. If delivery-time checks are achievable without a timer fallback, document that confirmation. If a timer is required, the bound must be a specific number in tasks.md before Group 8 is started — not a phrase.

---

*These findings do not affect the soundness of the authorization model itself. The helper design, grant type, serializer separation, and delivery-time WebSocket checks are architecturally correct. The issues are all sequencing and completeness gaps in how the task list represents the implementation order — a task list that has the right intent but would allow specific requirements to be skipped or reached in the wrong order without deliberate attention.*
