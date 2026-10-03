## MODIFIED Requirements

### Requirement: The active-topics response exposes the team's customization lock state

`GET /api/v1/teams/:teamId/topics` SHALL include an `isCustomizationLocked` boolean field in its response body, computed via the shared lock-check function. This field SHALL be present on every `200` response from this endpoint, for every caller the endpoint admits (see `team-content-access`, Requirement: The active-topics endpoint admits only non-manager participant members and eligible session facilitators). Any denied caller (a `null` grant, an Application Admin, or an engineering manager) SHALL receive no lock state, and the lock-check function SHALL NOT run for a denied request.

#### Scenario: Locked team's topic list response includes the lock flag
- **WHEN** an authorized caller requests the active topics for a team with zero completed sessions
- **THEN** the response includes `isCustomizationLocked: true` alongside the topic list

#### Scenario: Unlocked team's topic list response includes the lock flag
- **WHEN** an authorized caller requests the active topics for a team with at least one completed session
- **THEN** the response includes `isCustomizationLocked: false` alongside the topic list

#### Scenario: A denied caller receives no lock state
- **WHEN** an engineering manager of the team requests the active topics
- **THEN** the response is `403` and its body contains no `isCustomizationLocked` field
- **AND** the shared lock-check function is not invoked for the request
