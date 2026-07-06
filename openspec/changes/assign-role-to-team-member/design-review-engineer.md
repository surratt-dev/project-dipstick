# Engineering Design Review — Assign Role to Team Member

**Reviewer:** Marcus Oyelaran, Senior Full Stack Engineer
**Date:** 2026-07-06
**Artifacts reviewed:** design.md, proposal.md, tasks.md, specs/role-assignment/spec.md, specs/session-participation/spec.md

---

## Overall Assessment

The design is fundamentally sound and implementable. The schema is already correct — the `membership_role` enum exists with the right values, and the shared TypeScript types are already in place. The audit infrastructure is ready to extend. The prerequisite sequencing (session-participation enforcement before role assignment) is the right call and needs to stay enforced in code review, not just task ordering.

That said, there are several implementation problems I need to document before anyone writes code. Most are solvable in a sprint. One is a pre-existing defect in `app.ts` that will break the endpoint on day one if not caught. I'm flagging them in order of severity.

---

## Blocking Issues — Must Be Resolved Before Implementation Begins

### 1. CORS configuration does not include PATCH

`packages/backend/src/app.ts` line 52:

```
methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
```

`PATCH` is not in this list. TEAM-005 is a PATCH endpoint. The browser's CORS pre-flight for any cross-origin PATCH request will fail — the server will not include `PATCH` in the `Access-Control-Allow-Methods` response header, and the browser will block the actual request before it reaches the route handler. The endpoint will appear to work in server-to-server tests (including most of the unit tests we'd write) and break in the actual browser frontend.

Fix: add `"PATCH"` to the methods array in `buildApp()` before TEAM-005 is implemented. This is a one-line change, but if it ships without it, every role assignment call from the frontend will fail with a CORS error and the failure mode will look like a network error, not a configuration problem.

### 2. Zero-participant warning mechanism contradicts the design decision

Design decision 5 states: "The warning fires at the confirmation step, not as a toast after the fact."

Task 4.3 states: "if the count is zero, include a `zeroParticipantWarning: true` flag in the response body **(the change proceeds — this is not a 4xx rejection)**."

These two requirements are irreconcilable as written. If the PATCH applies the change and returns a warning flag, the change has already happened when the client receives the flag. There is no "confirmation step" — the actor never had an opportunity to cancel. The design decision explicitly calls out the post-fact toast as the wrong pattern, but the task description implements exactly that pattern.

The correct implementation of the design decision requires one of the following approaches:

**Option A — Validation-first flow:** Before the actor confirms, the client calls a validation endpoint (or a dry-run variant of the PATCH — e.g., a GET with query params, or a POST to a `/preview` subresource) that checks the post-change participant count without applying the change. The client shows the warning based on that response. Only after the actor confirms does the client send the actual PATCH.

**Option B — Confirm flag in the request body:** The PATCH endpoint accepts a `confirmedZeroParticipant: boolean` field. If the post-change count would be zero and `confirmedZeroParticipant` is not `true`, the endpoint returns a defined response (e.g., 422 with `requiresConfirmation: true`) without applying the change. The client displays the warning. On the second submission with `confirmedZeroParticipant: true`, the change proceeds. This keeps confirmation logic entirely on the server.

**Option C — Accept that the warning is post-fact:** Change the design decision language to match what task 4.3 actually describes — a warning notification after the change is applied. This is the weaker UX but it is at least honest about what the implementation does.

Option A adds a round-trip. Option B is cleaner — it keeps the confirmation state on the server and the client just reacts to the response code. Option C downgrades the UX but removes the contradiction. A decision needs to be made and the design and tasks need to match each other. Right now they don't.

### 3. The zero-participant check has a race condition

Related to item 2 above. The check-then-write pattern for the zero-participant validation is not atomic. Two simultaneous role changes by different authorized actors — say, an admin and an EM both using the interface at the same time — can both pass the check independently and together leave the team with zero participants without either warning having fired.

The fix: the participant count check and the UPDATE must be in the same transaction, using a CTE or a SELECT FOR UPDATE to hold the lock. The check must be on the post-update state within the transaction, not a separate pre-flight query. This is standard for any write-then-verify pattern in SQL. It applies regardless of which of the three options above is chosen for the UX flow.

---

## Concrete Gaps That Will Require Design Before They Can Be Implemented

### 4. Task 6 has no declared dependency on WebSocket infrastructure

The current codebase has no WebSocket layer. The session view at `/session/:sessionId` is a placeholder div. Task 6 ("Implement real-time facilitator readiness grid update") requires broadcasting a membership role change event to connected facilitators, which requires an event bus, a WebSocket connection pool, and a broadcast mechanism — none of which exist.

This task cannot be implemented in this change unless the WebSocket infrastructure is also built in this change, or an explicit dependency on a preceding change that builds that infrastructure is named. As written, task 6 is unblocked in the task list but blocked in reality. If the WS layer is being deferred, task 6 needs to be explicitly deferred to the same change that delivers that infrastructure, with a clear note in the risk section. If it is not deferred, the scope of this change is substantially larger than the tasks imply and the design needs to address the WS architecture.

I am not opposed to deferring task 6. But the current design decision 6 says "must be designed as part of the facilitator view" without naming what the facilitator view is built on. That is an incomplete design decision. It needs either a mechanism or an explicit deferral.

### 5. Frontend has no access to the current user's global role

`AuthSession.user` exposes `{ id, displayName, email }`. It does not include `globalRole`. The escalation UX (AC3, Option A) requires the member management view to know whether the current user is an `application_admin` or an `engineering_manager` for the team, in order to decide whether to show the role selector or the escalation message. The frontend currently has no way to derive this from the session data.

There are two clean paths:

**Option A:** Add `globalRole: UserRole` to `AuthSession.user` in `packages/shared/src/types/auth.ts`. This is a non-breaking addition to the shared type. The auth session endpoint already has access to the user record and would include this field in the response.

**Option B:** Include a `canAssignRoles: boolean` field in the team member list API response. The server evaluates authorization and returns the result. The frontend renders conditionally.

Option B is more defensive — the client doesn't implement authorization logic — and matches the principle that authorization is enforced at the API layer, not inferred by the frontend from role values. I prefer it. Either way, the current `AuthSession` type does not give the frontend what it needs for the escalation UX, and this needs to be resolved before the frontend work begins.

### 6. `TeamPage` renders raw `membership_role` enum values to users

This is a pre-existing issue but it intersects directly with this change. Line 79 of `packages/frontend/src/pages/TeamPage.tsx`:

```
{m.teamName} ({m.role})
```

This renders `"participant"` and `"engineering_manager"` as visible labels. Design decision 8 requires that these values never appear in the UI. The member management view being built in this change will need to apply the mapping (`participant` → "Engineer", `engineering_manager` → "Engineering Manager"). If `TeamPage` isn't updated at the same time, the vocabulary inconsistency will be visible to users who compare the two views. The TeamPage fix is small but it needs to be in this change's task list, not a follow-on.

---

## Implementation Risks That Need Explicit Attention in Code Review

### 7. Session data is stale after a role change

`AuthContext` fetches session data once on mount and holds it in React state. After a role change is applied, the affected user's session data — including their `teamMemberships[].role` — will still show the pre-change value until they reload. The server-side authorization check will use the correct (updated) database value on each request, which is correct per decision 4. But any frontend component that reads role from `useAuth().session.teamMemberships` will show the old value.

For the member management view itself, this is straightforward: the view must fetch its member list from a dedicated API endpoint (e.g., GET /api/v1/teams/:teamId/members), not from the AuthContext session data. That endpoint will return current database values on each request.

For the affected user's own session if they have the team page open during a role change: their displayed role label will be stale. This is likely acceptable — the server-side enforcement is what matters — but it needs to be a conscious call, not something discovered at QA. The review should verify that no component reads the current user's team membership role from `useAuth()` for the purpose of making authorization decisions on the client side.

### 8. Actor changing their own role

The design does not address this case. An EM who changes their own role from `engineering_manager` to `participant` loses EM authorization. The server-side enforcement will immediately reflect this, but the member management view they're currently looking at will need to handle the state where the actor is no longer authorized after the change they just made. The view should re-fetch authorization state (or redirect) after a successful role change rather than allowing the actor to continue making changes with stale authorization state.

Likewise, if an EM is the last EM on a team and demotes themselves, the team has no authorized role-assigner. This is a recoverable state (an application admin can fix it), but it should probably produce the zero-participant-style warning: "After this change, no Engineering Manager on this team will be able to manage roles. An Application Admin will be required." This edge case is not covered anywhere in the design or tasks.

### 9. Idempotent PATCH — no-op role change

TEAM-005 should handle the case where the requested `membership_role` equals the current value (e.g., `participant` → `participant`). The handler should return a success response without writing a database row or emitting an audit event. If the handler performs an unconditional UPDATE and logs it, it creates spurious audit entries. Given that the audit log is supposed to represent meaningful role changes, a no-op write is noise. The implementation should use a conditional UPDATE (`WHERE role != $newRole`) and skip audit logging if no row was updated.

### 10. `removed_at IS NULL` filter in TEAM-005 authorization

`join-links.ts` correctly filters the membership check with `AND tm.removed_at IS NULL`. The TEAM-005 handler must carry this same filter in both the authorization check (can this actor change roles for this team?) and the target membership check (is this subject an active member?). Missing this filter would allow a removed user with lingering session state to authorize role changes, or allow a role change to be applied to a removed membership record.

### 11. Task 1.1 is misleading — sign-off is already received

The proposal states: "Executive decision received. Rachel Okonkwo (VP Engineering) has approved Option A." Task 1.1 says "Obtain Q1 sign-off." These are inconsistent. The remaining action is documentation — updating the use case actor field and the API contract simultaneously — not obtaining a decision that has already been made. The task should be rewritten to reflect what actually remains: coordinated documentation update by the BA and security analyst. As written, a developer reading the task list will not know the decision is already made.

### 12. Task 7.3 and 7.6 verify behavior against endpoints that do not exist

Task 7.3 verifies that a demoted EM receives 403 from the session history endpoint. There is no session history endpoint in the codebase. This verification item has an implicit dependency on a separate change that has not shipped. The verification cannot pass until that endpoint exists. The task should either (a) be deferred to when the session history endpoint is built, or (b) be rewritten to describe a unit test against a not-yet-built handler, with an explicit note that end-to-end verification requires the history endpoint.

Task 7.6 verifies the session-initiation guard — but there is no build task in this change for the session-initiation guard. The design decision 5 explicitly states that both the warning and the initiation guard must be implemented, but tasks.md contains a verification item for the guard without a corresponding implementation task. Either the initiation guard is in scope and needs a task in group 4, or it belongs to a separate change and the verification task should be deferred.

---

## Minor Items

### 13. `AuditEventName` union type needs a new member

`packages/backend/src/auth/audit-logger.ts` defines `AuditEventName` as a union type. Adding the role change audit event (something like `"team.membership_role_changed"`) requires extending this type. TypeScript will catch any call to `emitAuditEvent` with an unrecognized event name, which is correct behavior. This is a small change but it should be done in the TEAM-005 handler task (task 4.4), not treated as a free-floating implementation detail. I'd suggest naming it `"team.membership_role_changed"` for consistency with the existing `"join.link_created"` / `"join.link_redeemed"` naming pattern.

### 14. Column name vs. design language mismatch

The design and spec consistently refer to "team_memberships.membership_role." The actual PostgreSQL column is named `role` — see migration 2 (`role membership_role NOT NULL DEFAULT 'participant'`). The TypeScript type in `shared/src/types/team.ts` uses `role: MembershipRole`. This is not a bug, but implementers writing SQL who follow the design document's language ("SET membership_role = ...") will produce invalid SQL. The TEAM-005 handler must use `SET role = $1`, not `SET membership_role = $1`. Code review should verify this.

---

## What Is Working Correctly in the Design

The prerequisite sequencing is right. The session-participation enforcement being a prerequisite to role assignment, not a parallel task, eliminates the window where a designated EM can still vote. This needs to stay enforced in code review — a PR that merges TEAM-005 before the session-participation endpoint is updated is a regression, not just a sequencing preference.

Decision 4 (no cached `membership_role`) is correct and the implementation approach — per-request DB read — is consistent with the existing authorization patterns in the codebase. There is no existing caching layer for authorization data that we'd have to bypass.

Decision 1 (membership_role only, no global_role writes) eliminates an entire category of TEAM-006 confusion. The risk note about developers reaching for TEAM-006 is realistic — the code comment calling this out explicitly in the TEAM-005 handler is the right countermeasure, and the test in task 4.6 that verifies `users.global_role` is not written provides a runtime-visible check.

The audit infrastructure is ready. `emitAuditEvent` handles the log level issue correctly (child logger set to 'info' explicitly, not inherited). The role change event just needs to be added to the union type and called in the handler.

---

## Summary of Required Actions Before Implementation

1. Add `"PATCH"` to the CORS methods array in `app.ts`
2. Resolve the zero-participant warning mechanism — pick one of the three approaches and update both design.md and tasks.md to agree with each other
3. Add a transaction requirement to the zero-participant check in task 4.3
4. Resolve Task 6's dependency on WebSocket infrastructure — either scope it correctly or explicitly defer it
5. Resolve how the frontend obtains the current user's global role for the escalation UX
6. Add a task to update `TeamPage` to use human-readable role labels
7. Add `"PATCH"` to the CORS methods array (already noted above, emphasizing it because it will break day one)
8. Rewrite task 1.1 to reflect that the executive decision is received and the remaining action is coordinated documentation
9. Resolve task 7.3 and 7.6 against endpoints/guards that are not in scope for this change
