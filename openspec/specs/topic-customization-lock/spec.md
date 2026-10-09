# topic-customization-lock

## Purpose

Defines the server-side rule that a team's topic configuration cannot be customized until that team has completed its first session, the single reusable function that computes this lock state, and the read-side/write-side surfaces that must consult it. This spec covers: the shared, uncached lock-check function; the `isCustomizationLocked` flag on the active-topics read endpoint; the check-ordering and status-code contract for topic-write endpoints (403 identity/role, then 409 lock, with a timing floor closing the resulting enumeration side-channel); the standard error envelope used for lock rejections; the audit trail for denied lock-bypass attempts; and `GET /api/v1/teams/:teamId/topics/all`'s own authorization model and response contract (team name, per-topic description, archived-topic provenance, per-topic team annotation and its provenance, the `canEditAnnotations` flag, and the `canAddTopics` flag added by `topic-add-form-and-empty-state`), since that endpoint is this capability's other consumer of the lock flag and the standing facilitator model.

This spec does NOT cover: the specific fields or business rules of any individual topic-write endpoint (see `add-custom-topic` for `POST /api/v1/teams/:teamId/topics`, `remove-topic` for `DELETE /api/v1/teams/:teamId/topics/:topicId`, and `topic-annotation` for `PUT /api/v1/teams/:teamId/topics/:topicId/annotation`), or the standing, org-wide facilitator authorization model itself (defined by the `evaluateStandingFacilitatorAccess` helper and referenced here only as the identity/role check that runs before the lock). The Topic Management screen's UI behavior built against `GET /api/v1/teams/:teamId/topics/all` is covered by `topic-management-screen`, not here.

**Implementation note — shared functions:** The lock-check function is `hasCompletedFirstSession(teamId)` in `packages/backend/src/auth/topic-lock-helper.ts`. It is called by both `GET /api/v1/teams/:teamId/topics` (`packages/backend/src/routes/content.ts`) and `POST /api/v1/teams/:teamId/topics` (`packages/backend/src/routes/topics.ts`). No other code path independently queries `sessions.status = 'complete'` to answer this question.

**Implementation note — `canAddTopics`:** Computed in the TOPIC-002 handler in `packages/backend/src/routes/content.ts` as `decision.actorGlobalRole === "facilitator" || decision.actorGlobalRole === "application_admin"` (true for every caller TOPIC-002 admits, per BRD FR-8.2), deliberately separate from `canEditAnnotations` (whose administrator exclusion is permanent). The response type `GetAllTopicsResponse.canAddTopics` and the shared `AddCustomTopicRequest`/`AddCustomTopicResponse` types are in `packages/shared/src/types/topic.ts`; TOPIC-003's validator in `packages/backend/src/routes/topics.ts` is typed against `AddCustomTopicRequest`, and its vote-type list is derived from an object declared `satisfies Record<VoteType, true>`. Flag/endpoint agreement is enforced by `packages/backend/src/routes/__tests__/topic-add-flag-parity.test.ts`, which registers both routes and runs their real authorization helpers against a SQL-routing `db.query` fake (not live Postgres); each caller-class row carries an explicit `expected` outcome (GET status, `canAddTopics`, POST status). Both endpoints now decide through `checkStandingFacilitatorOrAdminAuthorization`, so the test guards `content.ts`'s explicit role expression against TOPIC-003's `checkAddCustomTopicAuthorization`.

**Implementation note — timing floor:** `applyTimingFloor` (`packages/backend/src/content/timing-oracle.ts`) is applied at every early-return in a topic-write endpoint's check cascade, not only at the 409 lock rejection, so that response latency does not become a side channel distinguishing "never going to be authorized" from "authorized but blocked by the lock."

---

## Requirements

### Requirement: A single reusable function computes whether a team's topic configuration is customizable

The application SHALL provide one reusable, named server-side function that determines whether a team's topic configuration is customizable ("unlocked"). The function SHALL evaluate to unlocked if and only if the team has at least one session with `status = 'complete'`, and locked otherwise. This function SHALL execute a live database read on every call; its result MUST NOT be cached at any layer, in memory, in the session, or otherwise. No other code path SHALL independently query `sessions.status = 'complete'` to answer this question — every consumer of the lock state, on both the read side and the write side, SHALL call this same function.

#### Scenario: A team with zero completed sessions is locked
- **WHEN** the lock-check function is called for a team that has never had a session reach `status = 'complete'`
- **THEN** the function returns locked (customization not permitted)

#### Scenario: A team with at least one completed session is unlocked
- **WHEN** the lock-check function is called for a team that has at least one session with `status = 'complete'`
- **THEN** the function returns unlocked (customization permitted)

#### Scenario: A session that was started but abandoned does not count toward unlocking
- **WHEN** the lock-check function is called for a team whose only session exists but has a status other than `complete` (e.g., abandoned, in progress)
- **THEN** the function returns locked

#### Scenario: The lock state is read live, not from a cache
- **WHEN** a team's first session transitions to `status = 'complete'`
- **THEN** the very next call to the lock-check function for that team returns unlocked, with no caching delay at any layer

### Requirement: The active-topics response exposes the team's customization lock state

`GET /api/v1/teams/:teamId/topics` SHALL include an `isCustomizationLocked` boolean field in its response body, computed via the shared lock-state function (see "Topic read endpoints report why a team's topics are locked"), which delegates to the shared lock-check function for every team except the template. This field SHALL be present on every `200` response from this endpoint, for every caller the endpoint admits (see `team-content-access`, Requirement: The active-topics endpoint admits only non-manager participant members and eligible session facilitators). Any denied caller (a `null` grant, an Application Admin, or an engineering manager) SHALL receive no lock state, and neither the lock-state function nor the lock-check function SHALL run for a denied request.

#### Scenario: Locked team's topic list response includes the lock flag
- **WHEN** an authorized caller requests the active topics for a team with zero completed sessions
- **THEN** the response includes `isCustomizationLocked: true` alongside the topic list

#### Scenario: Unlocked team's topic list response includes the lock flag
- **WHEN** an authorized caller requests the active topics for a non-template team with at least one completed session
- **THEN** the response includes `isCustomizationLocked: false` alongside the topic list

#### Scenario: A denied caller receives no lock state
- **WHEN** an engineering manager of the team requests the active topics
- **THEN** the response is `403` and its body contains no `isCustomizationLocked` field
- **AND** the shared lock-check function is not invoked for the request

### Requirement: A topic-write request against a locked team is rejected with 409 Conflict, evaluated after identity/role authorization

Any endpoint that writes to a team's topic configuration SHALL evaluate the requester's identity/role authorization (standing facilitator, not an active member of the target team) before evaluating the customization lock. A request that fails identity/role authorization SHALL be rejected with `403 Forbidden` and SHALL NOT reveal the team's lock state. A request that passes identity/role authorization but targets a team where the lock-check function returns locked SHALL be rejected with `409 Conflict`. No topic configuration change SHALL be made when either rejection occurs.

A fixed status-code ordering alone does not close this ordering's enumeration-resistance guarantee: the shipped handler(s) SHALL also apply a constant minimum response-time floor (`applyTimingFloor`, `packages/backend/src/content/timing-oracle.ts`) at every early-return in the cascade — the `403`, the `404` team-existence check, and the `409` lock rejection alike — so that response latency does not distinguish "never going to be authorized" from "authorized but blocked by the lock" for a caller who was never going to be authorized regardless.

#### Scenario: A caller who fails identity/role authorization receives a response no faster than an authorized-but-locked caller's
- **WHEN** a caller who fails identity/role authorization submits a topic-write request, and a separately-measured standing facilitator's request against a locked team is also submitted
- **THEN** the `403` response's timing is not detectably faster than the `409` response's timing, because both apply the same minimum response-time floor

#### Scenario: An otherwise-authorized facilitator is rejected with 409 when the team is locked
- **WHEN** a standing facilitator who is not a member of the target team submits a topic-write request against a team with zero completed sessions
- **THEN** the request is rejected with `409 Conflict`
- **AND** no topic configuration change is made

#### Scenario: A caller who fails identity/role authorization receives 403 regardless of the team's lock state
- **WHEN** a caller who is not a facilitator, or who is an active member of the target team, submits a topic-write request against that team
- **THEN** the request is rejected with `403 Forbidden`
- **AND** the response does not reveal whether the team is locked or unlocked

#### Scenario: A direct API call bypassing the UI is rejected identically to a UI-originated call
- **WHEN** a topic-write request is submitted directly against the API for a locked team, without going through any client UI
- **THEN** the request is rejected with `409 Conflict` under the same rule as any other caller
- **AND** no topic configuration change is made

### Requirement: The lock-rejection response body carries a machine-readable reason code and a stable message, nested in the standard error envelope

Every rejected topic-write request SHALL return this codebase's standard error envelope, `{ error: { category, code, message, correlationId } }` — the same shape `teams.ts`'s `GLOBAL_ROLE_PRECONDITION_NOT_MET`/`TEAM006_BURST_LIMIT_EXCEEDED` responses already use — not a bare top-level `{ code, message }` body. `error.code` SHALL distinguish the specific rejection cause: `NOT_A_FACILITATOR`, `FACILITATOR_IS_TEAM_MEMBER` (both `error.category: "forbidden"`), or `TOPIC_CUSTOMIZATION_LOCKED` (`error.category: "precondition_failed"`). For `TOPIC_CUSTOMIZATION_LOCKED` specifically, `error.message` SHALL be the fixed literal string `"Topics cannot be customized until this team's first session is completed."`, not per-request or client-generated text. `error.correlationId` SHALL be present on every rejection, as it is on every other error response in this codebase.

#### Scenario: A lock rejection carries the stable reason code and message, nested under error
- **WHEN** a topic-write request is rejected because the team's customization lock is active
- **THEN** the response body includes `error.code: "TOPIC_CUSTOMIZATION_LOCKED"`, `error.category: "precondition_failed"`, and `error.message: "Topics cannot be customized until this team's first session is completed."`

#### Scenario: A non-facilitator rejection carries a distinct reason code
- **WHEN** a topic-write request is rejected because the caller does not have `global_role = 'facilitator'`
- **THEN** the response body includes `error.code: "NOT_A_FACILITATOR"` and `error.category: "forbidden"`, distinct from the lock rejection's code and category

#### Scenario: A same-team-member facilitator rejection carries a distinct reason code
- **WHEN** a topic-write request is rejected because the caller is a facilitator but is an active member of the target team
- **THEN** the response body includes `error.code: "FACILITATOR_IS_TEAM_MEMBER"` and `error.category: "forbidden"`, distinct from the lock rejection's code

### Requirement: Every request denied under the customization lock is audited before the response is sent

Every topic-write request rejected with `409 Conflict` under the customization lock SHALL result in a synchronous `audit_log` row (`operation = 'topic.write_denied_locked'`) written before the rejection response is sent to the caller. The audit row SHALL include the actor's user ID, global role, and IP address; the target team ID; and metadata identifying the endpoint and attempted operation.

#### Scenario: A denied lock-bypass attempt is recorded in the audit log before the caller receives the response
- **WHEN** a topic-write request is rejected with `409 Conflict` under the customization lock
- **THEN** an `audit_log` row with `operation = 'topic.write_denied_locked'` is written to the database
- **AND** that write completes before the `409` response is sent to the caller

#### Scenario: Denied attempts against different endpoints all use the same audit operation
- **WHEN** requests to two different topic-write endpoints are each rejected under the customization lock
- **THEN** both rejections write an `audit_log` row with `operation = 'topic.write_denied_locked'`, distinguished from each other only by their metadata (e.g., endpoint identifier), not by a different operation name

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

### Requirement: The all-topics endpoint's response carries the team's display name, each active topic's description, and each archived topic's provenance — extensions beyond the originally-drafted contract

`GET /api/v1/teams/:teamId/topics/all`'s response SHALL include, in addition to the topic lists themselves:

- A top-level `teamName: string`, the target team's display name. Before this endpoint shipped, no endpoint reachable by a standing, non-member facilitator returned a team's display name; this field exists so the Topic Management screen's remove-confirmation dialog can name the team it is acting on (see `topic-management-screen`'s "names both the topic and the team" requirement), without a second round trip against an endpoint this contract does not otherwise specify.
- Each `active[]` entry's `firstSessionDescription: string | null`, matching the existing View Active Topic Configuration acceptance criteria ("prompt, vote type, and description" per row) so the Topic Management screen's active list is not a stripped-down name list.
- Each `archived[]` entry's `archivedAt` (the timestamp the topic transitioned to `archived`) and `archivedBy` (the archiving user's ID and display name, or `null` if unavailable — `null` only for a topic archived before the `archived_by` column existed; none exist today).
- Each `archived[]` entry's `restoredAt: string | null` and `restoredBy: { userId: string; displayName: string } | null` — set only if the topic was previously restored and subsequently archived again (i.e., it reflects the most recent restore event prior to the current archive, if one occurred); `null` for a topic that has never been restored. Added by `restore-topic`, mirroring `archivedAt`/`archivedBy`'s provenance shape rather than introducing a different one.
- Each `active[]` **and** `archived[]` entry's `teamAnnotation: string | null` (read from `topics.team_annotation`; previously hard-coded `null` on active entries and absent on archived entries), `annotationUpdatedAt: string | null`, and `annotationUpdatedBy: { userId: string; displayName: string } | null`. Added by `topic-annotation`, reusing the `archivedBy` provenance shape. Archived entries carry the annotation so the facilitator can see what will return on restore; the Topic Management screen displays it read-only on archived rows (see `topic-management-screen`), and archived entries are read-only, so this exposes nothing new.
- A top-level `canEditAnnotations: boolean`, `true` when the caller is a standing facilitator and `false` when the caller is an `application_admin`. Added by `topic-annotation` because TOPIC-007 deliberately excludes administrators while this endpoint admits them; the flag lets the screen avoid offering a control that would only return `403`. It reflects authorization only and SHALL NOT be the server's enforcement — TOPIC-007 enforces independently. Administrators SHALL still receive the annotation fields read-only: topic configuration is administrative data they already read, and TOPIC-007's administrator exclusion concerns who authors the team's words, not who may view the configuration.

None of the first three fields were present in this endpoint's originally-drafted response contract; each was added to close a gap the Topic Management screen's own stated requirements exposed once that screen was actually built against this endpoint. `restoredAt`/`restoredBy` were added by `restore-topic` for the same reason, on the same footing: a strict subset of what the standing, org-wide facilitator model already discloses to this caller — the full topic list and content of a team they are, by design, trusted to read and archive from and restore to — not a new category of disclosure, and none of these fields is personal data about an individual beyond a facilitator's own display name, which is already visible org-wide in other bounded contexts (e.g., team membership screens). The `archivedBy`/`archivedAt` and `restoredBy`/`restoredAt` pairs are a facilitator-facing read path, distinct from and in addition to any audit-log record of the same events — a facilitator viewing this endpoint's response SHALL NOT need to consult the audit log to determine who archived or restored a topic, or when. The same holds for `annotationUpdatedBy`/`annotationUpdatedAt`.

**Implementation note — `defaultTopicsNotActive`:** The response also includes a top-level `defaultTopicsNotActive: Array<{ topicId, name, isArchived }>`, listing the team's canonical default topics that are not currently in the `active` list. This field was part of the originally-drafted TOPIC-002 contract and is correctly computed by this endpoint's query. It remains unread by this endpoint's current consumers (`topic-management-screen`'s active and archived lists are both driven by `active[]`/`archived[]` directly, and that screen is now required not to read it — see its requirement "The screen does not read `defaultTopicsNotActive`" — because the field's name-based join can mis-match a custom topic that shares a default topic's name and its `topicId` can refer to the template team); it is documented here only so its presence in the response shape is not mistaken for an unspecified or accidental field.

#### Scenario: The response includes the team's display name
- **WHEN** a standing facilitator requests a team's full topic list
- **THEN** the response includes a top-level `teamName` matching the target team's display name

#### Scenario: An active topic's entry includes its first-session description
- **WHEN** a standing facilitator requests a team's full topic list, and one of its active topics has a non-null description
- **THEN** the corresponding entry in the `active` array includes `firstSessionDescription` matching that topic's stored description

#### Scenario: An archived topic's entry includes who archived it and when
- **WHEN** a standing facilitator requests a team's full topic list, and that team has an archived topic
- **THEN** the corresponding entry in the `archived` array includes `archivedAt` matching the time it was archived
- **AND** includes `archivedBy` with the archiving user's ID and display name

#### Scenario: An archived topic that was previously restored and re-archived includes its most recent restore provenance
- **WHEN** a standing facilitator requests a team's full topic list, and that team has an archived topic that was restored at some point before its current archive
- **THEN** the corresponding entry in the `archived` array includes `restoredAt` and `restoredBy` reflecting that most recent restore event

#### Scenario: An archived topic that has never been restored has null restore provenance
- **WHEN** a standing facilitator requests a team's full topic list, and that team has an archived topic that has never been restored
- **THEN** the corresponding entry's `restoredAt` and `restoredBy` are both `null`

#### Scenario: An annotated active topic returns its annotation and provenance
- **WHEN** a standing facilitator requests a team's full topic list, and an active topic was annotated `"X"` by facilitator F
- **THEN** that `active` entry includes `teamAnnotation: "X"`, `annotationUpdatedBy` with F's ID and display name, and a non-null `annotationUpdatedAt`

#### Scenario: An unannotated topic returns null annotation fields
- **WHEN** a standing facilitator requests a team's full topic list, and an active topic has never been annotated
- **THEN** that entry's `teamAnnotation`, `annotationUpdatedAt`, and `annotationUpdatedBy` are all `null`

#### Scenario: An archived topic returns its annotation
- **WHEN** a standing facilitator requests a team's full topic list, and an archived topic carries annotation `"X"`
- **THEN** that `archived` entry includes `teamAnnotation: "X"`

#### Scenario: The edit flag distinguishes facilitators from administrators
- **WHEN** a standing facilitator requests a team's full topic list
- **THEN** `canEditAnnotations` is `true`
- **AND WHEN** an `application_admin` requests the same list
- **THEN** `canEditAnnotations` is `false`

#### Scenario: An administrator can read annotations and provenance
- **WHEN** an `application_admin` requests a team's full topic list, and an active topic was annotated `"X"` by facilitator F
- **THEN** that `active` entry includes `teamAnnotation: "X"` and `annotationUpdatedBy` with F's ID and display name

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

### Requirement: Topic read endpoints report why a team's topics are locked

TOPIC-001 (`GET /api/v1/teams/:teamId/topics`) and TOPIC-002 (`GET /api/v1/teams/:teamId/topics/all`) SHALL include `lockReason: "first_session" | "canonical_defaults" | null` beside `isCustomizationLocked` on every `200`. Both fields SHALL come from one shared server-side lock-state function used by both endpoints, so the two can never disagree. `null` SHALL mean unlocked.

#### Scenario: A real team with no completed session
- **WHEN** an authorized caller reads TOPIC-001 or TOPIC-002 for a non-template team with no completed session
- **THEN** the response has `isCustomizationLocked: true` and `lockReason: "first_session"`

#### Scenario: A real team with a completed session
- **WHEN** an authorized caller reads TOPIC-001 or TOPIC-002 for a non-template team with a completed session
- **THEN** the response has `isCustomizationLocked: false` and `lockReason: null`

#### Scenario: The template team
- **WHEN** a standing facilitator reads TOPIC-002 for `DEFAULT_TOPICS_TEAM_ID`
- **THEN** the response has `isCustomizationLocked: true` and `lockReason: "canonical_defaults"`
- **AND** TOPIC-001's handler obtains both fields by calling the shared lock-state function (asserted by a unit-level test on the handler, because TOPIC-001 admits no caller for the template over HTTP once the template has no members and no unexpired facilitator access)

### Requirement: The lock reason is a shared type

The `lockReason` type and the response shapes of TOPIC-001 and TOPIC-002 SHALL be declared in the shared types package used by both the backend and the frontend.

#### Scenario: Both endpoints use the shared response types
- **WHEN** the backend and frontend are type-checked
- **THEN** TOPIC-001 and TOPIC-002 handlers and the Topic Management screen use the shared response types that carry `lockReason`

### Requirement: The template team is permanently locked for customization, independent of session history

The shared lock-state function SHALL report the template team as locked with reason `canonical_defaults` without consulting session history. For every other team it SHALL delegate to the existing lock-check function unchanged. The existing lock-check function SHALL NOT reference the template team id, because the topic-write guard and the lock are deliberately independent.

#### Scenario: Template lock does not depend on sessions
- **GIVEN** the existing lock-check function would report the template unlocked (a test substitution)
- **WHEN** the lock-state function is called for the template
- **THEN** it returns locked with reason `canonical_defaults`

#### Scenario: The lock-check function stays template-agnostic
- **WHEN** the source of the existing lock-check function is inspected by an automated test
- **THEN** it does not reference `DEFAULT_TOPICS_TEAM_ID` or the template id literal
