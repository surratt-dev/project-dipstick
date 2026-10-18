## ADDED Requirements

### Requirement: Add Custom Topic rejects a name that duplicates an active topic of the same team

`POST /api/v1/teams/:teamId/topics` SHALL reject a request whose `name`, after `trim()` and `toLowerCase()` (no locale argument; `normalizeTopicNameForMatch`), equals the name of any ACTIVE topic of the same team, with `409 Conflict`, reason code `TOPIC_NAME_ACTIVE`, in the house error envelope (`buildErrorEnvelope`, category `precondition_failed`, with `correlationId`) with `conflictingTopicId` and `conflictingName` (the conflicting topic's stored name; a string, possibly empty, never null) as additional keys inside `error`. The response SHALL carry `Cache-Control: no-store` and SHALL be identical in shape for every role. No other normalisation applies: letters with and without diacritics, NFC and NFD forms, and differing internal whitespace are different names. Archived topics and prompt text SHALL NOT be considered; a duplicate prompt remains allowed. When several active topics match, the one with the lowest `display_order`, then lowest `id`, is named. The check SHALL run inside the per-team advisory transaction lock, before the `display_order` read and the insert, so that concurrent requests whose names match after normalisation yield exactly one success and the rest `TOPIC_NAME_ACTIVE`. A rejected request SHALL insert no row, leave no gap in `display_order`, and write no `audit_log` row (a name conflict is a validation outcome, not an access-control event; contrast `topic.write_denied_locked`). No log line is required or asserted; any log emitted SHALL NOT contain the submitted name or the conflicting name. When the topic-write rate limiter is unavailable the existing fail-closed `503` applies and `TOPIC_NAME_ACTIVE` is never returned. The response SHALL NOT echo the submitted name. No request parameter, header, body field, role (including `application_admin`) or setting SHALL change this outcome. This is a duplicate-prevention rule, not a uniqueness guarantee; existing duplicates are not affected.

#### Scenario: A name matching an active topic is rejected
- **WHEN** a facilitator adds a topic named " safety " to a team whose active topic is named "Safety"
- **THEN** the response is `409 Conflict` with `TOPIC_NAME_ACTIVE`, `conflictingName: "Safety"` and the active topic's id as `conflictingTopicId`
- **AND** no topic is created, no `topic.custom_added` row is written, and the next successful add receives the next unused `display_order`

#### Scenario: Limiter unavailable never yields a name answer
- **WHEN** the topic-write rate limiter is unavailable and an Add with a conflicting name is submitted
- **THEN** the response is the existing `503` (`TOPIC_WRITE_RATE_LIMIT_UNAVAILABLE`), not `409`

#### Scenario: The 409 body has exactly the documented keys
- **WHEN** an Add is rejected with `TOPIC_NAME_ACTIVE`
- **THEN** the body is `{ "error": { "category": "precondition_failed", "code": "TOPIC_NAME_ACTIVE", "message": "<text>", "conflictingTopicId": "<uuid>", "conflictingName": "Safety", "correlationId": "<uuid>" } }` with header `Cache-Control: no-store`
- **AND** `error` has exactly the keys `category`, `code`, `message`, `correlationId`, `conflictingTopicId`, `conflictingName` (no `field`), and the submitted name appears nowhere in the body

#### Scenario: A name matching only an archived topic is accepted
- **WHEN** a facilitator adds a topic whose name matches only an archived topic of the team
- **THEN** the response is `201 Created`

#### Scenario: A matching prompt with a different name is accepted
- **WHEN** a facilitator adds a topic whose prompt equals an active topic's prompt but whose name differs
- **THEN** the response is `201 Created`

#### Scenario: Names that are not equal after trim and lowercase are accepted (known limitation)
- **WHEN** a facilitator adds "Equipe" where "Équipe" is active, "A  B" (two spaces) where "A B" is active, or an NFD form where the NFC form is active
- **THEN** the response is `201 Created`
- **AND** this is the recorded known limitation that look-alike names are not caught (see proposal, Known limitations)

#### Scenario: An application administrator has no exemption
- **WHEN** an `application_admin` adds a topic whose name duplicates an active topic, with or without an extra body field such as `force: true`
- **THEN** the response is `409 Conflict` with `TOPIC_NAME_ACTIVE`

#### Scenario: Concurrent adds of the same name produce one topic
- **WHEN** two requests adding names that match after normalisation (for example "Safety" and "safety ") are submitted concurrently to the same team
- **THEN** exactly one responds `201 Created` and the other `409 Conflict` with `TOPIC_NAME_ACTIVE`
- **AND** the team has one active topic of that name

#### Scenario: Rejection spends rate-limit budget
- **WHEN** a request is rejected with `TOPIC_NAME_ACTIVE`
- **THEN** it has consumed one unit of the shared topic-write budget, as any other 4xx after the limiter does

## MODIFIED Requirements

### Requirement: Add Custom Topic evaluates checks in a fixed order — identity/role, team existence, lock, then body validation, then active-name rule

`POST /api/v1/teams/:teamId/topics` SHALL evaluate the following checks in this order, rejecting on the first one that fails and evaluating no later check — nor reporting its outcome — once an earlier one has already failed: (1) identity/role authorization (`403 Forbidden`, `NOT_A_FACILITATOR` or `FACILITATOR_IS_TEAM_MEMBER`; an `application_admin` always passes this check); (1b) the topic-write rate limit (`503 Service Unavailable`, `TOPIC_WRITE_RATE_LIMIT_UNAVAILABLE`, or `429 Too Many Requests`, `TOPIC_WRITE_BURST_LIMIT_EXCEEDED` or `TOPIC_WRITE_DAILY_LIMIT_EXCEEDED`; see `topic-write-rate-limiting`); (2) team existence (`404 Not Found`, `TEAM_NOT_FOUND`); (2a) the template team — a `teamId` equal to `DEFAULT_TOPICS_TEAM_ID` is answered exactly as a nonexistent team (`404 Not Found`, `TEAM_NOT_FOUND`) (see `default-topic-provisioning`, Requirement: The template team is never written through a team-scoped topic-write endpoint); (3) the customization lock (`409 Conflict`, `TOPIC_CUSTOMIZATION_LOCKED`); (4) request body validation (`422 Unprocessable Entity`); (5) the active-name rule — the submitted name, after `trim()` and `toLowerCase()`, duplicates the name of an active topic of the same team (`409 Conflict`, `TOPIC_NAME_ACTIVE`), evaluated inside the per-team transaction lock after validation passes. This ordering is stated once, here, as the canonical sequence; the individual requirements above and below describe each check's own condition and reason code but defer to this requirement for their relative order. The order SHALL be the same for administrators and facilitators.

The shipped handler SHALL also apply a constant minimum response-time floor (`applyTimingFloor`) at every one of these early-return points, plus the `201` success path, the `TOPIC_NAME_ACTIVE` rejection and the rate-limit `429` and `503` returns, so that this ordering's status-code-level anti-enumeration guarantee is not reopened through response-latency differences. The assertion is that `applyTimingFloor` is invoked on those paths, not a measured latency (measurement is #305). This includes the template-team `404`, both `403` branches emitted by the administrator-aware authorization check and the `404` and `409` returns reached by an administrator. A status-code ordering alone is not sufficient for this requirement to be considered met.

#### Scenario: A request against a nonexistent team is rejected with 404
- **WHEN** a standing facilitator who is not an active member of any team submits a request against a `teamId` that does not correspond to any existing team
- **THEN** the response is `404 Not Found` with reason code `TEAM_NOT_FOUND`
- **AND** no topic is created

#### Scenario: A caller who is neither facilitator nor administrator receives 403 rather than 404 against a nonexistent team
- **WHEN** a caller whose `global_role` is neither `facilitator` nor `application_admin` submits a request against a `teamId` that does not correspond to any existing team
- **THEN** the response is `403 Forbidden` with reason code `NOT_A_FACILITATOR`
- **AND** the response does not reveal whether the team exists

#### Scenario: A caller who is neither facilitator nor administrator submitting an invalid body still receives 403, not 422
- **WHEN** a caller whose `global_role` is neither `facilitator` nor `application_admin` submits a request with a missing `name` and an invalid `voteType` against any team
- **THEN** the response is `403 Forbidden` with reason code `NOT_A_FACILITATOR`
- **AND** the response does not include `error.field`

#### Scenario: A locked team's rejection takes priority over an invalid body
- **WHEN** a standing facilitator who is not a member of the target team submits a request with an invalid `name` against a team with zero completed sessions
- **THEN** the response is `409 Conflict` with reason code `TOPIC_CUSTOMIZATION_LOCKED`
- **AND** the response does not include `error.field`

#### Scenario: A request against a nonexistent team with an invalid body still receives 404, not 422
- **WHEN** a standing facilitator who is not an active member of any team submits a request with a missing `prompt` against a `teamId` that does not correspond to any existing team
- **THEN** the response is `404 Not Found` with reason code `TEAM_NOT_FOUND`
- **AND** the response does not include `error.field`

#### Scenario: An administrator against a nonexistent team with an invalid body receives 404, not 422
- **WHEN** an `application_admin` submits a request with a missing `prompt` against a canonical-format `teamId` that does not correspond to any existing team
- **THEN** the response is `404 Not Found` with reason code `TEAM_NOT_FOUND`
- **AND** the response does not include `error.field`

#### Scenario: An administrator against a locked team with an invalid body receives 409, not 422
- **WHEN** an `application_admin` submits a request with an invalid `name` against a team with zero completed sessions
- **THEN** the response is `409 Conflict` with reason code `TOPIC_CUSTOMIZATION_LOCKED`
- **AND** the response does not include `error.field`

#### Scenario: An administrator against an unlocked team with an invalid body receives 422
- **WHEN** an `application_admin` submits a request omitting `voteType` against an unlocked, existing team
- **THEN** the response is `422 Unprocessable Entity` with `error.field: "voteType"`
- **AND** no topic is created

#### Scenario: Every early return reachable through the administrator-aware check applies the timing floor
- **WHEN** an `application_admin` request ends in `404` (nonexistent team) or `409` (locked team), or a request ends in `403 NOT_A_FACILITATOR` (engineer or engineering manager) or `403 FACILITATOR_IS_TEAM_MEMBER` (member-facilitator)
- **THEN** `applyTimingFloor` has been applied before the response is sent

#### Scenario: The template team is rejected with 404 before the customization lock (tested in both lock states)
- **WHEN** a standing facilitator or an `application_admin` with an invalid body submits a request against `teamId = DEFAULT_TOPICS_TEAM_ID`, in either lock state
- **THEN** the response is `404 Not Found` with reason code `TEAM_NOT_FOUND`
- **AND** the customization lock is not evaluated and no `topic.write_denied_locked` row is written
- **AND** exactly one `topic.write_denied_template` row is written, with `metadata.attempted_operation = "topic.custom_added"`
- **AND** the response matches this endpoint's own nonexistent-team `404` (see `default-topic-provisioning`)
- **AND** the response does not include `error.field`
- **AND** no topic is created

#### Scenario: An over-budget actor receives 429 before team existence, template, lock or body checks
- **WHEN** an authorized actor who is over the topic-write budget submits an add-custom-topic request against a nonexistent team, the template team, a locked team, or with an invalid body
- **THEN** the response is `429 Too Many Requests` with the same body in every case
- **AND** no `topic.write_denied_template` or `topic.write_denied_locked` row is written

#### Scenario: A caller who fails authorization receives 403, never 429
- **WHEN** a caller who fails identity/role authorization submits an add-custom-topic request, however many requests that caller has made
- **THEN** the response is `403 Forbidden`

#### Scenario: A locked team never receives the name-conflict rejection
- **WHEN** a standing facilitator or an `application_admin` submits a request whose name duplicates an active topic against a team with zero completed sessions
- **THEN** the response is `409 Conflict` with reason code `TOPIC_CUSTOMIZATION_LOCKED`
- **AND** the body contains no `conflictingTopicId` or `conflictingName`

#### Scenario: An invalid body is rejected with 422 before the name rule is evaluated
- **WHEN** a request whose `name` is empty or whitespace-only (or whose `voteType` is invalid) is submitted against an unlocked team
- **THEN** the response is `422 Unprocessable Entity`, never `TOPIC_NAME_ACTIVE`
