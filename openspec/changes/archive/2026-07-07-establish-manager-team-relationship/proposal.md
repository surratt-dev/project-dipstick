## Why

Engineering Managers need read-only visibility into their team's session history and trends — that is the entire point of the post-session access model. But the application currently has no formal mechanism to establish the relationship between an EM and the teams they oversee, and no working path to grant a user the `global_role = 'engineering_manager'` that the establishment endpoint requires. Every downstream access control decision for EMs depends on this relationship existing and being correctly constrained. It must be foundational, not improvised.

## What Changes

- Implement `POST /api/v1/teams/:teamId/managers` (TEAM-006) to create the EM/team relationship, producing a `team_memberships` row with `role = 'engineering_manager'` for a user who has not previously been a team member
- Resolve the authorized actor conflict: the use case says Facilitator; the API contract says Application Admin. This change accepts Application Admin as the authorized actor (see Resolved Decisions). Both documents must be updated simultaneously — the use case requires correction before implementation begins; the API contract already reflects the correct actor and does not change.
- Specify idempotent behavior for TEAM-006 with precisely defined HTTP status codes and response body behavior for both the create-new and update-existing cases
- Define differentiated 409 error responses so callers can distinguish "target user lacks global EM role" from other failure conditions
- Extend `first-access` to include a documented, testable mechanism for setting `global_role = 'engineering_manager'` on a user account — the TEAM-006 precondition that currently has no resolution path
- Unlock EM-authenticated access at existing endpoints SESSION-007, SESSION-008, TREND-001, TREND-002, ACTION-004, and ACTION-005 — these endpoints already model EM authorization in the API contract; the `team_memberships` row written by TEAM-006 is the key that makes the authorization checks pass. Action item assignee name (`ownerDisplayName`) is visible to EMs in ACTION-004 and ACTION-005 responses (see Resolved Decisions for Q8).
- Build new EM-facing UI views for session history, trend data, and action items — these views are in scope for this change and deliver the trend visibility approved for Engineering Managers. Field-level vote attribution boundary enforcement at the serialization layer is a hard constraint on all view design and must be confirmed by Devon Calloway before wireframes are drawn.
- Update the team administration view to display participant members and associated managers in separate, labeled sections — a structural requirement, not a layout preference
- Add a participant-accessible access model statement (one sentence, findable but not prominent) in both the team view and the session lobby
- Document the EM/team relationship removal operation as explicitly out of scope, with an interim administrative procedure and a named owner for the follow-on change

## Capabilities

### New Capabilities

- `manager-team-association`: The TEAM-006 endpoint, EM-authenticated access at existing session history / trend / action item endpoints (with field-level attribution boundaries enforced at the serialization layer), idempotent multi-team support, labeled section display of managers vs. participants in the team admin view, participant-accessible access model statement in both the team view and session lobby, and the audit trail for association establishment. **Note: this single capability slug encompasses multiple independently testable components. The tasks list decomposes these correctly. A deployment where TEAM-006 functions but a downstream component (e.g., labeled sections, access model statement) does not is a partial delivery — the capability is not fully complete until all components pass acceptance criteria.**

### Modified Capabilities

- `first-access`: Requires an added mechanism to reach `global_role = 'engineering_manager'` — either IdP role claim mapping in the OIDC flow, a privileged bootstrap endpoint (admin only, audited), or a specified seed migration procedure. **Implementation of any task in this change is blocked until the mechanism for setting `global_role = 'engineering_manager'` is documented in the first-access spec and verified end-to-end. Task 1.2 is the gate condition. The first-access spec update may proceed in parallel with early TEAM-006 work but the approach must be agreed before implementation begins — the implementation team must not be left to resolve this mid-sprint.**

## Resolved Decisions

The following questions were open at proposal draft time and are resolved here. These decisions are final for the purpose of implementation. Changes to these decisions require a new proposal review cycle.

### Authorized Actor for TEAM-006 (Q2): Application Admin

**Decision:** The authorized actor for TEAM-006 is the Application Admin, not the Facilitator.

**Rationale:** Establishing an EM/team relationship grants permanent, ongoing read-only access to session history, trend data, and action items for the life of the association. This is a consequential, indefinite access grant — not a transient operational action. Application Admin accounts carry institutional accountability that rotating Facilitator accounts do not. Rachel Okonkwo (VP Engineering) has made this the organizational governance position, and the API contract already reflects it. The use case document currently says Facilitator; it must be corrected to say Application Admin before implementation begins.

**Ritual integrity note:** The authorized actor for this administrative operation does not touch the no-manager-participation constraint or the facilitator-from-another-team requirement. Both remain structural. Restricting TEAM-006 to Application Admins is consistent with the ritual's intent — it makes the EM access grant a deliberate, audited action rather than something a passing Facilitator can perform without institutional accountability.

**Escalation path requirement:** Because the authorized actor is the Application Admin, the team administration view must present a plain-language explanation to users who lack TEAM-006 permission, including an unambiguous contact path to the admin. A grayed-out control with no explanation does not meet the requirement. Minimum acceptable text: "Associating an Engineering Manager requires Application Admin access. Contact your admin to complete this before the session." The contact path must be specific — an email address, an in-application message path, or an equivalent mechanism.

### Action Item Assignee Visibility (Q8): ownerDisplayName is visible to EMs

**Decision:** `ownerDisplayName` is visible to Engineering Managers in ACTION-004 and ACTION-005 responses. The PENDING marker in the manager-team-association spec must be removed and replaced with this stated decision before implementation begins.

**Rationale:** Action item ownership is work-tracking data, not vote attribution. The attribution boundary in this change prohibits surfacing the connection between a specific vote value and the participant who cast it — assignee names on action items do not cross that boundary. Engineering Managers need to know who owns action items in order to follow up on health improvements the team has committed to; that is the operational purpose of action items in this context. The API contract's ACTION-004 and ACTION-005 response shapes already include `ownerDisplayName` for EM callers — no contract change is required.

**Boundary clarification:** The attribution boundary protects vote data. Action item text that attributes a concern to a named engineer remains attribution-adjacent (per the vote attribution boundary in the spec) and must still be reviewed before EM-facing display. The Q8 resolution covers assignee names only, not action item body content.

### EM-Facing UI Views Are In Scope for This Change

**Decision:** New EM-facing UI views for session history, trend data, and action items are in scope for this change. When this change is complete, an Engineering Manager with an established team association can navigate to trend data and session history in the application — no follow-on change is required for basic EM view access.

**Rationale:** Rachel Okonkwo (VP Engineering) asked for explicit confirmation that EMs can actually navigate to trend data after this change completes, or whether that navigation requires a follow-on. The answer is: this change delivers the views. The API endpoints already model EM access. This change provides the authorization unlock (the `team_memberships` row) and the UI surfaces EMs use to access that data. Delivering the backend relationship without the views would not satisfy the access model approval.

## Impact

- **API:** New endpoint `POST /api/v1/teams/:teamId/managers` (TEAM-006); EM-authenticated callers are now reachable at existing endpoints SESSION-007, SESSION-008, TREND-001, TREND-002, ACTION-004, and ACTION-005 — these endpoints already model EM access in the API contract; this change provides the `team_memberships` row that makes the authorization checks pass. The `GET /api/v1/teams/:teamId` (TEAM-003) response already includes both a `members` array and an `engineeringManagers` array; after a successful TEAM-006 call, the EM MUST appear in `engineeringManagers` and NOT in `members`. **Acceptance criterion:** A test that calls TEAM-003 after a successful TEAM-006 confirms the target user appears in `engineeringManagers` and does not appear in `members`. For a user who was previously a participant and is subsequently established as EM via TEAM-006, TEAM-003 must show that user in `engineeringManagers` only — their `team_memberships.role` is updated in place, so they do not appear in `members`.
- **Database:** `team_memberships` table receives rows written by TEAM-006 (same table as TEAM-005). Audit trail destination must be confirmed before any TEAM-006 implementation task begins: if TEAM-005 writes audit records to a database table, this change must use that table (or create an `audit_log` table as a schema change in this change's scope); if TEAM-005 writes to the structured application log, the spec's transactional rollback requirement for TEAM-006 must be updated — structured log writes do not support database rollback semantics. The audit record fields are already specified in the spec (actor_user_id, actor_global_role, actor_ip, target_user_id, team_id, operation, timestamp); only the destination is unresolved.
- **Authorization:** All downstream EM access control checks depend on the `team_memberships` row written here; the session participation spec's dual enforcement (`global_role` AND `team_memberships.role`) relies on this relationship being correctly established. The "Enforce Access Control on Team Content" use case check — "Is the user the Engineering Manager associated with this team?" — is satisfied entirely by the `team_memberships` row; the two authorization bullets in step 2 of that use case resolve to the same row and should be simplified before implementation to prevent duplicate authorization checks.
- **Session history and trend data views:** New EM-facing UI views for session history, trends, and action items built in this change; field-level vote attribution boundary is a hard constraint on all view design and must be confirmed by Devon Calloway before wireframes are drawn — this is a ritual integrity question, not a documentation task
- **Team administration view:** Structural change to member display; separate labeled sections required
- **Participant-accessible access model statement:** The statement ("Your Engineering Manager can see session history but cannot join or observe live sessions.") appears in both the team view (persistent reference) and the session lobby (contextual, where the question most naturally arises during a session). Both surfaces are explicitly in scope. Acceptance criteria must verify both.
- **First Access spec:** Must be updated with a mechanism for `global_role = 'engineering_manager'` assignment, and the approach agreed, before any implementation task in this change begins
- **Use case documents requiring correction before implementation:** (1) "Establish a Manager/Team Relationship" use case precondition — must clarify that TEAM-006 establishes the `team_memberships.role = 'engineering_manager'` row only, and that `users.global_role = 'engineering_manager'` must pre-exist as a separate precondition; the current language implies the team relationship IS the mechanism that establishes the role, which is incorrect. (2) Authorized actor — must be updated from Facilitator to Application Admin (see Resolved Decisions).

## Feedback Not Incorporated

The following feedback from the proposal reviews was considered and not adopted, with rationale. These are matters of implementation planning preference, not design corrections.

### BA Problem 3: Split `manager-team-association` into sub-capabilities

**Feedback (Marcus Delgado, BA):** The `manager-team-association` capability slug bundles multiple independently testable components and should be broken into sub-capabilities to produce accurate status reporting.

**Not adopted.** The capability slug represents a coherent, user-facing feature — the EM/team relationship and everything required to make it functional. Splitting it into sub-capabilities would add tracking overhead without changing what is built or how it is tested. The tasks list already decomposes the work into independently executable, independently testable units — that is the right place for this granularity. Sub-capability slugs at the proposal level would multiply the artifacts without adding clarity to the implementation team.

**Accommodation:** A note has been added to the `manager-team-association` capability entry in the Capabilities section above, explicitly flagging that the slug encompasses multiple independently testable components and that partial delivery is a possible outcome. Any project tracking system that reads capability slugs should treat the `manager-team-association` capability as complete only when all component acceptance criteria pass.
