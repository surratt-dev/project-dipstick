# role-assignment

## Purpose

Defines requirements for authorized actors to change a team member's membership role between Engineer and Engineering Manager via the member management view. This change operates exclusively on `team_memberships.role` and does not modify `users.global_role`.

The role system has two distinct layers that must not be conflated:

| Layer | Field | Table | Valid values |
|---|---|---|---|
| Global role | `users.global_role` | `users` | `engineer`, `senior_engineer`, `facilitator`, `engineering_manager`, `application_admin` |
| Membership role | `team_memberships.role` | `team_memberships` | `participant`, `engineering_manager` |

**Q1 resolved — Option A selected** (Rachel Okonkwo, VP Engineering; BA and security analyst sign-off). Authorized actors are Application Admins (any team) and Engineering Managers with an active `team_memberships` row for the specific team being modified. Facilitators cannot assign roles.

## Requirements

### Requirement: Authorized actor can change a team member's membership role

An authorized actor SHALL be able to change a team member's `team_memberships.role` between `participant` (displayed as "Engineer") and `engineering_manager` (displayed as "Engineering Manager") via the member management view. The change is submitted via `PATCH /api/v1/teams/:teamId/members/:userId/role` (TEAM-005).

**Authorized actors (Q1 Option A):**
- `users.global_role = 'application_admin'` — authorized to change roles on any team
- `users.global_role = 'engineering_manager'` with an active (`removed_at IS NULL`) `team_memberships` row with `role = 'engineering_manager'` for the specific `teamId` in the request URL — authorized to change roles on their own team only

The authorization check MUST query the `team_memberships` table directly at request time using the `teamId` from the request path. It MUST NOT use role information from session state, in-memory state, or token claims. An EM on Team A calling the endpoint for Team B MUST receive 403.

Facilitators are not authorized actors. TEAM-006 is not called by this change. `users.global_role` is never written by this change.

The role selector MUST display human-readable labels, not database enum values:
- `participant` displays as **Engineer**
- `engineering_manager` displays as **Engineering Manager**

Each option in the role selector MUST include an inline description:
- **Engineer** — participates in session voting
- **Engineering Manager** — can view session history; will not vote

The assignable roles are Engineer and Engineering Manager only. Facilitator is NOT assignable through this change.

#### Scenario: Authorized actor promotes Engineer to Engineering Manager

- **WHEN** an authorized actor selects "Engineering Manager" for a team member currently designated as Engineer
- **THEN** the application submits a PATCH to TEAM-005 with `role = 'engineering_manager'`
- **AND** on success, the member management view reflects "Engineering Manager" for that member
- **AND** a plain-language confirmation is displayed: "[Member name] is now an Engineering Manager for this team"

#### Scenario: Authorized actor demotes Engineering Manager to Engineer

- **WHEN** an authorized actor selects "Engineer" for a team member currently designated as Engineering Manager
- **THEN** the application submits a PATCH to TEAM-005 with `role = 'participant'`
- **AND** on success, the member management view reflects "Engineer" for that member
- **AND** a plain-language confirmation is displayed: "[Member name] is now an Engineer for this team"

#### Scenario: Unauthorized actor cannot change roles

- **WHEN** a user who is not an Application Admin or an active EM for the specific team attempts to change a team member's role
- **THEN** the request is rejected by the server with 403
- **AND** the member management view does not display an actionable role selector for that user

#### Scenario: Role selector shows only valid assignable roles

- **WHEN** an authorized actor views the role selector for a team member
- **THEN** the selector contains exactly two options: "Engineer" and "Engineering Manager"
- **AND** "Facilitator" is not present as an option

---

### Requirement: Role changes take effect immediately

A role change MUST take effect on the affected user's next authenticated request. The server MUST read `team_memberships.role` directly from the database on each request that requires team-specific authorization. The value MUST NOT be read from the session cookie, an in-memory cache, Redis, or any store that could lag behind a role change.

**Redis prohibition:** Role data MUST NOT be cached in Redis or any in-memory store. The application's Redis instance is used for session storage only. This prohibition MUST be documented in code comments at each authorization check implementation site.

**WebSocket scope:** The per-request role check applies to WebSocket operations as well as HTTP requests. The vote lock-in handler MUST read `team_memberships.role` from the database on each lock-in attempt. It MUST NOT use a role value established at WebSocket connection time. A long-lived WebSocket connection opened before a role change MUST NOT permit lock-in operations that the role change prohibits.

#### Scenario: Role change is reflected on the next server request from the affected user

- **WHEN** a user's `team_memberships.role` is changed from `participant` to `engineering_manager`
- **THEN** the user's next API request to a team-scoped endpoint is evaluated against the updated value from the database
- **AND** the server does not use a cached value from before the change

#### Scenario: Mid-session role change — post-change lock-in attempt is rejected

- **WHEN** a user's `team_memberships.role` is changed to `engineering_manager` during an active session
- **AND** the user attempts to lock in a vote after the change takes effect
- **THEN** the session participation endpoint rejects the lock-in request
- **AND** the vote is not recorded

#### Scenario: Mid-session role change — pre-change locked-in votes are preserved

- **WHEN** a user locks in a vote on a topic
- **AND** the user's `team_memberships.role` is subsequently changed to `engineering_manager` before the topic reveal
- **THEN** the already-locked-in vote is not invalidated
- **AND** the vote is counted at reveal

---

### Requirement: Pre-action warning when role change would leave zero participant-role members

When a role change would result in the team having zero members with `team_memberships.role = 'participant'`, the server SHALL require explicit confirmation before applying the change via a two-submission flow.

**Two-submission flow:**
1. The client submits `PATCH /api/v1/teams/:teamId/members/:userId/role` with the requested role and no confirmation flag.
2. The server applies the UPDATE inside a transaction, then counts remaining active `participant`-role members (post-update). If the count is zero and `confirmedZeroParticipant` is absent, the server issues ROLLBACK and returns `422 Unprocessable Entity` with body `{ "requiresConfirmation": true }`. The change is not committed.
3. The client displays the zero-participant warning to the actor.
4. If the actor confirms, the client re-submits the same PATCH with `confirmedZeroParticipant: true` in the request body.
5. On the second submission with `confirmedZeroParticipant: true`, the server applies the change regardless of participant count and returns `200 OK`.

**Warning message text:** "This change will leave [team name] with no Engineers. A session cannot start without at least one Engineer. You can still make this change."

The warning MUST appear at the confirmation step, before any change is committed. It MUST NOT be a toast shown after the change has been applied.

**Transaction and locking requirement:** The participant count check and the UPDATE MUST execute within a single database transaction. A `SELECT ... FOR UPDATE` on all active membership rows for the team MUST be issued before the UPDATE to serialize concurrent modifications and prevent a race where two concurrent role changes by different authorized actors both pass the zero-participant guard independently and together produce a zero-participant state with neither returning 422.

**Implementation status:** The `SELECT id FROM team_memberships WHERE team_id = $1 AND removed_at IS NULL FOR UPDATE` lock is present in the TEAM-005 handler before the UPDATE statement. Verified by architect review.

#### Scenario: Role change reduces Engineers to zero — 422 returned on first submission

- **GIVEN** a team with exactly one member with `team_memberships.role = 'participant'`
- **WHEN** an authorized actor submits a PATCH to change that member's role to `engineering_manager` with no `confirmedZeroParticipant` flag
- **THEN** the server returns `422 Unprocessable Entity` with `{ "requiresConfirmation": true }`
- **AND** the role change is not committed to the database

#### Scenario: Warning allows the actor to confirm and proceed

- **GIVEN** the server has returned 422 with `{ "requiresConfirmation": true }`
- **WHEN** the actor confirms and the client re-submits the PATCH with `confirmedZeroParticipant: true`
- **THEN** the server applies the role change and returns 200
- **AND** the team now has zero participant-role members

#### Scenario: No warning when Engineers remain after the role change

- **GIVEN** a team with two or more members with `team_memberships.role = 'participant'`
- **WHEN** an authorized actor changes one member's role to Engineering Manager
- **THEN** the server returns 200 without a 422 intermediate step
- **AND** the role change proceeds without the actor seeing a zero-participant warning

---

### Requirement: Role change is audited

Every change to `team_memberships.role` MUST produce an audit log entry in the `role_change_audit` table. The audit write MUST execute in the same database transaction as the role change. If the audit write fails, the transaction MUST roll back and the role change MUST NOT commit.

The audit record MUST include:
- `actor_user_id` — the actor's user ID
- `actor_global_role` — the actor's `users.global_role` at the time of the change, stored as `text` (not a foreign key or enum) for audit durability against future schema changes
- `actor_ip` — the actor's IP address, populated from `request.ip` (resolves to real client IP given `trustProxy: 1`)
- `subject_user_id` — the affected user's ID
- `team_id` — the team ID
- `from_role` — the previous `team_memberships.role` value
- `to_role` — the new `team_memberships.role` value
- `changed_at` — timestamp of the change

Both promotion (`participant` → `engineering_manager`) and demotion (`engineering_manager` → `participant`) MUST be logged. The audit log is append-only. Audit records are not deletable through any application UI or API — deletion requires direct database access by a designated DBA under change control.

**Retention:** Minimum 12 months from the date of each role change event.

**Access:** Accessible to Application Admins only through the application. Engineering Managers do not have read access to the audit trail in the initial implementation.

#### Scenario: Promotion to Engineering Manager is logged

- **WHEN** a user's `team_memberships.role` is changed from `participant` to `engineering_manager`
- **THEN** an audit log entry is created with all required fields including `actor_global_role` and `actor_ip`

#### Scenario: Demotion to Engineer is logged

- **WHEN** a user's `team_memberships.role` is changed from `engineering_manager` to `participant`
- **THEN** an audit log entry is created with all required fields including `actor_global_role` and `actor_ip`

#### Scenario: Audit write failure rolls back the role change

- **WHEN** the audit INSERT fails within the transaction
- **THEN** the transaction is rolled back and the role change is not committed
- **AND** a role change with no audit record is not a possible outcome through normal application paths

---

### Requirement: Demotion from Engineering Manager immediately revokes session history access

When a user's `team_memberships.role` is changed from `engineering_manager` to `participant`, their read-only access to that team's session history MUST be revoked immediately. Any subsequent request to a session history endpoint for that team MUST be rejected with 403.

*Note: The session history endpoint is not yet implemented. When implemented, the access control check MUST read `team_memberships.role` directly from the database on each request — no cached value.*

#### Scenario: Demoted EM loses session history access immediately

- **WHEN** a user's `team_memberships.role` is changed from `engineering_manager` to `participant`
- **AND** the user subsequently requests the team's session history
- **THEN** the request is rejected with 403
- **AND** the user is not served session history data

---

### Requirement: Member management view supports pre-session role verification

The member management view MUST display each team member's current role clearly, in list form, without requiring drill-downs or edit-mode activation to read the role values. A facilitator scanning the list before a session MUST be able to assess the role state of all members at a glance.

Database enum values (`participant`, `engineering_manager`) MUST NOT appear as visible text in any rendered state of the view. The vocabulary mapping is:
- `participant` → **Engineer**
- `engineering_manager` → **Engineering Manager**

#### Scenario: Facilitator can scan all member roles in list view

- **WHEN** an authenticated user navigates to the team's member management view
- **THEN** each member is listed with their current role label ("Engineer" or "Engineering Manager") visible without additional interaction
- **AND** the list does not require the user to enter an edit state to read role values
- **AND** the raw database values `participant` and `engineering_manager` are not visible as text in any rendering state of the view

---

### Requirement: Frontend authorization signal — server-side `canAssignRoles` flag

The team member list API response (`GET /api/v1/teams/:teamId/members`) MUST include a `canAssignRoles: boolean` field at the response level (not per-member). The server evaluates whether the requesting user is authorized to assign roles for this specific team and returns the result. The frontend renders the role selector (when `true`) or the escalation message (when `false`) based solely on this flag.

`globalRole` MUST NOT be added to `AuthSession.user` for this purpose. The frontend MUST NOT implement authorization logic by reading a role value from session state. The `canAssignRoles` flag is more defensive: the client reacts to a server authorization result; it does not compute one.

The `canAssignRoles` field MUST be evaluated on every request to the member list endpoint using the same per-team, per-request database query as the PATCH authorization check. It MUST NOT be derived from session state.

#### Scenario: Authorized actor sees the role selector

- **WHEN** an Application Admin or an active EM for the specific team requests the member list
- **THEN** the response includes `canAssignRoles: true`
- **AND** the member management view renders a role selector for each member

#### Scenario: Unauthorized actor sees the escalation message

- **WHEN** a user who is not an authorized actor requests the member list
- **THEN** the response includes `canAssignRoles: false`
- **AND** the member management view renders the escalation message instead of a role selector

---

### Requirement: Facilitator-from-another-team constraint is independent of membership role

The facilitator-from-another-team constraint checks for the existence of any `team_memberships` row linking the user to the team. The `team_memberships.role` value is irrelevant to this check. A user with `team_memberships.role = 'engineering_manager'` on a team is still ineligible to facilitate that team's sessions.

#### Scenario: EM-designated member cannot facilitate their own team's session

- **WHEN** a user has `team_memberships.role = 'engineering_manager'` on Team A
- **AND** that user attempts to set up a session for Team A
- **THEN** the session setup endpoint rejects the request
- **AND** the rejection reason is the team membership constraint (membership row exists), not the role value

---

### Requirement: Facilitator escalation path when role assignment is restricted

*Q1 resolved to Option A — this requirement is unconditional.*

Because only Application Admins and active Engineering Managers can assign roles, the member management view MUST include a plain-language escalation path for users who do not hold the role-assignment permission. A grayed-out control with no explanation is not acceptable.

**Minimum acceptable:** "Only an Application Admin or an Engineering Manager for this team can change roles. Contact your admin to update this before the session."

**Preferred (not yet implemented):** The view surfaces the admin contact (name and an in-app message or email path) for users who do not hold the role-assignment permission. Owner: Marcus Oyelaran.

#### Scenario: Non-authorized user sees explanation, not a grayed-out control

- **GIVEN** the server has returned `canAssignRoles: false`
- **WHEN** a user without role-assignment permission views the member management view
- **THEN** a plain-language explanation is shown indicating who can change roles and how to reach them
- **AND** no opaque disabled control is shown without explanation
- **AND** no role selector is rendered
