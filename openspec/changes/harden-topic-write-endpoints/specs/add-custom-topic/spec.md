## MODIFIED Requirements

### Requirement: Add Custom Topic evaluates checks in a fixed order — identity/role, team existence, lock, then body validation

`POST /api/v1/teams/:teamId/topics` SHALL evaluate the following checks in this order, rejecting on the first one that fails and evaluating no later check — nor reporting its outcome — once an earlier one has already failed: (1) identity/role authorization (`403 Forbidden`, `NOT_A_FACILITATOR` or `FACILITATOR_IS_TEAM_MEMBER`; an `application_admin` always passes this check); (1b) the topic-write rate limit (`503 Service Unavailable`, `TOPIC_WRITE_RATE_LIMIT_UNAVAILABLE`, or `429 Too Many Requests`, `TOPIC_WRITE_BURST_LIMIT_EXCEEDED` or `TOPIC_WRITE_DAILY_LIMIT_EXCEEDED`; see `topic-write-rate-limiting`); (2) team existence (`404 Not Found`, `TEAM_NOT_FOUND`); (2a) the template team — a `teamId` equal to `DEFAULT_TOPICS_TEAM_ID` is answered exactly as a nonexistent team (`404 Not Found`, `TEAM_NOT_FOUND`) (see `default-topic-provisioning`, Requirement: The template team is never written through a team-scoped topic-write endpoint); (3) the customization lock (`409 Conflict`, `TOPIC_CUSTOMIZATION_LOCKED`); (4) request body validation (`422 Unprocessable Entity`). This ordering is stated once, here, as the canonical sequence; the individual requirements above and below describe each check's own condition and reason code but defer to this requirement for their relative order. The order SHALL be the same for administrators and facilitators.

The shipped handler SHALL also apply a constant minimum response-time floor (`applyTimingFloor`) at every one of these early-return points, plus the `201` success path and the rate-limit `429` and `503` returns, so that this ordering's status-code-level anti-enumeration guarantee is not reopened through response-latency differences. This includes the template-team `404`, both `403` branches emitted by the administrator-aware authorization check and the `404` and `409` returns reached by an administrator. A status-code ordering alone is not sufficient for this requirement to be considered met.

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
