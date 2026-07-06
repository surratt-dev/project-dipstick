## Context

The Engineering Health Check application enforces two structural constraints that protect the ritual's integrity: Engineering Managers must not participate in sessions as voters, and facilitators must come from a team different from the one they are facilitating. Both constraints depend on role data being accurate. The join-link change correctly assigns every new team member the default `participant` membership role. This change provides the mechanism to correct that default when the member is, in fact, an Engineering Manager.

The role system is two separate layers that are often confused:

| Layer | Field | Table | Valid values |
|---|---|---|---|
| Global role | `users.global_role` | `users` | `engineer`, `senior_engineer`, `facilitator`, `engineering_manager`, `application_admin` |
| Membership role | `team_memberships.membership_role` | `team_memberships` | `participant`, `engineering_manager` |

This change operates **exclusively on `team_memberships.membership_role`**. It does not touch `users.global_role`. The implementation team must not conflate these layers; writing `membership_role = 'facilitator'` would cause a PostgreSQL constraint error because `facilitator` is not a valid `membership_role` enum value.

The session-participation spec currently checks only `users.global_role` to enforce EM non-participation. Once a working path exists to set `membership_role = 'engineering_manager'`, that check is incomplete. A user could have `global_role = 'engineer'` and `membership_role = 'engineering_manager'` on their team — the existing check would pass them through. The session-participation spec update is a **prerequisite** to this change: it must ship first.

TEAM-006 (`POST /api/v1/teams/:teamId/managers`) is not part of this change. TEAM-006 requires the target user to already have `global_role = 'engineering_manager'` and is used to establish the manager/team relationship for application-wide EM access. This change does not modify `users.global_role`, and therefore does not invoke TEAM-006. A developer who sees TEAM-006 in the API contract while implementing EM designation should not call it. `TEAM-005` is sufficient for the behaviors this change enables.

## Goals / Non-Goals

**Goals:**
- Provide an authorized actor with the ability to change a team member's `membership_role` between `participant` (Engineer) and `engineering_manager` (Engineering Manager)
- Surface a pre-action warning when a role change would leave the team with zero participant-role members, so the actor understands the consequence before confirming
- Apply role changes immediately and without caching lag, so that a user designated as EM cannot cast a vote in a session after the change takes effect
- Emit a complete audit trail for every role change (actor, subject, from-role, to-role, timestamp)
- Update the session-participation spec before role assignment is implemented, so the no-manager enforcement covers both `users.global_role` and `team_memberships.membership_role`
- Update the use case text to remove Facilitator as an assignable role in this change

**Non-Goals:**
- Modifying `users.global_role` for any role (Engineer, Facilitator, EM, Admin)
- Calling TEAM-006 or establishing the manager/team relationship at the `global_role` layer
- Facilitator designation — separate use case, separate endpoint, deferred
- Bootstrapping the first admin or facilitator account — a named follow-on with a designated owner
- A "session readiness" pre-flight signal on the member management view — that is a session-initiation UX concern

## Decisions

### Decision 1: `team_memberships.membership_role` only — no `global_role` writes

**Decision:** This change writes only to `team_memberships.membership_role`. Designating someone as Engineering Manager for a team means setting their membership role to `engineering_manager`. It does not require — and must not include — a change to `users.global_role`.

**Rationale:** The behaviors this change enables — exclusion from session voting, access to session history for their team — are enforced by checking `team_memberships.membership_role`, once the session-participation spec is updated per the prerequisite. A user does not need `global_role = 'engineering_manager'` for these behaviors. Adding a `global_role` change would require TEAM-006, which requires the user to already have `global_role = 'engineering_manager'`, creating a circularity. Keep the two layers separate.

**Alternatives considered:**
- Writing both layers simultaneously: rejected because it conflates two different concepts, requires a new privileged endpoint for `global_role` modification, and is not needed for the session-layer enforcement to work correctly.

---

### Decision 2: Session-participation spec update is a prerequisite, not a parallel task

**Decision:** The session-participation spec must be updated before role assignment is implemented. The spec update is Task Group 1; role assignment implementation is Task Group 2. They are sequential, not parallel.

**Rationale:** Once a working path exists to set `membership_role = 'engineering_manager'`, the session participation endpoint must already refuse that user. If the spec and endpoint still check only `global_role`, a user with `membership_role = 'engineering_manager'` can still vote. The no-manager rule would be broken from the moment the first EM is designated. The prerequisite ordering eliminates this window.

---

### Decision 3: Q1 — Who can assign roles (authorization) — RESOLVED: Option A selected

**Decision:** Option A is selected. Executive decision received from Rachel Okonkwo (VP Engineering). The BA and security analyst have both signed off on this resolution.

- `global_role = 'application_admin'` can change roles on any team
- `global_role = 'engineering_manager'` with an active `team_memberships` row for the specific team (verified at request time from the database — see EM authorization requirement below) can change roles on their own team
- Facilitators cannot change roles

**EM authorization implementation requirement:** The authorization check for Engineering Manager access must query the `team_memberships` table directly at request time, using the `teamId` from the request path. It must not use role information from session state, in-memory state, or token claims. A user who holds `global_role = 'engineering_manager'` in the `users` table is not thereby authorized to change roles on any team — they must have an active (`removed_at IS NULL`) `team_memberships` row with `membership_role = 'engineering_manager'` for the specific `teamId` in the request URL. The `teamId` in the URL path is attacker-controlled input; server-side verification must be per-team, per-request, from the database. An EM on Team A calling `PATCH /api/v1/teams/team-b-id/members/:userId/role` must receive a 403, not a 200.

**CSRF protection:** The session cookie is configured with `sameSite: "strict"` (see `buildApp()` in `packages/backend/src/app.ts`), which provides CSRF protection for modern browsers. The TEAM-005 PATCH endpoint must rely on this protection, consistent with how all other state-changing endpoints in this application are protected. Implementation must confirm that no mechanism is introduced that weakens this protection (e.g., accepting credentials via query string or a custom scheme that bypasses SameSite enforcement).

**Escalation UX requirement (required by Option A):** The member management view must include an explicit escalation path for facilitators who discover a misconfigured role at session-start time. Minimum acceptable: plain-language explanation ("Only an Application Admin can change this role. Contact your admin to update this before the session."). Preferred: the view surfaces the admin contact and an in-app request path. A grayed-out control with no explanation is not acceptable and will harm adoption.

**Rationale:** EM designation grants access to potentially sensitive session history. That access should be a deliberate organizational decision. A facilitator visiting a team they have never facilitated before should not have the unilateral ability to grant that access. The argument for Option B — reducing friction — is real, but Option A is acceptable if and only if the facilitator escalation path is built into this change.

**Alternatives considered:**
- Option B (Facilitators can change roles for teams they do not belong to): rejected because a facilitator assigning `engineering_manager` grants read-only access to session history, which is a privilege escalation path. This was confirmed by the security analyst's review.
- Option C (Any authenticated user): rejected as widest attack surface; not appropriate for a role that grants access to potentially sensitive data.

---

### Decision 4: Role changes must be immediate — no caching of membership_role

**Decision:** The session participation endpoint, the session history access check, and any other authorization check that uses `team_memberships.membership_role` must read the value directly from the database on each request. The value must not be cached in the session cookie, an in-memory store, or middleware-level state.

**Rationale:** Role changes take effect immediately on the next authenticated request from the affected user. If a participant is designated EM mid-session, their next lock-in attempt must be rejected. A cached role value would create a window where the user's stored role says `participant` while the database says `engineering_manager`. For the no-manager rule, any such window is unacceptable.

**Implementation note:** Read `team_memberships.membership_role` directly from the `team_memberships` table on each request that requires team-specific authorization. This is a per-request DB read, not a session-stored value.

**Redis prohibition:** Role data must not be cached in Redis or any in-memory store. A developer who observes repeated per-request database reads for `membership_role` and attempts to optimize them with a Redis cache will silently break the immediate-effect guarantee. This prohibition must be stated in code comments at the authorization check implementation and verified in code review. The application's Redis instance is used for session storage — that use must not be extended to role data.

**WebSocket scope:** The per-request role check applies to WebSocket operations as well as HTTP requests. The vote lock-in handler must read `team_memberships.membership_role` from the database on each lock-in attempt. It must not use a role value established at WebSocket connection time. Per-operation server-side checks are the required and sufficient mechanism; invalidating the WebSocket connection when a role changes is not required, but every operation processed through that connection must independently verify the current role from the database. A long-lived WebSocket connection opened before a role change must not permit operations that the role change should prohibit.

---

### Decision 5: Pre-action warning for zero-participant state — warn-and-allow, not block

**Decision:** When a role change would leave the team with zero participant-role members, the server must require explicit confirmation before applying the change. The mechanism is Option B: a server-side confirmation gate using a flag in the request body.

**Two-submission flow:**
1. The client submits `PATCH /api/v1/teams/:teamId/members/:userId/role` with the requested role value and no confirmation flag.
2. The server evaluates whether applying the change would leave zero participants. If yes, the server returns `422 Unprocessable Entity` with body `{ "requiresConfirmation": true }` — **the change is not applied**.
3. The client receives the 422 and displays the zero-participant warning to the actor.
4. If the actor confirms, the client re-submits the same PATCH with `confirmedZeroParticipant: true` in the request body.
5. On the second submission with `confirmedZeroParticipant: true`, the server applies the change regardless of the participant count and returns `200 OK`.

The warning fires at the confirmation step because the change has not been applied when the actor sees it. This is consistent with the decision intent: "The warning fires at the confirmation step, not as a toast after the fact." Task 4.3's original description (`zeroParticipantWarning: true` returned alongside a completed change) was contradictory and is superseded by this decision.

**Warning trigger condition:** After applying this change, does any active (`removed_at IS NULL`) member of this team have `membership_role = 'participant'`? If no, the warning fires (422 returned on first submission). This check runs inside the database transaction, on the post-update state.

**Warning message:** "This change will leave [team name] with no Engineers. A session cannot start without at least one Engineer. You can still make this change."

**Transaction requirement:** The participant count check and the UPDATE must execute within a single database transaction. The count must be evaluated on the post-update state within the transaction — using a CTE or `SELECT FOR UPDATE` to hold the lock — not as a separate pre-flight query outside it. This prevents a race condition where two concurrent role changes by different authorized actors both pass an independent check and together produce a zero-participant state without either 422 firing. This transaction requirement applies regardless of whether `confirmedZeroParticipant` is present in the request.

**Rationale for Option B over Option A (pre-flight check endpoint):** Option A requires an additional round-trip and moves the zero-participant evaluation to the client. Option B keeps the confirmation logic entirely server-side: the client does not evaluate the zero-participant condition independently — it reacts to the server's response code. This is consistent with the access control principle that authorization and state validation are enforced at the API layer.

**Rationale for Option B over Option C (post-fact warning):** Option C would require changing the design decision language to match what a post-fact toast actually describes. The design decision language is correct — a warning shown after an irreversible change has been applied is not a confirmation step.

**Rationale:** The alternate flow in the use case says "may warn." That language is not a requirement. The application must warn, with specific visible text, before the actor confirms. "May warn" creates ambiguity about whether the warning was intentionally omitted. A team with zero Engineers cannot start a session; the actor should understand that consequence before creating that state.

**Connection to session-initiation guard:** The role-change warning and the session-initiation guard are separate checks at separate enforcement points. The warning fires at role-change time and informs the actor. The session-initiation guard fires at session-start time and blocks a session from proceeding. Both must be implemented. Implementing only the warning while missing the initiation guard means the state is warned about but not enforced.

---

### Decision 6: Facilitator view during mid-session role change

**Decision:** If a participant's role is changed from `participant` to `engineering_manager` during an active session (by an admin acting in a separate context), the facilitator's readiness grid must reflect the change in real time: the expected-voter count denominator must update, and the participant indicator for the affected user must be removed from the voting grid.

**Rationale (Priya Nair, incorporated):** The data integrity requirement — votes already locked in are preserved; lock-in attempts after the change are rejected — does not address what the facilitator sees. A facilitator managing a stale control surface while the underlying data has changed is an operational failure. The readiness grid must stay accurate.

**Task 6 deferral — explicit:** The current codebase has no WebSocket layer. The session view at `/session/:sessionId` is a placeholder div. Task 6 ("Implement real-time facilitator readiness grid update") requires a WebSocket event bus, a connection pool, and a broadcast mechanism — none of which exist. Task 6 is **explicitly deferred to the WebSocket infrastructure change**. This change (TEAM-005 and its associated tasks) does not scope, build, or depend on WebSocket infrastructure. Task 6 must be removed from the task list for this change and re-scoped in the change that delivers WebSocket infrastructure, with this design document cited as the source of the deferral and the behavioral requirement.

**Requirements for Task 6 when it is implemented in the WebSocket change:** Role-change events emitted over the WebSocket channel must be scoped to authorized recipients only — at minimum, the facilitator of the active session and the directly affected user. They must not be broadcast to all connected clients. The event payload must contain only data each recipient is authorized to see. These are non-negotiable constraints that must be reflected in the WebSocket change's design before implementation begins.

---

### Decision 7: Audit log for all role changes

**Decision:** Every role change must be logged with the following fields:
- Actor user ID
- **Actor's `global_role` at the time of the change** — specifically whether they acted as `application_admin` or `engineering_manager`. Actor user ID alone is insufficient; a post-incident review must be able to determine what privilege was exercised, not just who held the session.
- Subject user ID
- Team ID
- From-role
- To-role
- Timestamp
- Actor IP address (populated from `request.ip`, which resolves to the real client IP given `trustProxy: 1` in `buildApp()`)

Both promotion to EM and demotion back to Engineer must be logged. The audit trail is append-only and not user-editable or user-deletable through any application interface.

**Transaction requirement:** The audit log write must be in the same database transaction as the role change. If the audit write fails, the transaction must roll back and the role change must not commit. A role change with no audit record is not an acceptable failure mode. Out-of-transaction approaches (message queue, deferred write, fire-and-forget log call) are not permitted for this operation.

**Retention and access policy:**
- **Minimum retention:** 12 months from the date of the role change event.
- **Read access:** Audit records for role changes are accessible to Application Admins only through the application. Engineering Managers do not have read access to the audit trail through the application UI in the initial implementation.
- **Storage:** Audit records are stored in the application database. This means a compromised Application Admin account can potentially read audit records directly. The initial implementation accepts this risk given the application's small-population internal scope. A separate write-only audit destination may be introduced in a future change; that change should migrate these records.
- **Deletion:** Audit records must not be deletable through any application UI or API regardless of role. Deletion requires direct database access by a designated DBA under change control.

**Rationale:** EM designation grants access to potentially sensitive session history. Demotion revokes that access. Both directions are security-relevant. An incomplete audit trail — one that logs promotions but not demotions, or that omits the actor's privilege basis — is not sufficient for incident investigation or compliance review.

---

### Decision 8: Vocabulary mapping — UI labels vs. database values

**Decision:** The member management view must use human-readable role labels, not database enum values. The mapping is:

| `membership_role` value | UI label |
|---|---|
| `participant` | Engineer |
| `engineering_manager` | Engineering Manager |

The role selector must include inline descriptions:
- **Engineer** — participates in session voting
- **Engineering Manager** — can view session history; will not vote

**Rationale:** "participant" and "engineering_manager" are implementation details. The ritual's vocabulary — Engineer, Engineering Manager — is what users recognize. A member management view that shows "participant" will confuse facilitators at their first pre-session setup. The inline descriptions reduce first-session confusion without requiring a tutorial.

---

### Decision 9: Frontend authorization signal — server-side `canAssignRoles` flag

**Decision:** The member management view requires knowing whether the current user is authorized to assign roles (to show the role selector or the escalation message). `AuthSession.user` currently exposes only `{ id, displayName, email }` — it does not include `global_role`, and therefore the frontend cannot evaluate authorization independently.

The team member list API response (e.g., `GET /api/v1/teams/:teamId/members`) must include a `canAssignRoles: boolean` field at the response level. The server evaluates whether the requesting user is an Application Admin or an active EM for this specific team, and returns the result. The frontend renders the role selector or the escalation message based on this flag.

**`globalRole` must not be added to `AuthSession.user` for this purpose.** Adding `globalRole` to the session type would push authorization reasoning into the client: the frontend would infer "can this user change roles?" from a role value. The `canAssignRoles: boolean` flag is more defensive — the client does not implement authorization logic, it reacts to a server authorization result. This is consistent with the access control principle that authorization is enforced at the API layer, not inferred by the frontend from role values.

**Implementation note:** The `canAssignRoles` field must be evaluated fresh on each request to the member list endpoint, using the same per-team, per-request database query described in Decision 3. It must not be derived from session state.

## Risks / Trade-offs

**Risk: Q1 resolved — use case and API contract must be updated simultaneously** → Q1 is resolved (Option A). The remaining action is coordinating the BA's use case update and the API contract update as a single reviewed change. Implementation cannot begin until both documents reflect Option A. An actor model inconsistency between those two documents is a security gap that the security analyst has explicitly required be closed before development starts.

**Risk: Session-participation spec update skipped or treated as parallel** → If a developer starts role assignment before the session-participation spec and endpoint are updated, a newly designated EM can still vote. The task ordering in tasks.md must enforce the prerequisite sequence. A code review that merges role assignment before the session-participation change is a regression.

**Risk: Mid-session role change leaves facilitator grid stale (deferred to WS change)** → Task 6 is explicitly deferred to the WebSocket infrastructure change (see Decision 6). Until that change ships, a facilitator may not see role changes reflected in real time during an active session. This is an accepted operational risk for the initial delivery of this change. The WS change's design must address it before that change ships.

**Risk: Facilitator escalation path is a required deliverable, not optional** → Option A is selected. The escalation UX is not a nice-to-have. A facilitator who discovers a misconfigured role at session-start time and hits a dead-end with no actionable path will not use this tool. The escalation path must ship with this change.

**Risk: Developer reaches for TEAM-006 during EM designation** → The exploration notes document this risk explicitly. Any code review for this change must verify that TEAM-006 is not called as part of role assignment. The test for "designate a user as EM" must confirm that only `team_memberships.membership_role` is written, not `users.global_role`.

**Risk: Bootstrapping question not resolved before deployment** → The first team onboarded will ask who configured their roles and how. If the answer is "a DBA ran a migration script with no UI trace," that is an adoption risk. The bootstrapping mechanism must be decided and documented before any team is onboarded — not just before the code ships.

## Migration Plan

This change introduces no new database tables or schema changes. The `team_memberships.membership_role` enum and the `users.global_role` enum already exist. No data migration is required.

**Prerequisite sequencing:**
0. **Add `"PATCH"` to the CORS `methods` array in `packages/backend/src/app.ts` line 52.** The current array is `["GET", "POST", "PUT", "DELETE", "OPTIONS"]`. TEAM-005 is a PATCH endpoint. Without this change, every role assignment call from a browser frontend will fail with a CORS pre-flight error — the server will not include `PATCH` in the `Access-Control-Allow-Methods` response header and the browser will block the request before it reaches the route handler. This is a one-line change but must ship before TEAM-005 is implemented. The failure mode (network error rather than a 4xx) makes it easy to misdiagnose.
1. Update session-participation spec (spec update, not implementation)
2. Implement the updated session-participation endpoint check (both fields)
3. Implement role assignment UI and API

**Rollback:** If role assignment must be rolled back, the TEAM-005 route handler for the membership role change can be removed. Existing `team_memberships.membership_role` values in the database are not rolled back — they were set by legitimate operations. The audit log entries are preserved. Session-participation enforcement (dual-field check) should remain even if role assignment UI is removed; the check is purely additive and does not break any existing behavior.

## Open Questions

**Q1 (RESOLVED): Who can assign roles?**
Option A selected. Executive decision received from Rachel Okonkwo (VP Engineering). The use case actor field and the API contract must be updated simultaneously to reflect Option A — this coordinated documentation update is the remaining action, not obtaining a decision. See Decision 3.

**Q1 follow-on (RESOLVED by Decision 3): Facilitator escalation path design**
The escalation UX is a required deliverable of this change per Decision 3's Option A requirement. The escalation path must be designed and implemented as part of this change's frontend work, not deferred. See Decision 3 for minimum acceptable specification.

**Q3 (Must be documented in proposal): Bootstrapping path for the first admin and facilitator**
How are the first Application Admin and first Facilitator accounts provisioned? Options: seed migration run at deployment, a bootstrap endpoint activated only on first deploy, or IdP role claims honored by First Access instead of defaulting to `engineer`. This question does not block this change's implementation, but the proposal must name it, list the options, and assign a named owner for the follow-on work. The security analyst (Tomás Ferreira) has flagged this as a required pre-production item with specific security controls per each path — see design-review-security.md section 5a.
