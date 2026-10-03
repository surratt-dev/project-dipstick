## MODIFIED Requirements

### Requirement: Restore Topic evaluates checks in a fixed order — identity/role, team existence, lock, topic existence, then topic status

`POST /api/v1/teams/:teamId/topics/:topicId/restore` SHALL evaluate the following checks in this order, rejecting on the first one that fails and evaluating no later check — nor reporting its outcome — once an earlier one has already failed: (1) identity/role authorization — the caller satisfies (`global_role = 'facilitator'` AND not an active member of the target team) OR `global_role = 'application_admin'` (`403 Forbidden`, `NOT_A_FACILITATOR` or `FACILITATOR_IS_TEAM_MEMBER`; an `application_admin` is exempt from both the role and the membership sub-check); (2) team existence (`404 Not Found`, `TEAM_NOT_FOUND`); (2a) the template team — a `teamId` equal to `DEFAULT_TOPICS_TEAM_ID` is answered exactly as a nonexistent team (`404 Not Found`, `TEAM_NOT_FOUND`) (see `default-topic-provisioning`, Requirement: The template team is never written through a team-scoped topic-write endpoint); (3) the customization lock (`409 Conflict`, `TOPIC_CUSTOMIZATION_LOCKED`); (4) topic existence and ownership — the `topicId` path parameter references a row belonging to the target team (`404 Not Found`, `TOPIC_NOT_FOUND`); (5) topic status — the topic is currently `archived` (`422 Unprocessable Entity`, `TOPIC_ALREADY_ACTIVE`). The shipped handler SHALL also apply a constant minimum response-time floor (`applyTimingFloor`) at every one of these early-return points, plus the `200` success outcome, so this ordering's status-code-level anti-enumeration guarantee is not reopened through response-latency differences.

#### Scenario: A non-facilitator, non-admin caller receives 403 regardless of team or topic state
- **WHEN** a caller without `global_role = 'facilitator'` and without `global_role = 'application_admin'` submits a request against any `teamId`/`topicId` combination
- **THEN** the response is `403 Forbidden` with reason code `NOT_A_FACILITATOR`
- **AND** the response does not reveal whether the team or topic exists, is locked, or is already active

#### Scenario: An application administrator is exempt from the team-membership check
- **WHEN** an authenticated user with `global_role = 'application_admin'` who is also an active member of the target team submits a request to restore one of that team's archived topics on an unlocked team
- **THEN** the request is not rejected at the identity/role check
- **AND** it proceeds to the remaining checks in the cascade (team existence, template team, lock, topic existence, topic status) as normal

#### Scenario: A request against a nonexistent team is rejected with 404 before the lock or topic are evaluated
- **WHEN** a standing facilitator who is not an active member of any team submits a request against a `teamId` that does not correspond to any existing team
- **THEN** the response is `404 Not Found` with reason code `TEAM_NOT_FOUND`

#### Scenario: A locked team's rejection takes priority over topic-specific state
- **WHEN** a standing facilitator who is not a member of the target team submits a request against a team with zero completed sessions, for a `topicId` that is already active
- **THEN** the response is `409 Conflict` with reason code `TOPIC_CUSTOMIZATION_LOCKED`
- **AND** the response does not reveal the topic's status

#### Scenario: A nonexistent topic is rejected with 404 after the lock passes
- **WHEN** a standing facilitator who is not a member of the target team submits a request against an unlocked team, for a `topicId` that does not belong to that team
- **THEN** the response is `404 Not Found` with reason code `TOPIC_NOT_FOUND`

#### Scenario: An already-active topic is rejected with 422
- **WHEN** a standing facilitator who is not a member of the target team submits a request against an unlocked team, for a topic whose status is already `active`
- **THEN** the response is `422 Unprocessable Entity` with reason code `TOPIC_ALREADY_ACTIVE`
- **AND** the topic's state is unchanged

#### Scenario: The template team is rejected with 404 before the customization lock (tested in both lock states)
- **WHEN** a standing facilitator or an `application_admin`, naming any `topicId`, submits a request against `teamId = DEFAULT_TOPICS_TEAM_ID`, in either lock state
- **THEN** the response is `404 Not Found` with reason code `TEAM_NOT_FOUND`
- **AND** the customization lock is not evaluated and no `topic.write_denied_locked` row is written
- **AND** exactly one `topic.write_denied_template` row is written, with `metadata.attempted_operation = "topic.restored"`
- **AND** the response matches this endpoint's own nonexistent-team `404` (see `default-topic-provisioning`)
- **AND** no topics row is modified
