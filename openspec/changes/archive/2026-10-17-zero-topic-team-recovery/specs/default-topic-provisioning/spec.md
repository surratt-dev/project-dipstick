## ADDED Requirements

### Requirement: The assign-defaults endpoint is covered by the template guard and shares the canonical copy

`POST /api/v1/teams/:teamId/topics/assign-defaults` writes `topics` for a `:teamId` and therefore falls under "The template team is never written through a team-scoped topic-write endpoint": its template check runs after the non-canonical id rejection, after authorization and after team existence, answers with the same `404 TEAM_NOT_FOUND` response the endpoint gives a missing team, and writes the `topic.write_denied_template` audit row with `metadata.attempted_operation = 'topic.defaults_assigned'`. The structural template test (`teams/__tests__/template-team-guard-source.test.ts`) SHALL cover this route. The endpoint SHALL copy the canonical set with the same routine that team creation uses, so there is one definition of the canonical default set for creation, restore and recovery.

#### Scenario: The structural template test covers the new route
- **WHEN** the structural template test runs
- **THEN** it exercises `assign-defaults` against the template team and asserts the `404` response, the `topic.write_denied_template` row with `attempted_operation = 'topic.defaults_assigned'`, and that the template's rows are unchanged

#### Scenario: The recovered team matches a freshly created team
- **WHEN** the defaults are assigned to a team with zero active topics
- **THEN** the team's active topics equal, in text, vote type, description, default flag and order, those a freshly created team receives, and carry no annotation fields

### Requirement: An empty template is a refusal for assign-defaults, never a partial or empty success

When the template has no active default rows, `assign-defaults` SHALL respond `500` with `error.code` `DEFAULT_TOPICS_UNAVAILABLE`, roll back, and persist nothing. The body SHALL carry a fixed message, a `correlationId`, and no template id. The message SHALL be: "The default topic template is empty or unavailable, so nothing was assigned. An operator needs to fix the default topic template (see "Zero-topic teams" in the deployment runbook, docs/deployment.md), then try again." This is distinct from team creation's generic message because the caller here is an authenticated application administrator who can act on it.

#### Scenario: Empty template gives the admin-facing message
- **GIVEN** the template has no active default rows
- **WHEN** an `application_admin` posts to `assign-defaults` for a team with zero active topics
- **THEN** the status is `500`, the code is `DEFAULT_TOPICS_UNAVAILABLE`, the message is the one above, the body carries a `correlationId`, and it holds no template id
- **AND** the team still has zero active topics
