# Spec Delta: role-assignment

## ADDED Requirements

### Requirement: Member listing and TEAM-005 answer the template team as they answer a missing team

`GET /api/v1/teams/:teamId/members` and `PATCH /api/v1/teams/:teamId/members/:userId/role` with `teamId = DEFAULT_TOPICS_TEAM_ID` SHALL return, for a caller with the same role, the response each endpoint returns for a canonical-format `teamId` that matches no team. A caller refused by an earlier role or membership check gets that check's existing `403` and no `team.template_access_denied` row. No membership row SHALL be changed.

#### Scenario: An administrator changing a role on the template
- **WHEN** an `application_admin` sends TEAM-005 for the template
- **THEN** the response is `404` with the message "User is not an active member of this team.", matching the missing-team response
- **AND** no `team_memberships` row changes and one `team.template_access_denied` row with `surface: "membership"` is written

#### Scenario: A non-administrator changing a role on the template
- **WHEN** a caller who is not an `application_admin` and holds no membership on the template sends TEAM-005 for it
- **THEN** the response is the endpoint's existing `403`, as for a missing team, and no `team.template_access_denied` row is written

#### Scenario: An administrator lists template members
- **WHEN** an `application_admin` sends `GET /api/v1/teams/<DEFAULT_TOPICS_TEAM_ID>/members`
- **THEN** the response matches the endpoint's response for a team that does not exist
- **AND** one `team.template_access_denied` row with `surface: "membership"` is written

#### Scenario: A non-administrator lists template members
- **WHEN** a caller who is not an `application_admin` sends `GET /api/v1/teams/<DEFAULT_TOPICS_TEAM_ID>/members`
- **THEN** the response is the endpoint's existing `403` "You are not a member of this team.", as for a missing team
- **AND** no `team.template_access_denied` row is written
