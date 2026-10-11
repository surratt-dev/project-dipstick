## ADDED Requirements

### Requirement: The all-topics endpoint writes one durable row and one event per non-administrator denial

Every `403` from TOPIC-002 (`GET /api/v1/teams/:teamId/topics/all`) with reason `NOT_A_FACILITATOR` or `FACILITATOR_IS_TEAM_MEMBER` SHALL write exactly one `audit_log` row, operation `topic.config_list_denied`, with no deduplication, then emit one event of the same name (also when the insert failed, with `rowWritten: false`). Row and event SHALL contain no team content. This closes SEC-13 for these two reasons on this endpoint only (remaining gaps: #187, #208, 401, 404).

#### Scenario: A participant is denied and the denial is recorded

- **WHEN** a user whose `global_role` is `participant` requests TOPIC-002 for a team
- **THEN** the response is `403` with the message "Only a facilitator or an application admin can view this team's topic list."
- **AND** exactly one row with operation `topic.config_list_denied` is written, with `team_id` equal to the requested id, `actor_user_id` equal to the caller, `actor_roles` equal to the caller's stored role array, and `metadata` deep-equal to `{ endpoint: "GET /api/v1/teams/:teamId/topics/all", http_status: 403, reason: "NOT_A_FACILITATOR" }`
- **AND** exactly one `topic.config_list_denied` event is emitted with exactly the nine pinned keys

#### Scenario: Row and event field contract

- **WHEN** a denial is recorded
- **THEN** `actor_ip` is `request.ip`, the same source the `admin.topic_config_accessed` row uses in the same handler
- **AND** `actor_global_role` is the role the authorization decision used, `'unknown'` when the caller has no `users` row
- **AND** `actor_roles` is the caller's `users.roles::text[]` in stored order, captured inside the insert statement, and NULL when the caller has no `users` row (NULL means not captured or unavailable)
- **AND** `metadata` deep-equals `{ endpoint: "GET /api/v1/teams/:teamId/topics/all", http_status: 403, reason }`
- **AND** `reason` is `FACILITATOR_IS_TEAM_MEMBER` for a global `facilitator` who is an active member, and `NOT_A_FACILITATOR` for every other caller who is neither facilitator nor administrator
- **AND** the event has exactly the keys `actorUserId`, `actorGlobalRole`, `actorIp`, `teamId`, `endpoint`, `httpStatus`, `reason`, `actorRoles` (`null` when no row was written), `rowWritten`

#### Scenario: A global engineering manager with a participant membership is denied

- **WHEN** a user with `global_role = 'engineering_manager'` and an active `participant` membership on the team requests TOPIC-002
- **THEN** the response is `403` and one row is written with `reason = "NOT_A_FACILITATOR"` and `actor_global_role = 'engineering_manager'`

#### Scenario: A member-facilitator is denied with the same response and a row

- **WHEN** a user with `global_role = 'facilitator'` and an active membership on the team requests TOPIC-002
- **THEN** the response is `403` with the message "A facilitator cannot view topic management for a team they are a member of."
- **AND** one row is written with `reason = "FACILITATOR_IS_TEAM_MEMBER"`
- **AND** a facilitator with no membership on the team is admitted and writes no `topic.config_list_denied` row

#### Scenario: Repeated denials write repeated rows

- **WHEN** the same denied caller requests TOPIC-002 twice
- **THEN** two rows are written

#### Scenario: A team id that names no team

- **WHEN** a participant requests TOPIC-002 for a canonical UUID that names no team, or for a deleted or inactive team
- **THEN** the response is the same `403` as for an existing team, one row is written with that `team_id`, and no query reads `teams`

#### Scenario: A caller with no users row

- **WHEN** the session user has no `users` row (a deleted user whose session is still live) and requests TOPIC-002
- **THEN** the response is `403`, the row has `actor_global_role = 'unknown'` and `actor_roles IS NULL`, and no failure event is emitted

#### Scenario: Row and event carry no team content

- **WHEN** a denial is recorded for a team whose name, topic names, topic ids, and annotation text are known to the test
- **THEN** none of those strings appears anywhere in the serialized row or the event

### Requirement: The denial response and timing are unchanged and never disclose the audit

On the denial path the order SHALL be insert (which carries the role read), event, timing floor, send. The `403` status, `Content-Type`, and body SHALL equal a snapshot committed before this change, for each reason, on success and failure paths. No response field, header, banner, or toast SHALL imply an attempt was recorded.

#### Scenario: Call order on the denial path

- **WHEN** a denied request is handled, for each reason
- **THEN** the recorded call order is insert, event, floor, send
- **AND** the floor is a minimum, measured from handler entry: when the audit work already took longer than the floor, no additional wait is added

#### Scenario: The 403 equals the committed baseline

- **WHEN** a denied request is answered, with the audit succeeding or failing
- **THEN** status, `Content-Type`, and body string equal the committed snapshot for that reason
- **AND** no header or field mentions auditing or logging

### Requirement: A failed denial audit leaves the response a 403

A failure of the denial-path audit insert (error or the 500 ms `AUDIT_WRITE_TIMEOUT_MS`) SHALL NOT change the response: it stays the same byte-identical `403`, never `200` or `500`. Fail-open scope is exactly that insert; the administrator arm stays fail-closed. Ruled by Security (design.md D3).

#### Scenario: The failure event field contract

- **WHEN** the denial insert fails
- **THEN** the `topic.audit_write_failed` event has exactly the keys `actorUserId`, `teamId`, `endpoint`, `operation`, `stage` (`"audit_insert"`), `reason`, `failureMode` (`"error"` or `"timeout"`), `errorCode` (SQLSTATE or `null`)
- **AND** it never carries `err.message` or `err.detail`

#### Scenario: The audit insert fails or times out

- **WHEN** a denied caller's insert throws, or hangs past `AUDIT_WRITE_TIMEOUT_MS`
- **THEN** the response equals the committed `403` snapshot, the floor still applies as a minimum, exactly one log-only `topic.audit_write_failed` event (error level) with the matching `failureMode` is emitted, and the denial event is emitted with `rowWritten: false` and `actorRoles: null`
- **AND** total handler latency does not exceed 500 ms plus a test tolerance
- **AND** any other failure on the denial path remains `500`

#### Scenario: The administrator arm stays fail-closed

- **WHEN** an admitted administrator's `admin.topic_config_accessed` insert fails
- **THEN** the response is `500` and contains no topic names, topic ids, or definitions

### Requirement: Admitted callers pay nothing

An admitted facilitator or administrator request SHALL execute no query that a pre-change request did not execute. In particular it SHALL NOT read the role set for denial purposes or insert a `topic.config_list_denied` row.

#### Scenario: An admitted facilitator runs no added query

- **WHEN** a facilitator who is not a member of the team requests TOPIC-002 against the SQL-text-routed fixture
- **THEN** no query against `audit_log` for `topic.config_list_denied` and no denial role-set read appear in the recorded SQL, and the set of queries equals the pre-change set

### Requirement: Denial rows are not exposed, informational for member-facilitators, and documented

No application endpoint or screen SHALL return `topic.config_list_denied` rows to a non-administrator, and none currently returns them to anyone: access is database and log-sink only. The rows have no UI surface, aggregation, or alerting, and follow the existing `audit_log` retention policy unchanged. `FACILITATOR_IS_TEAM_MEMBER` rows are informational, and no review or alert SHALL treat their volume as a signal.

#### Scenario: No non-admin read of the operation exists

- **WHEN** every application query that selects from `audit_log` and serves a non-administrator caller is listed
- **THEN** each filters `operation` by equality on one named operation other than `topic.config_list_denied`, and the list is recorded in the PR description as the interim acceptance evidence until the #262 structural guard exists

#### Scenario: The informational labelling is documented

- **WHEN** the `audit-logger.ts` comment block and `docs/deployment.md` are read
- **THEN** both state that `FACILITATOR_IS_TEAM_MEMBER` rows are informational and that `topic.audit_write_failed` is log-only
