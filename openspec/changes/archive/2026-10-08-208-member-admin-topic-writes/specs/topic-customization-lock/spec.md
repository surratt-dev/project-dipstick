## RENAMED Requirements

- FROM: `### Requirement: The all-topics endpoint audits every administrator read and every administrator denial`
- TO: `### Requirement: The all-topics endpoint audits every administrator read`

## MODIFIED Requirements

### Requirement: The all-topics endpoint uses the standing, org-wide facilitator authorization model, matching every other topic-write endpoint it serves

`GET /api/v1/teams/:teamId/topics/all` SHALL authorize requests using the same standing, org-wide facilitator model as `POST /api/v1/teams/:teamId/topics`, `DELETE /api/v1/teams/:teamId/topics/:topicId`, and every other topic-write endpoint this capability gates. A caller is admitted when either:

- `global_role = 'facilitator'` AND the caller is not an active member of the target team, OR
- `global_role = 'application_admin'`, whatever the caller's membership on the target team (none, or any value of `team_memberships.role`; today `participant` or `engineering_manager`).

The non-member facilitator rule is shared by every topic-write endpoint. The `application_admin` arm is shared with add, `DELETE`, restore, and reorder (TOPIC-003/004/005/006), and is identical to theirs: an administrator is admitted on any team whatever their membership (#208: the product owner decided that administrators are a trusted role and are not barred from topic configuration by team membership; that decision covers TOPIC-002..006 only and does not change any other administrator restriction). `PUT /api/v1/teams/:teamId/topics/:topicId/annotation` (TOPIC-007, BRD FR-8.7) rejects administrators with `403`. This read endpoint still admits them and returns `canEditAnnotations: false` and `canAddTopics: true` to them. This endpoint SHALL NOT require that the caller currently hold, or have ever held, an active session for the target team. No completed-session relationship, and no prior facilitation history with the specific team, is required.

**No membership rule on the administrator arm (#208, reversing #232).** This endpoint SHALL NOT deny an `application_admin` because of their membership role on the target team. The no-manager rule #232 added to this arm, and its `ADMIN_IS_TEAM_MANAGER` and `ADMIN_MEMBERSHIP_NOT_ADMITTED` `403`s, are removed. On the administrator arm the handler SHALL read the caller's live active membership role on the target team once per request, with no cache, and SHALL use it only as audit data (see Requirement: The all-topics endpoint audits every administrator read). Only an active membership counts: a membership whose `removed_at` is set is recorded as no membership. The membership role SHALL be read only for a caller already admitted on the administrator arm, so a facilitator's request performs no additional query.

**Only two authorized roles reach the data.** After the shared authorization check admits a caller, the handler SHALL accept only `facilitator` (the unaudited read) and `application_admin` (the audited administrator arm) as the authorized global role. Any other authorized role value, including a different spelling or casing of `application_admin`, SHALL fail the request with `500` before any membership, role-set, topic, annotation, team-name, or lock-state read, and SHALL write no audit row. The error message SHALL name no role value, team, or user. This guards against a later change to the shared helper admitting a third role that would otherwise reach the data with no audit.

**Failure handling on the administrator arm (fail closed).** If the membership-role read, the read of the caller's stored role set used for audit (including that read returning no row), or the audit insert (see Requirement: The all-topics endpoint audits every administrator read) fails, the request SHALL respond `500` with the application's existing server-error response. That response SHALL contain no topic, annotation, team-name, or lock-state data. This fail-closed rule applies to this endpoint's administrator arm only. It SHALL NOT be read as a pattern for facilitator or live-session paths, which this rule does not touch.

**Reason names are internal labels.** `NOT_A_FACILITATOR` and `FACILITATOR_IS_TEAM_MEMBER` name branches in code and in the REST API Contract's `403` table. They are not response fields. The observable difference between the `403`s is the envelope's `error.message`, and the scenarios below assert that message.

**Team ids that name no team.** A `teamId` that is not a canonical UUID SHALL still receive `404` (`TEAM_NOT_FOUND`) before any query. A canonical UUID that names no team is answered `200` with `teamName: ""` and empty lists. An administrator's request for such an id is admitted and audited like any other administrator `200`, with `team_id` set to the requested id.

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

#### Scenario: An application admin's request for a team id that names no team is audited like any other read
- **WHEN** an `application_admin` requests the full topic list for a canonical UUID that names no team
- **THEN** the response is `200 OK` with `teamName: ""` and empty `active` and `archived` lists
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

#### Scenario: A caller who is neither a standing facilitator nor an admin is rejected
- **WHEN** a caller whose global role is neither `facilitator` nor `application_admin` requests a team's full topic list
- **THEN** the response is `403 Forbidden`

#### Scenario: A facilitator who is an active member of the team is rejected
- **WHEN** a facilitator who is an active member of the target team, in any membership role, requests that team's full topic list
- **THEN** the response is `403 Forbidden` with the message "A facilitator cannot view topic management for a team they are a member of.", even though the caller holds `global_role = 'facilitator'`

#### Scenario: A 403 rejection is not detectably faster than a 200 success
- **WHEN** a caller who fails this endpoint's authorization check submits a request, and a separately measured authorized caller's request against the same endpoint is also submitted
- **THEN** the `403` response's timing is not detectably faster than the `200` response's timing, because both apply the same minimum response-time floor

### Requirement: The all-topics endpoint tells the screen whether the caller can add a custom topic

`GET /api/v1/teams/:teamId/topics/all`'s response SHALL include a top-level `canAddTopics: boolean`. `canAddTopics` SHALL be `true` for every caller TOPIC-002 admits: every non-member `facilitator`, and every `application_admin` whatever their membership on the team. (TOPIC-002 already rejects facilitators who are active members of the team, so the flag computes no membership of its own.) It SHALL NOT be derived from `canEditAnnotations`, whose administrator exclusion (FR-8.7) is permanent.

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
- **AND** every caller that the full topic list rejects also receives `403` from the add request, with no exception

#### Scenario: The flag does not depend on the lock
- **WHEN** a standing facilitator requests the full topic list of a team that has not completed its first session
- **THEN** the response includes `isCustomizationLocked: true` and `canAddTopics: true`

### Requirement: The all-topics endpoint audits every administrator read

Every `200` response from `GET /api/v1/teams/:teamId/topics/all` to an `application_admin` SHALL write exactly one `audit_log` row and SHALL emit the matching structured audit event. The row SHALL have:

- `operation = 'admin.topic_config_accessed'`
- `actor_user_id`, `actor_global_role = 'application_admin'`, `actor_ip`, and `team_id`
- `actor_roles` = the caller's stored role set (`users.roles`) at the time of the request, highest precedence first
- `metadata = { endpoint: "GET /api/v1/teams/:teamId/topics/all", http_status: 200, membership_role, actor_idp_roles_include_em, team_found, active_count, archived_count, annotated_count }`, with exactly these keys

`membership_role` SHALL be the caller's live active membership role on the team as read (`null` when there is none; today `"participant"` or `"engineering_manager"` otherwise), recorded without an allow-list because no admission decision depends on it. A membership role added later SHALL be recorded verbatim and needs no change to this requirement; "today" does not describe a closed set. It is the durable record of whether the reader holds a role on the team, including whether they manage it.

This SHALL apply to every team, the template team included, whether or not any topic carries a definition. `annotated_count` SHALL be the number of entries in the response's `active` and `archived` lists that carry a non-null `teamAnnotation`. `team_found` SHALL be whether the endpoint's existing lookup of the team's name found a `teams` row.

The caller's role set SHALL be read once per administrator request. `actor_roles` is the durable record of it. `actor_idp_roles_include_em` SHALL be derived from the same read, as whether `engineering_manager` is in that set, so the two cannot disagree. It SHALL be `false` whenever `users.roles` does not contain `engineering_manager`. That includes users whose roles were backfilled to `{global_role}` by migration 21 and who have not signed in since #245, so `false` (and an `actor_roles` without `engineering_manager`) does not prove the caller holds no manager role in the IdP. The role set is audit data only and SHALL NOT be an input to admission. If the read returns no row, the request SHALL fail as described under "Failure handling on the administrator arm"; it SHALL NOT record a default value.

The row SHALL be written after the response data has been read, and before the timing floor and the response. If the membership-role read, the role-set read, or the audit write fails, the request SHALL fail with `500` and the response SHALL contain none of the data read. One row SHALL be written per request, with no deduplication.

The matching structured event `admin.topic_config_accessed` SHALL carry exactly `{ actorUserId, actorGlobalRole, actorIp, teamId, endpoint, httpStatus, membershipRole, actorRoles, actorIdpRolesIncludeEm, teamFound, activeCount, archivedCount, annotatedCount }`.

When the role-set read or the insert fails on the administrator arm, the endpoint SHALL emit the log-only structured event `admin.audit_write_failed` with exactly `{ actorUserId, teamId, endpoint, operation, stage, errorCode }` before failing the request. `operation` is `"admin.topic_config_accessed"`, `stage` is `"role_set_read"` or `"audit_insert"`, and `errorCode` is the database error code when there is one, otherwise `null`. It SHALL NOT carry the database error's message or detail. It writes no `audit_log` row.

Neither the row's metadata nor the event's payload SHALL contain annotation text, topic names, or topic ids. A `200` to a caller who is not an `application_admin` SHALL write no `admin.*` row. This endpoint SHALL write no `admin.topic_config_denied` row; that operation was retired by #208, and historical rows of it are left unchanged.

TOPIC-002's `403`s to non-administrators (`NOT_A_FACILITATOR`, `FACILITATOR_IS_TEAM_MEMBER`) are not audited by this requirement. Scenarios that assert "no `admin.*` row" for those callers pin only that no administrator operation is written. They do not decide whether those denials should be audited under SEC-13.

#### Scenario: An admin read writes one access row with text-free counts
- **WHEN** an `application_admin` requests the full topic list of a team with an annotated active topic and an annotated archived topic
- **THEN** exactly one `admin.topic_config_accessed` row is written for the request
- **AND** its `metadata.annotated_count` is `2`, and its `active_count` and `archived_count` match the response
- **AND** its metadata contains no annotation text, topic name, or topic id

#### Scenario: The access row records the reader's membership role
- **WHEN** an `application_admin` requests the full topic list three times, once with no membership on the team, once with a `participant` membership, and once with an `engineering_manager` membership
- **THEN** each request answers `200` and writes exactly one `admin.topic_config_accessed` row
- **AND** the rows' `metadata.membership_role` values are `null`, `"participant"`, and `"engineering_manager"` respectively

#### Scenario: A membership role outside today's set is recorded verbatim (unit test only)
- **WHEN** an `application_admin` whose live active membership role on the team is a value other than `participant` or `engineering_manager` (for example `observer`) requests the full topic list
- **THEN** the response is `200`
- **AND** exactly one `admin.topic_config_accessed` row is written with `metadata.membership_role` equal to that value, and the structured event's `membershipRole` carries the same value

#### Scenario: An admin read of a team with no definitions is still audited
- **WHEN** an `application_admin` requests the full topic list of a team where no topic carries a definition
- **THEN** exactly one `admin.topic_config_accessed` row is written with `metadata.annotated_count = 0`

#### Scenario: An admin read of the template team is audited
- **WHEN** an `application_admin` requests the full topic list of the template team (`DEFAULT_TOPICS_TEAM_ID`)
- **THEN** exactly one `admin.topic_config_accessed` row is written

#### Scenario: The role set is recorded but does not decide admission
- **WHEN** an `application_admin` whose stored `users.roles` is `{application_admin,engineering_manager}`, and who holds no membership on the team, requests the full topic list
- **THEN** the response is `200`
- **AND** the access row's `actor_roles` is `{application_admin,engineering_manager}` and its `metadata.actor_idp_roles_include_em` is `true`

#### Scenario: A backfilled role set records what was known
- **WHEN** an `application_admin` whose stored `users.roles` is `{application_admin}` requests the full topic list
- **THEN** the access row's `actor_roles` is `{application_admin}` and its `metadata.actor_idp_roles_include_em` is `false`

#### Scenario: The row and event carry exactly the specified keys
- **WHEN** an `application_admin` with an `engineering_manager` membership requests the full topic list of a team whose topics carry definitions
- **THEN** the `audit_log` row's metadata and the structured event's payload each have exactly the key set this requirement specifies
- **AND** none of their values contains a definition, a topic name, or a topic id

#### Scenario: A failed audit write is signalled without data
- **WHEN** the `admin.topic_config_accessed` insert fails
- **THEN** the response is `500`
- **AND** one `admin.audit_write_failed` event is emitted with `stage = "audit_insert"`, `operation = "admin.topic_config_accessed"`, and no database error message

#### Scenario: A failed access-row write fails the request with no data
- **WHEN** an `application_admin` requests the full topic list and the `admin.topic_config_accessed` insert fails
- **THEN** the response is `500`
- **AND** the response body contains no topic names, topic ids, definitions, or team name, although the team name and topics were already read

#### Scenario: No admin request writes a denial row
- **WHEN** an `application_admin` with any membership role on the team, or none, requests the full topic list
- **THEN** no `admin.topic_config_denied` row is written

#### Scenario: Each admin request is audited separately
- **WHEN** an `application_admin` sends two requests for the same team's full topic list
- **THEN** two `admin.topic_config_accessed` rows are written, one per request

#### Scenario: A facilitator read writes no admin row
- **WHEN** a non-member standing facilitator requests the full topic list
- **THEN** the response is `200`
- **AND** no `admin.*` audit row is written
