## MODIFIED Requirements

### Requirement: Escalation path when actor cannot perform TEAM-006

If TEAM-006 is restricted to Application Admins, the team administration view MUST present a plain-language explanation to actors who lack the permission, plus a specific, resolvable contact mechanism. A grayed-out control with no explanation is not acceptable. "Contact the admin" with no mechanism does not meet this requirement.

The contact mechanism resolves to the configured Application Admin contact alias only. TEAM-006's only authorized actor is the Application Admin (Q2, resolved); this escalation path MUST NOT resolve to an Engineering Manager, even when one is already associated with the team being viewed. Routing this contact toward an EM would reopen the admin-only decision the escalation path exists to honor.

**Contact resolution:**
- **WHEN** the Application Admin contact alias is configured — the escalation message presents a `mailto:` link to that configured address (a shared inbox / mailing-list address, not an individual's identity), rendered as a single inline line (no per-admin cards, no list layout).
- **WHEN** no Application Admin contact alias is configured (the configured value is unset or empty) — the escalation message renders a fallback stating that no Application Admin contact is currently configured and directing the user to contact engineering leadership directly, instead of silently repeating "Contact your admin" or rendering a broken or empty address.

**Implementation:** The `GET /api/v1/teams/:teamId` endpoint (TEAM-003) returns a `canAssociateManagers` boolean flag computed server-side. This flag is `true` only for users with `global_role = 'application_admin'`. The team administration view uses `canAssociateManagers` to determine whether to render the association control or the escalation path. The same endpoint additionally supplies the configured Application Admin contact alias (or a `null` value signaling it is unconfigured) needed to resolve the contact mechanism above, populated unconditionally for every caller — this value is a shared configuration string, not individually-privileged identity data, so it carries no viewer-state gating.

#### Scenario: Facilitator without TEAM-006 permission sees explanation and a resolvable Application Admin contact

- **WHEN** a user who cannot perform TEAM-006 views the team administration view's EM association section
- **AND** the Application Admin contact alias is configured
- **THEN** a plain-language explanation of who can perform the operation is displayed
- **AND** a `mailto:` link to the configured Application Admin contact alias is displayed as a single inline line
- **AND** no opaque disabled control is shown without explanation

#### Scenario: TEAM-006 escalation shows the unconfigured-contact fallback when no Application Admin contact alias is configured

- **WHEN** a user who cannot perform TEAM-006 views the team administration view's EM association section
- **AND** no Application Admin contact alias is configured (the configured value is unset or empty)
- **THEN** the escalation message states that no Application Admin contact is currently configured and directs the user to contact engineering leadership directly
- **AND** no broken or empty `mailto:` link is rendered as a contact

#### Scenario: TEAM-006 escalation never resolves to an Engineering Manager

- **WHEN** a user who cannot perform TEAM-006 views the team administration view's EM association section
- **AND** an Engineering Manager is already associated with the team
- **THEN** the escalation message's contact mechanism shows Application Admin identity only
- **AND** the associated Engineering Manager's identity is not rendered as part of the escalation contact mechanism
