## RENAMED Requirements

- FROM: `### Requirement: A standing facilitator can add a custom topic to an unlocked team`
- TO: `### Requirement: A standing facilitator or application administrator can add a custom topic to an unlocked team`

- FROM: `### Requirement: Add Custom Topic enforces the customization lock and standing-facilitator authorization`
- TO: `### Requirement: Add Custom Topic enforces the customization lock and standing-facilitator-or-administrator authorization`

## MODIFIED Requirements

### Requirement: A standing facilitator or application administrator can add a custom topic to an unlocked team

`POST /api/v1/teams/:teamId/topics` SHALL allow an authenticated user to create a new custom topic for the target team when the user either has `global_role = 'facilitator'` and is not an active member of that team, or has `global_role = 'application_admin'` (on any team, whether or not they are a member of it, per BRD FR-8.2), provided the team's customization lock (per the `topic-customization-lock` capability) is not active. The request body SHALL require `name` (non-empty after trim, ≤100 characters), `prompt` (non-empty after trim, ≤500 characters), and `voteType` (one of `finger`, `roman`, `modified_roman`), and MAY include `firstSessionDescription` (≤500 characters). The created topic SHALL be marked `isDefault: false` and SHALL be assigned `displayOrder` equal to one greater than the current maximum `displayOrder` among the team's active topics. An administrator's request SHALL be subject to the same body rules, lock, and check order as a facilitator's; the role grants no exemption from either.

#### Scenario: A valid request creates a custom topic
- **WHEN** a standing facilitator who is not a member of the team submits a request with a valid `name`, `prompt`, and `voteType` against an unlocked team
- **THEN** the response is `201 Created`
- **AND** the response body includes the new topic's `topicId`, `name`, `prompt`, `voteType`, `displayOrder`, `isDefault: false`, and `createdAt`

#### Scenario: An application administrator who is not a team member creates a custom topic
- **WHEN** a user with `global_role = 'application_admin'` who has no active membership on the team submits a request with a valid `name`, `prompt`, and `voteType` against an unlocked team whose active topics have display orders `0` through `n`
- **THEN** the response is `201 Created` with `isDefault: false`
- **AND** the new topic is assigned `displayOrder = n + 1`

#### Scenario: An application administrator who is a team member creates a custom topic
- **WHEN** a user with `global_role = 'application_admin'` who has an active (`removed_at IS NULL`) membership on the team submits a valid request against that unlocked team
- **THEN** the response is `201 Created`
- **AND** the new topic is appended at the end of the team's display order
- **AND** exactly one `audit_log` row with `operation = 'topic.custom_added'` and `actor_global_role = 'application_admin'` is written in the same transaction as the topic `INSERT`

#### Scenario: A new topic is appended to the end of the display order
- **WHEN** a custom topic is successfully created for a team whose active topics currently have display orders `0` through `n`
- **THEN** the new topic is assigned `displayOrder = n + 1`

#### Scenario: An optional firstSessionDescription is stored when provided
- **WHEN** a valid request includes a `firstSessionDescription`
- **THEN** the created topic's `firstSessionDescription` is persisted with the submitted value

#### Scenario: A valid request omitting firstSessionDescription succeeds
- **WHEN** a valid request omits `firstSessionDescription`
- **THEN** the topic is created successfully with `firstSessionDescription` set to null

#### Scenario: An administrator's add does not change a session whose room is already open
- **WHEN** a team has a session whose room is open (its `session_topics` snapshot already taken), and an `application_admin` successfully adds a custom topic to that team
- **THEN** the open session's `session_topics` rows, their topics, and their order are unchanged
- **AND** the new topic is part of the team's active topic configuration for the next room opened

### Requirement: Add Custom Topic enforces the customization lock and standing-facilitator-or-administrator authorization

`POST /api/v1/teams/:teamId/topics` SHALL reject a request with `403 Forbidden` and reason code `NOT_A_FACILITATOR` if the caller's `global_role` is neither `facilitator` nor `application_admin` (including a caller whose session's user has no `users` row), with the message "Only a facilitator or an application admin can add a custom topic."; SHALL reject a request with `403 Forbidden` and reason code `FACILITATOR_IS_TEAM_MEMBER` if the caller is a facilitator but is an active member of the target team, with the unchanged message "A facilitator cannot add a custom topic to a team they are a member of."; SHALL NOT reject an `application_admin` on either `403` ground, whatever their membership of the target team; SHALL reject a request with `404 Not Found` if the `teamId` path parameter does not reference an existing team, evaluated only after the identity/role check passes; and SHALL reject a request with `409 Conflict` and reason code `TOPIC_CUSTOMIZATION_LOCKED` if the target team's customization lock is active, evaluated only after the team is confirmed to exist. The lock SHALL apply identically to administrators and facilitators. No topic SHALL be created when any of these rejections occurs. Every rejection's reason code and message are carried in this codebase's standard error envelope (`{ error: { category, code, message, correlationId } }`), not a bare top-level `{ code, message }` body.

The team-existence check treats a deactivated team (`teams.deactivated_at IS NOT NULL`) as existing — it is not equivalent to a nonexistent team for this endpoint's `404` — matching every other write-adjacent existence check in this codebase except `GET /api/v1/teams/facilitatable`'s listing-scoped filter, which does not apply here.

This endpoint's administrator arm SHALL NOT be shared with `PUT /api/v1/teams/:teamId/topics/:topicId/annotation` (TOPIC-007), which remains facilitator-only under BRD FR-8.7.

#### Scenario: A deactivated team is not treated as nonexistent
- **WHEN** a standing facilitator who is not a member of the target team submits an otherwise-valid request against a team whose `deactivated_at` is set, and the team is unlocked
- **THEN** the topic is created successfully; deactivation alone does not produce a `404`

#### Scenario: A caller who is neither facilitator nor administrator is rejected before the lock is evaluated
- **WHEN** a caller whose `global_role` is neither `facilitator` nor `application_admin` (an engineer, an engineering manager, or a caller with no `users` row) submits an otherwise-valid request against a locked team
- **THEN** the response is `403 Forbidden` with reason code `NOT_A_FACILITATOR` and message "Only a facilitator or an application admin can add a custom topic."
- **AND** the response does not reveal the team's lock state

#### Scenario: A facilitator who is a team member is rejected before the lock is evaluated
- **WHEN** a facilitator who is an active member of the target team submits an otherwise-valid request against that team
- **THEN** the response is `403 Forbidden` with reason code `FACILITATOR_IS_TEAM_MEMBER` and message "A facilitator cannot add a custom topic to a team they are a member of."

#### Scenario: An otherwise-authorized facilitator is rejected when the team is locked
- **WHEN** a standing facilitator who is not a member of the target team submits an otherwise-valid request against a team with zero completed sessions
- **THEN** the response is `409 Conflict` with reason code `TOPIC_CUSTOMIZATION_LOCKED`
- **AND** no topic is created

#### Scenario: An application administrator is rejected when the team is locked
- **WHEN** an `application_admin` submits an otherwise-valid request against a team with zero completed sessions
- **THEN** the response is `409 Conflict` with reason code `TOPIC_CUSTOMIZATION_LOCKED`
- **AND** one `audit_log` row with `operation = 'topic.write_denied_locked'`, `actor_global_role = 'application_admin'`, and `metadata.attempted_operation = 'topic.custom_added'` is written before the `409` is returned
- **AND** no topic is created and no `topic.custom_added` audit row is written

#### Scenario: Add Custom Topic is available regardless of which facilitator has run sessions for the team
- **WHEN** a standing facilitator who has never run any session for the target team submits a valid request against that team, and the team is unlocked
- **THEN** the topic is created successfully; prior session history with this specific facilitator is not required

### Requirement: Add Custom Topic evaluates checks in a fixed order — identity/role, team existence, lock, then body validation

`POST /api/v1/teams/:teamId/topics` SHALL evaluate the following checks in this order, rejecting on the first one that fails and evaluating no later check — nor reporting its outcome — once an earlier one has already failed: (1) identity/role authorization (`403 Forbidden`, `NOT_A_FACILITATOR` or `FACILITATOR_IS_TEAM_MEMBER`; an `application_admin` always passes this check); (2) team existence (`404 Not Found`); (3) the customization lock (`409 Conflict`, `TOPIC_CUSTOMIZATION_LOCKED`); (4) request body validation (`422 Unprocessable Entity`). This ordering is stated once, here, as the canonical sequence; the individual requirements above and below describe each check's own condition and reason code but defer to this requirement for their relative order. The order SHALL be the same for administrators and facilitators.

The shipped handler SHALL also apply a constant minimum response-time floor (`applyTimingFloor`) at every one of these early-return points, plus the `201` success path, so that this ordering's status-code-level anti-enumeration guarantee is not reopened through response-latency differences. This includes both `403` branches emitted by the administrator-aware authorization check and the `404` and `409` returns reached by an administrator. A status-code ordering alone is not sufficient for this requirement to be considered met.

#### Scenario: A request against a nonexistent team is rejected with 404
- **WHEN** a standing facilitator who is not an active member of any team submits a request against a `teamId` that does not correspond to any existing team
- **THEN** the response is `404 Not Found`
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
- **THEN** the response is `404 Not Found`
- **AND** the response does not include `error.field`

#### Scenario: An administrator against a nonexistent team with an invalid body receives 404, not 422
- **WHEN** an `application_admin` submits a request with a missing `prompt` against a canonical-format `teamId` that does not correspond to any existing team
- **THEN** the response is `404 Not Found`
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

### Requirement: A successful Add Custom Topic write is audited in the same transaction as the insert

Every accepted `POST /api/v1/teams/:teamId/topics` request SHALL write a row to `audit_log` (`operation = 'topic.custom_added'`) in the same database transaction as the topic `INSERT`. The audit row SHALL carry `actor_user_id`, `actor_global_role`, `actor_ip`, `team_id`, and `metadata` including at minimum the created topic's `topic_id`. `actor_global_role` SHALL record the caller's actual role (`facilitator` or `application_admin`), so an administrator's add is distinguishable from a facilitator's in the audit trail. This closes the non-repudiation gap that the standing, org-wide facilitator model would otherwise leave on the success path — under that model, any facilitator or application administrator, with no requirement of ever having run a session for the team, can trigger this write, and `created_at` alone does not answer who did so.

#### Scenario: A successful creation writes an audit_log row alongside the topic
- **WHEN** a standing facilitator successfully creates a custom topic for an unlocked team
- **THEN** an `audit_log` row with `operation = 'topic.custom_added'`, the correct `team_id`, and `metadata.topic_id` matching the created topic is written in the same transaction as the topic `INSERT`

#### Scenario: An administrator's creation is audited with the administrator role
- **WHEN** an `application_admin` successfully creates a custom topic for an unlocked team
- **THEN** exactly one `audit_log` row with `operation = 'topic.custom_added'` and `actor_global_role = 'application_admin'` is written in the same transaction as the topic `INSERT`

#### Scenario: A rejected request writes no success audit row
- **WHEN** an Add Custom Topic request is rejected by any check (identity/role, team existence, the lock, or body validation)
- **THEN** no `audit_log` row with `operation = 'topic.custom_added'` is written
