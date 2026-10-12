## MODIFIED Requirements

### Requirement: The all-topics endpoint uses the standing, org-wide facilitator authorization model, matching every other topic-write endpoint it serves

`GET /api/v1/teams/:teamId/topics/all` SHALL authorize requests using the same standing, org-wide facilitator model as `POST /api/v1/teams/:teamId/topics`, `DELETE /api/v1/teams/:teamId/topics/:topicId`, and every other topic-write endpoint this capability gates. A caller is admitted when either:

- `global_role = 'facilitator'` AND the caller is not an active member of the target team, OR
- `global_role = 'application_admin'`, whatever the caller's membership on the target team (none, or any value of `team_memberships.role`; today `participant` or `engineering_manager`).

The non-member facilitator rule is shared by every topic-write endpoint. The `application_admin` arm is shared with add, `DELETE`, restore, and reorder (TOPIC-003/004/005/006), and is identical to theirs: an administrator is admitted on any team whatever their membership (#208: the product owner decided that administrators are a trusted role and are not barred from topic configuration by team membership; that decision covers TOPIC-002..006 only and does not change any other administrator restriction). `PUT /api/v1/teams/:teamId/topics/:topicId/annotation` (TOPIC-007, BRD FR-8.7) rejects administrators with `403`. This read endpoint still admits them and returns `canEditAnnotations: false` and `canAddTopics: true` to them. This endpoint SHALL NOT require that the caller currently hold, or have ever held, an active session for the target team. No completed-session relationship, and no prior facilitation history with the specific team, is required.

**No membership rule on the administrator arm (#208, reversing #232).** This endpoint SHALL NOT deny an `application_admin` because of their membership role on the target team. The no-manager rule #232 added to this arm, and its `ADMIN_IS_TEAM_MANAGER` and `ADMIN_MEMBERSHIP_NOT_ADMITTED` `403`s, are removed. On the administrator arm the handler SHALL read the caller's live active membership role on the target team once per request, with no cache, and SHALL use it only as audit data (see Requirement: The all-topics endpoint audits every administrator read). Only an active membership counts: a membership whose `removed_at` is set is recorded as no membership. The membership role SHALL be read only for a caller already admitted on the administrator arm and only for a team that exists, so a facilitator's request performs no additional query and a request for a non-existent team performs none of the administrator arm's reads.

**Only two authorized roles reach the data.** After the shared authorization check admits a caller, the handler SHALL accept only `facilitator` (the unaudited read) and `application_admin` (the audited administrator arm) as the authorized global role. Any other authorized role value, including a different spelling or casing of `application_admin`, SHALL fail the request with `500` before any membership, role-set, topic, annotation, team-name, or lock-state read, and SHALL write no audit row. The error message SHALL name no role value, team, or user. This guards against a later change to the shared helper admitting a third role that would otherwise reach the data with no audit.

**Failure handling on the administrator arm (fail closed).** If the membership-role read, the read of the caller's stored role set used for audit (including that read returning no row), or the audit insert (see Requirement: The all-topics endpoint audits every administrator read) fails, the request SHALL respond `500` with the application's existing server-error response. That response SHALL contain no topic, annotation, team-name, or lock-state data. This fail-closed rule applies to this endpoint's administrator arm only. It SHALL NOT be read as a pattern for facilitator or live-session paths, which this rule does not touch.

**Reason names are envelope codes.** Every TOPIC-002 `403` to a non-administrator SHALL carry the denial reason as `error.code`, with `error.category = "forbidden"`: `NOT_A_FACILITATOR` for a caller without the facilitator role (including the global `engineering_manager` role) and `FACILITATOR_IS_TEAM_MEMBER` for a facilitator who is an active member of the target team. These are exactly the two members of the handler's denial-reason type, and `error.code` SHALL be that same value (the value written to the denial audit row's `metadata.reason`), taken from the authorization decision with no second mapping. The two codes are the same strings TOPIC-003..006 already return for the same refusals. `error.message` is unchanged for each reason, and so are the status, the headers (including `Cache-Control: no-store`), the denial audit row, the structured event, and the order insert, event, timing floor, send. The code only labels the refusal: it adds no way through it, no configuration and no alternate path, and the set of distinguishable denial bodies stays exactly two. Clients MUST NOT use `error.code` to grant, unlock or hide an access decision; they MAY use it to choose display text, and a client that does not recognise a code SHALL fall back to `error.message`. The server is the sole authority on access. No code may distinguish an engineering-manager or application-admin denial without Security review. The `error.correlationId` on this `403` is generated per response and is not currently recorded in the audit row or the event, so it is not searchable in logs or audit. This requirement does not apply to TOPIC-001, whose `403`s stay generic.

**Team ids that name no team.** A `teamId` that is not a canonical UUID SHALL still receive `404` (`TEAM_NOT_FOUND`) before any query. A canonical UUID that names no team (no `teams` row; a deactivated team and the template team `DEFAULT_TOPICS_TEAM_ID` do have a row, so they are not "no team") SHALL be answered, once the caller's role is authorized, with `404` and the body `teamNotFoundEnvelope()` (`TEAM_NOT_FOUND`), `Cache-Control: no-store`, and the same `applyTimingFloor` call the `403` path makes before replying. The order is fixed: non-canonical boundary `404`, then the shared authorization check (`403`, audited under `topic.config_list_denied`), then the role assertion, then the team-name read (`404` here), then the administrator arm. The authorization check precedes the lookup so that a caller who is not authorized, a participant for example, receives a response byte-identical for an existing and a non-existent team and cannot probe which team ids exist. The team-name read SHALL be the endpoint's existing `SELECT name FROM teams WHERE id = $1`, moved ahead of the administrator arm, not a new query: a standing facilitator on an existing team SHALL execute exactly the same multiset of SQL texts as before this change. The lookup SHALL NOT filter on `deactivated_at` or exclude the template team. The authorization check and role assertion SHALL NOT read the `teams` table, so a caller who is not authorized triggers no `teams` query at all (existing or non-existent team alike). The `404` SHALL write no `audit_log` row and emit no `admin.*` event, and SHALL emit exactly one log-only structured event `topic.config_read_unknown_team` with metadata `{ userId, teamId, globalRole }` (no topic names, ids or annotation text), emitted immediately before `applyTimingFloor` and the reply, as a probing signal for an authorized caller (standing facilitator or `application_admin`). The event SHALL NOT be emitted for a caller who fails authorization (the `403` comes first), nor for an existing team (including the template team), and it has no database backing. On the administrator arm the `404` SHALL run no membership-role or role-set read. If the team-name read itself fails (a database error), the request SHALL follow the endpoint's existing `500` behaviour for a standing facilitator and an application admin alike, write no audit row, and on the administrator arm run no membership-role or role-set read. A team that exists with no topics SHALL still be answered `200` with empty lists and its real `teamName`; `404` is keyed on the absence of the `teams` row, never on empty lists.

**Engineering managers by global role.** A caller whose global role is `engineering_manager` SHALL receive `403` for reason `NOT_A_FACILITATOR`, whatever their membership on the team (none, `participant`, or `engineering_manager`). The messages are: `NOT_A_FACILITATOR` is "Only a facilitator or an application admin can view this team's topic list." and `FACILITATOR_IS_TEAM_MEMBER` is "A facilitator cannot view topic management for a team they are a member of."

This endpoint SHALL apply the same constant minimum response-time floor (`applyTimingFloor`) at every early return from this authorization check (`403 Forbidden`, for any rejection reason) as every other endpoint covered by this capability's timing-floor requirement. Response latency then does not distinguish "never going to be authorized" from "authorized" for a caller probing this endpoint. On the administrator `200`, the audit insert and its structured event SHALL complete before `applyTimingFloor` is called, and the floor SHALL be applied before the response is sent. The audit insert SHALL NOT run between the floor and the send.

#### Scenario: A standing facilitator with no session history for the team can list its topics
- **WHEN** a facilitator who is not an active member of a team, and who has never run any session for that team, requests that team's full topic list (active and archived)
- **THEN** the response is `200 OK` with the team's active and archived topics

#### Scenario: An application admin with no membership on the team can list its topics
- **WHEN** an authenticated user with `global_role = 'application_admin'` and no active membership on the team requests the team's full topic list
- **THEN** the response is `200 OK` with the team's active and archived topics

#### Scenario: An application admin with a participant membership can list the team's topics
- **WHEN** an `application_admin` with an active `participant` membership on the team requests the team's full topic list
- **THEN** the response is `200 OK` with the team's active and archived topics

#### Scenario: An application admin who is the team's engineering manager can list the team's topics
- **WHEN** an `application_admin` with an active `engineering_manager` membership on the team requests the team's full topic list
- **THEN** the response is `200 OK` with the team's active and archived topics, `canEditAnnotations: false`, and `canAddTopics: true`
- **AND** exactly one `admin.topic_config_accessed` row is written with `metadata.membership_role = "engineering_manager"`
- **AND** no `admin.topic_config_denied` row is written

#### Scenario: An application admin whose membership was removed is recorded as having none
- **WHEN** an `application_admin` whose only membership on the team is an `engineering_manager` membership with `removed_at` set requests the team's full topic list
- **THEN** the response is `200 OK`
- **AND** the `admin.topic_config_accessed` row records `metadata.membership_role = null`

#### Scenario: A standing facilitator's request for a team id that names no team is a 404
- **WHEN** a standing facilitator requests the full topic list for a canonical UUID that names no team
- **THEN** the response is `404` with a body equal to `teamNotFoundEnvelope()` and `Cache-Control: no-store`
- **AND** `applyTimingFloor` is called exactly once, before the reply is sent (observed by a spy on `applyTimingFloor` and on the reply)
- **AND** no `audit_log` row is written, no `admin.*` event is emitted, and exactly one log-only `topic.config_read_unknown_team` event `{ userId, teamId, globalRole }` is emitted before `applyTimingFloor`
- **AND** the response is not `403` (a facilitator with no membership on a missing team is authorized, not denied)

#### Scenario: An application admin's request for a team id that names no team is not found and writes no audit row
- **WHEN** an `application_admin` requests the full topic list for a canonical UUID that names no team
- **THEN** the response is NOT audited and NOT `200`: it is `404` with a body equal to `teamNotFoundEnvelope()` and `Cache-Control: no-store` (the pre-#265 `200` with `team_found = false` behaviour is replaced, not kept)
- **AND** the `audit_log` row count is unchanged
- **AND** no membership-role or role-set query ran, no `admin.*` event was emitted, and exactly one log-only `topic.config_read_unknown_team` event was emitted

#### Scenario: A failed team-name read fails the request with no data
- **WHEN** the team-name read fails with a database error for a standing facilitator, and separately for an `application_admin`
- **THEN** each response is the endpoint's existing `500`, no `audit_log` row is written, and for the administrator no membership-role or role-set query ran

#### Scenario: An uppercase canonical UUID that matches no team is a 404
- **WHEN** a standing facilitator requests the full topic list for an upper-case canonical UUID that matches no team
- **THEN** the response is `404` `TEAM_NOT_FOUND`

#### Scenario: A team with no topics is a 200
- **WHEN** a standing facilitator requests the full topic list for an existing team that has no topics
- **THEN** the response is `200` with empty `active` and `archived` lists and the team's real `teamName`

#### Scenario: A deactivated team is a 200
- **WHEN** a standing facilitator requests the full topic list for a team whose `deactivated_at` is set
- **THEN** the response is `200`, unchanged by this change

#### Scenario: The template team is unchanged
- **WHEN** a standing facilitator requests TOPIC-002 for `DEFAULT_TOPICS_TEAM_ID`
- **THEN** the response is `200` as before
- **AND** when the caller is an `application_admin`, exactly one `admin.topic_config_accessed` row is written

#### Scenario: An unauthorized caller cannot tell whether a team exists
- **WHEN** a participant requests TOPIC-002 for a canonical UUID that names no team, and for one that names an existing team
- **THEN** both responses are the same `403 NOT_A_FACILITATOR`: identical status, identical headers and identical body once the per-request values (the body's `correlationId` and any per-request header such as `date` or a request id) are normalized, and the test SHALL name what it normalizes
- **AND** each is audited under `topic.config_list_denied`, and the two audit rows are equal in every field except `team_id` (and per-row identifiers and timestamps)
- **AND** neither request executed any query against the `teams` table

#### Scenario: A standing facilitator on an existing team runs no extra query
- **WHEN** a non-member standing facilitator requests the full topic list for an existing team
- **THEN** the multiset of SQL texts executed equals the multiset executed before this change

#### Scenario: An unexpected authorized role fails closed (unit test only)
- **WHEN** the shared authorization check admits a caller whose global role is neither `facilitator` nor `application_admin` (for example `engineering_manager`, `Application_Admin`, or an empty string)
- **THEN** the request fails with `500` before any membership, role-set, topic, annotation, team-name, or lock-state read
- **AND** the error message does not contain the role value

#### Scenario: A non-canonical team id is still 404
- **WHEN** any caller requests the full topic list with a `teamId` that is not a canonical UUID (hyphenless, braced, or malformed)
- **THEN** the response is `404` with `TEAM_NOT_FOUND` and `Cache-Control: no-store`, before any query

#### Scenario: A failed membership read fails the request with no data
- **WHEN** an `application_admin` requests the team's full topic list and the membership-role read fails
- **THEN** the response is `500`
- **AND** no topic, annotation, or lock-state query ran for the request, and the response contains no team name

#### Scenario: A failed role-set read fails the request with no data
- **WHEN** an `application_admin` requests the team's full topic list and the read of the caller's stored role set (`users.roles`) fails or returns no row
- **THEN** the response is `500`, not `200`
- **AND** the response body contains no topic names, topic ids, definitions, or team name

#### Scenario: On the administrator arm the audit write precedes the timing floor
- **WHEN** an `application_admin` requests the team's full topic list, once with no membership and once as the team's engineering manager
- **THEN** in each request the audit insert runs before `applyTimingFloor`, and `applyTimingFloor` runs before the response is sent

#### Scenario: The read and the topic-write endpoints agree for an administrator who manages the team
- **WHEN** an `application_admin` with an active `engineering_manager` membership on an unlocked team requests the team's full topic list and also sends a valid `POST /api/v1/teams/:teamId/topics` for that team
- **THEN** the full topic list answers `200` with `canAddTopics: true`
- **AND** the add request answers `201`

#### Scenario: A facilitator's request performs no membership-role read
- **WHEN** a non-member standing facilitator requests the team's full topic list
- **THEN** the response is `200 OK`
- **AND** the number of queries against `team_memberships` equals the number the shared authorization check issues, counted by SQL text and not by mock position

#### Scenario: A global engineering manager is rejected whatever their membership
- **WHEN** a caller with `global_role = 'engineering_manager'` and no membership, a `participant` membership, or an `engineering_manager` membership on the team requests the team's full topic list
- **THEN** the response is `403 Forbidden` with the message "Only a facilitator or an application admin can view this team's topic list."
- **AND** `error.category` is "forbidden" and `error.code` is "NOT_A_FACILITATOR"

#### Scenario: A caller who is neither a standing facilitator nor an admin is rejected
- **WHEN** a caller whose global role is neither `facilitator` nor `application_admin` (a participant, for example) requests a team's full topic list
- **THEN** the response is `403 Forbidden` with the message "Only a facilitator or an application admin can view this team's topic list."
- **AND** `error.category` is "forbidden" and `error.code` is "NOT_A_FACILITATOR"

#### Scenario: A facilitator who is an active member of the team is rejected
- **WHEN** a facilitator who is an active member of the target team, in any membership role, requests that team's full topic list
- **THEN** the response is `403 Forbidden` with the message "A facilitator cannot view topic management for a team they are a member of.", even though the caller holds `global_role = 'facilitator'`
- **AND** `error.category` is "forbidden" and `error.code` is "FACILITATOR_IS_TEAM_MEMBER"

#### Scenario: A returning facilitator who is a member of the team is told why, by code
- **WHEN** a facilitator who has become an active member of a team they used to run requests that team's full topic list
- **THEN** the response is `403` with `error.code` "FACILITATOR_IS_TEAM_MEMBER" and the member message, so a client can tell this refusal from "no facilitator role" without matching message text
- **AND** the refusal is still a hard block: no request field, header, flag or configuration changes the outcome

#### Scenario: The code equals the audited reason and the shape is otherwise unchanged
- **WHEN** a denied request is answered for each reason
- **THEN** `error.code` equals the `metadata.reason` of the one `topic.config_list_denied` row written for that request
- **AND** the status is `403`, `Content-Type` and `Cache-Control: no-store` are unchanged, and `error.message` is the exact text above for that reason
- **AND** the body for both reasons is built from `decision.reason` by one envelope call, and `error.code` is never derived from the message

#### Scenario: A participant gets the same code for an existing and a non-existent team
- **WHEN** a participant requests TOPIC-002 for an existing team and for a canonical UUID that names no team
- **THEN** both responses are `403` with `error.code` "NOT_A_FACILITATOR" and are otherwise identical after normalizing per-request values, because authorization precedes the team lookup; the `404` `TEAM_NOT_FOUND` applies only to authorized callers

#### Scenario: A facilitator whose membership was removed is not blocked
- **WHEN** a standing facilitator whose membership on the team is removed (not active) requests the team's full topic list
- **THEN** the response is `200 OK` and no `topic.config_list_denied` row is written

#### Scenario: The distinguishable non-admin denials are exactly two
- **WHEN** the non-admin denials above are compared after normalizing `correlationId`
- **THEN** there are exactly two distinct response bodies, one per code, and no code distinguishes an engineering manager or an administrator

#### Scenario: Nothing in the request changes the denial
- **WHEN** a denied caller adds a spurious header and query parameter to the request
- **THEN** the status, `error.code` and `error.message` are the same as without them

#### Scenario: An application admin's 200 carries no code
- **WHEN** an `application_admin` requests the team's full topic list
- **THEN** the response is `200 OK` and its body has no `code` member

#### Scenario: A 403 rejection is not detectably faster than a 200 success
- **WHEN** a caller who fails this endpoint's authorization check submits a request, and a separately measured authorized caller's request against the same endpoint is also submitted
- **THEN** the `403` response's timing is not detectably faster than the `200` response's timing, because both apply the same minimum response-time floor

### Requirement: The denial response and timing are unchanged and never disclose the audit

On the denial path the order SHALL be insert (which carries the role read), event, timing floor, send. The `403` status, `Content-Type`, and body SHALL equal the committed snapshot for each reason, on success and failure paths. That snapshot was hand-edited by #263 and differs from the one #264 committed only by the inserted `"code"` member (`"code":"<REASON>"` between `category` and `message`) in each of the two bodies; status, `Content-Type`, message text and every other byte are unchanged. No response field, header, banner, or toast SHALL imply an attempt was recorded.

#### Scenario: Call order on the denial path

- **WHEN** a denied request is handled, for each reason
- **THEN** the recorded call order is insert, event, floor, send
- **AND** the floor is a minimum, measured from handler entry: when the audit work already took longer than the floor, no additional wait is added

#### Scenario: The 403 equals the committed baseline

- **WHEN** a denied request is answered, with the audit succeeding or failing
- **THEN** status, `Content-Type`, and body string equal the committed (#263-edited) snapshot for that reason
- **AND** no header or field mentions auditing or logging

#### Scenario: A failed denial audit still returns the 403 with the code
- **WHEN** a denied request is answered and the denial audit insert fails or times out
- **THEN** the response is the same `403` with the same `error.code` and body as when the insert succeeds (the denial audit is fail-open)
- **AND** a failure elsewhere on the denial path (the helper call, the timing floor, the send) is still `500`, as before
