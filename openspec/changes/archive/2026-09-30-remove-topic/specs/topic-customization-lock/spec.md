## ADDED Requirements

### Requirement: The all-topics endpoint uses the standing, org-wide facilitator authorization model, matching every other topic-write endpoint it serves

`GET /api/v1/teams/:teamId/topics/all` SHALL authorize requests using the same standing, org-wide facilitator model as `POST /api/v1/teams/:teamId/topics`, `DELETE /api/v1/teams/:teamId/topics/:topicId`, and every other topic-write endpoint this capability gates: `global_role = 'facilitator'` AND the caller is not an active member of the target team, OR `global_role = 'application_admin'`. This endpoint SHALL NOT require that the caller currently hold, or have ever held, an active session for the target team. No completed-session relationship, and no prior facilitation history with the specific team, is required.

This endpoint SHALL apply the same constant minimum response-time floor (`applyTimingFloor`) at every early-return from this authorization check (`403 Forbidden`, on either rejection reason) as every other endpoint this capability's timing-floor requirement already covers, so that response latency does not distinguish "never going to be authorized" from "authorized" for a caller probing this endpoint.

#### Scenario: A standing facilitator with no session history for the team can list its topics
- **WHEN** a facilitator who is not an active member of a team, and who has never run any session for that team, requests that team's full topic list (active and archived)
- **THEN** the response is `200 OK` with the team's active and archived topics

#### Scenario: An application admin can list any team's topics
- **WHEN** an authenticated user with `global_role = 'application_admin'` requests a team's full topic list
- **THEN** the response is `200 OK` with the team's active and archived topics

#### Scenario: A caller who is neither a standing facilitator nor an admin is rejected
- **WHEN** a caller who does not have `global_role = 'facilitator'` (and is not an `application_admin`), or who is an active member of the target team, requests that team's full topic list
- **THEN** the response is `403 Forbidden`

#### Scenario: A facilitator who is an active member of the team is rejected
- **WHEN** a facilitator who is an active member of the target team requests that team's full topic list
- **THEN** the response is `403 Forbidden`, even though the caller holds `global_role = 'facilitator'`

#### Scenario: A 403 rejection is not detectably faster than a 200 success
- **WHEN** a caller who fails this endpoint's authorization check submits a request, and a separately-measured authorized caller's request against the same endpoint is also submitted
- **THEN** the `403` response's timing is not detectably faster than the `200` response's timing, because both apply the same minimum response-time floor

### Requirement: The all-topics endpoint's archived-topic entries expose who archived them and when

Each entry in `GET /api/v1/teams/:teamId/topics/all`'s `archived` array SHALL include `archivedAt` (the timestamp the topic transitioned to `archived`) and `archivedBy` (the archiving user's ID and display name, or `null` if unavailable). This is a facilitator-facing read path, distinct from and in addition to any audit-log record of the same event — a facilitator viewing this endpoint's response SHALL NOT need to consult the audit log to determine who archived a topic or when.

#### Scenario: An archived topic's entry includes who archived it and when
- **WHEN** a standing facilitator requests a team's full topic list, and that team has an archived topic
- **THEN** the corresponding entry in the `archived` array includes `archivedAt` matching the time it was archived
- **AND** includes `archivedBy` with the archiving user's ID and display name
