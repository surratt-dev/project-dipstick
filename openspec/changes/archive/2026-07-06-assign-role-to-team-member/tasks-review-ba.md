# BA Review: tasks.md Coverage Against Proposal and Design

**Reviewer:** Marcus Delgado, Senior Business Analyst
**Date:** 2026-07-06
**Artifacts reviewed:** proposal.md, design.md, tasks.md, design-review-engineer.md, design-review-security.md

---

## Purpose

This review answers two questions: (1) Do the tasks, taken together, cover all capabilities stated in the proposal? (2) Are the items added or clarified during design review represented as tasks? I check each capability condition individually and each named design-review addition individually.

---

## The Six Capability Conditions

The proposal defines the `role-assignment` capability as complete when six conditions are independently satisfied. I check each one for at least one implementation task and at least one verification task.

---

### Condition 1: Member Management View

> A team's members are displayed in a list view with each member's current role labeled as "Engineer" or "Engineering Manager." The view is accessible to an authorized actor before a session begins.

**Implementation task:** 5.1 covers this.

**Verification gap:** There is no verification task that specifically confirms the member list renders current role labels correctly for existing members. Tasks 7.1 and 7.2 are end-to-end flows that pass through the view, but they test designation and demotion — they do not verify that the view displays roles correctly before any change is made. The proposal's condition includes "accessible to an authorized actor before a session begins," and no task tests that access point independently. A dedicated verify task is missing for the list display itself.

**Status: Implementation covered. Verification incomplete.**

---

### Condition 2: Role Selector with Inline Descriptions

> The role selector presents exactly two options — "Engineer" and "Engineering Manager" — each with an inline description. No other roles are selectable.

**Implementation tasks:** 5.2 (two options, no Facilitator) and 5.3 (inline descriptions) cover this.

**Verification gap:** Task 7.8 verifies the role selector contains exactly "Engineer" and "Engineering Manager" under all rendering conditions. It does not verify the inline descriptions appear in the rendered output. The inline descriptions are a stated acceptance criterion in the proposal (they are part of what makes the capability complete) and they require a separate verify step. No task checks this.

**Status: Implementation covered. Verification incomplete — inline descriptions not verified.**

---

### Condition 3: Pre-Action Zero-Participant Warning

> When a role change would result in zero members with `membership_role = 'participant'`, the specified message is displayed before the confirmation step. The warning does not block the change.

**Implementation tasks:** 4.3, 5.4, 5.5 address this.

**Critical inconsistency — tasks describe a superseded mechanism:** Design.md Decision 5 explicitly states that Task 4.3's original description is wrong and supersedes it. The design decision specifies a two-submission flow: the first PATCH with no confirmation flag returns `422 Unprocessable Entity` with `{ "requiresConfirmation": true }` and does not apply the change; the second PATCH with `confirmedZeroParticipant: true` applies the change. Task 4.3 still describes the old approach — the change proceeds and returns `zeroParticipantWarning: true`. Task 5.4 still references checking for `zeroParticipantWarning: true`. These tasks reflect a mechanism the design explicitly rejected. An implementer reading tasks.md and design.md simultaneously will find them in direct contradiction.

**Also missing:** Design Decision 5 requires the participant count check and the UPDATE to execute within a single database transaction (to prevent a race where two concurrent role changes both pass an independent pre-flight check and together produce a zero-participant state). No task captures this transaction requirement.

**Verification tasks:** 7.5 covers the observable behavior (warning appears before confirmation, does not block). If the implementation tasks are corrected to match the design decision, 7.5's verification criteria remain valid.

**Status: Implementation tasks describe a superseded mechanism — must be rewritten. Transaction requirement absent. Verification acceptable if implementation is corrected.**

---

### Condition 4: Plain-Language Confirmation

> After a successful role change, the application displays a confirmation naming the person and their new role.

**Implementation task:** 5.6 covers this.

**Verification gap:** No verification task confirms the plain-language confirmation message actually appears after a successful role change. Tasks 7.1 and 7.2 are end-to-end tests for designation and demotion; neither specifies checking for the confirmation message. This condition is one of the six that makes the capability complete, and it has no verify task.

**Status: Implementation covered. Verification missing entirely.**

---

### Condition 5: Role Change Immediacy

> The next API request from the affected user is evaluated against the updated `team_memberships.membership_role` value. No cached role value is used.

**Implementation tasks:** 3.1 (endpoint reads both fields) and 3.2 (verify reads from DB, not cache) address the HTTP path. Tests 3.3–3.6 cover specific scenarios. Tasks 7.1 and 7.2 cover end-to-end immediate effect for designation and demotion.

**WebSocket gap:** Design Decision 4 explicitly states this requirement applies to WebSocket operations as well as HTTP requests, and that the vote lock-in handler must read `team_memberships.membership_role` from the database on each lock-in attempt — not from a value established at WebSocket connection time. No task addresses WebSocket role enforcement. The security review flagged this as R6 (required). This is a stated condition in the design that has no implementation task.

**Redis prohibition gap:** Design Decision 4 states that role data must not be cached in Redis or any in-memory store, and that this prohibition must be stated in code comments at the authorization check implementation. The security review flagged this as R7 (required). No task captures the Redis prohibition or requires the code comment.

**Status: HTTP path covered. WebSocket path has no implementation or verification task. Redis prohibition has no task.**

---

### Condition 6: Audit Logging

> Every role change writes a log entry containing: actor user ID, subject user ID, team ID, from-role, to-role, and timestamp. Both promotions and demotions are logged.

**Implementation task:** 4.4 covers the basic requirement.

**Field specification gap:** Design Decision 7 and the security review (R3) require two additional fields beyond what the proposal lists: the actor's `global_role` at the time of the change (specifically whether they acted as `application_admin` or `engineering_manager`) and the actor's IP address (populated from `request.ip`). Task 4.4's field list matches the proposal, not the design decision. The security reviewer called the actor user ID alone insufficient for post-incident review. Task 7.4's verification criteria also use the proposal's shorter field list. If implementation follows task 4.4 as written, it will not satisfy the design's audit requirement.

**Transaction requirement gap:** Design Decision 7 and the security review (R4) require the audit log write to be in the same database transaction as the role change — if the audit write fails, the transaction must roll back and the role change must not commit. No task captures this. As written, task 4.4 does not specify whether the audit write is transactional.

**Verification tasks:** 7.4 covers both promotion and demotion audit entries but verifies the shorter field list from the proposal. It needs to be updated to match the design's required fields once task 4.4 is corrected.

**Status: Implementation task field list is incomplete relative to design. Transaction requirement absent. Verification task will also need updating once task 4.4 is corrected.**

---

## Design Review Items

The following five items were introduced or clarified during design review. I check whether each is represented as a task.

---

### Item A: Two-Step Confirmation Flow

Design Decision 5 specifies a two-submission protocol: first submission may return 422; second submission with `confirmedZeroParticipant: true` proceeds. The engineer reviewer flagged this as a blocking inconsistency (item 2 in design-review-engineer.md).

**Finding:** Not represented as a task. Tasks 4.3 and 5.4 describe the superseded approach. Neither has been updated. This is the same finding as Condition 3 above, stated here to confirm it is also a design-review item with no task coverage.

---

### Item B: `canAssignRoles` Flag

Design Decision 9 specifies that the team member list API response must include a `canAssignRoles: boolean` field evaluated server-side, so the frontend can render the role selector or the escalation message without implementing authorization logic. The engineer reviewer flagged this as item 5 in design-review-engineer.md. The design explicitly selected Option B (server-evaluated flag) and rejected adding `globalRole` to `AuthSession.user`.

**Finding:** No task implements the `canAssignRoles` field. Task 5.7 describes the escalation UI behavior but does not specify how the frontend determines authorization. An implementer working from tasks.md has no task telling them to add this field to the GET /api/v1/teams/:teamId/members response. This is a complete gap — the escalation UX (which is a hard requirement for Option A) depends on a mechanism that no task asks anyone to build.

---

### Item C: Audit Log Transaction Requirement

Design Decision 7 states the audit write must execute in the same transaction as the role change. The security review flagged this as R4 (required). The engineer reviewer also flagged it in item 3 of design-review-engineer.md.

**Finding:** Not represented as a task. Task 4.4 is silent on transactional requirements. No verify task checks for this. Same finding as Condition 6 above.

---

### Item D: Redis Prohibition

Design Decision 4 states role data must not be cached in Redis or any in-memory store, and that this prohibition must appear in code comments at the implementation. The security review flagged this as R7 (required).

**Finding:** Not represented as a task. No task requires the code comment. No verify task checks that no Redis cache for role data was introduced. The prohibition exists only in the design document; it will not survive to the implementation unless a task carries it there.

---

### Item E: CSRF Confirmation

Design Decision 3 states the TEAM-005 PATCH endpoint must rely on SameSite: strict cookie protection, consistent with all other state-changing endpoints, and that implementation must confirm no mechanism weakens this protection. The security review flagged this as R8 (required).

**Finding:** Not represented as a task. No task asks the implementation team to confirm CSRF protection is in place on TEAM-005, and no verify task checks for it. Given that TEAM-005 is a new endpoint with a CORS change (PATCH being added to the methods array), a CSRF verification step is not redundant — it is the right moment to confirm the protection holds under the new configuration.

---

## Additional Gaps Not in the Five Named Items

These are not in the user's explicit checklist but are losses in translation I would flag in any review of this task list.

**CORS PATCH fix is not in the tasks.** The design's migration plan and the engineer reviewer both call out that `"PATCH"` must be added to the CORS methods array in `packages/backend/src/app.ts` line 52 before TEAM-005 is implemented. The failure mode is a silent CORS error in the browser, not a server-side test failure. This is not in the task list at all.

**Task 6 should not be in the task list.** Design Decision 6 explicitly states Task 6 ("Implement real-time facilitator readiness grid update") is deferred to the WebSocket infrastructure change because no WebSocket layer exists. The decision says Task 6 "must be removed from the task list for this change." Tasks 6.1, 6.2, and 6.3 remain. If these tasks are not marked explicitly deferred or removed, they will appear as open work that cannot be completed and will block closure of this change.

**Task 1.1 wording misrepresents the status.** The executive decision on Q1 has been received. Rachel Okonkwo approved Option A. Task 1.1 says "Obtain Q1 sign-off," which implies a decision is pending when the decision is not pending. The remaining action is the coordinated documentation update by the BA and security analyst. The task wording should say so.

**Audit log actor fields missing from task 7.4.** Task 7.4's verification criteria match the proposal's field list. Once task 4.4 is updated to include actor global_role and IP address, task 7.4 must also be updated or it will pass against an incomplete implementation.

**Task 7.3 and 7.6 verify against items not in scope.** Task 7.3 verifies demotion immediately returns 403 from the session history endpoint. There is no session history endpoint in this change. Task 7.6 verifies the session-initiation guard, but there is no implementation task for the guard in this change. Neither task can pass as written. The engineer reviewer (item 12) flagged both. These tasks need either an explicit deferral note or a build task to accompany them.

---

## Summary

| Item | Status |
|---|---|
| Condition 1 — Member management view | Implementation covered; dedicated list-display verification missing |
| Condition 2 — Role selector with inline descriptions | Implementation covered; inline description verification missing |
| Condition 3 — Pre-action zero-participant warning | Implementation tasks describe superseded mechanism; transaction requirement absent |
| Condition 4 — Plain-language confirmation | Implementation covered; verification missing entirely |
| Condition 5 — Role change immediacy | HTTP path covered; WebSocket path and Redis prohibition have no tasks |
| Condition 6 — Audit logging | Task 4.4 field list incomplete; transaction requirement absent |
| Design item A — Two-step confirmation flow | Not represented; tasks 4.3 and 5.4 describe the superseded approach |
| Design item B — `canAssignRoles` flag | No task implements this field; escalation UX is unbuildable without it |
| Design item C — Audit log transaction requirement | Not represented |
| Design item D — Redis prohibition | Not represented |
| Design item E — CSRF confirmation | Not represented |

The highest-priority corrections are: (1) rewrite task 4.3 and task 5.4 to reflect the two-submission flow from Design Decision 5; (2) add a task implementing `canAssignRoles` in the member list response; (3) add the transaction requirement to task 4.4; and (4) add a task for the CORS PATCH fix before TEAM-005 is implemented. Items B and the CORS fix are blockers — the escalation UX cannot function without the authorization signal, and the endpoint cannot be called from a browser without the CORS change.
