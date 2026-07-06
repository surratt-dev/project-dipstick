## ADDED Requirements

### Requirement: Authorized actor can change a team member's membership role

An authorized actor SHALL be able to change a team member's `team_memberships.membership_role` between `participant` (displayed as "Engineer") and `engineering_manager` (displayed as "Engineering Manager") via the member management view. The change is submitted to TEAM-005 (`PATCH /api/v1/teams/:teamId/members/:userId/role`).

The authorized actors are determined by the Q1 resolution (see design.md). Until Q1 is resolved, no implementation should proceed. Once resolved, the authorized actor list must be reflected in both the API contract and this spec.

The role selector MUST display human-readable labels, not database enum values:
- `participant` displays as **Engineer**
- `engineering_manager` displays as **Engineering Manager**

Each option in the role selector MUST include an inline description:
- **Engineer** — participates in session voting
- **Engineering Manager** — can view session history; will not vote

The assignable roles are Engineer and Engineering Manager only. Facilitator is NOT an assignable role in this change.

#### Scenario: Authorized actor promotes Engineer to Engineering Manager

- **WHEN** an authorized actor selects "Engineering Manager" for a team member currently designated as Engineer
- **THEN** the application submits a PATCH to TEAM-005 with `membership_role = 'engineering_manager'`
- **AND** on success, the member management view reflects "Engineering Manager" for that member
- **AND** a plain-language confirmation is displayed: "[Member name] is now an Engineering Manager for this team"

#### Scenario: Authorized actor demotes Engineering Manager to Engineer

- **WHEN** an authorized actor selects "Engineer" for a team member currently designated as Engineering Manager
- **THEN** the application submits a PATCH to TEAM-005 with `membership_role = 'participant'`
- **AND** on success, the member management view reflects "Engineer" for that member
- **AND** a plain-language confirmation is displayed: "[Member name] is now an Engineer for this team"

#### Scenario: Unauthorized actor cannot change roles

- **WHEN** a user who is not an authorized actor (per the Q1 resolution) attempts to change a team member's role
- **THEN** the request is rejected by the server with an appropriate error response
- **AND** the member management view does not display an actionable role selector for that user

#### Scenario: Role selector shows only valid assignable roles

- **WHEN** an authorized actor views the role selector for a team member
- **THEN** the selector contains exactly two options: "Engineer" and "Engineering Manager"
- **AND** "Facilitator" is not present as an option

---

### Requirement: Role changes take effect immediately

A role change MUST take effect on the affected user's next authenticated request. The server MUST read `team_memberships.membership_role` directly from the database on each request that requires team-specific authorization. The value MUST NOT be read from the session cookie, an in-memory cache, or any store that could lag behind a role change.

#### Scenario: Role change is reflected on the next server request from the affected user

- **WHEN** a user's `membership_role` is changed from `participant` to `engineering_manager`
- **THEN** the user's next API request to a team-scoped endpoint sees `membership_role = 'engineering_manager'`
- **AND** the server does not use a cached value from before the change

#### Scenario: Mid-session role change — post-change lock-in attempt is rejected

- **WHEN** a user's `membership_role` is changed to `engineering_manager` during an active session
- **AND** the user attempts to lock in a vote after the change takes effect
- **THEN** the session participation endpoint rejects the lock-in request
- **AND** the vote is not recorded

#### Scenario: Mid-session role change — pre-change locked-in votes are preserved

- **WHEN** a user locks in a vote on a topic
- **AND** the user's `membership_role` is subsequently changed to `engineering_manager` before the topic reveal
- **THEN** the already-locked-in vote is not invalidated
- **AND** the vote is counted at reveal

---

### Requirement: Pre-action warning when role change would leave zero participant-role members

When a role change would result in the team having zero members with `membership_role = 'participant'`, the application SHALL display a warning message before the actor confirms the change.

**Trigger condition:** After applying this change, does any member of this team have `membership_role = 'participant'`? If not, the warning fires. This check runs at submission time, before the action is confirmed.

**Warning placement:** The warning MUST appear at the confirmation step, before the actor confirms. It MUST NOT be a toast shown after the change has been applied.

**Warning message text:** "This change will leave [team name] with no Engineers. A session cannot start without at least one Engineer. You can still make this change."

The warning SHALL NOT block the change. After the warning is displayed, the actor may confirm and proceed.

#### Scenario: Role change reduces Engineers to zero — warning appears before confirmation

- **GIVEN** a team with exactly one member with `membership_role = 'participant'`
- **WHEN** an authorized actor selects "Engineering Manager" as the new role for that member
- **THEN** the application displays the warning message before the actor confirms
- **AND** the warning message names the team and states that no session can proceed without at least one Engineer

#### Scenario: Warning allows the actor to confirm and proceed

- **GIVEN** the zero-participant warning is displayed
- **WHEN** the actor confirms the change
- **THEN** the role change proceeds and the member's `membership_role` is updated to `engineering_manager'`
- **AND** the team now has zero participant-role members

#### Scenario: No warning when Engineers remain after the role change

- **GIVEN** a team with two or more members with `membership_role = 'participant'`
- **WHEN** an authorized actor changes one member's role to Engineering Manager
- **THEN** the application does not display the zero-participant warning
- **AND** the role change proceeds directly to confirmation

---

### Requirement: Role change is audited

Every change to `team_memberships.membership_role` MUST produce an audit log entry. The entry MUST capture: the actor's user ID, the subject's user ID, the team ID, the previous role value, the new role value, and the timestamp of the change. The audit log is append-only and not user-editable.

Both promotion (participant → engineering_manager) and demotion (engineering_manager → participant) MUST be logged.

#### Scenario: Promotion to Engineering Manager is logged

- **WHEN** a user's `membership_role` is changed from `participant` to `engineering_manager`
- **THEN** an audit log entry is created with the actor ID, subject ID, team ID, from-role (`participant`), to-role (`engineering_manager`), and timestamp

#### Scenario: Demotion to Engineer is logged

- **WHEN** a user's `membership_role` is changed from `engineering_manager` to `participant`
- **THEN** an audit log entry is created with the actor ID, subject ID, team ID, from-role (`engineering_manager`), to-role (`participant`), and timestamp

---

### Requirement: Demotion from Engineering Manager immediately revokes session history access

When a user's `membership_role` is changed from `engineering_manager` to `participant`, their read-only access to that team's session history MUST be revoked immediately. Any subsequent request to a session history endpoint for that team MUST be rejected with 403.

#### Scenario: Demoted EM loses session history access immediately

- **WHEN** a user's `membership_role` is changed from `engineering_manager` to `participant`
- **AND** the user subsequently requests the team's session history
- **THEN** the request is rejected with 403
- **AND** the user is not served session history data

---

### Requirement: Member management view supports pre-session role verification

The member management view MUST display each team member's current role clearly, in list form, without requiring drill-downs or edit-mode activation to read the role values. A facilitator scanning the list before a session MUST be able to assess the role state of all members at a glance.

#### Scenario: Facilitator can scan all member roles in list view

- **WHEN** an authenticated user navigates to the team's member management view
- **THEN** each member is listed with their current role label ("Engineer" or "Engineering Manager") visible without additional interaction
- **AND** the list does not require the user to enter an edit state to read the role values

---

### Requirement: Facilitator-from-another-team constraint is independent of membership role

The facilitator-from-another-team constraint checks for the existence of any `team_memberships` row linking the user to the team. The `membership_role` value is irrelevant to this check. A user with `membership_role = 'engineering_manager'` on a team is still ineligible to facilitate that team's sessions.

#### Scenario: EM-designated member cannot facilitate their own team's session

- **WHEN** a user has `membership_role = 'engineering_manager'` on Team A
- **AND** that user attempts to set up a session for Team A
- **THEN** the session setup endpoint rejects the request
- **AND** the rejection reason is the team membership constraint (membership exists), not the role value

---

### Requirement: Facilitator escalation path when role assignment is restricted (conditional on Q1 Option A)

*This requirement applies only if Q1 resolves to Option A (Application Admins and Engineering Managers only can assign roles).*

If an authenticated user who does not hold an authorized role views the member management view, the role selector MUST NOT be displayed as an opaque disabled control. The view MUST display a plain-language explanation of the restriction and an actionable next step.

Minimum acceptable: "Only an Application Admin can change this role. Contact your admin to update this before the session."

Preferred: The view surfaces the admin contact (name and an in-app message or email path) for users who do not hold the role-assignment permission.

#### Scenario: Non-authorized user sees explanation, not a grayed-out control

- **GIVEN** Q1 has resolved to Option A
- **WHEN** a user without role-assignment permission views the member management view
- **THEN** the role display is readable but not editable
- **AND** a plain-language explanation is shown indicating who can change roles and how to reach them
- **AND** no opaque disabled control is shown without explanation
