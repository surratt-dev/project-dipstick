# Spec Delta: topic-customization-lock

## ADDED Requirements

### Requirement: Topic read endpoints report why a team's topics are locked

TOPIC-001 (`GET /api/v1/teams/:teamId/topics`) and TOPIC-002 (`GET /api/v1/teams/:teamId/topics/all`) SHALL include `lockReason: "first_session" | "canonical_defaults" | null` beside `isCustomizationLocked` on every `200`. Both fields SHALL come from one shared server-side lock-state function used by both endpoints, so the two can never disagree. `null` SHALL mean unlocked.

#### Scenario: A real team with no completed session
- **WHEN** an authorized caller reads TOPIC-001 or TOPIC-002 for a non-template team with no completed session
- **THEN** the response has `isCustomizationLocked: true` and `lockReason: "first_session"`

#### Scenario: A real team with a completed session
- **WHEN** an authorized caller reads TOPIC-001 or TOPIC-002 for a non-template team with a completed session
- **THEN** the response has `isCustomizationLocked: false` and `lockReason: null`

#### Scenario: The template team
- **WHEN** a standing facilitator reads TOPIC-002 for `DEFAULT_TOPICS_TEAM_ID`
- **THEN** the response has `isCustomizationLocked: true` and `lockReason: "canonical_defaults"`
- **AND** TOPIC-001's handler obtains both fields by calling the shared lock-state function (asserted by a unit-level test on the handler, because TOPIC-001 admits no caller for the template over HTTP once the template has no members and no unexpired facilitator access)

### Requirement: The lock reason is a shared type

The `lockReason` type and the response shapes of TOPIC-001 and TOPIC-002 SHALL be declared in the shared types package used by both the backend and the frontend.

#### Scenario: Both endpoints use the shared response types
- **WHEN** the backend and frontend are type-checked
- **THEN** TOPIC-001 and TOPIC-002 handlers and the Topic Management screen use the shared response types that carry `lockReason`

### Requirement: The template team is permanently locked for customization, independent of session history

The shared lock-state function SHALL report the template team as locked with reason `canonical_defaults` without consulting session history. For every other team it SHALL delegate to the existing lock-check function unchanged. The existing lock-check function SHALL NOT reference the template team id, because the topic-write guard and the lock are deliberately independent.

#### Scenario: Template lock does not depend on sessions
- **GIVEN** the existing lock-check function would report the template unlocked (a test substitution)
- **WHEN** the lock-state function is called for the template
- **THEN** it returns locked with reason `canonical_defaults`

#### Scenario: The lock-check function stays template-agnostic
- **WHEN** the source of the existing lock-check function is inspected by an automated test
- **THEN** it does not reference `DEFAULT_TOPICS_TEAM_ID` or the template id literal

## MODIFIED Requirements

### Requirement: The active-topics response exposes the team's customization lock state

`GET /api/v1/teams/:teamId/topics` SHALL include an `isCustomizationLocked` boolean field in its response body, computed via the shared lock-state function (see "Topic read endpoints report why a team's topics are locked"), which delegates to the shared lock-check function for every team except the template. This field SHALL be present on every `200` response from this endpoint, for every caller the endpoint admits (see `team-content-access`, Requirement: The active-topics endpoint admits only non-manager participant members and eligible session facilitators). Any denied caller (a `null` grant, an Application Admin, or an engineering manager) SHALL receive no lock state, and neither the lock-state function nor the lock-check function SHALL run for a denied request.

#### Scenario: Locked team's topic list response includes the lock flag
- **WHEN** an authorized caller requests the active topics for a team with zero completed sessions
- **THEN** the response includes `isCustomizationLocked: true` alongside the topic list

#### Scenario: Unlocked team's topic list response includes the lock flag
- **WHEN** an authorized caller requests the active topics for a non-template team with at least one completed session
- **THEN** the response includes `isCustomizationLocked: false` alongside the topic list

#### Scenario: A denied caller receives no lock state
- **WHEN** an engineering manager of the team requests the active topics
- **THEN** the response is `403` and its body contains no `isCustomizationLocked` field
- **AND** the shared lock-check function is not invoked for the request

