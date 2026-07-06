# Architectural Task Review — Assign Role to Team Member

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Date:** 2026-07-06
**Source documents reviewed:** tasks.md, design.md, proposal.md

---

## Summary Verdict

The task list has four issues that will cause implementation failures or produce incorrect behavior. Two of them are critical: a required infrastructure step is missing entirely, and a task directly contradicts a superseding design decision. Two more are structural: a complete task group was explicitly ordered removed by the design and is still present, and a backend prerequisite for a frontend task was never written. Beyond those four, there are three specification gaps that will result in incomplete implementations, and two stale items that may cause a developer to treat a closed question as open.

I am not signing off on this task list for implementation until the critical issues are resolved.

---

## Critical Issues

### 1. The CORS PATCH fix is missing — no task exists for it

The Migration Plan in design.md opens with a step 0:

> Add `"PATCH"` to the CORS `methods` array in `packages/backend/src/app.ts` line 52. [...] This is a one-line change but must ship before TEAM-005 is implemented. The failure mode (network error rather than a 4xx) makes it easy to misdiagnose.

There is no task in tasks.md that corresponds to this change. It is not in Task Group 3, not in Task Group 4, not in verification.

This must be Task 3.0 — or a new Task Group 0, if the intent is to keep it visually prior to the session-participation work — and it must appear before any TEAM-005 implementation or any frontend work that calls TEAM-005. A CORS failure produces a network-level error in the browser, not a 4xx. Without this task in the list, it will either be skipped or discovered only when a developer first exercises the frontend against the backend and spends time debugging a misdiagnosed failure.

**Required action:** Add a task that adds `"PATCH"` to the CORS methods array in `packages/backend/src/app.ts` line 52, placed as the first implementation task before any TEAM-005 or frontend work.

---

### 2. Task 4.3 contradicts Decision 5 — it describes the wrong flow

Task 4.3 reads:

> if the count is zero, include a `zeroParticipantWarning: true` flag in the response body (the change proceeds — this is not a 4xx rejection; the client uses this flag to display the pre-action warning)

Decision 5 in design.md explicitly supersedes this:

> The server returns `422 Unprocessable Entity` with body `{ "requiresConfirmation": true }` — **the change is not applied**.
> If the actor confirms, the client re-submits the same PATCH with `confirmedZeroParticipant: true` in the request body.
> Task 4.3's original description (`zeroParticipantWarning: true` returned alongside a completed change) was contradictory and is superseded by this decision.

If a developer implements Task 4.3 as written, they will build a one-step flow in which the change is applied immediately and the client receives a completed-change response with a warning flag. That is not what the design specifies. The correct behavior is a two-step protocol: first submission returns 422 (change not applied), second submission with `confirmedZeroParticipant: true` proceeds.

Task 5.4 compounds this error: it references `zeroParticipantWarning: true` as the field to react to, which is the wrong field name and wrong response code under Decision 5.

**Required action:** Rewrite Task 4.3 to describe the two-step flow. The first PATCH returns 422 with `{ "requiresConfirmation": true }` if applying the change would leave zero participants (change is not applied). The second PATCH with `confirmedZeroParticipant: true` in the body applies the change and returns 200. Rewrite Task 5.4 to match — the frontend reacts to a 422 response, not to a `zeroParticipantWarning` field in a 200 response. Add the transaction requirement from Decision 5 (single DB transaction with CTE or SELECT FOR UPDATE) to the task description.

---

## Structural Issues

### 3. Task Group 6 was explicitly ordered removed — it is still present

Decision 6 in design.md is unambiguous:

> Task 6 is **explicitly deferred to the WebSocket infrastructure change**. This change (TEAM-005 and its associated tasks) does not scope, build, or depend on WebSocket infrastructure. **Task 6 must be removed from the task list for this change** and re-scoped in the change that delivers WebSocket infrastructure.

Tasks 6.1, 6.2, and 6.3 are still in tasks.md. The current codebase has no WebSocket layer. The session view is a placeholder div. A developer picking up Task 6.1 ("Implement real-time facilitator readiness grid update: when a participant's `membership_role` is changed... the facilitator's readiness grid must reflect the change") has no event bus, no connection pool, and no broadcast mechanism to work with. These tasks cannot be implemented in this change. Their presence in the list is a trap.

**Required action:** Remove Task Group 6 in its entirety from tasks.md. Create a stub task (or change-level note) that names Decision 6 as the source, identifies the WebSocket infrastructure change as the recipient, and carries forward the authorization scope requirements from Decision 6 (events scoped to authorized recipients only; payload must not broadcast to all connected clients).

---

### 4. Missing backend task for `canAssignRoles` — Task 5.7 has no prerequisite

Decision 9 requires that the `GET /api/v1/teams/:teamId/members` response include a `canAssignRoles: boolean` field, evaluated server-side, so the frontend can render the role selector or the escalation message without implementing authorization logic itself.

There is no task in Task Group 4 (or anywhere in the backend work) that adds this field to the member list endpoint response. Task 5.7 ("implement the facilitator escalation path — when a user without role-assignment permission views the member management view, display a plain-language explanation") depends on this field being present in the API response. Task 5.1 ("create the member management view component") may also depend on it — the view must know whether to render a selector or an explanation on initial load.

A developer picking up Task 5.7 will reach for `canAssignRoles` in the API response and find it does not exist. They will either improvise a client-side authorization check (which is exactly what Decision 9 prohibits) or block until the backend task is written.

**Required action:** Add a task to Task Group 4 that adds `canAssignRoles: boolean` to the `GET /api/v1/teams/:teamId/members` response. The evaluation must use the same per-team, per-request database query described in Decision 3 — it must not be derived from session state. This task must appear before Task 5.1 or 5.7 can be implemented.

---

## Specification Gaps

### 5. Audit logging task is missing required fields from Decision 7

Task 4.4 specifies the audit log entry as: "actor ID, subject ID, team ID, from-role, to-role, and ISO 8601 timestamp."

Decision 7 requires two additional fields:
- **Actor's `global_role` at the time of the change** — so that a post-incident review can determine what privilege was exercised (Application Admin vs. Engineering Manager), not just who held the session.
- **Actor IP address** — populated from `request.ip`, which resolves to the real client IP given `trustProxy: 1` in `buildApp()`.

Decision 7 also carries a transaction requirement that is absent from Task 4.4: the audit log write must be in the same database transaction as the role change. If the audit write fails, the transaction must roll back and the role change must not commit.

A developer implementing Task 4.4 as written will produce an incomplete audit trail. That audit trail will not satisfy the access control and compliance intent of Decision 7.

**Required action:** Update Task 4.4 to include actor's `global_role`, actor IP address, and the in-transaction requirement (audit write and role change in one transaction; either both commit or neither does).

---

### 6. Transaction requirements for the zero-participant check are not represented in any task

Decision 5 contains an explicit architectural constraint:

> The participant count check and the UPDATE must execute within a single database transaction. The count must be evaluated on the post-update state within the transaction — using a CTE or `SELECT FOR UPDATE` to hold the lock — not as a separate pre-flight query outside it. This prevents a race condition where two concurrent role changes by different authorized actors both pass an independent check and together produce a zero-participant state without either 422 firing.

This constraint appears nowhere in Task 4.3 or anywhere else in the task list. Without it, a developer implementing the zero-participant check will write a two-query approach (read the count, then update) — which is the implementation Decision 5 was specifically designed to prevent. Two concurrent authorized role changes will both pass the pre-flight read and both commit, leaving the team in a zero-participant state with no 422 having fired.

**Required action:** Add the transaction requirement to Task 4.3, naming the CTE or SELECT FOR UPDATE approach and the race condition it prevents.

---

### 7. No verification task for the CORS fix

The verification task group (Task Group 7) does not include a test or check that the CORS configuration was correctly updated. This omission is low-cost to address and high-value given the diagnostic difficulty described in the Migration Plan. A CORS failure on a PATCH request presents as a network error in the browser console, not as a 4xx from the application. Without an explicit verification step, this is the kind of thing that gets missed in code review and discovered by the first frontend developer to exercise the endpoint against a real backend.

**Required action:** Add a verification task confirming that a browser-initiated PATCH request to TEAM-005 succeeds (i.e., is not blocked at the CORS pre-flight stage).

---

## Stale Items

### 8. Task 1.1 frames a resolved decision as open

Task 1.1 reads: "Obtain Q1 sign-off: BA and security analyst must agree on the authorized actor model (Option A, B, or C) from design.md."

Decision 3 in design.md states: "Option A is selected. Executive decision received from Rachel Okonkwo (VP Engineering). The BA and security analyst have both signed off on this resolution."

The decision is closed. A developer reading Task 1.1 as written will not know this. The remaining action is a coordinated documentation update — the BA must update the use case actor field and the API contract simultaneously, as a single reviewed change — but that is not the same as the underlying decision being unresolved.

**Required action:** Rewrite Task 1.1 to reflect its actual status. The decision is made. The task is: update the use case actor field and the API contract simultaneously to reflect Option A, reviewed together by the BA and security analyst before implementation begins.

---

### 9. Task 5.7 conditional framing is stale

Task 5.7 reads: "If Q1 resolves to Option A: implement the facilitator escalation path..."

Q1 has resolved to Option A. The escalation UX is not conditional — it is a hard requirement called out in Decision 3, the proposal, and the acceptance criteria (AC3). The conditional framing understates the requirement's status and creates an opening for a developer to treat it as optional.

**Required action:** Remove the conditional framing. The escalation UX task is unconditional. The minimum-acceptable specification from Decision 3 should be referenced directly in the task text: plain-language explanation of why role assignment is unavailable, plus the Application Admin contact name and actionable in-app request path.

---

## Ordering Summary

With the issues above addressed, the correct implementation sequence is:

1. CORS PATCH fix (one-line change to `app.ts` — must precede all TEAM-005 and frontend work)
2. Blocking documentation updates (Task Group 1, rewritten per item 8 above)
3. Spec updates (Task Group 2)
4. Session-participation dual-field endpoint implementation (Task Group 3)
5. `canAssignRoles` field added to member list endpoint response (new task in Task Group 4)
6. TEAM-005 role assignment backend (remainder of Task Group 4)
7. Frontend — member management view (Task Group 5)
8. Verification (Task Group 7)
9. Task Group 6 — removed; re-scoped to WebSocket infrastructure change

Step 4 (session-participation implementation) is correctly placed before step 6 (role assignment). The design's intent — that no user can be designated EM through the new path before the session-participation endpoint will reject them — is preserved by this ordering.
