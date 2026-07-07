# manager-team-association

## Purpose

Defines requirements for establishing the formal relationship between an Engineering Manager and the teams they oversee, granting the EM read-only access to session history, trend data, and action items. This capability is the authorization foundation for all downstream EM access — the access control enforcement for EM-facing team content depends on the `team_memberships` row written here.

This spec covers: the `POST /api/v1/teams/:teamId/managers` endpoint (TEAM-006), EM read-only access boundaries, the team administration view's labeled section display, and the participant-accessible access model statement.

This spec does NOT cover: the removal of an EM/team relationship (separate use case), EM participation in live sessions (prohibited unconditionally by the session-participation spec), or notifications to the EM upon association.

## Requirements

### Requirement: Authorized actor can establish an EM/team relationship via TEAM-006

The application SHALL provide `POST /api/v1/teams/:teamId/managers` (TEAM-006) to create the relationship between a user with `global_role = 'engineering_manager'` and a team they oversee. The endpoint creates or updates a `team_memberships` row with `role = 'engineering_manager'` for the target user.

**Authorized actor:** Application Admin only. Resolved per Decision 1 in design.md and the proposal's Resolved Decisions (Q2). The use case document has been corrected simultaneously. The operational cost of admin-only is addressed by the escalation requirement below: facilitators who lack TEAM-006 permission see a plain-language explanation and an unambiguous contact path to the admin. A grayed-out control with no explanation is not acceptable.

**Precondition (hard):** The target user (`engineeringManagerUserId`) MUST have `users.global_role = 'engineering_manager'`. If the precondition is not met, the endpoint SHALL return `409 Conflict` with an error body that distinguishes this condition from other failure cases. The endpoint MUST NOT create a `team_memberships` row if the precondition is not met.

**Idempotency:** If a `team_memberships` row with `role = 'engineering_manager'` already exists for the target user and team, TEAM-006 SHALL update the existing row and return `200 OK`. If no such row exists, TEAM-006 SHALL create a new row and return `201 Created`. The response body MUST be identical in both cases — the response SHALL NOT indicate whether a row was created or updated. The implementation uses PostgreSQL's `xmax` system column to determine create-vs-update at the database level within the upsert transaction.

**Distinctness from TEAM-005:** TEAM-006 is used when the target user has NO prior `team_memberships` row for the team. TEAM-005 is used when the target user already has an active membership and their role is being changed. These endpoints MUST remain distinct and MUST NOT be called in place of each other. A user identified via TEAM-006 must already have `global_role = 'engineering_manager'`; TEAM-005 does not check `global_role`.

**Audit trail:** Every successful TEAM-006 call MUST produce an audit log entry in the `audit_log` database table (migration 8 — this table replaces the earlier `role_change_audit` table). The audit record MUST include: `actor_user_id`, `actor_global_role` (stored as text for audit durability), `actor_ip`, `target_user_id`, `team_id`, `operation` (value: `'team.manager_established'`), `timestamp`. The audit write MUST execute in the same database transaction as the `team_memberships` write. If the audit write fails, the transaction MUST roll back. A committed transaction MUST produce both a `team_memberships` row and an `audit_log` row. A rolled-back transaction MUST produce neither.

#### Scenario: Admin establishes EM/team relationship for a new-to-team user

- **WHEN** an authorized actor calls `POST /api/v1/teams/:teamId/managers` with a `engineeringManagerUserId` whose `global_role = 'engineering_manager'` and who has no existing `team_memberships` row for this team
- **THEN** the endpoint creates a `team_memberships` row with `role = 'engineering_manager'` for that user and team
- **AND** returns `201 Created` with the association details
- **AND** an audit log entry is created with all required fields

#### Scenario: TEAM-006 called again for an existing EM/team relationship — idempotent update

- **WHEN** an authorized actor calls `POST /api/v1/teams/:teamId/managers` with a `engineeringManagerUserId` who already has `team_memberships.role = 'engineering_manager'` for this team
- **THEN** the endpoint updates the existing row (no duplicate created)
- **AND** returns `200 OK` with the same response body shape as the create case
- **AND** the response body does not indicate whether a row was created or updated

#### Scenario: TEAM-006 precondition failure — target user lacks engineering_manager global role

- **WHEN** an authorized actor calls `POST /api/v1/teams/:teamId/managers` with a `engineeringManagerUserId` whose `global_role` is not `engineering_manager`
- **THEN** the endpoint returns `409 Conflict`
- **AND** the response body includes a machine-readable error code specifically identifying the `global_role` precondition failure
- **AND** no `team_memberships` row is created or modified

#### Scenario: TEAM-006 for unknown team returns 404

- **WHEN** an authorized actor calls `POST /api/v1/teams/:teamId/managers` with a `teamId` that does not exist
- **THEN** the endpoint returns `404 Not Found`
- **AND** the response body does not return a 409 for this condition

#### Scenario: Unauthorized actor is rejected

- **WHEN** a user who is not an authorized actor for TEAM-006 calls the endpoint
- **THEN** the endpoint returns `403 Forbidden`
- **AND** no `team_memberships` row is created or modified

#### Scenario: Audit write failure rolls back the association

- **WHEN** the audit INSERT fails within the transaction
- **THEN** the transaction is rolled back and no `team_memberships` row is committed
- **AND** an EM/team association with no audit record is not a possible outcome

---

### Requirement: Escalation path when actor cannot perform TEAM-006

If TEAM-006 is restricted to Application Admins, the team administration view MUST present a plain-language explanation to actors who lack the permission, plus an unambiguous contact path to the admin. A grayed-out control with no explanation is not acceptable.

**Minimum acceptable text:** "Associating an Engineering Manager requires Application Admin access. Contact your admin to complete this before the session."

The contact path MUST be specific — an email address, an in-application message path, or an equivalent mechanism. "Contact the admin" with no mechanism does not meet this requirement.

**Implementation:** The `GET /api/v1/teams/:teamId` endpoint (TEAM-003) returns a `canAssociateManagers` boolean flag computed server-side. This flag is `true` only for users with `global_role = 'application_admin'`. The team administration view uses `canAssociateManagers` to determine whether to render the association control or the escalation path.

#### Scenario: Facilitator without TEAM-006 permission sees explanation, not a grayed-out control

- **WHEN** a user who cannot perform TEAM-006 views the team administration view's EM association section
- **THEN** a plain-language explanation of who can perform the operation is displayed
- **AND** an unambiguous contact path to the admin is displayed
- **AND** no opaque disabled control is shown without explanation

---

### Requirement: Multi-team EM support

TEAM-006 SHALL support establishing the EM/team relationship for the same user with multiple teams by calling the endpoint with different `teamId` values. There is no limit on the number of teams a single EM may be associated with.

Each association is independent: the EM's access to one team does not imply access to another. A TEAM-006 call for Team A does not grant access to Team B.

#### Scenario: EM is associated with multiple teams via repeated TEAM-006 calls

- **WHEN** TEAM-006 is called successfully with `engineeringManagerUserId = X` and `teamId = A`, then called again with `engineeringManagerUserId = X` and `teamId = B`
- **THEN** the user has `team_memberships` rows for both Team A and Team B with `role = 'engineering_manager'`
- **AND** the user can access session history for Team A and Team B independently

#### Scenario: Multi-team EM access to one team does not grant access to another

- **WHEN** an EM has been associated with Team A via TEAM-006 but not Team B
- **AND** the EM requests session history for Team B
- **THEN** the request is rejected with 403

---

### Requirement: EM read-only access to session history, trend data, and action items

Upon successful TEAM-006 call, the Engineering Manager SHALL have read-only access to the following data for the associated team. This access is permanent until the EM/team relationship is removed (out of scope for this change). Access is not date-bounded to the association date — the EM SHALL be able to view session history for sessions that completed before the TEAM-006 call.

**EM MUST be able to see:**

*Session history:*
- The aggregate vote distribution per topic (e.g., "3 participants voted 4, 1 participant voted 2") — never individual attribution
- The session date
- The participant count as an aggregate number — not the names of individual participants
- The facilitator name
- The topic names active during that session (including topics subsequently removed, for historical completeness)

*Trend data:*
- Trend data over the team's full available history with no artificial time boundary
- All topics that were active during historical sessions, including removed topics
- Statistical displays: averages, medians, trend direction — without labeling individual participants

*Action items:*
- Title and current status
- Due date if set
- Assignee visibility to EM: **`ownerDisplayName` is visible to Engineering Managers** in ACTION-004 and ACTION-005 responses. Action item ownership is work-tracking data, not vote attribution — EMs need to know who owns action items in order to follow up on health improvements. This is resolved per Q8 in proposal.md and Decision 13 in design.md. The vote attribution boundary still prohibits per-participant vote values; this decision covers assignee names only.

**EM MUST NOT be able to:**
- View individual vote attribution (who voted what) — this is the most sensitive access point
- View live session data (current votes, readiness grid, active connections)
- Create or update action items
- Modify topic configuration
- Initiate or close sessions

**Endpoints implementing EM read-only access:** SESSION-007, SESSION-008, TREND-001, TREND-002, ACTION-004, ACTION-005 — implemented in `em-views.ts`. Frontend pages: `EmSessionHistoryPage`, `EmTrendDataPage`, `EmActionItemsPage`, `EmTeamDashboardPage`.

**Vote attribution boundary (hard constraint — Devon Calloway must confirm before EM-facing view design begins):**

> EM-facing views of session history and trend data must not surface the connection between a specific vote value and the participant who cast it. Specifically:
>
> - Aggregate vote distributions (e.g., "3 participants voted 4, 1 participant voted 2") are permitted.
> - Named or identifiable per-participant vote values are prohibited.
> - Statistical displays (averages, medians, ranges) that do not label individual participants are permitted.
> - The presence or absence of an outlier flag in the aggregate results is permitted; the identity of the outlier is not.
> - Action item text that attributes a concern to a named engineer is attribution-adjacent and must be reviewed before EM-facing display.
>
> Acceptance criterion: A QA reviewer testing the EM view using an EM-role account must be unable to determine any individual participant's vote for any topic in any session using only the data surfaced in the EM view. This acceptance criterion must be verified before any team goes live with EM history access enabled.

#### Scenario: EM can view session history aggregate data for associated team

- **WHEN** an EM with an established `team_memberships.role = 'engineering_manager'` row for Team A requests session history for Team A
- **THEN** the response includes aggregate vote distributions, session dates, participant counts, facilitator names, and topic names
- **AND** no individual participant's vote value is included in the response

#### Scenario: EM cannot view individual vote attribution

- **WHEN** an EM requests session history data for an associated team
- **THEN** no API response or rendered view surfaces the connection between a specific vote value and the participant who cast it
- **AND** a QA reviewer using the EM account cannot determine any individual participant's vote

#### Scenario: EM can view sessions that predate their association

- **WHEN** an EM is associated with a team via TEAM-006 on date D
- **AND** the team has session history for sessions completed before date D
- **THEN** the EM can view that pre-association session history
- **AND** the access is not bounded to sessions after date D

#### Scenario: EM cannot view live session data

- **WHEN** an EM requests live session data (current votes, readiness grid, active connections) for an associated team
- **THEN** the request is rejected
- **AND** no live session data is served to the EM

#### Scenario: EM cannot write to action items or topics

- **WHEN** an EM submits a write request to an action item or topic configuration endpoint for an associated team
- **THEN** the request is rejected with 403
- **AND** no data is modified

---

### Requirement: Team administration view — separate labeled sections for participants and managers

The team administration view MUST display participant members (`team_memberships.role = 'participant'`) and associated managers (`team_memberships.role = 'engineering_manager'`) in separate, labeled sections. The section headings MUST make clear that associated managers are not session participants.

A facilitator viewing the team administration page MUST be able to determine at a glance that the associated EM is a manager of the team, not a voting participant.

When TEAM-006 has been called successfully for a team, the EM MUST appear in the "Associated Managers" section (or equivalent labeled section), NOT in the participants list.

When TEAM-006 has not been called for a team, the "Associated Managers" section MUST display a visually distinct incomplete-setup indicator — not an error, but a signal that the EM association has not been established.

When a facilitator hands off a team to another facilitator, the incoming facilitator MUST be able to see the EM association for that team without a separate handoff conversation. The EM association is part of the team context available to any facilitator with access to the team.

**Implementation:** `GET /api/v1/teams/:teamId` (TEAM-003) returns `{ participants, engineeringManagers, canAssignRoles, canAssociateManagers }`. The `participants` and `engineeringManagers` arrays are the data source for the two labeled sections. The `MemberManagement.tsx` component renders these sections.

**Acceptance criterion:** A facilitator who has never used the application can correctly identify which users will receive a session invite and which will not, without reading help documentation.

#### Scenario: Team administration view shows associated EM in a separate labeled section

- **WHEN** a facilitator views the team administration page for a team with an established EM association
- **THEN** the participant members are displayed in one labeled section
- **AND** the associated manager is displayed in a separate labeled section
- **AND** the section headings make clear that the manager is not a session participant

#### Scenario: Unestablished EM association is visually distinct in team administration view

- **WHEN** a facilitator views the team administration page for a team with no established EM association
- **THEN** the Associated Managers section shows an incomplete-setup indicator
- **AND** the indicator is not an error state, but a signal that setup is not yet complete

#### Scenario: Incoming facilitator can see EM association without handoff conversation

- **WHEN** a facilitator with access to a team views the team administration page
- **THEN** the EM association (or its absence) is visible without requiring a separate communication from a previous facilitator

#### Scenario: Facilitator can distinguish session invite recipients from associated managers at a glance

- **WHEN** a facilitator scans the team administration view before a session
- **THEN** the facilitator can immediately identify which users will receive a session invite (participants) and which will not (associated managers)
- **AND** this determination requires no help documentation

---

### Requirement: Participant-accessible access model statement

The application SHALL surface a one-sentence access model statement accessible from the team view or session lobby: "Your Engineering Manager can see session history but cannot join or observe live sessions."

The statement MUST be findable by a participant who wants to verify what the EM can see. It MUST NOT be displayed as a modal, a required acknowledgment, a notification, or a gamification element. It is a passive, findable statement — not a prominent UI element.

**Implementation:** The access model statement is present in both `MemberManagement.tsx` (team view) and `SessionLobbyPage.tsx` (session lobby). Both locations are required — a participant in the session lobby must be able to find the statement without navigating back to the team view.

**Rationale**: The most common first-session anxiety is "Can our manager see this?" The application carries this answer so facilitators and participants can verify it without needing a human explainer.

#### Scenario: Participant can find the access model statement

- **WHEN** a participant in a team views the team view or session lobby
- **THEN** the access model statement is accessible without searching help documentation
- **AND** the statement is not displayed as a modal or required acknowledgment

#### Scenario: Access model statement is passive — no required interaction

- **WHEN** a participant completes an action (joins a session, views the team page) that could surface the access model statement
- **THEN** no modal, pop-up, or acknowledgment flow is shown
- **AND** the statement is available to participants who actively look for it but does not interrupt normal flow

---

### Requirement: EM access to team history is not revoked by subsequent role changes unless explicitly removed

An EM's read-only access to session history persists until the `team_memberships` row is explicitly removed (a separate, out-of-scope operation). Role changes on other team members do not affect the EM's association. A team restructuring (e.g., new participants added) does not remove the EM's association.

If a user who was previously a participant on a team is later established as the EM via TEAM-006, their historical participation records (votes, session participation rows) are preserved. Only their `team_memberships.role` changes.

#### Scenario: Historical participant designated as EM retains their previous participation records

- **WHEN** a user has prior session participation records as a participant on a team
- **AND** TEAM-006 is subsequently called to establish them as the EM for that team
- **THEN** their prior `session_participants` rows and vote records are not deleted or hidden
- **AND** their `team_memberships.role` is updated to `engineering_manager`

---

## Out of Scope and Interim Administrative Procedure

### Task 8.1 — EM/team relationship removal is explicitly out of scope

The removal of an EM/team relationship (soft-deleting the `team_memberships` row established by TEAM-006) is explicitly out of scope for this change. This is a named follow-on change: **"remove-manager-team-relationship"**. It must be assigned, entered in the backlog, and scheduled before the first team goes live with EM history access. An association that cannot be removed through a supported path is a sustained access control liability that compounds with each new association established.

The follow-on change must implement a `DELETE /api/v1/teams/:teamId/managers/:userId` endpoint (or equivalent) with the same authorization constraint as TEAM-006 (Application Admin only), the same transactional atomicity requirement (row update and audit record in the same database transaction), and the same audit trail fields (`operation = 'team.manager_removed'`, `actor_user_id`, `actor_ip`, `target_user_id`, `team_id`, `timestamp`).

**Backlog condition:** The follow-on removal change enters the backlog immediately upon deployment of this change, with a target completion before the second team goes live with EM history access.

---

### Task 8.2 — Interim administrative procedure for removing an EM/team association

Until the follow-on removal change is shipped, the only supported path for removing an incorrect EM/team association is a direct database operation performed by an Application Admin. This procedure is documented here so that it is a known, access-controlled, audited operation — not an undocumented backdoor.

**Authorized actor:** Application Admin only. The operation must not be performed by engineers, facilitators, or any other role.

**Operation:**

```sql
UPDATE team_memberships
SET removed_at = NOW()
WHERE user_id = $1
  AND team_id = $2
  AND role = 'engineering_manager'
  AND removed_at IS NULL;
```

This is a soft-delete consistent with the existing `removed_at` pattern in `team_memberships`. Once `removed_at` is set, the EM's row no longer satisfies the `WHERE removed_at IS NULL` check that the dual-authorization check and TEAM-003 use — EM access to session history for that team is revoked at the next API request.

**Audit requirement:** The removal must be logged to `audit_log` with the following fields in the same database transaction as the `UPDATE`:

```sql
INSERT INTO audit_log (actor_user_id, actor_global_role, actor_ip, target_user_id, team_id, operation, timestamp)
VALUES ($actor_user_id, $actor_global_role, $actor_ip, $target_user_id, $team_id, 'team.manager_removed', NOW());
```

The same transactional atomicity requirement from Decision 9 applies: the `UPDATE team_memberships` and the `INSERT audit_log` must be in the same database transaction. A committed transaction produces both; a rolled-back transaction produces neither. An EM/team removal with no audit record is not an acceptable outcome.

**Precondition check:** Before executing the `UPDATE`, confirm that the `team_memberships` row exists with `role = 'engineering_manager'` and `removed_at IS NULL`. If no such row exists, log the discrepancy and take no action.

**Post-operation verification:** After the transaction commits, verify the row is no longer returned by:

```sql
SELECT id FROM team_memberships
WHERE user_id = $1 AND team_id = $2 AND role = 'engineering_manager' AND removed_at IS NULL;
```

This should return zero rows. If it returns a row, the soft-delete did not apply and must be investigated before the admin closes the operation.

---

### Task 8.3 — Named owner for follow-on removal-operation change

**Owner:** Marcus Delgado, Senior Business Analyst.

Marcus Delgado owns the backlog entry for the **"remove-manager-team-relationship"** follow-on change and is responsible for:
1. Entering the change into the product backlog immediately upon deployment of `establish-manager-team-relationship`
2. Ensuring the change is scheduled before the second team goes live with EM history access
3. Coordinating the design review with the security analyst (the threat model named EM account compromise as a risk that the removal path mitigates)

If Marcus Delgado's ownership changes, the replacement owner must be named in this spec before the next team goes live with EM access.

---

### Task 8.4 — Access control dependency on `team_memberships` row written by TEAM-006

The access control check for the question "Is this user the Engineering Manager associated with this team?" is answered exclusively by the `team_memberships` row written by TEAM-006. This dependency must be explicit in the implementation.

**The check:**

```sql
SELECT u.global_role, tm.role AS membership_role
FROM users u
LEFT JOIN team_memberships tm
  ON tm.user_id = u.id
  AND tm.team_id = $team_id
  AND tm.removed_at IS NULL
WHERE u.id = $user_id;
```

An authorized EM has BOTH `global_role = 'engineering_manager'` (set via IdP claim mapping per Decision 2) AND `membership_role = 'engineering_manager'` (set by TEAM-006 in `team_memberships`). Both checks must pass independently. Neither check alone is sufficient.

**Dependency statement:** Every EM-facing endpoint (SESSION-007, SESSION-008, TREND-001, TREND-002, ACTION-004, ACTION-005) performs this check on every request. The authorization result is not cached. If the `team_memberships` row is soft-deleted (via the interim administrative procedure above or via the follow-on removal change), the next request from that EM user to any EM-facing endpoint for that team returns 403. There is no grace period, no session-level caching of the authorization result.

**Implication for the interim removal procedure:** Because the EM-facing endpoints read directly from `team_memberships` on every request, the soft-delete takes effect immediately. The EM does not need to sign out or have their session revoked at the application layer — the next HTTP request to an EM-facing endpoint will fail the membership check.

This dependency is also the reason that the removal operation (task 8.2) must use a database transaction: if the `UPDATE team_memberships` commits but the `INSERT audit_log` fails, the access control result changes without an audit record. That is the prohibited outcome. The transaction ensures both happen or neither happens.
