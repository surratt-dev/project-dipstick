## Context

Engineering Managers are non-participants by design. The Health Check ritual depends on their absence from live sessions — but they need post-session visibility into the trends that session data produces. This change creates the formal EM/team relationship and the read-only access model that enables that visibility without enabling session access.

The `team_memberships` table already handles EM relationships in two paths: TEAM-005 (changing the role of an existing team member) and TEAM-006 (establishing the relationship for a user who was never a team member). TEAM-005 is implemented. TEAM-006 is not. This change implements TEAM-006 and the EM-facing views that depend on it.

Two prerequisite decisions that were blocking at proposal time are resolved in Decisions 1 and 2 below. Implementation must not begin until those decisions are reflected in the first-access spec and the use case document. Additional blocking implementation issues identified in design review are resolved in Decisions 9–14. All decisions must be documented in the relevant specs before the corresponding implementation phase begins.

## Goals / Non-Goals

**Goals:**

- Implement `POST /api/v1/teams/:teamId/managers` (TEAM-006) with idempotent behavior, differentiated error responses, and a transactional audit trail
- Implement the `global_role = 'engineering_manager'` assignment mechanism via IdP role claim mapping in the OIDC flow, with explicit token validation requirements documented in the first-access spec
- Implement EM read-only access to session history, trend data, and action items — with explicit field-level vote attribution boundaries enforced at the serialization layer and verified by API-layer unit tests in CI
- Build net-new endpoint implementations for SESSION-007, SESSION-008, TREND-001, TREND-002, ACTION-004, and ACTION-005 with EM-facing serialization paths that enforce the vote attribution boundary
- Build `GET /api/v1/teams/:teamId` (TEAM-003) with `participants` and `engineeringManagers` arrays; update `TeamMembersResponse` in `@dipstick/shared` as a Phase 2 prerequisite
- Create the `audit_log` table as a schema change in this change's scope; migrate TEAM-005 audit writes to it; ensure the TEAM-006 audit record is written in the same database transaction as the `team_memberships` row
- Update the team administration view to display participant members and associated managers in separate, labeled sections
- Add a participant-accessible access model statement (one sentence, findable but not prominent) in both the team view and the session lobby
- Document the EM/team relationship removal as explicitly out of scope with a written interim administrative procedure, a named owner, and a defined condition for when the follow-on change enters the backlog

**Non-Goals:**

- Removal of the EM/team relationship (separate use case, out of scope)
- Notifications to the EM upon association
- Any EM access to live session data (current votes, readiness grid, who is connected)
- Individual vote attribution in any EM-facing view
- Cross-team aggregate or comparison views for multi-team EMs (per-team access only)
- EM write access to session history, action items, or topic configuration

## Decisions

### Decision 1: Authorized actor for TEAM-006 — RESOLVED: Application Admin

**Decision:** Application Admin is the authorized actor for TEAM-006.

**Rationale:** Establishing an EM/team relationship grants permanent, ongoing read-only access to session history, trend data, and action items for the life of the association. This is a consequential, indefinite access grant — not a transient operational action. Application Admin accounts carry institutional accountability that rotating Facilitator accounts do not. Rachel Okonkwo (VP Engineering) has made this the organizational governance position, and the API contract already reflects it. The use case document currently says Facilitator; it must be corrected to say Application Admin before implementation begins.

**Ritual integrity note:** Restricting TEAM-006 to Application Admins does not touch the no-manager-participation constraint or the facilitator-from-another-team requirement. Both remain structural. The admin-only restriction makes the EM access grant a deliberate, audited action rather than something a passing Facilitator can perform without institutional accountability.

**Escalation path constraint:** Because the authorized actor is the Application Admin, the team administration view must present a plain-language explanation to users who lack TEAM-006 permission, with an unambiguous contact path to the admin. A grayed-out control with no explanation does not meet the requirement. Minimum acceptable text: "Associating an Engineering Manager requires Application Admin access. Contact your admin to complete this before the session." The contact path must be specific — an email address, an in-application message path, or an equivalent mechanism.

---

### Decision 2: Mechanism for `global_role = 'engineering_manager'` — RESOLVED: Option A (IdP role claim mapping)

**Decision:** The mechanism for setting `global_role = 'engineering_manager'` is Option A — the OIDC flow reads a role claim from the signed ID token and maps it to `global_role` in the `resolveOrCreateAccount` function.

**Rationale:** Option A keeps role assignment in the authoritative identity system, avoids creating a permanently deployed high-sensitivity API surface, and is provider-agnostic when implemented correctly. Option B (bootstrap endpoint) was rejected because Option A is viable and Option B creates new attack surface that is avoidable. Option C (seed migration) was rejected as non-scalable by both the security analyst and this review.

**Explicit token validation requirements — all five must appear in the first-access spec before Phase 1 implementation begins:**

1. **Claim name configuration:** The claim name that carries the role assignment must be a configuration value, not hardcoded. The first-access spec must name the specific claim (e.g., a custom claim, the standard `roles` claim, or a provider-specific attribute). This is a required decision, not an implementation detail.
2. **Signed ID token only:** The role claim must be read from the signed ID token only — not from the userinfo endpoint. Claims from the userinfo endpoint are not signed and must not be used for role assignment.
3. **Absent claim behavior:** When the role claim is absent from the token, the user receives the default role (`engineer`). A missing claim is not an error — it is the normal case for non-EM users.
4. **Allowlist validation:** The claim value must be validated against an explicit allowlist of permitted role strings before the mapping is applied. Any claim value not on the allowlist must be rejected with a logged warning. It must not be silently mapped or silently ignored in a way that could be exploited by claim injection.
5. **Re-evaluation on each authentication:** The role mapping must be re-evaluated on each authentication (initial sign-in and token refresh/re-login). If a user's IdP role is changed by an administrator, the application reflects that change at the user's next authentication. The first-access spec must state this explicitly.

**Constraint:** The end-to-end path — user has IdP role claim → signs in → `global_role = 'engineering_manager'` is set — must be tested before TEAM-006 implementation begins. Teams must not be promised EM history access until this test passes.

---

### Decision 3: TEAM-006 idempotency response codes and implementation

**Decision:**
- Create-new case (no existing active `team_memberships` row): `201 Created`
- Update-existing case (idempotent re-association): `200 OK`
- Response body is identical in both cases — the response does not reveal whether a row was created or updated

**Implementation requirement — use PostgreSQL `xmax`, not SELECT-before-INSERT:**

```sql
INSERT INTO team_memberships (user_id, team_id, role)
VALUES ($1, $2, 'engineering_manager')
ON CONFLICT (user_id, team_id) WHERE removed_at IS NULL
DO UPDATE SET role = 'engineering_manager'
RETURNING id, (xmax = 0) AS is_new_row
```

`xmax = 0` is true for freshly inserted rows and false for updated rows. This determines 201 vs. 200 atomically from the upsert result without a separate SELECT. A SELECT-before-INSERT approach has a race condition identical to the one TEAM-005 solved: two concurrent admin calls both see "no row," both attempt INSERT, one fails. Document the `xmax` idiom in a code comment — it is a PostgreSQL-specific internal and the next engineer who reads it must understand why it is there.

**Prerequisite:** The `ON CONFLICT` target requires a partial unique constraint on `(user_id, team_id) WHERE removed_at IS NULL` in `team_memberships`. If this constraint does not exist in the migration files, add it as a prerequisite migration for TEAM-006.

---

### Decision 4: TEAM-006 error differentiation

**Decision:** 409 Conflict is used only for the `global_role` precondition failure. Other failure conditions use distinct codes:
- `404 Not Found` — team not found (or team found but caller is not authorized to know it exists — see constraint below)
- `409 Conflict` — target user does not have `global_role = 'engineering_manager'`
- `403 Forbidden` — actor is not authorized

The 409 response body MUST include a machine-readable error code that distinguishes the `global_role` precondition failure from any other 409-eligible condition. The escalation UX in the team administration view depends on being able to display the specific failure reason.

**404 information exposure constraint:** A 404 for "team not found" must be indistinguishable from a 404 for "team found but caller is not authorized to know it exists" when the caller is not an Application Admin. Error responses must not leak existence information beyond what is authorized.

---

### Decision 5: Vote attribution boundary

**Decision (Devon Calloway must confirm in writing before EM-facing view design begins):**

EM-facing views of session history and trend data must not surface the connection between a specific vote value and the participant who cast it:
- Aggregate vote distributions (e.g., "3 participants voted 4, 1 participant voted 2") are permitted
- Named or identifiable per-participant vote values are prohibited
- Statistical displays (averages, medians, ranges) that do not label individual participants are permitted
- The presence or absence of an outlier flag is permitted; the identity of the outlier is not

**Implementation constraints:**

1. EM-facing session history queries must never `SELECT voter_id` from the `votes` table. Aggregate by `vote_value` only.
2. The response serialization for EM-facing endpoints must not include any field that can be cross-referenced to identify a voter — this includes participant display names, user IDs in `session_participants` rows, and vote timestamps fine-grained enough to enable correlation attacks.
3. A unit test at the route handler level must assert that the JSON response body for an EM session history request contains no `userId`, `voter_id`, `voterId`, `displayName` (when applied to vote rows), or equivalent field. This test runs in CI on every PR. The QA acceptance criterion (EM-role account against actual session data, not fixture data) is a required supplement, not a substitute — both are required.

**This decision is a gate, not a design guideline. EM-facing view design cannot begin until Devon has confirmed this boundary in writing.**

---

### Decision 6: Full historical access from association date

**Decision:** Upon successful TEAM-006 call, the EM is granted read access to the full session history of the associated team. This access is not date-bounded to the association date. Sessions completed before the association was established are included.

**Rationale:** Post-session historical access is the entire point. Bounding access to sessions after the association date would deprive the EM of the trend context that makes the data meaningful.

**Security implication (acknowledged, not contested):** A compromised EM account exposes the complete historical session archive of every associated team — not only recent sessions. For a team with three years of session history, that is the full three-year archive. This is documented as an accepted organizational risk. The mitigating controls are OIDC token validation, session revocation at the IdP, and EM account monitoring. The threat model must name this scenario explicitly before the first team goes live with EM history access.

---

### Decision 7: Labeled sections in team administration view

**Decision:** The team administration view MUST display participant members (`team_memberships.role = 'participant'`) and associated managers (`team_memberships.role = 'engineering_manager'`) in separate, labeled sections. The section headings must make clear that associated managers are not session participants.

**Acceptance criterion:** A facilitator who has never used the application can correctly identify which users will receive a session invite and which will not, without reading help documentation.

---

### Decision 8: Participant-accessible access model statement

**Decision:** A one-sentence statement — "Your Engineering Manager can see session history but cannot join or observe live sessions" — is accessible from both the team view (persistent reference) and the session lobby (contextual). It is not prominent (no modal, no acknowledgment flow, no notification). It is findable if a participant wants to verify. Acceptance criteria must verify both surfaces.

---

### Decision 9: Audit log table — schema and atomicity

**Decision:** This change creates a general-purpose `audit_log` table as a database migration within Phase 2 scope:

```
audit_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id     UUID NOT NULL,
  actor_global_role TEXT NOT NULL,
  actor_ip          INET,
  target_user_id    UUID,
  team_id           UUID,
  operation         TEXT NOT NULL,
  timestamp         TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata          JSONB
)
```

TEAM-005's writes to `role_change_audit` are migrated to `audit_log` in the same migration that creates the new table. `role_change_audit` is dropped in that migration. The `AuditEventName` union in `packages/backend/src/auth/audit-logger.ts` gains `"team.manager_established"`. Tests for TEAM-005 audit behavior in `teams.test.ts` (including test "4.4" which checks positional parameters `[1]` through `[6]`) must be updated to match the new schema before TEAM-006 implementation begins.

**Atomicity requirement — non-negotiable:** The TEAM-006 audit record MUST be written to `audit_log` within the same database transaction as the `team_memberships` row. A structured application log write is not acceptable for this operation. TEAM-006 grants indefinite, retroactive access to sensitive historical data. The audit record is the control that makes this grant detectable and reviewable. A simulated transaction rollback must produce neither a `team_memberships` row nor an audit record. A committed transaction must produce both. This will be verified by the security analyst before production deployment.

**Rationale for new table over extending `role_change_audit`:** The `role_change_audit` schema (`from_role`/`to_role`, `subject_user_id`) is incompatible with the TEAM-006 audit fields (`operation`, `target_user_id`). Extending it with nullable columns produces a table serving two incompatible record shapes. A general-purpose `audit_log` table handles both operations cleanly and positions the system for future audit requirements without schema gymnastics.

---

### Decision 10: Authorization flag for TEAM-006 — `canAssociateManagers`

**Decision:** `TeamMembersResponse` in `@dipstick/shared` gains a new boolean field: `canAssociateManagers`. This field is `true` when `actor.global_role = 'application_admin'`. It is computed server-side per request, the same pattern as the existing `canAssignRoles` flag.

**Rationale:** `canAssignRoles` permits both Application Admins and EMs who hold EM membership on the specific team (per TEAM-005 authorization). TEAM-006 is admin-only. If the frontend renders the "Associate Manager" control based on `canAssignRoles`, EMs see the affordance, attempt the operation, and receive a 403. That is worse UX than not showing the control. `canAssociateManagers` correctly targets only Application Admins. The escalation message required by Decision 1 renders when this flag is `false`.

---

### Decision 11: Phase 3 endpoint scope — net-new implementations, not authorization unlocks

**Decision:** SESSION-007, SESSION-008, TREND-001, TREND-002, ACTION-004, and ACTION-005 do not exist in the current backend. Phase 3 is a full backend build — six new route handlers, new database queries, purpose-built EM serialization logic, and new shared types. These are not authorization unlocks on existing routes.

**Why this must be stated explicitly:** The proposal's framing — "these endpoints already model EM authorization in the API contract; the `team_memberships` row written by TEAM-006 is the key that makes the authorization checks pass" — is inaccurate as a description of the code. The backend routes directory contains `teams.ts`, `sessions.ts`, `auth.ts`, `join-links.ts`, and `health.ts`. The implementations for session history, trend, and action item endpoints do not exist. A developer who reads "authorization checks already pass once the membership row exists" and reaches for a general-purpose session history query will miss that the EM-facing serialization path must be purpose-built to enforce the vote attribution boundary (Decision 5). The attribution constraint cannot be retrofitted onto a query written for participant views.

**EM access audit trail for Phase 3 endpoints:** Every EM access to a session history, trend data, or action item endpoint that returns data must generate an audit record in `audit_log`. Required fields: caller identity, team ID, session identifier where applicable, timestamp. Bulk reads (a trend view covering multiple sessions) log the team ID and date range — not an individual audit row per session returned, which would create log volume without proportional security value.

---

### Decision 12: TEAM-003 and `TeamMembersResponse` shape

**Decision:** `GET /api/v1/teams/:teamId` (TEAM-003) does not exist in the current backend. The current backend exposes `GET /api/v1/teams/:teamId/members`. `TeamMembersResponse` in `packages/shared/src/types/team.ts` has a single flat `members: TeamMember[]` array. Both must be built.

**Selected shape:** `TeamMembersResponse` becomes `{ participants: TeamMember[]; engineeringManagers: TeamMember[]; canAssignRoles: boolean; canAssociateManagers: boolean; ... }`. The backend knows the role at query time — sending a flat list and expecting the client to segment it correctly creates a dependency between frontend rendering logic and the database schema that the type system cannot enforce. A new role category added to `team_memberships` produces silent rendering bugs in the UI if the client segments by role.

**Coordination requirement:** The shared type change must ship together — `TeamMembersResponse` in `@dipstick/shared`, the backend route handler query and response serialization, and the `MemberManagement` component. The type change is a compile-time boundary. CI fails if the backend ships without the updated shared type. That is the correct behavior.

**Phase ordering:** The `TeamMembersResponse` type change must be implemented in Phase 2 (alongside TEAM-006), not Phase 4 (team administration view). After TEAM-006 ships to production, an EM appears in `team_memberships` with `role = 'engineering_manager'`. The current query selects `WHERE removed_at IS NULL` with no role filter — the EM appears in the flat `members` array and `MemberManagement` renders a role selector offering "promote to EM" (a no-op that returns 200 and shows a confirmation message). This is a confusing UX inconsistency that will be reported as a bug. The type boundary must be in place before Phase 2 ships to production.

---

### Decision 13: Action item body text visibility to EMs

**Decision:** Action item body text (title and description) is visible to Engineering Managers in full in ACTION-004 and ACTION-005 responses.

**Rationale:** The attribution boundary in this change protects vote data — it prohibits surfacing the connection between a specific vote value and the participant who cast it. Action item task descriptions are operational work-tracking data. An EM needs to understand the substance of the actions their team has committed to in order to follow up on health improvements. A per-item `reviewed_for_em_display` flag and a review workflow would add implementation complexity and ongoing operational overhead for content that does not cross the vote attribution boundary. The complexity is not justified.

**Boundary clarification:** This decision covers action item body text. It does not change the vote attribution boundary — individual vote values and per-participant vote attribution remain prohibited in all EM-facing views. Q8 in the proposal resolved assignee visibility; this decision resolves body text visibility. Both are now resolved.

**Known inference risk (accepted):** An EM who knows a specific engineer was assigned an action item following a session where a topic scored poorly has an inference path toward individual vote attribution in small teams. This is an indirect inference, not a direct attribution exposure. It is accepted as an organizational decision and must be named in the threat model as a known inference risk — not as a boundary violation.

---

### Decision 14: Dual authorization check retention

**Decision:** The `global_role = 'engineering_manager'` check and the `team_memberships.role = 'engineering_manager'` check for EM data access MUST be implemented as independent controls and must remain independent. An earlier recommendation in the design to simplify these checks because "they resolve to the same row" is withdrawn.

**Rationale:** The `global_role` check is a global role guard. The `team_memberships.role` check is a team-scoped association guard. They serve different purposes even when they produce the same result in the common case. If a user's `global_role` is updated out-of-band while their `team_memberships` row is not, or if a future change allows `global_role = 'engineering_manager'` to be set without going through TEAM-006, consolidating these checks creates a single point of failure with no backstop. The solution is clear code documentation explaining why both checks exist, not removing one. This is consistent with the Risks section requirement that "the session-participation spec's dual enforcement must not be weakened."

## Risks / Trade-offs

**[Risk] IdP role claim mapping misconfigured → EM role not assigned** → Mitigation: End-to-end test (user has IdP role claim → signs in → `global_role = 'engineering_manager'` is set) is a Phase 1 gate. TEAM-006 implementation does not begin until the test passes.

**[Risk] Vote attribution boundary enforced in spec prose but not in serialization** → Mitigation: API-layer unit test at the route handler level asserts the response body contains no vote-attributing fields. QA acceptance criterion (EM-role account against actual session data) supplements but does not substitute for the CI test. Both are required.

**[Risk] EM association cannot be removed → access control liability compounds over time** → Mitigation: Written interim administrative procedure documented in Q4. A named owner for the follow-on removal change is required before deployment. An association that cannot be removed is a sustained access control liability — the follow-on change must be scheduled before the first team goes live.

**[Risk] Multi-team EM sees a cross-team aggregate landing view by default** → Mitigation: Evidence from spreadsheet usage shows EMs examine each team independently. The default landing experience is a team selector, not a cross-team comparison view.

**[Risk] TEAM-006 and TEAM-005 treated as interchangeable by implementors** → Mitigation: TEAM-006 has a precondition (`global_role = 'engineering_manager'`) that TEAM-005 does not. They must remain distinct endpoints. Document this boundary explicitly in code comments at both endpoints.

**[Risk] Session participation enforcement weakened if global_role precondition for TEAM-006 is relaxed in future** → Mitigation: Both the `global_role` check and the `team_memberships.role` check remain in place and independent (Decision 14). The dual check must not be weakened regardless of how the relationship was established.

**[Risk] Compromised EM account exposes complete historical session archive** → Mitigation: Accepted organizational risk per Decision 6. Mitigating controls are OIDC token validation, session revocation at the IdP, and EM account monitoring. The threat model must name this scenario explicitly before the first team goes live.

**[Risk] Bulk TEAM-006 calls under compromised admin account** → Mitigation: Rate limiting on TEAM-006 is a required compensating control. The spec must specify the threshold before Phase 2 implementation begins.

## Migration Plan

**Phase 0 — Prerequisite decisions (no coding until complete):**

1. Decision 1 is resolved as Application Admin. The "Establish a Manager/Team Relationship" use case document must be updated to reflect Application Admin as the authorized actor. The API contract already reflects this and does not change.
2. Decision 2 is resolved as Option A (IdP claim mapping). The first-access spec must be updated with all five token validation requirements from Decision 2 before Phase 1 begins.
3. Devon Calloway confirms the vote attribution boundary (Decision 5) in writing. EM-facing view design cannot begin until this confirmation is received.
4. Threat modeling session must be completed before Phase 2 begins. Required scenarios: TEAM-006 as an access escalation vector, EM account compromise, IdP claim manipulation, and retroactive historical data exposure under Decision 6. This session was committed to at the initial architecture review; it must be scheduled before Phase 2, not before production deployment.
5. PENDING markers in `specs/manager-team-association/spec.md` — the authorized actor line and the action item assignee line — must be replaced with the resolved decision text before any implementation task begins. A developer who reads a PENDING marker in the spec has no ground to stand on.

**Phase 1 — Global role mechanism:**
- Implement IdP role claim mapping in `resolveOrCreateAccount` per the five token validation requirements in Decision 2
- Verify end-to-end: user has IdP role claim → signs in → `global_role = 'engineering_manager'` is set and testable in an integration test
- Phase 2 does not begin until this test passes

**Phase 2 — TEAM-006 endpoint and shared type change:**
- Create `audit_log` table migration; migrate TEAM-005 audit writes; drop `role_change_audit`; update `AuditEventName` union; update TEAM-005 tests (Decision 9)
- Implement `TeamMembersResponse` shape change (`participants` / `engineeringManagers` split); add `canAssociateManagers` flag; update backend route, shared types, and `MemberManagement` component simultaneously (Decisions 10, 12)
- Implement `POST /api/v1/teams/:teamId/managers` (TEAM-006) with xmax idempotency (Decision 3), error differentiation with 404 information-exposure constraint (Decision 4), `canAssociateManagers` flag (Decision 10), and transactional audit write to `audit_log` (Decision 9)
- Implement escalation path in team administration view (Decision 1 constraint)
- The security analyst will verify atomicity (successful TEAM-006 call produces both `team_memberships` row and audit record; simulated rollback produces neither) before Phase 3 begins

**Phase 3 — EM read-only views (net-new backend build):**
- Implement SESSION-007, SESSION-008, TREND-001, TREND-002, ACTION-004, ACTION-005 as net-new route handlers with purpose-built EM serialization paths (Decision 11) — these are not authorization unlocks
- Every handler enforces the vote attribution boundary at the serialization layer (Decision 5) — no `voter_id` in queries, no voter-identifying fields in response bodies
- API-layer unit tests assert that EM response bodies contain no vote-attributing fields (Decision 5) — these must be in CI before Phase 3 ships
- Every handler writes EM access audit records to `audit_log` (Decision 11)
- QA acceptance criterion: security analyst tests with an EM-role account against actual session data, not fixture data — attribution boundary must hold

**Phase 4 — Team administration view and access model statement:**
- Update team administration view with separate labeled sections — the `TeamMembersResponse` shape from Phase 2 makes the `participants` / `engineeringManagers` split available; Phase 4 is a rendering change, not a data model change
- Add participant-accessible access model statement in team view and session lobby; acceptance criteria must verify both surfaces
- Verify CORS configuration for all EM-facing endpoints before Phase 4 ships to production
- Verify that WebSocket endpoints correctly exclude EM-role accounts from live session access

**Rollback:**
- TEAM-006 is additive (new endpoint, new EM-facing views). Rollback removes the endpoint and views. Existing `team_memberships` data is not affected by rollback.
- Phase 1 rollback: the IdP claim mapping can be removed by reverting the `resolveOrCreateAccount` change and the first-access spec update. Users who already had `global_role` set via the claim retain it until next authentication if the claim is absent.
- Phase 2 rollback: the `audit_log` migration replaces `role_change_audit`. Rolling back Phase 2 requires restoring `role_change_audit` and its data from backup or a reverse migration. This must be scripted before Phase 2 ships.

## Open Questions

**Q1 — RESOLVED:** How does a user acquire `global_role = 'engineering_manager'`?
Resolved as Option A (IdP role claim mapping). See Decision 2. The first-access spec must be updated with the five token validation requirements before Phase 1 begins.

**Q2 — RESOLVED:** Who is the authorized actor for TEAM-006?
Resolved as Application Admin. See Decision 1. The use case document must be corrected before any implementation begins.

**Q3 (Pre-design gate): Vote attribution boundary confirmation**
Devon Calloway must confirm the boundary in Decision 5 in writing. EM-facing view design cannot begin until this is received.

**Q4 (Out of scope — interim procedure required before deployment):**

Removal of the EM/team relationship is explicitly out of scope for this change. A follow-on change is required and must be assigned before this change is deployed to production.

*Interim administrative procedure (must exist in writing before the deployment gate is cleared):*

- **Authorized actor:** Application Admin only.
- **Operation:** `UPDATE team_memberships SET removed_at = NOW() WHERE user_id = $1 AND team_id = $2 AND role = 'engineering_manager' AND removed_at IS NULL`. This is a soft-delete consistent with the existing `removed_at` pattern in `team_memberships`. Once `removed_at` is set, the EM's row no longer satisfies the `WHERE removed_at IS NULL` check and EM access to session history for that team is revoked at the next request.
- **Audit requirement:** The removal must be logged to `audit_log` with `operation = 'team.manager_removed'`, `actor_user_id`, `actor_ip`, `target_user_id`, `team_id`, and `timestamp`. The same transactional atomicity requirement from Decision 9 applies: the row update and the audit record must be in the same database transaction.
- **Named owner for follow-on change:** [To be assigned before the deployment gate is cleared.]
- **Backlog condition:** The follow-on removal change enters the backlog immediately upon deployment of this change, with a target completion before the second team goes live with EM history access.

**Q5 (Design prerequisite): Multi-team EM landing experience**
If an EM manages multiple teams, what do they see at sign-in? Team selector vs. aggregate view. Decision must be made before Phase 3 design begins. Owner: product owner, in consultation with BA.

**Q6 (Required before Phase 2): Rate limiting threshold for TEAM-006**
Rate limiting on TEAM-006 is required (see Risks). An Application Admin account is a high-value target; bulk TEAM-006 calls under a compromised account would grant historical data access across many teams before the compromise is detected. The threshold must be specified in the spec before Phase 2 implementation. Owner: BA in consultation with security analyst.

## Feedback Not Incorporated

The following feedback from the design reviews was considered and either resolved through a specific architectural decision (with alternatives rejected) or intentionally out-of-scope for this document.

### global_role Options B and C rejected in favor of Option A

**Feedback (Marcus Oyelaran and Tomás Ferreira):** Options B (bootstrap endpoint) and C (seed migration) are presented as alternatives.

**Options B and C rejected; Option A selected (Decision 2).** Option B creates a permanently deployed privileged API endpoint whose only purpose is role assignment — a high-sensitivity surface that is avoidable when Option A is viable. Option C requires a new out-of-band operation every time an EM is designated and is explicitly non-scalable. Option A is the correct architectural choice because it keeps role assignment in the authoritative identity system and is provider-agnostic when the claim validation requirements are met. The security analyst's recommendation was Option A; that recommendation is adopted.

### Extending `role_change_audit` with nullable columns rejected

**Feedback (Marcus Oyelaran):** If the team prefers not to create a new table, `role_change_audit` could be extended with `operation`, renamed columns, and nullable `from_role`/`to_role`.

**Rejected; new `audit_log` table created (Decision 9).** A table with nullable columns serving two incompatible record shapes is a design liability. The nullable-column approach would produce a schema that fails to enforce the completeness of either record type and makes future audit requirements harder to accommodate. The new `audit_log` table is a clean solution that costs one migration and updates to TEAM-005 tests — a low price for the structural benefit.

### Formal threat model document not added to design.md

**Feedback (Tomás Ferreira):** No threat model document exists for this change; a formal threat modeling session was committed to before production deployment.

**Incorporated as a Phase 0 gate, not as design.md content.** The threat model session is a process requirement — it produces a separate artifact. This document is not the right place for that artifact. The session is listed as a Phase 0 prerequisite for Phase 2. The scenarios Tomás requires (TEAM-006 as escalation vector, EM account compromise, IdP claim manipulation, retroactive data exposure) are identified in the Decisions and Risks sections to give the threat modeling session a specific starting list. The pre-production verification steps the security analyst committed to (atomicity test, attribution boundary test with real session data, dual auth check verification, WebSocket exclusion verification, interim removal procedure review) remain as explicit pre-deployment gates.

### CORS and WebSocket verification not added as design decisions

**Feedback (Tomás Ferreira — I-2, I-4):** CORS configuration for EM-facing endpoints should be verified; WebSocket endpoints should be verified to exclude EM-role accounts from live session access.

**Incorporated as Phase 4 pre-ship verification requirements, not as architectural decisions.** These are operational verification steps, not choices between alternatives with documented rationale. The non-goal ("Any EM access to live session data") already establishes the requirement. The enforcement mechanism at the WebSocket layer uses the same authorization model as the HTTP endpoints — the `team_memberships.role` check (Decision 14) correctly excludes EMs from live sessions. Verification that this holds belongs in the deployment checklist and is noted in Phase 4 of the Migration Plan.
