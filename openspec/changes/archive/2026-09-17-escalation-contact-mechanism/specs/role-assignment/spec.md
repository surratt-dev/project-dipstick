## MODIFIED Requirements

### Requirement: Facilitator escalation path when role assignment is restricted

*Q1 resolved to Option A — this requirement is unconditional.*

Because only Application Admins and active Engineering Managers can assign roles, the member management view MUST include a plain-language escalation path for users who do not hold the role-assignment permission, plus a specific, resolvable contact mechanism. A grayed-out control with no explanation is not acceptable. "Contact the admin" with no mechanism does not meet this requirement.

**Contact resolution:**
- **WHEN** the team has exactly one Engineering Manager currently associated (a `team_memberships.role = 'engineering_manager'` row exists for the team) — the escalation message presents that EM's name and email as the contact. This reuses data already fetched and rendered elsewhere on the same view; no new backend call is required for this branch.
- **WHEN** the team has more than one Engineering Manager currently associated (the `(user_id, team_id)` uniqueness constraint is per user-team pair, not per team, so a team may have zero, one, or many active EMs) — the escalation message presents all associated EMs' names and emails as the contact, comma-separated, on a single inline line, in the same format as the multi-admin case below. This also reuses data already fetched and rendered elsewhere on the same view; no new backend call is required.
- **WHEN** the team has no associated Engineering Manager (including the case where the user also lacks TEAM-006/manager-association permission) — the escalation message falls back to the Application Admin contact mechanism, resolved identically to the `manager-team-association` capability's escalation path (a `mailto:` link to the configured Application Admin contact alias — a shared inbox / mailing-list address, not an individual's identity).
- **WHEN** no Application Admin contact alias is configured (the configured value is unset or empty) — the escalation message renders a fallback stating that no Application Admin contact is currently configured and directing the user to contact engineering leadership directly, instead of silently repeating "Contact your admin" or rendering a broken or empty address.

This resolution logic is unconditional and is not affected by whether the team also lacks a TEAM-006-eligible actor — the two escalation sites (TEAM-005, TEAM-006) resolve their contact mechanisms independently, and this requirement's EM-fallback branch does not apply to the TEAM-006 escalation path, whose only authorized actor is the Application Admin.

The rendered escalation text MUST NOT be reduced to the unqualified sentence "Contact your admin" with no name, address, or resolvable mechanism following it.

#### Scenario: Non-authorized user with an associated EM sees the EM as the contact

- **GIVEN** the server has returned `canAssignRoles: false`
- **AND** the team has exactly one Engineering Manager currently associated
- **WHEN** a user without role-assignment permission views the member management view
- **THEN** a plain-language explanation is shown indicating who can change roles
- **AND** the associated Engineering Manager's name and email are shown as the contact mechanism
- **AND** no role selector is rendered

#### Scenario: Non-authorized user with multiple associated EMs sees all of them as the contact

- **GIVEN** the server has returned `canAssignRoles: false`
- **AND** the team has more than one Engineering Manager currently associated
- **WHEN** a user without role-assignment permission views the member management view
- **THEN** a plain-language explanation is shown indicating who can change roles
- **AND** all associated Engineering Managers' names and emails are shown as the contact mechanism, comma-separated, on a single inline line
- **AND** no role selector is rendered

#### Scenario: TEAM-005 escalation falls back to Application Admin contact when no EM is associated

- **GIVEN** the server has returned `canAssignRoles: false`
- **AND** no Engineering Manager is currently associated with the team
- **WHEN** a user without role-assignment permission views the member management view
- **THEN** the escalation message shows the Application Admin contact mechanism (a `mailto:` link to the configured Application Admin contact alias)
- **AND** no attempt is made to reference Engineering Manager data, because none exists to reference

#### Scenario: TEAM-005 escalation shows the unconfigured-contact fallback when no Application Admin contact alias is configured

- **GIVEN** the server has returned `canAssignRoles: false`
- **AND** no Engineering Manager is currently associated with the team
- **AND** no Application Admin contact alias is configured (the configured value is unset or empty)
- **WHEN** a user without role-assignment permission views the member management view
- **THEN** the escalation message states that no Application Admin contact is currently configured and directs the user to contact engineering leadership directly
- **AND** no broken or empty `mailto:` link is rendered as a contact

#### Scenario: Non-authorized user sees explanation, not a grayed-out control

- **GIVEN** the server has returned `canAssignRoles: false`
- **WHEN** a user without role-assignment permission views the member management view
- **THEN** a plain-language explanation is shown indicating who can change roles and how to reach them
- **AND** no opaque disabled control is shown without explanation
- **AND** no role selector is rendered
