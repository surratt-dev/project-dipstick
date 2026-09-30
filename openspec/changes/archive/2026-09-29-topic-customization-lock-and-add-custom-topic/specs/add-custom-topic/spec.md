## ADDED Requirements

### Requirement: A standing facilitator can add a custom topic to an unlocked team

`POST /api/v1/teams/:teamId/topics` SHALL allow an authenticated user with `global_role = 'facilitator'` who is not an active member of the target team to create a new custom topic for that team, provided the team's customization lock (per the `topic-customization-lock` capability) is not active. The request body SHALL require `name` (non-empty after trim, ≤100 characters), `prompt` (non-empty after trim, ≤500 characters), and `voteType` (one of `finger`, `roman`, `modified_roman`), and MAY include `firstSessionDescription` (≤500 characters). The created topic SHALL be marked `isDefault: false` and SHALL be assigned `displayOrder` equal to one greater than the current maximum `displayOrder` among the team's active topics.

#### Scenario: A valid request creates a custom topic
- **WHEN** a standing facilitator who is not a member of the team submits a request with a valid `name`, `prompt`, and `voteType` against an unlocked team
- **THEN** the response is `201 Created`
- **AND** the response body includes the new topic's `topicId`, `name`, `prompt`, `voteType`, `displayOrder`, `isDefault: false`, and `createdAt`

#### Scenario: A new topic is appended to the end of the display order
- **WHEN** a custom topic is successfully created for a team whose active topics currently have display orders `0` through `n`
- **THEN** the new topic is assigned `displayOrder = n + 1`

#### Scenario: An optional firstSessionDescription is stored when provided
- **WHEN** a valid request includes a `firstSessionDescription`
- **THEN** the created topic's `firstSessionDescription` is persisted with the submitted value

#### Scenario: A valid request omitting firstSessionDescription succeeds
- **WHEN** a valid request omits `firstSessionDescription`
- **THEN** the topic is created successfully with `firstSessionDescription` set to null

### Requirement: Add Custom Topic validates required fields and rejects invalid submissions with 422

`POST /api/v1/teams/:teamId/topics` SHALL reject a request with `422 Unprocessable Entity` if `name` is missing, empty after trim, or exceeds 100 characters; if `prompt` is missing, empty after trim, or exceeds 500 characters; if `voteType` is missing or not one of `finger`, `roman`, `modified_roman`; or if a provided `firstSessionDescription` exceeds 500 characters. The validation error response SHALL identify which field(s) failed validation. No topic SHALL be created when validation fails. This check is evaluated last, after team existence, identity/role authorization, and the customization lock all pass (see "Add Custom Topic evaluates checks in a fixed order" below) — a request that fails an earlier check receives that check's rejection, never `422`, regardless of whether its body would also have failed validation.

#### Scenario: Missing name is rejected
- **WHEN** a request omits `name`
- **THEN** the response is `422 Unprocessable Entity` identifying `name` as the failing field
- **AND** no topic is created

#### Scenario: Missing prompt is rejected
- **WHEN** a request omits `prompt`
- **THEN** the response is `422 Unprocessable Entity` identifying `prompt` as the failing field
- **AND** no topic is created

#### Scenario: Missing or invalid voteType is rejected
- **WHEN** a request omits `voteType` or supplies a value other than `finger`, `roman`, or `modified_roman`
- **THEN** the response is `422 Unprocessable Entity` identifying `voteType` as the failing field
- **AND** no topic is created

#### Scenario: A name exceeding 100 characters is rejected
- **WHEN** a request supplies a `name` longer than 100 characters
- **THEN** the response is `422 Unprocessable Entity` identifying `name` as the failing field

#### Scenario: A prompt exceeding 500 characters is rejected
- **WHEN** a request supplies a `prompt` longer than 500 characters
- **THEN** the response is `422 Unprocessable Entity` identifying `prompt` as the failing field

#### Scenario: Duplicate prompts are not rejected
- **WHEN** a request submits a `prompt` identical to an existing topic's prompt for the same team
- **THEN** the topic is created successfully as a distinct record; prompt uniqueness is not enforced

### Requirement: Add Custom Topic enforces the customization lock and standing-facilitator authorization

`POST /api/v1/teams/:teamId/topics` SHALL reject a request with `403 Forbidden` and reason code `NOT_A_FACILITATOR` if the caller's `global_role` is not `facilitator`; SHALL reject a request with `403 Forbidden` and reason code `FACILITATOR_IS_TEAM_MEMBER` if the caller is a facilitator but is an active member of the target team; SHALL reject a request with `404 Not Found` if the `teamId` path parameter does not reference an existing team, evaluated only after both of the preceding `403` checks pass; and SHALL reject a request with `409 Conflict` and reason code `TOPIC_CUSTOMIZATION_LOCKED` if the target team's customization lock is active, evaluated only after the team is confirmed to exist. No topic SHALL be created when any of these rejections occurs. Every rejection's reason code and message are carried in this codebase's standard error envelope (`{ error: { category, code, message, correlationId } }`), not a bare top-level `{ code, message }` body.

The team-existence check treats a deactivated team (`teams.deactivated_at IS NOT NULL`) as existing — it is not equivalent to a nonexistent team for this endpoint's `404` — matching every other write-adjacent existence check in this codebase except `GET /api/v1/teams/facilitatable`'s listing-scoped filter, which does not apply here.

#### Scenario: A deactivated team is not treated as nonexistent
- **WHEN** a standing facilitator who is not a member of the target team submits an otherwise-valid request against a team whose `deactivated_at` is set, and the team is unlocked
- **THEN** the topic is created successfully; deactivation alone does not produce a `404`

#### Scenario: A non-facilitator caller is rejected before the lock is evaluated
- **WHEN** a caller without `global_role = 'facilitator'` submits an otherwise-valid request against a locked team
- **THEN** the response is `403 Forbidden` with reason code `NOT_A_FACILITATOR`
- **AND** the response does not reveal the team's lock state

#### Scenario: A facilitator who is a team member is rejected before the lock is evaluated
- **WHEN** a facilitator who is an active member of the target team submits an otherwise-valid request against that team
- **THEN** the response is `403 Forbidden` with reason code `FACILITATOR_IS_TEAM_MEMBER`

#### Scenario: An otherwise-authorized facilitator is rejected when the team is locked
- **WHEN** a standing facilitator who is not a member of the target team submits an otherwise-valid request against a team with zero completed sessions
- **THEN** the response is `409 Conflict` with reason code `TOPIC_CUSTOMIZATION_LOCKED`
- **AND** no topic is created

#### Scenario: Add Custom Topic is available regardless of which facilitator has run sessions for the team
- **WHEN** a standing facilitator who has never run any session for the target team submits a valid request against that team, and the team is unlocked
- **THEN** the topic is created successfully; prior session history with this specific facilitator is not required

### Requirement: Add Custom Topic evaluates checks in a fixed order — identity/role, team existence, lock, then body validation

`POST /api/v1/teams/:teamId/topics` SHALL evaluate the following checks in this order, rejecting on the first one that fails and evaluating no later check — nor reporting its outcome — once an earlier one has already failed: (1) identity/role authorization (`403 Forbidden`, `NOT_A_FACILITATOR` or `FACILITATOR_IS_TEAM_MEMBER`); (2) team existence (`404 Not Found`); (3) the customization lock (`409 Conflict`, `TOPIC_CUSTOMIZATION_LOCKED`); (4) request body validation (`422 Unprocessable Entity`). This ordering is stated once, here, as the canonical sequence; the individual requirements above and below describe each check's own condition and reason code but defer to this requirement for their relative order (design.md Decision 9).

The shipped handler SHALL also apply a constant minimum response-time floor (`applyTimingFloor`) at every one of these early-return points, plus the `201` success path, so that this ordering's status-code-level anti-enumeration guarantee is not reopened through response-latency differences (design.md Decision 9's security-review amendment). A status-code ordering alone is not sufficient for this requirement to be considered met.

#### Scenario: A request against a nonexistent team is rejected with 404
- **WHEN** a standing facilitator who is not an active member of any team submits a request against a `teamId` that does not correspond to any existing team
- **THEN** the response is `404 Not Found`
- **AND** no topic is created

#### Scenario: A non-facilitator receives 403 rather than 404 against a nonexistent team
- **WHEN** a caller without `global_role = 'facilitator'` submits a request against a `teamId` that does not correspond to any existing team
- **THEN** the response is `403 Forbidden` with reason code `NOT_A_FACILITATOR`
- **AND** the response does not reveal whether the team exists

#### Scenario: A non-facilitator submitting an invalid body still receives 403, not 422
- **WHEN** a caller without `global_role = 'facilitator'` submits a request with a missing `name` and an invalid `voteType` against any team
- **THEN** the response is `403 Forbidden` with reason code `NOT_A_FACILITATOR`
- **AND** the response does not identify any field-validation failure

#### Scenario: A locked team's rejection takes priority over an invalid body
- **WHEN** a standing facilitator who is not a member of the target team submits a request with an invalid `name` against a team with zero completed sessions
- **THEN** the response is `409 Conflict` with reason code `TOPIC_CUSTOMIZATION_LOCKED`
- **AND** the response does not identify any field-validation failure

#### Scenario: A request against a nonexistent team with an invalid body still receives 404, not 422
- **WHEN** a standing facilitator who is not an active member of any team submits a request with a missing `prompt` against a `teamId` that does not correspond to any existing team
- **THEN** the response is `404 Not Found`
- **AND** the response does not identify any field-validation failure

### Requirement: Concurrent Add Custom Topic requests against the same team never collide on displayOrder

When two or more requests to add a custom topic to the same team are processed concurrently, the `displayOrder` computation and the topic insert SHALL be serialized per team, using a mechanism that defers the second request's `displayOrder` read until after the first request's insert has committed — not merely a row lock re-checked against a pre-existing snapshot (design.md Decision 10, corrected per engineer review B1) — so that no two topics ever created for the same team are assigned the same `displayOrder`, and neither request SHALL fail with an unhandled server error as a result of the collision.

#### Scenario: Two concurrent valid requests against the same unlocked team each receive a distinct displayOrder
- **WHEN** two valid Add Custom Topic requests against the same unlocked team are submitted concurrently
- **THEN** both topics are created successfully, each with `201 Created`
- **AND** each is assigned a distinct `displayOrder`
- **AND** neither request fails with an unhandled server error

### Requirement: A successful Add Custom Topic write is audited in the same transaction as the insert

Every accepted `POST /api/v1/teams/:teamId/topics` request SHALL write a row to `audit_log` (`operation = 'topic.custom_added'`) in the same database transaction as the topic `INSERT`. The audit row SHALL carry `actor_user_id`, `actor_global_role`, `actor_ip`, `team_id`, and `metadata` including at minimum the created topic's `topic_id`. This closes the non-repudiation gap that Decision 3's standing, org-wide facilitator model would otherwise leave on the success path — under that model, any facilitator, with no requirement of ever having run a session for the team, can trigger this write, and `created_at` alone does not answer who did so.

#### Scenario: A successful creation writes an audit_log row alongside the topic
- **WHEN** a standing facilitator successfully creates a custom topic for an unlocked team
- **THEN** an `audit_log` row with `operation = 'topic.custom_added'`, the correct `team_id`, and `metadata.topic_id` matching the created topic is written in the same transaction as the topic `INSERT`

#### Scenario: A rejected request writes no success audit row
- **WHEN** an Add Custom Topic request is rejected by any check (identity/role, team existence, the lock, or body validation)
- **THEN** no `audit_log` row with `operation = 'topic.custom_added'` is written
