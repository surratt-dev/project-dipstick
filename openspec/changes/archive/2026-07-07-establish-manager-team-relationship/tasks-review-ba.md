# Tasks Review — BA (Marcus Delgado)

**Change:** establish-manager-team-relationship
**Reviewer:** Marcus Delgado, Senior Business Analyst
**Review date:** 2026-07-06

---

## Summary Verdict

The tasks list covers the core mechanics of this change well. The TEAM-006 endpoint, the first-access global_role mechanism, the escalation path, the labeled sections, and the vote attribution boundary each have explicit, verifiable tasks. The prerequisite gate structure in section 1 is correct and the end-to-end verification in section 9 is appropriately scoped.

There are five gaps where something the proposal commits to delivering is either absent from the tasks list, present with language weaker than the proposal requires, or dependent on a confirmation that has no corresponding gate task. These are itemized below in descending order of severity.

---

## Gaps

### GAP-1 — No Tasks for EM-Facing UI Views (High)

The proposal makes this explicit: "New EM-facing UI views for session history, trend data, and action items built in this change." The Resolved Decisions section doubles down: "When this change is complete, an Engineering Manager with an established team association can navigate to trend data and session history in the application — no follow-on change is required for basic EM view access."

Section 5 of the tasks list covers server-side authorization and API endpoint behavior. It does not contain a single task for building the front-end components that EMs actually navigate to. The acceptance test in task 5.9 tests the API response but does not test that an EM user can navigate to a history or trend view in the running application.

This is not a minor omission. The capability is described as: "EM-authenticated access at existing session history / trend / action item endpoints." If the API is unlocked but there are no routes, pages, or navigation surfaces for an EM, the capability is not delivered. The proposal was explicit that this change delivers the views, not a follow-on. The tasks list does not reflect that commitment.

**Resolution needed:** Add tasks for:
- Build session history view for EM (route, data fetch, field-constrained display)
- Build trend data view for EM
- Build action items read-only view for EM
- Acceptance test: EM user can navigate to each view in the running application and the views render with the correct field constraints enforced

### GAP-2 — Access Model Statement Surface Weakened to "Or" (High)

Task 7.1: "Implement the access model statement ... in the team view **or** session lobby."

The proposal says: "The statement appears in both the team view (persistent reference) and the session lobby (contextual, where the question most naturally arises during a session). Both surfaces are explicitly in scope. Acceptance criteria must verify both."

"Or" is not "and." An implementation that puts the statement only in the team view satisfies task 7.1 but does not satisfy the proposal. The session lobby placement is not optional — the proposal calls it the surface "where the question most naturally arises during a session." That is the moment when a participant might genuinely need to know whether their EM can observe what is happening.

Task 7.3 tests that the statement does not interrupt normal flows. There is no test verifying the statement is present in both the team view and the session lobby. A team that ships the team view placement and skips the session lobby placement would pass all tasks as currently written.

**Resolution needed:** Task 7.1 must change "or" to "and." Add a test that confirms the statement is present in the session lobby, separately from confirmation of its presence in the team view.

### GAP-3 — TEAM-003 Acceptance Criterion Has No Task (Medium)

The proposal's Impact section states explicitly: "A test that calls TEAM-003 after a successful TEAM-006 confirms the target user appears in `engineeringManagers` and does not appear in `members`. For a user who was previously a participant and is subsequently established as EM via TEAM-006, TEAM-003 must show that user in `engineeringManagers` only — their `team_memberships.role` is updated in place, so they do not appear in `members`."

The proposal marks this as an acceptance criterion — not guidance, not a note. The tasks list does not contain a task for this test. Task 9.4 verifies that a historical participant's prior session records are retained, which is related but distinct. The TEAM-003 response shape after TEAM-006 is a contract-level check; it confirms both the positive case (EM appears in `engineeringManagers`) and the negative case (EM does not appear in `members`). Neither is tested by any task.

**Resolution needed:** Add a task: "Write test: call TEAM-003 after a successful TEAM-006; confirm target user appears in `engineeringManagers` and does not appear in `members`. Include the case where the target user was previously a participant."

### GAP-4 — Audit Trail Destination Not Gated (Medium)

The proposal's Impact section states: "Audit trail destination must be confirmed before any TEAM-006 implementation task begins." The reason is specific: if TEAM-005 writes to a structured log rather than a database table, the transactional rollback requirement for TEAM-006 — which task 3.6 implements — cannot be satisfied as written. The proposal identifies this as a decision that must precede implementation.

Section 1 of the tasks list gates on five prerequisite decisions. None of them covers audit trail destination. Task 3.6 assumes transactional rollback is achievable without first confirming whether the audit destination supports database transaction semantics. If this is discovered mid-sprint, task 3.6 and the rollback behavior it implements may need to be reworked.

**Resolution needed:** Add a prerequisite task (section 1): "Confirm TEAM-005 audit trail destination (database table or structured log). If structured log: update TEAM-006 audit spec to remove transactional rollback requirement and document the alternative. Decision documented before TEAM-006 implementation begins."

### GAP-5 — Use Case Precondition Language Correction Missing (Low)

The proposal identifies two corrections required in the use case documents before implementation begins. Task 1.1 covers one of them: updating the authorized actor from Facilitator to Application Admin. The second correction is not covered by any task.

The uncovered correction: "The 'Establish a Manager/Team Relationship' use case precondition must clarify that TEAM-006 establishes the `team_memberships.role = 'engineering_manager'` row only, and that `users.global_role = 'engineering_manager'` must pre-exist as a separate precondition; the current language implies the team relationship IS the mechanism that establishes the role, which is incorrect."

This is a buildable-requirements concern. If an engineer reads the use case precondition as currently written, they may implement TEAM-006 to both write the `team_memberships` row and set `global_role` — collapsing two separate mechanisms into one. That would conflict with the first-access spec update in section 2 and the precondition check in task 3.2.

**Resolution needed:** Extend task 1.1, or add a parallel task: "Correct use case precondition language to state that `users.global_role = 'engineering_manager'` must pre-exist before TEAM-006 is called; TEAM-006 writes only the `team_memberships` row. Update use case document before implementation begins."

---

## What Is Well Covered

These areas map cleanly from proposal to tasks with no identified gaps.

**TEAM-006 endpoint mechanics (section 3):** Authorized actor check, precondition check with differentiated error code, idempotent status codes, 404 vs. 409 distinction, 403 for unauthorized, audit trail in-transaction with rollback, code comments distinguishing TEAM-005 and TEAM-006, and a full test matrix covering all HTTP response cases. The test specification in task 3.9 is complete.

**First-access global_role mechanism (section 2):** All three option paths are represented. The gate condition for this mechanism as a change-wide blocker is correctly captured. Task 2.5 gates Option B on security review. Task 2.3 requires a verifiable end-to-end test. The spec update in task 2.1 correctly ties to the PENDING marker.

**Escalation path (section 4):** The prohibition on a grayed-out control with no explanation is explicit in task 4.2, which requires a specific contact mechanism rather than a generic "contact your admin." Task 4.3 tests the correct user-facing behavior directly.

**Labeled sections (section 6):** Task 6.2 requires section headings that make the non-participant status of EMs legible to someone reading the view. Task 6.3 handles the empty state correctly (incomplete-setup indicator, not an error). Task 6.5 is an acceptance test framed around a never-seen-the-app facilitator — that is the right bar for this requirement.

**Vote attribution boundary (tasks 1.3, 5.3, 5.9):** Devon Calloway's confirmation is gated (task 1.3). Task 5.3 extends the boundary enforcement to the API response, not just the UI — this is correct and matches the proposal's serialization-layer requirement. Task 5.9 is a verifiable acceptance test with a specific, testable formulation.

**Out-of-scope documentation (section 8):** The removal operation is correctly called out as a named follow-on, the interim procedure requires an audit trail, and task 8.4 documents the access-control dependency on the `team_memberships` row.

**End-to-end verification (section 9):** Task 9.2 checks the dual enforcement on session participation. Task 9.3 checks multi-team independence. Task 9.4 checks the historical participant edge case. These cover the proposal's stated concern about the session participation spec's dual check.

---

## Minor Observations

These are not gaps against the proposal's acceptance criteria but are worth flagging for implementation clarity.

**Action item body content review:** The Resolved Decisions section notes that "action item text that attributes a concern to a named engineer remains attribution-adjacent and must still be reviewed before EM-facing display." Task 5.6 implements the action item endpoint with the Q8 decision applied, but no task schedules a content review of action item body text for attribution risk. If this review is expected to happen, it needs a task and an owner. If it is deferred, that deferral should be explicit.

**Multi-team landing experience (task 1.4):** Task 1.4 correctly gates the design on a product owner decision. If the product owner chooses a non-trivial landing approach (e.g., a team selector with its own routing), an implementation task for that surface will need to be added after the decision. The tasks list should note this explicitly so the gap doesn't surface as a surprise after task 1.4 resolves.

**PENDING marker removal for Q8:** The Resolved Decisions section states the PENDING marker in the manager-team-association spec must be replaced with the Q8 decision before implementation begins. No task explicitly covers this spec update. It may be implied by task 8.4, but the Q8 resolution and the access-control dependency documentation are distinct concerns. Consider making the PENDING marker removal a named deliverable in section 1.
