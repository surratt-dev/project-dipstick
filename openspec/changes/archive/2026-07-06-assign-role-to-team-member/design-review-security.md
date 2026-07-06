# Security Design Review: Assign a Role to a Team Member

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Date:** 2026-07-06
**Documents reviewed:** design.md, proposal.md, exploration-notes.md
**Status:** CONDITIONAL SIGN-OFF — implementation blocked pending resolution of items marked [REQUIRED]

---

## Summary

The design is more security-conscious than most role management proposals I see. The two-layer role model is correctly understood and cleanly separated. The prerequisite ordering — session-participation spec update before role assignment — is the right call and I want it enforced at code review, not just at planning time. Option A is the correct authorization model. The audit logging intent is sound but the spec leaves too much implicit to be implementable without security drift. The immediate-effect requirement is stated correctly for the HTTP path but has a gap on WebSocket connections that must be resolved before implementation begins.

What follows is a full accounting. Items are marked [REQUIRED], [RECOMMENDED], or [OBSERVATION] according to whether they block sign-off, should be addressed in this change, or are flagged for awareness without blocking.

---

## 1. Authorization Model — Q1, Option A

**Finding:** Sound, with one scoping gap that must be made explicit.

Option A is the correct decision. Rejecting Option B was right, and the design's rationale is accurate: EM designation grants read access to session history, which is a privilege grant, not a configuration operation. A visiting Facilitator granting standing data access to a team's history — for a team they may never facilitate again — is a privilege escalation path. Option C was not seriously considered and should not be.

The authorization rule as stated is: Application Admins can change roles on any team; Engineering Managers can change roles on their own team. The phrase "their own team" requires a precise implementation:

**[REQUIRED] EM authorization must be verified against team membership in the database, not from session state or token claims.** The check must confirm that the requesting user has an active `team_memberships` row for the `teamId` in the request path, with `membership_role = 'engineering_manager'`, read directly from the database at request time. The `teamId` in the URL path is attacker-controlled. A user who is an EM on Team A must not be able to call `PATCH /api/v1/teams/teamB-id/members/:userId/role` and have it succeed because their session state says they are an EM. Server-side authorization must verify team membership for the specific team in the request path.

**[REQUIRED] The API contract update and use case update must occur as a single simultaneous change, reviewed together.** This is already flagged as a prerequisite, and I am confirming it from the security side. Implementation cannot begin with two documents in conflict about who the authorized actor is.

**[OBSERVATION] The escalation UX exposes organizational structure.** When the member management view surfaces the Application Admin's name and contact path to an unauthorized actor (a Facilitator), it discloses who holds the admin role in the application. For this application's threat model — internal, small user population — this is acceptable. I am noting it so the decision is explicit, not overlooked.

---

## 2. Privilege Escalation Analysis

**Finding:** The primary escalation path was correctly identified and blocked. Two secondary paths are not addressed.

### 2a. Facilitator-as-attacker path (correctly blocked)

The design correctly identifies that a Facilitator who can assign EM roles could grant session history access as a side effect of a routine setup operation. Option A blocks this. This is the correct outcome.

### 2b. EM self-demotion followed by re-elevation

**[RECOMMENDED]** The design does not address whether an EM can demote themselves. If they can, and if another EM on the same team can then re-elevate them, there is a rotation pattern that could be used to obscure access. The audit log would capture this, which is mitigating — but the design should explicitly state whether self-demotion is permitted. My recommendation: permit it (blocking it creates operational problems), but ensure the audit log captures it clearly enough that a pattern of elevation/demotion rotation is visible in a log review.

### 2c. EM grants EM to all team members

**[OBSERVATION]** An EM can designate every participant on their team as an Engineering Manager, leaving zero Engineers. The design correctly implements a warn-and-allow rather than a block on this. From a security standpoint this is acceptable — an EM doing this is acting with deliberate intent and the audit log records it — but the warn-and-allow only makes sense if the audit trail is complete and queryable. An organization that never reviews the audit log has no compensating control for this pattern. I flag this as an observation, not a blocker.

### 2d. Cross-team path via URL manipulation

This is addressed implicitly by the requirement that EM authorization is team-scoped, but the implementation must close it explicitly. See item 1 above (EM authorization verified per team from database). If the authorization check is "is this user an EM anywhere," rather than "is this user an EM on this specific team," an EM on any team could modify roles for any team.

---

## 3. Audit Log Design

**Finding:** Intent is correct; specification is insufficient for consistent implementation.

Decision 7 specifies: actor user ID, subject user ID, team ID, from-role, to-role, timestamp. Both promotions and demotions. Append-only, not user-editable. This is the right set of fields as a baseline. The gaps:

**[REQUIRED] The actor's authorization basis must be logged.** The audit record must include the actor's `global_role` at the time of the change (specifically whether they acted as `application_admin` or as `engineering_manager`). Without this, a post-incident review cannot determine whether a role change was authorized. If an admin's account is compromised and used to make role changes, the log needs to answer not just "who" but "what privilege did they exercise." Actor user ID alone is insufficient.

**[REQUIRED] The audit log write must be in the same transaction as the role change, or the design must explicitly address what happens if the audit write fails.** If the role change commits and the audit write fails, you have a privileged operation with no record. The correct implementation is a single transaction covering both. If an out-of-transaction approach is used (a message queue, a separate write), the design must specify what happens on failure — does the role change roll back, or does the missing audit entry get flagged for investigation? This must be stated explicitly, not left to the implementation team to decide.

**[REQUIRED] Audit log retention policy must be specified.** The current design does not specify how long audit records are retained, where they are stored, or who can read them. Session history access is described as sensitive. An audit log covering access grants and revocations for sensitive data is itself sensitive. The following must be documented before implementation begins:
- Minimum retention period
- Whether audit log access requires elevated privilege (i.e., can a regular EM read the audit trail for their team, or is it admin-only?)
- Whether audit records are stored in the application database (meaning a compromised application admin can delete them) or in a separate write-only destination

**[RECOMMENDED] The actor's IP address should be included in the audit record.** For a small-population internal application this is often sufficient to establish context for incident investigation. It is a low-cost addition that aids post-incident scope analysis.

**[RECOMMENDED] Mid-session role changes should log the active session ID if one exists.** If a role is changed while a session is active for the team, the audit record should note the session ID. This lets an incident responder correlate a suspicious role change to a specific session without cross-referencing timestamps across log sources.

**[OBSERVATION]** The audit log design covers role changes but does not cover read access to the audit log itself. If an actor reads the audit log, that access should be logged. This is a future concern, not a blocker for this change — but the design should be built with this in mind.

---

## 4. Immediate-Effect Requirement and Role Caching

**Finding:** Correctly specified for HTTP requests. Unaddressed for WebSocket connections. This is a gap.

Decision 4 is the right call: read `team_memberships.membership_role` from the database on each request that requires team-specific authorization. Do not cache in session cookie, in-memory store, or middleware state. This eliminates the window where a cached `participant` role would allow a newly designated EM to cast a vote.

**[REQUIRED] The WebSocket connection is not addressed.** The design specifies immediate effect "on the next authenticated request." For HTTP requests this is clear. For the application's WebSocket channel — specifically the vote lock-in mechanism and the facilitator readiness grid — this requires explicit specification.

If a user is connected via WebSocket and their role is changed from `participant` to `engineering_manager` during an active session, two behaviors must be specified:

1. **Server-side:** The vote lock-in handler on the server must check `team_memberships.membership_role` on each lock-in attempt, not use a value established at WebSocket connection time. This is the more critical requirement. Decision 4 implies this, but it must be stated explicitly for the WebSocket path.

2. **Connection-level:** Must the application close or invalidate the WebSocket connection when a role change occurs? Or is it sufficient to reject individual operations at the handler level? My position: per-operation server-side checks are sufficient and correct — but this must be the explicitly designed behavior, not an assumption.

The persona document I reviewed prior to this engagement flags WebSocket re-authorization as a standing concern on this application. A long-lived WebSocket connection opened before a role change must not permit operations that the role change should prohibit. The design must state how this is handled.

**[REQUIRED] Redis caching must be explicitly out of scope for role data.** The application's tech stack includes Redis. If any layer caches `team_memberships.membership_role` in Redis — for performance reasons, for example — Decision 4 is violated. The design must state explicitly that role data is never cached in Redis or any in-memory store, and the code review must verify this. A developer who sees repeated per-request DB reads for role data and "optimizes" them into Redis cache will break the immediate-effect guarantee silently.

**[RECOMMENDED] The "next authenticated request" formulation should address in-flight requests.** If a role change is committed at time T, and a vote lock-in request was submitted at T-epsilon (before the change) but has not yet been processed by the server at time T, how is it handled? The most defensible answer is: the server processes it in the order received. If the lock-in arrives before the role change is committed to the database, the lock-in succeeds — this is correct behavior per the design's own statement about preserving pre-change locked-in votes. This edge case does not require a specification change but should be confirmed as understood by the implementation team.

---

## 5. Deferred and Implicit Security Decisions

The following security decisions are either deferred to future work or implicit in the current design. I am flagging each so they are not forgotten.

### 5a. Bootstrapping the first Application Admin — security gap, not just an operational concern

**[REQUIRED — for pre-production deployment, not for this change]** The design correctly defers the bootstrapping question to a named follow-on with a named owner. I want to add a security dimension to that deferral: the bootstrapping mechanism is not only an adoption concern, it is a security concern. The first Application Admin account is provisioned by an out-of-band mechanism — a seed migration, a bootstrap endpoint, or IdP role claims. Each of these has a different security posture:

- **Seed migration run at deployment:** Credentials or privilege grants in migration scripts have a history of landing in source control. If this path is chosen, the migration must not contain credentials, must be idempotent, and must emit an audit record when it runs.
- **Bootstrap endpoint activated on first deploy:** Must be disabled after first use. If it remains active, it is a privilege escalation endpoint. The disablement must be automatic or verified, not manual.
- **IdP role claims honored by First Access:** Must be validated, not trusted. A token from an IdP with role claims must have those claims verified against the IdP, not simply read from the token payload.

The bootstrapping mechanism must specify which of these paths is chosen and what its security controls are. This must be documented before any team is onboarded, and the audit log must show the bootstrap operation when it occurs. An admin account provisioned through an invisible mechanism with no audit trace is a gap I cannot sign off on.

### 5b. Session history access as a privilege grant — scope of "sensitive data" not defined

**[RECOMMENDED]** The design correctly identifies session history as potentially sensitive data, which is the rationale for requiring EM designation to be a deliberate organizational decision. What the design does not define is what session history contains, what its data classification is, and whether that classification informs how it is handled at the storage layer. Role assignment creates and revokes access to this data. The data being protected should be classified before the access control mechanism for it is implemented. This is not a blocker for this change, but the classification must exist before the session history access feature reaches production.

### 5c. Audit log access is not specified

Partially addressed in section 3 above. Beyond retention and storage, the design is silent on who holds read access to audit records. An Application Admin who can also delete or modify audit records provides weak accountability guarantees. If audit records are stored in the application database and accessible to Application Admins through the application UI, a compromised admin account can cover its tracks. I am flagging this as a design gap to be addressed before production deployment.

---

## 6. Additional Security Findings

### 6a. CSRF protection on PATCH /api/v1/teams/:teamId/members/:userId/role

**[REQUIRED]** The design does not mention CSRF protection on the role assignment endpoint. PATCH requests that change authorization state are a CSRF target. The application must apply CSRF protection to this endpoint consistent with how it protects other state-changing endpoints. This is not specific to this change but must be confirmed as part of implementation.

### 6b. Server-side input validation for the role value

**[RECOMMENDED]** The database enum constraint on `membership_role` is a correct and reliable guardrail against invalid values. The API layer should also validate the submitted role value before it reaches the database. The accepted values are exactly two: `participant` and `engineering_manager`. An explicit allowlist validation at the API layer — rejecting any other value with a 400 before it reaches the ORM — is the defense-in-depth posture. The enum constraint is the backstop; the API validation is the first gate.

### 6c. Rate limiting on the role assignment endpoint

**[RECOMMENDED]** The design does not specify rate limiting on TEAM-005. A compromised admin or EM account used to mass-modify roles would benefit from rate limiting that triggers an alert or throttle. Given the small expected user population, a conservative rate limit (e.g., ten role changes per minute per actor) would not affect legitimate usage and would provide a detection signal for anomalous activity.

### 6d. The facilitator-from-another-team rule is unaffected by this change — confirm explicitly

**[OBSERVATION]** The exploration notes correctly identify that EM designation does not affect facilitator eligibility, because the facilitator constraint checks for the existence of any team membership row, not the role value. This is correct, and I want it documented explicitly in the implementation notes so a developer does not attempt to "optimize" the facilitator constraint check in a way that starts considering role values.

### 6e. Real-time role change event must be scoped to authorized recipients

**[REQUIRED]** Decision 6 requires the facilitator's readiness grid to update in real-time when a role is changed mid-session. This requires the server to emit an event over the WebSocket channel. That event must be scoped to authorized recipients: the facilitator of the active session, and (per the design) potentially the affected user. It must not be broadcast to all connected clients. The event payload must not include data the recipient is not authorized to see. This must be part of the implementation specification for the real-time update, not left to the WebSocket event dispatch layer to get right by convention.

---

## 7. Summary: Items Requiring Resolution Before Sign-Off

The following are [REQUIRED] items that block my sign-off on implementation:

| # | Item | Where Addressed |
|---|---|---|
| R1 | EM authorization verified per-team from DB at request time (not session state) | Section 1 |
| R2 | Use case and API contract updated simultaneously as a single reviewed change | Section 1 |
| R3 | Actor's authorization basis (global_role) included in audit log record | Section 3 |
| R4 | Audit write in same transaction as role change, or failure behavior explicitly designed | Section 3 |
| R5 | Audit log retention, storage, and read-access policy specified | Section 3 |
| R6 | Immediate-effect guarantee explicitly covers WebSocket lock-in handler (per-operation check, not connection-time check) | Section 4 |
| R7 | Redis or in-memory caching of role data explicitly prohibited and verified in code review | Section 4 |
| R8 | CSRF protection confirmed on PATCH /api/v1/teams/:teamId/members/:userId/role | Section 6a |
| R9 | Real-time role-change event scoped to authorized recipients only | Section 6e |
| R10 | Bootstrapping mechanism specified with security controls documented (pre-production, not blocking this change) | Section 5a |

Items marked [RECOMMENDED] should be addressed in this change but do not block sign-off. Items marked [OBSERVATION] are recorded for future reference.

---

## 8. Sign-Off Position

I will sign off on Q1 (Option A is the correct model) as soon as R1 and R2 above are resolved and reflected in the updated documents. The remaining required items (R3–R9) must be addressed in the implementation specification before development begins on the role assignment API and UI. R10 must be resolved before any team is onboarded, not before code ships.

The design team has done the hardest part correctly: they identified that EM designation is a privilege grant, chose the more restrictive authorization model, required both-direction audit logging, and built in a prerequisite ordering that prevents a window where the enforcement check is incomplete. The gaps I have identified are mostly at the specification layer — things that are implied but not made explicit enough to be implemented consistently. That is a solvable problem.

I am available for a working session on R3–R5 (audit log design) and R6 (WebSocket authorization) before the implementation spec is finalized.
