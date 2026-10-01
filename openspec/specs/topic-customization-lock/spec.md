# topic-customization-lock

## Purpose

Defines the server-side rule that a team's topic configuration cannot be customized until that team has completed its first session, the single reusable function that computes this lock state, and the read-side/write-side surfaces that must consult it. This spec covers: the shared, uncached lock-check function; the `isCustomizationLocked` flag on the active-topics read endpoint; the check-ordering and status-code contract for topic-write endpoints (403 identity/role, then 409 lock, with a timing floor closing the resulting enumeration side-channel); the standard error envelope used for lock rejections; the audit trail for denied lock-bypass attempts; and `GET /api/v1/teams/:teamId/topics/all`'s own authorization model and response contract (team name, per-topic description, archived-topic provenance, per-topic team annotation and its provenance, and the `canEditAnnotations` flag), since that endpoint is this capability's other consumer of the lock flag and the standing facilitator model.

This spec does NOT cover: the specific fields or business rules of any individual topic-write endpoint (see `add-custom-topic` for `POST /api/v1/teams/:teamId/topics`, `remove-topic` for `DELETE /api/v1/teams/:teamId/topics/:topicId`, and `topic-annotation` for `PUT /api/v1/teams/:teamId/topics/:topicId/annotation`), or the standing, org-wide facilitator authorization model itself (defined by the `evaluateStandingFacilitatorAccess` helper and referenced here only as the identity/role check that runs before the lock). The Topic Management screen's UI behavior built against `GET /api/v1/teams/:teamId/topics/all` is covered by `topic-management-screen`, not here.

**Implementation note — shared functions:** The lock-check function is `hasCompletedFirstSession(teamId)` in `packages/backend/src/auth/topic-lock-helper.ts`. It is called by both `GET /api/v1/teams/:teamId/topics` (`packages/backend/src/routes/content.ts`) and `POST /api/v1/teams/:teamId/topics` (`packages/backend/src/routes/topics.ts`). No other code path independently queries `sessions.status = 'complete'` to answer this question.

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

`GET /api/v1/teams/:teamId/topics` SHALL include an `isCustomizationLocked` boolean field in its response body, computed via the shared lock-check function. This field SHALL be present on every successful response from this endpoint, regardless of the requesting user's role.

#### Scenario: Locked team's topic list response includes the lock flag
- **WHEN** an authorized caller requests the active topics for a team with zero completed sessions
- **THEN** the response includes `isCustomizationLocked: true` alongside the topic list

#### Scenario: Unlocked team's topic list response includes the lock flag
- **WHEN** an authorized caller requests the active topics for a team with at least one completed session
- **THEN** the response includes `isCustomizationLocked: false` alongside the topic list

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

`GET /api/v1/teams/:teamId/topics/all` SHALL authorize requests using the same standing, org-wide facilitator model as `POST /api/v1/teams/:teamId/topics`, `DELETE /api/v1/teams/:teamId/topics/:topicId`, and every other topic-write endpoint this capability gates: `global_role = 'facilitator'` AND the caller is not an active member of the target team, OR `global_role = 'application_admin'`. (The non-member facilitator rule is shared by every topic-write endpoint; the `application_admin` arm is shared with `DELETE`, restore, and reorder (TOPIC-004/005/006) only. `POST /api/v1/teams/:teamId/topics` (TOPIC-003) and `PUT /api/v1/teams/:teamId/topics/:topicId/annotation` (TOPIC-007, BRD FR-8.7) reject administrators with `403`; this read endpoint still admits them, and returns `canEditAnnotations: false`.) This endpoint SHALL NOT require that the caller currently hold, or have ever held, an active session for the target team. No completed-session relationship, and no prior facilitation history with the specific team, is required.

This endpoint SHALL apply the same constant minimum response-time floor (`applyTimingFloor`) at every early-return from this authorization check (`403 Forbidden`, on either rejection reason) as every other endpoint this capability's timing-floor requirement already covers, so that response latency does not distinguish "never going to be authorized" from "authorized" for a caller probing this endpoint.

#### Scenario: A standing facilitator with no session history for the team can list its topics
- **WHEN** a facilitator who is not an active member of a team, and who has never run any session for that team, requests that team's full topic list (active and archived)
- **THEN** the response is `200 OK` with the team's active and archived topics

#### Scenario: An application admin can list any team's topics
- **WHEN** an authenticated user with `global_role = 'application_admin'` requests a team's full topic list
- **THEN** the response is `200 OK` with the team's active and archived topics

#### Scenario: A caller who is neither a standing facilitator nor an admin is rejected
- **WHEN** a caller who does not have `global_role = 'facilitator'` (and is not an `application_admin`), or who is an active member of the target team, requests that team's full topic list
- **THEN** the response is `403 Forbidden`

#### Scenario: A facilitator who is an active member of the team is rejected
- **WHEN** a facilitator who is an active member of the target team requests that team's full topic list
- **THEN** the response is `403 Forbidden`, even though the caller holds `global_role = 'facilitator'`

#### Scenario: A 403 rejection is not detectably faster than a 200 success
- **WHEN** a caller who fails this endpoint's authorization check submits a request, and a separately-measured authorized caller's request against the same endpoint is also submitted
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

**Implementation note — `defaultTopicsNotActive`:** The response also includes a top-level `defaultTopicsNotActive: Array<{ topicId, name, isArchived }>`, listing the team's canonical default topics that are not currently in the `active` list. This field was part of the originally-drafted TOPIC-002 contract and is correctly computed by this endpoint's query. It remains unread by this endpoint's current consumers (`topic-management-screen`'s active and archived lists are both driven by `active[]`/`archived[]` directly); it is documented here only so its presence in the response shape is not mistaken for an unspecified or accidental field.

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
