## MODIFIED Requirements

### Requirement: Reorder Topics evaluates checks in a fixed order

`PUT /api/v1/teams/:teamId/topics/order` SHALL evaluate checks in the following order. It SHALL reject on the first check that fails, and SHALL neither evaluate nor report the outcome of any later check:
1. **Identity/role:** `403 Forbidden`, `NOT_A_FACILITATOR` or `FACILITATOR_IS_TEAM_MEMBER`. An `application_admin` is exempt from both sub-checks.
1b. **Topic-write rate limit:** `503 Service Unavailable`, `TOPIC_WRITE_RATE_LIMIT_UNAVAILABLE`, or `429 Too Many Requests`, `TOPIC_WRITE_BURST_LIMIT_EXCEEDED` or `TOPIC_WRITE_DAILY_LIMIT_EXCEEDED` (see `topic-write-rate-limiting`).
2. **Team existence:** `404 Not Found`, `TEAM_NOT_FOUND`.
2a. **Template team:** a `teamId` equal to `DEFAULT_TOPICS_TEAM_ID` is answered exactly as a nonexistent team: `404 Not Found`, `TEAM_NOT_FOUND` (see `default-topic-provisioning`, Requirement: The template team is never written through a team-scoped topic-write endpoint).
3. **Customization lock:** `409 Conflict`, `TOPIC_CUSTOMIZATION_LOCKED`.
4. **Body structure:** `422 Unprocessable Entity`, `INVALID_TOPIC_ORDER`, with `error.field: "orderedTopicIds"`. This check fails when the body is not a JSON object (for example `null`, an array, or a string), when `orderedTopicIds` is missing or not an array, is empty, or has more than 200 entries, when an entry is not a string matching `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$` case-insensitively, or when the list contains duplicates after every entry is lowercased. The length check SHALL be evaluated before any per-entry check. The `422` message SHALL NOT echo submitted values.
5. **Set equality** against the team's current active topic IDs, evaluated inside the per-team advisory lock: `409 Conflict`, `TOPIC_ORDER_STALE`.

Every entry SHALL be lowercased before the duplicate check, and only the lowercased list SHALL be used for the set comparison, the no-op comparison, the database write, the audit row, and the response. Every rejection SHALL use the standard error envelope `{ error: { category, code, message, correlationId } }`. The handler SHALL apply `applyTimingFloor` at every handled exit, including `200`. `404` SHALL be returned only for a nonexistent team or the template team, never for a topic ID. Every response from this endpoint, success or error, SHALL carry `Cache-Control: no-store`. No malformed entry SHALL reach the database, so no body can produce a `500`.

#### Scenario: A locked team is rejected with 409 regardless of the body
- **WHEN** a standing facilitator submits a malformed body (for example, an empty array) against a team with zero completed sessions
- **THEN** the response is `409 Conflict` with `error.code: "TOPIC_CUSTOMIZATION_LOCKED"`, not `422`

#### Scenario: A non-facilitator is rejected with 403 before the team or lock is evaluated
- **WHEN** a caller with neither `facilitator` nor `application_admin` global role submits a reorder against a nonexistent team
- **THEN** the response is `403 Forbidden` with `error.code: "NOT_A_FACILITATOR"`

#### Scenario: A facilitator who is a team member is rejected with 403
- **WHEN** a facilitator who is an active member of the target team submits a reorder
- **THEN** the response is `403 Forbidden` with `error.code: "FACILITATOR_IS_TEAM_MEMBER"`

#### Scenario: A nonexistent team is rejected with 404
- **WHEN** a standing facilitator submits a reorder for a team ID that does not exist
- **THEN** the response is `404 Not Found` with `error.code: "TEAM_NOT_FOUND"`

#### Scenario: Structurally malformed bodies are rejected with 422
- **WHEN** a standing facilitator submits, against an unlocked team, an `orderedTopicIds` that is not an array, contains a non-UUID string, contains the same ID twice, is empty, or has 201 entries
- **THEN** each request is rejected with `422 Unprocessable Entity`, `error.code: "INVALID_TOPIC_ORDER"`, and `error.field: "orderedTopicIds"`
- **AND** no topic row is modified

#### Scenario: A body that is not an object is rejected with 422, not 500
- **WHEN** a standing facilitator submits, against an unlocked team, a JSON body of `null`, a bare array, or a string
- **THEN** each request is rejected with `422 Unprocessable Entity` and `error.code: "INVALID_TOPIC_ORDER"`

#### Scenario: The same ID in different letter case is a duplicate
- **WHEN** a standing facilitator submits, against an unlocked team, a list containing one topic ID in uppercase and the same ID in lowercase
- **THEN** the response is `422 Unprocessable Entity` with `error.code: "INVALID_TOPIC_ORDER"`, not `409` or `500`

#### Scenario: An uppercase but otherwise correct list is accepted
- **WHEN** a standing facilitator submits the team's current active topic IDs, all uppercased, in a new order
- **THEN** the response is `200 OK` and the order is saved
- **AND** the response's `topicId` values and the audit row's `new_order` are lowercase

#### Scenario: Every response forbids caching
- **WHEN** a reorder request succeeds or is rejected at any step
- **THEN** the response carries `Cache-Control: no-store`

#### Scenario: Every exit applies the timing floor
- **WHEN** a reorder request exits at any step of the cascade, or succeeds
- **THEN** the response is sent no sooner than the shared `applyTimingFloor` minimum

#### Scenario: The template team is rejected with 404 before the customization lock (tested in both lock states)
- **WHEN** a standing facilitator or an `application_admin`, with any body, submits a request against `teamId = DEFAULT_TOPICS_TEAM_ID`, in either lock state
- **THEN** the response is `404 Not Found` with reason code `TEAM_NOT_FOUND`
- **AND** the customization lock is not evaluated and no `topic.write_denied_locked` row is written
- **AND** exactly one `topic.write_denied_template` row is written, with `metadata.attempted_operation = "topic.reordered"`
- **AND** the response matches this endpoint's own nonexistent-team `404` (see `default-topic-provisioning`)
- **AND** no topics row is modified

#### Scenario: An over-budget actor receives 429 before team existence, template, lock or body checks
- **WHEN** an authorized actor who is over the topic-write budget submits a reorder request against a nonexistent team, the template team, a locked team, or with an invalid body
- **THEN** the response is `429 Too Many Requests` with the same body in every case
- **AND** no `topic.write_denied_template` or `topic.write_denied_locked` row is written

#### Scenario: A caller who fails authorization receives 403, never 429
- **WHEN** a caller who fails identity/role authorization submits a reorder request, however many requests that caller has made
- **THEN** the response is `403 Forbidden`
