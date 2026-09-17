## MODIFIED Requirements

### Requirement: Escalation path when actor cannot perform TEAM-006

If TEAM-006 is restricted to Application Admins, the team administration view MUST present a plain-language explanation to actors who lack the permission, plus a specific, resolvable contact mechanism. A grayed-out control with no explanation is not acceptable. "Contact the admin" with no mechanism does not meet this requirement.

The contact mechanism resolves to Application Admin identity only. TEAM-006's only authorized actor is the Application Admin (Q2, resolved); this escalation path MUST NOT resolve to an Engineering Manager, even when one is already associated with the team being viewed. Routing this contact toward an EM would reopen the admin-only decision the escalation path exists to honor.

**Contact resolution:**
- **WHEN** at least one real Application Admin exists — the escalation message presents each current Application Admin's name and `mailto:` email link, excluding the seed `System` account, rendered as a single comma-separated inline line (no per-admin cards, no list layout).
- **WHEN** no real Application Admin exists (the Application Admin query, excluding the seed `System` account, returns zero rows) — the escalation message renders a fallback stating that no Application Admin is currently configured and directing the user to contact engineering leadership directly, instead of silently repeating "Contact your admin" or rendering a non-actionable address.

**Implementation:** The `GET /api/v1/teams/:teamId` endpoint (TEAM-003) returns a `canAssociateManagers` boolean flag computed server-side. This flag is `true` only for users with `global_role = 'application_admin'`. The team administration view uses `canAssociateManagers` to determine whether to render the association control or the escalation path. The same endpoint (or a related read used by this view) additionally supplies the Application Admin identity data needed to resolve the contact mechanism above, or the zero-admin fallback state when no real Application Admin exists.

#### Scenario: Facilitator without TEAM-006 permission sees explanation and a resolvable Application Admin contact

- **WHEN** a user who cannot perform TEAM-006 views the team administration view's EM association section
- **AND** at least one real Application Admin exists
- **THEN** a plain-language explanation of who can perform the operation is displayed
- **AND** each current Application Admin's name and `mailto:` link are displayed as a single comma-separated inline line
- **AND** no opaque disabled control is shown without explanation

#### Scenario: TEAM-006 escalation shows the zero-admin fallback when no real Application Admin exists

- **WHEN** a user who cannot perform TEAM-006 views the team administration view's EM association section
- **AND** the only user with `global_role = 'application_admin'` is the seed `System` account
- **THEN** the escalation message states that no Application Admin is currently configured and directs the user to contact engineering leadership directly
- **AND** the seed `System` account's email is not rendered as a contact

#### Scenario: TEAM-006 escalation never resolves to an Engineering Manager

- **WHEN** a user who cannot perform TEAM-006 views the team administration view's EM association section
- **AND** an Engineering Manager is already associated with the team
- **THEN** the escalation message's contact mechanism shows Application Admin identity only
- **AND** the associated Engineering Manager's identity is not rendered as part of the escalation contact mechanism
