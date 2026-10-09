## MODIFIED Requirements

### Requirement: The all-topics endpoint uses the standing, org-wide facilitator authorization model, matching every other topic-write endpoint it serves

`GET /api/v1/teams/:teamId/topics/all` SHALL authorize requests using the same standing, org-wide facilitator model as `POST /api/v1/teams/:teamId/topics`, `DELETE /api/v1/teams/:teamId/topics/:topicId`, and every other topic-write endpoint this capability gates. A caller is admitted when either:

- `global_role = 'facilitator'` AND the caller is not an active member of the target team, OR
- `global_role = 'application_admin'`, subject to the no-manager rule below.

The non-member facilitator rule is shared by every topic-write endpoint. The `application_admin` arm is shared with add, `DELETE`, restore, and reorder (TOPIC-003/004/005/006) only. `PUT /api/v1/teams/:teamId/topics/:topicId/annotation` (TOPIC-007, BRD FR-8.7) rejects administrators with `403`. This read endpoint still admits them, subject to the no-manager rule, and returns `canEditAnnotations: false` and `canAddTopics: true` to them. This endpoint SHALL NOT require that the caller currently hold, or have ever held, an active session for the target team. No completed-session relationship, and no prior facilitation history with the specific team, is required.

**No-manager rule on the administrator arm (#232).** This endpoint SHALL admit a caller whose global role is `application_admin` only when that caller's live active membership role on the target team is absent or `participant`. Any other membership role SHALL receive `403`, and the handler SHALL NOT execute any topic, annotation, team-name, or lock-state query for that request. This covers `engineering_manager` (reason `ADMIN_IS_TEAM_MANAGER`) and any role value not listed here (reason `ADMIN_MEMBERSHIP_NOT_ADMITTED`). The rule is an allow-list. It SHALL be unconditional, with no flag, environment setting, or override. The membership role SHALL be read live per request, with no cache. Only an active membership counts: a membership whose `removed_at` is set is no membership, so an administrator whose `engineering_manager` membership on the team has been removed is admitted with `membership_role: null`. No application path sets `team_memberships.removed_at` today (the only membership update is TEAM-005's role change), so such a removal can only come from direct database access. It is out-of-band and is not audited at the application layer; database-level access control is the control for it, not this rule. The audited self-demotion path is a TEAM-005 role change (`team.role_changed` with `actor_user_id = target_user_id` and `metadata.from_role = "engineering_manager"`), which the later `admin.topic_config_accessed` rows make correlatable. The membership role SHALL be checked only for a caller already admitted on the administrator arm, so a facilitator's request performs no additional query. The `membership_unrecognised` branch cannot be reached against today's `membership_role` enum (`participant`, `engineering_manager`). It exists as defence in depth for a future enum value and is verified by unit tests only. Adding a value to the enum SHALL revisit this rule.

**Only two authorized roles reach the data.** After the shared authorization check admits a caller, the handler SHALL accept only `facilitator` (the unaudited read) and `application_admin` (the audited administrator arm) as the authorized global role. Any other authorized role value, including a different spelling or casing of `application_admin`, SHALL fail the request with `500` before any membership, role-set, topic, annotation, team-name, or lock-state read, and SHALL write no audit row. The error message SHALL name no role value, team, or user. This guards against a later change to the shared helper (#208) admitting a third role that would otherwise reach the data with no no-manager check and no audit.

**Failure handling on the administrator arm (fail closed).** If the membership-role read, the read of the caller's stored role set used for audit (including that read returning no row), or either audit insert (see Requirement: The all-topics endpoint audits every administrator read and every administrator denial) fails, the request SHALL respond `500` with the application's existing server-error response. That response SHALL contain no topic, annotation, team-name, or lock-state data. A failed denial-row insert SHALL NOT turn the `403` into a `200`. This fail-closed rule applies to this endpoint's administrator arm only. It SHALL NOT be read as a pattern for facilitator or live-session paths, which this rule does not touch.

**Reason names are internal labels.** `NOT_A_FACILITATOR`, `FACILITATOR_IS_TEAM_MEMBER`, `ADMIN_IS_TEAM_MANAGER`, and `ADMIN_MEMBERSHIP_NOT_ADMITTED` name branches in code, in the REST API Contract's `403` table, and (as `membership_em` / `membership_unrecognised`) in audit `metadata.reason`. They are not response fields. The observable difference between the `403`s is the envelope's `error.message`, and the scenarios below assert that message.

**Team ids that name no team.** A `teamId` that is not a canonical UUID SHALL still receive `404` (`TEAM_NOT_FOUND`) before any query, as before this change. A canonical UUID that names no team is not a new case for this rule. The handler's existing behaviour for such an id (`200` with `teamName: ""` and empty lists) is unchanged by this change. An administrator's request for such an id is admitted (no membership exists) and audited like any other administrator `200`, with `team_id` set to the requested id.

**Boundary with the topic-write endpoints.** This rule SHALL NOT change the authorization of TOPIC-003, TOPIC-004, TOPIC-005, or TOPIC-006. Until #208 is decided, an `application_admin` with an active `engineering_manager` membership is denied this read but still admitted by those writes. That split is deliberate and is recorded in the add-flag parity test.

**403 messages.** A `403` from this rule SHALL use the standard forbidden envelope (`{ error: { category: "forbidden", message, correlationId } }`) and the `Cache-Control: no-store` header, like this endpoint's other `403`s. The `message` SHALL be:

- `ADMIN_IS_TEAM_MANAGER`: "Topic configuration for this team isn't available to its engineering manager."
- `ADMIN_MEMBERSHIP_NOT_ADMITTED`: "Topic configuration for this team isn't available to you."

**Engineering managers by global role.** A caller whose global role is `engineering_manager` SHALL receive `403` for reason `NOT_A_FACILITATOR`, whatever their membership on the team (none, `participant`, or `engineering_manager`). The existing messages are unchanged: `NOT_A_FACILITATOR` is "Only a facilitator or an application admin can view this team's topic list." and `FACILITATOR_IS_TEAM_MEMBER` is "A facilitator cannot view topic management for a team they are a member of."

The requirement title is kept for spec-sync continuity. The non-member facilitator arm still matches every topic-write endpoint. The administrator arm deliberately does not match TOPIC-003..006, as described above.

This endpoint SHALL apply the same constant minimum response-time floor (`applyTimingFloor`) at every early return from this authorization check (`403 Forbidden`, for any rejection reason, including the no-manager rule) as every other endpoint covered by this capability's timing-floor requirement. Response latency then does not distinguish "never going to be authorized" from "authorized" for a caller probing this endpoint. On both administrator outcomes (`200` and the no-manager `403`), the audit insert and its structured event SHALL complete before `applyTimingFloor` is called, and the floor SHALL be applied before the response is sent. The audit insert SHALL NOT run between the floor and the send.

#### Scenario: A standing facilitator with no session history for the team can list its topics
- **WHEN** a facilitator who is not an active member of a team, and who has never run any session for that team, requests that team's full topic list (active and archived)
- **THEN** the response is `200 OK` with the team's active and archived topics

#### Scenario: An application admin with no membership on the team can list its topics
- **WHEN** an authenticated user with `global_role = 'application_admin'` and no active membership on the team requests the team's full topic list
- **THEN** the response is `200 OK` with the team's active and archived topics

#### Scenario: An application admin with a participant membership can list the team's topics
- **WHEN** an `application_admin` with an active `participant` membership on the team requests the team's full topic list
- **THEN** the response is `200 OK` with the team's active and archived topics

#### Scenario: An application admin who is the team's engineering manager is denied
- **WHEN** an `application_admin` with an active `engineering_manager` membership on the team requests the team's full topic list
- **THEN** the response is `403 Forbidden` with the message "Topic configuration for this team isn't available to its engineering manager." and `Cache-Control: no-store`
- **AND** the response body contains no topic, annotation, team-name, or lock-state data
- **AND** no topic, annotation, team-name, or lock-state query ran for the request
- **AND** `applyTimingFloor` was called once, with the request's start time, before the reply was sent

#### Scenario: An application admin with an unrecognised membership role is denied (unit test only)
- **WHEN** an `application_admin` whose live active membership role on the team is a value other than `participant` or `engineering_manager` requests the team's full topic list
- **THEN** the response is `403 Forbidden` with the message "Topic configuration for this team isn't available to you."
- **AND** no topic, annotation, team-name, or lock-state query ran for the request

#### Scenario: An application admin whose engineering-manager membership was removed is admitted
- **WHEN** an `application_admin` whose only membership on the team is an `engineering_manager` membership with `removed_at` set requests the team's full topic list
- **THEN** the response is `200 OK`
- **AND** the `admin.topic_config_accessed` row records `metadata.membership_role = null`

#### Scenario: An application admin's request for a team id that names no team is audited like any other read
- **WHEN** an `application_admin` requests the full topic list for a canonical UUID that names no team
- **THEN** the response is `200 OK` with `teamName: ""` and empty `active` and `archived` lists, as before this change
- **AND** exactly one `admin.topic_config_accessed` row is written with `team_id` equal to the requested id, all counts `0`, and `metadata.team_found = false`

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
- **AND** no topic, annotation, team-name, or lock-state query ran for the request

#### Scenario: A failed denial-row insert fails the request with no data
- **WHEN** an `application_admin` with an active `engineering_manager` membership on the team requests the team's full topic list and the `admin.topic_config_denied` insert fails
- **THEN** the response is `500`, not `200`
- **AND** the response body contains no topic, annotation, team-name, or lock-state data

#### Scenario: A failed role-set read fails the request with no data
- **WHEN** an `application_admin` requests the team's full topic list and the read of the caller's stored role set (`users.roles`) fails or returns no row
- **THEN** the response is `500`, not `200` or `403`
- **AND** the response body contains no topic names, topic ids, definitions, or team name

#### Scenario: On the administrator arm the audit write precedes the timing floor
- **WHEN** an `application_admin` requests the team's full topic list, once admitted and once as the team's engineering manager
- **THEN** in each request the audit insert runs before `applyTimingFloor`, and `applyTimingFloor` runs before the response is sent

#### Scenario: The no-manager rule does not change the topic-write endpoints
- **WHEN** an `application_admin` with an active `engineering_manager` membership on an unlocked team requests the team's full topic list and also sends a valid `POST /api/v1/teams/:teamId/topics` for that team
- **THEN** the full topic list answers `403`
- **AND** the add request answers `201`, unchanged until #208 is decided

#### Scenario: A facilitator's request performs no membership-role read
- **WHEN** a non-member standing facilitator requests the team's full topic list
- **THEN** the response is `200 OK`
- **AND** the number of queries against `team_memberships` equals the number the shared authorization check issues, counted by SQL text and not by mock position

#### Scenario: A global engineering manager is rejected whatever their membership
- **WHEN** a caller with `global_role = 'engineering_manager'` and no membership, a `participant` membership, or an `engineering_manager` membership on the team requests the team's full topic list
- **THEN** the response is `403 Forbidden` with the message "Only a facilitator or an application admin can view this team's topic list."

#### Scenario: A caller who is neither a standing facilitator nor an admin is rejected
- **WHEN** a caller who does not have `global_role = 'facilitator'` (and is not an `application_admin`), or who is an active member of the target team, requests that team's full topic list
- **THEN** the response is `403 Forbidden`

#### Scenario: A facilitator who is an active member of the team is rejected
- **WHEN** a facilitator who is an active member of the target team requests that team's full topic list
- **THEN** the response is `403 Forbidden` with the message "A facilitator cannot view topic management for a team they are a member of.", even though the caller holds `global_role = 'facilitator'`

#### Scenario: A 403 rejection is not detectably faster than a 200 success
- **WHEN** a caller who fails this endpoint's authorization check submits a request, and a separately measured authorized caller's request against the same endpoint is also submitted
- **THEN** the `403` response's timing is not detectably faster than the `200` response's timing, because both apply the same minimum response-time floor

### Requirement: The all-topics endpoint tells the screen whether the caller can add a custom topic

`GET /api/v1/teams/:teamId/topics/all`'s response SHALL include a top-level `canAddTopics: boolean`. `canAddTopics` SHALL be `true` for every caller TOPIC-002 admits: every non-member `facilitator`, and every `application_admin` that the endpoint's no-manager rule admits. (TOPIC-002 already rejects facilitators who are active members of the team, and administrators whose membership role on the team is other than absent or `participant`, so the flag computes no membership of its own.) It SHALL NOT be derived from `canEditAnnotations`, whose administrator exclusion (FR-8.7) is permanent.

The flag reflects authorization only and SHALL NOT be the server's enforcement. `POST /api/v1/teams/:teamId/topics` enforces its own authorization and the customization lock independently. The flag does not consider `isCustomizationLocked`; the screen combines the two.

#### Scenario: A standing facilitator can add topics
- **WHEN** a standing facilitator who is not a member of the team requests the team's full topic list
- **THEN** the response includes `canAddTopics: true`

#### Scenario: An administrator can add topics but cannot edit annotations
- **WHEN** an `application_admin` with no membership on the team requests the team's full topic list
- **THEN** the response includes `canAddTopics: true` and `canEditAnnotations: false`
- **AND** the response still includes the full `active` and `archived` lists

#### Scenario: The flag agrees with the add endpoint's authorization for every caller class
- **WHEN** each of the following requests an unlocked team's full topic list and also sends a valid `POST /api/v1/teams/:teamId/topics` for that team: a non-member standing facilitator, a facilitator who is a member of the team, an `application_admin`, an `application_admin` with a `participant` membership on the team, an `application_admin` with an `engineering_manager` membership on the team, an engineer, an engineering manager, and a caller whose session's user has no `users` row
- **THEN** for every caller that the full topic list admits, `canAddTopics` is `true` exactly when the add request does not answer `403`
- **AND** every caller that the full topic list rejects also receives `403` from the add request, except the `application_admin` with an `engineering_manager` membership, whose add request answers `201`
- **AND** that exception is recorded in the parity test with a comment citing #208, because the no-manager rule on this read does not change the topic-write endpoints until #208 is decided

#### Scenario: The flag does not depend on the lock
- **WHEN** a standing facilitator requests the full topic list of a team that has not completed its first session
- **THEN** the response includes `isCustomizationLocked: true` and `canAddTopics: true`

## ADDED Requirements

### Requirement: The all-topics endpoint audits every administrator read and every administrator denial

Every `200` response from `GET /api/v1/teams/:teamId/topics/all` to an `application_admin` SHALL write exactly one `audit_log` row and SHALL emit the matching structured audit event. The row SHALL have:

- `operation = 'admin.topic_config_accessed'`
- `actor_user_id`, `actor_global_role = 'application_admin'`, `actor_ip`, and `team_id`
- `actor_roles` = the caller's stored role set (`users.roles`) at the time of the request, highest precedence first
- `metadata = { endpoint: "GET /api/v1/teams/:teamId/topics/all", http_status: 200, membership_role: null | "participant", actor_idp_roles_include_em, team_found, active_count, archived_count, annotated_count }`, with exactly these keys

This SHALL apply to every team, the template team included, whether or not any topic carries a definition. `annotated_count` SHALL be the number of entries in the response's `active` and `archived` lists that carry a non-null `teamAnnotation`. `team_found` SHALL be whether the endpoint's existing lookup of the team's name found a `teams` row.

The caller's role set SHALL be read once per administrator request. `actor_roles` is the durable record of it. `actor_idp_roles_include_em` SHALL be derived from the same read, as whether `engineering_manager` is in that set, so the two cannot disagree. It SHALL be `false` whenever `users.roles` does not contain `engineering_manager`. That includes users whose roles were backfilled to `{global_role}` by migration 21 and who have not signed in since #245, so `false` (and an `actor_roles` without `engineering_manager`) does not prove the caller holds no manager role in the IdP. The role set is audit data only and SHALL NOT be an input to admission. If the read returns no row, the request SHALL fail as described under "Failure handling on the administrator arm"; it SHALL NOT record a default value.

The row SHALL be written after the response data has been read, and before the timing floor and the response. If the role-set read or the audit write fails, the request SHALL fail with `500` and the response SHALL contain none of the data read. One row SHALL be written per request, with no deduplication.

The matching structured event `admin.topic_config_accessed` SHALL carry exactly `{ actorUserId, actorGlobalRole, actorIp, teamId, endpoint, httpStatus, membershipRole, actorRoles, actorIdpRolesIncludeEm, teamFound, activeCount, archivedCount, annotatedCount }`.

Every `403` from this endpoint's no-manager rule SHALL write exactly one `audit_log` row and SHALL emit the matching structured event. The row SHALL have:

- `operation = 'admin.topic_config_denied'`
- the same actor, `actor_roles` and team columns as the access row
- `metadata = { endpoint, http_status: 403, reason: "membership_em" | "membership_unrecognised", actor_idp_roles_include_em }`, with exactly these keys

The denial row SHALL be written before the timing floor and the response. If the role-set read or the denial insert fails, the request SHALL fail with `500` and SHALL still return no topic data (see "Failure handling on the administrator arm"). The matching structured event `admin.topic_config_denied` SHALL carry exactly `{ actorUserId, actorGlobalRole, actorIp, teamId, endpoint, httpStatus, reason, actorRoles, actorIdpRolesIncludeEm }`.

When the role-set read or either insert fails on the administrator arm, the endpoint SHALL emit the log-only structured event `admin.audit_write_failed` with exactly `{ actorUserId, teamId, endpoint, operation, stage, errorCode }` before failing the request. `operation` is the row that was due, `stage` is `"role_set_read"` or `"audit_insert"`, and `errorCode` is the database error code when there is one, otherwise `null`. It SHALL NOT carry the database error's message or detail. It writes no `audit_log` row.

Neither row's metadata, and neither event's payload, SHALL contain annotation text, topic names, or topic ids. A `200` to a caller who is not an `application_admin` SHALL write no `admin.*` row.

This requirement adds audit rows only for administrator reads and the new no-manager denial. TOPIC-002's pre-existing `403`s to non-administrators (`NOT_A_FACILITATOR`, `FACILITATOR_IS_TEAM_MEMBER`) are not audited by this change. Scenarios that assert "no `admin.*` row" for those callers pin only that no administrator operation is written. They do not decide whether those denials should be audited under SEC-13.

#### Scenario: An admin read writes one access row with text-free counts
- **WHEN** an admitted `application_admin` requests the full topic list of a team with an annotated active topic and an annotated archived topic
- **THEN** exactly one `admin.topic_config_accessed` row is written for the request
- **AND** its `metadata.annotated_count` is `2`, and its `active_count` and `archived_count` match the response
- **AND** its metadata contains no annotation text, topic name, or topic id

#### Scenario: An admin read of a team with no definitions is still audited
- **WHEN** an admitted `application_admin` requests the full topic list of a team where no topic carries a definition
- **THEN** exactly one `admin.topic_config_accessed` row is written with `metadata.annotated_count = 0`

#### Scenario: An admin read of the template team is audited
- **WHEN** an `application_admin` requests the full topic list of the template team (`DEFAULT_TOPICS_TEAM_ID`)
- **THEN** exactly one `admin.topic_config_accessed` row is written

#### Scenario: The role set is recorded but does not decide admission
- **WHEN** an `application_admin` whose stored `users.roles` is `{application_admin,engineering_manager}`, and who holds no membership on the team, requests the full topic list
- **THEN** the response is `200`
- **AND** the access row's `actor_roles` is `{application_admin,engineering_manager}` and its `metadata.actor_idp_roles_include_em` is `true`

#### Scenario: A backfilled role set records what was known
- **WHEN** an admitted `application_admin` whose stored `users.roles` is `{application_admin}` requests the full topic list
- **THEN** the access row's `actor_roles` is `{application_admin}` and its `metadata.actor_idp_roles_include_em` is `false`

#### Scenario: The rows and events carry exactly the specified keys
- **WHEN** an `application_admin` is admitted, and separately an `application_admin` who is the team's engineering manager is denied, for a team whose topics carry definitions
- **THEN** each `audit_log` row's metadata and each structured event's payload has exactly the key set this requirement specifies
- **AND** none of their values contains a definition, a topic name, or a topic id

#### Scenario: A failed audit write is signalled without data
- **WHEN** the `admin.topic_config_accessed` or `admin.topic_config_denied` insert fails
- **THEN** the response is `500`
- **AND** one `admin.audit_write_failed` event is emitted with `stage = "audit_insert"`, the due `operation`, and no database error message

#### Scenario: A failed access-row write fails the request with no data
- **WHEN** an admitted `application_admin` requests the full topic list and the `admin.topic_config_accessed` insert fails
- **THEN** the response is `500`
- **AND** the response body contains no topic names, topic ids, definitions, or team name, although the team name and topics were already read

#### Scenario: A no-manager denial writes one denial row
- **WHEN** an `application_admin` with an active `engineering_manager` membership on the team requests the full topic list
- **THEN** exactly one `admin.topic_config_denied` row with `metadata.reason = "membership_em"` and `metadata.http_status = 403` is written
- **AND** no `admin.topic_config_accessed` row is written

#### Scenario: Each admin request is audited separately
- **WHEN** an admitted `application_admin` sends two requests for the same team's full topic list
- **THEN** two `admin.topic_config_accessed` rows are written, one per request

#### Scenario: A facilitator read writes no admin row
- **WHEN** a non-member standing facilitator requests the full topic list
- **THEN** the response is `200`
- **AND** no `admin.*` audit row is written
