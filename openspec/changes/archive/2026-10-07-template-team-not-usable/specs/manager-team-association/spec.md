# Spec Delta: manager-team-association

## ADDED Requirements

### Requirement: TEAM-006 refuses the template team as if it did not exist

`POST /api/v1/teams/:teamId/managers` with `teamId = DEFAULT_TOPICS_TEAM_ID` SHALL return the same response the endpoint returns for a canonical-format `teamId` that matches no team (`404` with `error.code: "TEAM_NOT_FOUND"`). The check SHALL run after authentication, the `application_admin` authorization check and the rate limiter, exactly where the missing-team check runs. No `team_memberships` row SHALL be created, and an Engineering Manager SHALL never be associated with the template.

#### Scenario: An administrator cannot make anyone an EM of the template
- **WHEN** an `application_admin` sends TEAM-006 for the template with a valid EM user
- **THEN** the response matches the endpoint's missing-team response in status and body (except `correlationId`)
- **AND** no `team_memberships` row is created, no `team.manager_established` row is written, and one `team.template_access_denied` row with `surface: "membership"` is written

#### Scenario: Non-administrators are still refused first
- **WHEN** a caller who is not an `application_admin` sends TEAM-006 for the template
- **THEN** the response is the endpoint's existing `403` and no `team.template_access_denied` row is written

#### Scenario: The rate limiter still applies
- **WHEN** an `application_admin` has exhausted the TEAM-006 rate limit and sends TEAM-006 for the template
- **THEN** the response is the rate-limit response, as for any team
