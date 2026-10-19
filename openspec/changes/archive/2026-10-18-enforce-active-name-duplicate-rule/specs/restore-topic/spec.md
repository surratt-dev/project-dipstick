## ADDED Requirements

### Requirement: Single restore rejects an archived topic whose name duplicates an active topic

`POST /api/v1/teams/:teamId/topics/:topicId/restore` SHALL reject restoring an archived topic whose name, after `trim()` and `toLowerCase()` (no locale argument; `normalizeTopicNameForMatch`), equals the name of any ACTIVE topic of the same team, with `409 Conflict`, reason code `TOPIC_NAME_ACTIVE`, in the house error envelope (`buildErrorEnvelope`, category `precondition_failed`, with `correlationId`, header `Cache-Control: no-store`, identical in shape for every role) with `conflictingTopicId` and `conflictingName` as additional keys inside `error` (the conflicting active topic's stored name; a string, possibly empty for a legacy blank name, never null). The topic SHALL remain archived and unchanged; no `restored_at`/`restored_by` is set, no `display_order` is consumed, and no `audit_log` row is written (a name conflict is a validation outcome, not an access-control event; no log line is required or asserted, and any log SHALL NOT contain the restored topic's name or the conflicting name; when the rate limiter is unavailable the existing fail-closed `503` applies, never `409`). The comparison SHALL run inside the per-team advisory transaction lock before the append position is computed, against active topics only (a name matching another archived topic is not a conflict). When several active topics match, the lowest `display_order`, then lowest `id`, is named. No parameter, header, body field, role (including `application_admin`) or setting SHALL change this outcome. Concurrent restores or adds whose names match after normalisation SHALL yield exactly one success. Once the active topic is archived (or otherwise no longer matches), retrying the same restore succeeds.

#### Scenario: Restoring a topic whose name matches an active topic is rejected
- **WHEN** a facilitator restores an archived topic named "Pairing" while "pairing" is active in the same team
- **THEN** the response is `409 Conflict` with `TOPIC_NAME_ACTIVE`, `conflictingName: "pairing"` and the active topic's id as `conflictingTopicId`
- **AND** the archived topic is still `archived` with `restored_at` unset, and no `topic.restored` row is written

#### Scenario: Archiving the active topic then retrying succeeds (swap)
- **WHEN** after that rejection the facilitator archives the active "pairing" topic and restores "Pairing" again
- **THEN** the second restore responds `200 OK`

#### Scenario: An administrator has no exemption
- **WHEN** an `application_admin` restores such a topic, with or without an extra body field such as `force: true`
- **THEN** the response is `409 Conflict` with `TOPIC_NAME_ACTIVE`

#### Scenario: Two archived topics with the same name restored in turn
- **WHEN** two archived topics share a name and the first is restored, then the second
- **THEN** the second is rejected with `TOPIC_NAME_ACTIVE`

#### Scenario: A blank-named legacy topic conflicts with a blank-named active topic
- **WHEN** a facilitator restores an archived topic whose name is blank while an active topic with a blank name exists
- **THEN** the response is `409 Conflict` with `TOPIC_NAME_ACTIVE` and `conflictingName: ""` (an empty string, not null)
- **AND** the client renders the conflicting topic as "a topic with no name"

#### Scenario: Concurrent restores of the same topic
- **WHEN** two restores of the same archived topic are submitted concurrently
- **THEN** exactly one responds `200 OK` and the other `422 TOPIC_ALREADY_ACTIVE`, never `409 TOPIC_NAME_ACTIVE`

#### Scenario: Concurrent restores of two same-named archived topics
- **WHEN** restores of two archived topics sharing a normalized name are submitted concurrently to the same team
- **THEN** exactly one responds `200 OK` and the other `409 Conflict` with `TOPIC_NAME_ACTIVE`

#### Scenario: Concurrent single restore and bulk restore of the same-named default
- **WHEN** a single restore and a bulk restore of an archived default of one name are submitted concurrently
- **THEN** the team ends with one active topic of that name: the single restore may succeed and bulk skips it with `NAME_ACTIVE`, or bulk restores it and the single restore is rejected `TOPIC_NAME_ACTIVE`

#### Scenario: Remove takes the same per-team lock
- **WHEN** an archive (Remove) of the conflicting active topic and a restore of the same-named archived topic run concurrently
- **THEN** they are serialized by the per-team advisory lock, so the restore sees either the topic still active (rejected) or already archived (succeeds), never a state with two active topics of that name

#### Scenario: Concurrent restore and add of one name
- **WHEN** a restore of an archived "Safety" and an add of "safety" are submitted concurrently to the same team
- **THEN** exactly one succeeds and the other responds `409 Conflict` with `TOPIC_NAME_ACTIVE`

## MODIFIED Requirements

### Requirement: Restore Topic evaluates checks in a fixed order — identity/role, team existence, lock, topic existence, then topic status, then active-name rule

`POST /api/v1/teams/:teamId/topics/:topicId/restore` SHALL evaluate the following checks in this order, rejecting on the first one that fails and evaluating no later check — nor reporting its outcome — once an earlier one has already failed: (1) identity/role authorization — the caller satisfies (`global_role = 'facilitator'` AND not an active member of the target team) OR `global_role = 'application_admin'` (`403 Forbidden`, `NOT_A_FACILITATOR` or `FACILITATOR_IS_TEAM_MEMBER`; an `application_admin` is exempt from both the role and the membership sub-check); (1b) the topic-write rate limit (`503 Service Unavailable`, `TOPIC_WRITE_RATE_LIMIT_UNAVAILABLE`, or `429 Too Many Requests`, `TOPIC_WRITE_BURST_LIMIT_EXCEEDED` or `TOPIC_WRITE_DAILY_LIMIT_EXCEEDED`; see `topic-write-rate-limiting`); (2) team existence (`404 Not Found`, `TEAM_NOT_FOUND`); (2a) the template team — a `teamId` equal to `DEFAULT_TOPICS_TEAM_ID` is answered exactly as a nonexistent team (`404 Not Found`, `TEAM_NOT_FOUND`) (see `default-topic-provisioning`, Requirement: The template team is never written through a team-scoped topic-write endpoint); (3) the customization lock (`409 Conflict`, `TOPIC_CUSTOMIZATION_LOCKED`); (4) topic existence and ownership — the `topicId` path parameter references a row belonging to the target team (`404 Not Found`, `TOPIC_NOT_FOUND`; a `topicId` that is not a canonical UUID SHALL be answered here with this same `404` without any query, never with a `5xx`); (5) topic status — the topic is currently `archived` (`422 Unprocessable Entity`, `TOPIC_ALREADY_ACTIVE`); (6) the active-name rule — the topic's name, after `trim()` and `toLowerCase()`, duplicates the name of an active topic of the same team (`409 Conflict`, `TOPIC_NAME_ACTIVE`), evaluated inside the per-team transaction lock. Checks (4) and (5) run before the transaction; inside the lock the topic is re-read, and if it is no longer archived the answer remains `422 TOPIC_ALREADY_ACTIVE`, which therefore takes precedence over (6). The shipped handler SHALL also apply a constant minimum response-time floor (`applyTimingFloor`) at every one of these early-return points, plus the rate-limit `429` and `503` returns, the `200` success outcome and the `TOPIC_NAME_ACTIVE` rejection, so this ordering's status-code-level anti-enumeration guarantee is not reopened through response-latency differences. The assertion is that `applyTimingFloor` is invoked on those paths, not a measured latency (measurement is #305).

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

#### Scenario: An over-budget actor receives 429 before team existence, template, lock or body checks
- **WHEN** an authorized actor who is over the topic-write budget submits a restore request against a nonexistent team, the template team, a locked team, or with a non-canonical or nonexistent `topicId`
- **THEN** the response is `429 Too Many Requests` with the same body in every case
- **AND** no `topic.write_denied_template` or `topic.write_denied_locked` row is written

#### Scenario: A caller who fails authorization receives 403, never 429
- **WHEN** a caller who fails identity/role authorization submits a restore request, however many requests that caller has made
- **THEN** the response is `403 Forbidden`

#### Scenario: A malformed topicId is answered 404 without a query
- **WHEN** an authorized actor on an existing, unlocked team submits a restore request whose `topicId` is not a canonical UUID
- **THEN** the response is `404 Not Found` with reason code `TOPIC_NOT_FOUND`, not `500`
- **AND** no query against `topics` is issued for that `topicId`

#### Scenario: A locked team never receives the name-conflict rejection
- **WHEN** a facilitator or administrator restores an archived topic whose name duplicates an active topic, on a team with zero completed sessions
- **THEN** the response is `409 Conflict` with `TOPIC_CUSTOMIZATION_LOCKED` and no conflicting-topic fields

#### Scenario: Already-active takes precedence over the name rule
- **WHEN** a request restores a topic that is already active and whose name equals another active topic's name (a legacy duplicate)
- **THEN** the response is `422 Unprocessable Entity` with `TOPIC_ALREADY_ACTIVE`

## REMOVED Requirements

### Requirement: Single restore is unchanged by the existence of bulk restore
**Reason**: It states that single restore has "an absence of a name-uniqueness check" and carries the scenario "Single restore ignores the duplicate rule". The Product Owner decided (#299) that all three doors enforce the active-name rule, so this statement is now false.
**Migration**: Replaced by "Single restore rejects an archived topic whose name duplicates an active topic". Bulk restore (`bulk-restore-default-topics`) remains a separate endpoint with skip-and-report semantics; single restore remains the path for restoring a chosen subset and any non-default topic, now subject to the same rule.
