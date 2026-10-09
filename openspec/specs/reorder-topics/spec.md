# reorder-topics

## Purpose

Defines `PUT /api/v1/teams/:teamId/topics/order` (TOPIC-006). The endpoint replaces the display order of a team's active topics with a facilitator-supplied order. This spec covers authorization (the standing, org-wide facilitator-or-admin model shared with TOPIC-004/005; TOPIC-002 shares the facilitator side but adds a no-manager rule to its admin side, #232), the fixed check cascade, the full-list set-equality check and its stale-save outcome, dense 1-based atomic renumbering, no-op handling, concurrency posture, audit posture, the open-session hint in the response and who may receive it, and the guarantee that reorder never modifies an existing session's topic sequence.

This spec does NOT cover the reorder controls on the Topic Management screen (see `topic-management-screen`), or the partial-unique-index fix for archived-row `display_order` collisions (see `remove-topic`), which this endpoint depends on.

## Requirements

### Requirement: A standing facilitator or an application administrator can reorder an unlocked team's active topics

`PUT /api/v1/teams/:teamId/topics/order` SHALL accept a body `{ orderedTopicIds: string[] }` and SHALL allow an authenticated user with `global_role = 'facilitator'` who is not an active member of the target team, OR `global_role = 'application_admin'`, to replace the team's active-topic order with the submitted order, provided the team's customization lock (per `topic-customization-lock`) is not active. On a successful save that changes the order, the team's active topics SHALL have `display_order` exactly `1..N` (N = active topic count), assigned in the submitted order, and the response SHALL be `200 OK` with `{ topics: [{ topicId, name, displayOrder }], openSessionCreatedAt }`, with `topics` in the new order.

#### Scenario: A valid full ordering is persisted densely and 1-based
- **WHEN** a standing facilitator who is not a member of the team submits `orderedTopicIds` equal to the team's current active topic IDs in a different order, for an unlocked team
- **THEN** the response is `200 OK`
- **AND** the team's active topics have `display_order` values exactly `1..N` in the submitted order
- **AND** the response's `topics` array lists them in that order with matching `displayOrder` values

#### Scenario: The read endpoints reflect the saved order
- **WHEN** a reorder succeeds
- **THEN** a subsequent `GET /api/v1/teams/:teamId/topics` and `GET /api/v1/teams/:teamId/topics/all` both return the team's active topics in the submitted order

#### Scenario: Reorder closes gaps left by earlier archives
- **WHEN** a team's active topics currently hold `display_order` values `1, 2, 4, 7` and a facilitator saves a different order of those four topics
- **THEN** after the save their `display_order` values are exactly `1, 2, 3, 4` in the submitted order

#### Scenario: An application administrator can reorder any team's topics
- **WHEN** a user with `global_role = 'application_admin'` submits a valid reorder for an unlocked team
- **THEN** the response is `200 OK`
- **AND** this succeeds regardless of whether the admin is also an active member of the target team

#### Scenario: Archived topics' display_order is untouched by reorder
- **WHEN** a team has archived topics and a facilitator saves a new active order
- **THEN** no archived topic's row is modified by the reorder

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

### Requirement: A well-formed list that does not equal the current active set is rejected as stale

Inside the per-team advisory lock (`pg_advisory_xact_lock(hashtext(teamId))`, the same lock taken by add, archive, and restore), the endpoint SHALL compare the set of submitted IDs with the set of the team's current active topic IDs. If the sets differ for any reason (a missing active ID, or an extra ID that is archived, belongs to another team, or does not exist), the request SHALL be rejected with `409 Conflict`, `error.code: "TOPIC_ORDER_STALE"`, and no topic row SHALL be modified. The response SHALL NOT distinguish among these causes: its body SHALL be identical for every cause and SHALL NOT include submitted IDs, missing IDs, or the current list. The comparison SHALL be made against the team-scoped active set read under the lock; submitted IDs SHALL NOT be looked up individually.

#### Scenario: A list missing an active topic is stale
- **WHEN** a facilitator submits a list that omits one of the team's active topic IDs
- **THEN** the response is `409 Conflict` with `error.code: "TOPIC_ORDER_STALE"`
- **AND** no `display_order` value changes

#### Scenario: A list including an archived, foreign, or unknown ID is stale, with no distinguishing detail
- **WHEN** a facilitator submits a list containing every active ID plus one ID that is archived on this team, belongs to another team, or does not exist
- **THEN** each response is `409 Conflict` with `error.code: "TOPIC_ORDER_STALE"` and the same `error.message`
- **AND** none of the responses is a `404`

#### Scenario: A topic added concurrently makes an in-flight save stale
- **WHEN** a facilitator loads the active list, another request adds a custom topic to the team, and the facilitator then saves an order built from the original list
- **THEN** the save is rejected with `409 TOPIC_ORDER_STALE`
- **AND** the newly added topic keeps its position

### Requirement: Renumbering is atomic, and no partial order is ever persisted

The reorder SHALL write all new `display_order` values in a single transaction. The write SHALL NOT fail partway on the active-order uniqueness index when positions are swapped (for example, via a two-phase write that moves the active rows to a non-colliding scratch range and then assigns final values). Each write phase SHALL affect exactly N rows (N = active topic count); any other count SHALL roll the transaction back and fail the request. If any statement in the transaction fails, the transaction SHALL roll back and every topic's `display_order` SHALL be left at its pre-request value.

#### Scenario: Swapping two adjacent topics succeeds
- **WHEN** a facilitator saves an order that swaps the topics at positions 2 and 3 and changes nothing else
- **THEN** the response is `200 OK` and the two topics hold positions 3 and 2 respectively

#### Scenario: Reversing the full list succeeds
- **WHEN** a facilitator saves the exact reverse of the current active order for a team with 11 active topics
- **THEN** the response is `200 OK` and the topics hold positions `1..11` in reversed order

#### Scenario: A failure mid-transaction leaves the prior order intact
- **WHEN** the reorder transaction fails after its first write statement
- **THEN** every topic's `display_order` equals its value before the request

### Requirement: A save that does not change the order is a no-op

If the submitted list equals the team's current active order, the endpoint SHALL return `200 OK` with the same response shape as a changed save, `{ topics, openSessionCreatedAt }`, with `topics` in the current order and each `displayOrder` equal to its stored value (which may have gaps; a no-op SHALL NOT renumber), and SHALL write no `topic.reordered` audit row.

#### Scenario: Submitting the current order writes nothing
- **WHEN** a facilitator submits the team's active topic IDs in their current order
- **THEN** the response is `200 OK` with `{ topics, openSessionCreatedAt }`, `topics` in the current order
- **AND** no `audit_log` row with `operation = 'topic.reordered'` is written

### Requirement: Concurrent reorders of the same active set follow last-writer-wins

Two reorders that each submit the same active set SHALL both pass the set-equality check. They SHALL be serialized by the per-team advisory lock, and the later commit SHALL determine the persisted order. No version token is required.

#### Scenario: The second of two concurrent pure reorders determines the order
- **WHEN** two facilitators each submit a different ordering of the same active set, and the requests are serialized so that B commits after A
- **THEN** both responses are `200 OK`
- **AND** the persisted order equals B's submitted order
- **AND** two `topic.reordered` audit rows exist, and B's `previous_order` equals A's `new_order`

### Requirement: A successful reorder is audited in the same transaction, and lock denials use the shared denial audit

A reorder that changes the order SHALL write an `audit_log` row with `operation = 'topic.reordered'` inside the reorder transaction. The row SHALL carry `actor_user_id`, `actor_global_role`, `actor_ip`, `team_id`, and `metadata: { previous_order: uuid[], new_order: uuid[] }`, with IDs in lowercase canonical form. The metadata SHALL contain topic IDs only and no topic names. A request rejected under the customization lock SHALL write the shared `topic.write_denied_locked` row with `metadata.attempted_operation = "topic.reordered"` and no order payload. A request rejected at the template-team step SHALL write the shared `topic.write_denied_template` row (see `default-topic-provisioning`, Requirement: The template team is never written through a team-scoped topic-write endpoint) with `metadata.attempted_operation = "topic.reordered"` and no order payload. Apart from that row, no audit row SHALL be written for a `403`, `404`, `422`, or `409 TOPIC_ORDER_STALE` rejection, or for a no-op.

#### Scenario: A successful reorder records before and after orders
- **WHEN** a facilitator saves a changed order
- **THEN** an `audit_log` row with `operation = 'topic.reordered'` exists for the team
- **AND** its `metadata.previous_order` equals the prior active order's IDs and `metadata.new_order` equals the submitted IDs
- **AND** its metadata contains no topic names

#### Scenario: A lock-denied reorder writes the shared denial audit row
- **WHEN** a standing facilitator submits a reorder against a locked team
- **THEN** an `audit_log` row with `operation = 'topic.write_denied_locked'` and `metadata.attempted_operation = "topic.reordered"` is written before the `409` response is sent
- **AND** no `topic.reordered` row is written

#### Scenario: A stale save writes no audit row
- **WHEN** a reorder is rejected with `409 TOPIC_ORDER_STALE`
- **THEN** no `topic.reordered` or `topic.write_denied_locked` row is written for that request

#### Scenario: A template-team reorder writes only the template denial audit row
- **WHEN** an authorized caller submits a reorder against `teamId = DEFAULT_TOPICS_TEAM_ID`
- **THEN** exactly one `audit_log` row with `operation = 'topic.write_denied_template'` and `metadata.attempted_operation = "topic.reordered"` is written before the `404` response is sent
- **AND** no `topic.reordered` or `topic.write_denied_locked` row is written

### Requirement: Reorder never modifies an existing session's topic sequence

The reorder SHALL write only to `topics`. It SHALL NOT insert, update, or delete any `session_topics` row, and it SHALL NOT be blocked because the team has a session in any status. No endpoint SHALL accept a topic order scoped to a single session. A session's topic sequence is fixed at room open (see `session-topic-lifecycle`). A reorder saved while the team's session is still in `draft` is used by that session when its room opens. A reorder saved after room open is used by the team's next session.

#### Scenario: Reorder does not affect a session whose room is open
- **WHEN** an unlocked team has a session in `lobby` or `active` status and the facilitator saves a new order
- **THEN** the save succeeds
- **AND** that session's `session_topics.display_order` values are unchanged

#### Scenario: Reorder does not rewrite history
- **WHEN** a team has completed sessions and a new order is saved
- **THEN** no `session_topics` row for any completed session is modified

#### Scenario: The reorder transaction writes no session_topics row
- **WHEN** any reorder succeeds
- **THEN** the number and content of `session_topics` rows is identical before and after the request

#### Scenario: A reorder during the draft is used when the room opens
- **WHEN** an unlocked team's session is in `draft`, the facilitator saves a new order, and then opens the room
- **THEN** that session's `session_topics` rows follow the new order, numbered 1..N

#### Scenario: A reorder after room open reaches the next session
- **WHEN** a facilitator saves a new order while the team's session is in `lobby`, and the team's next session later reaches room open
- **THEN** the next session's `session_topics` rows follow the new order

### Requirement: The reorder response indicates to a facilitator whether a created, not-yet-completed session keeps its original order

The `200` response SHALL include `openSessionCreatedAt: string | null`. The field name is kept for compatibility. Its value is the **room-open time** of the team's open session, not that session's creation time. For a caller with `global_role = 'facilitator'`, the value SHALL be the `room_opened_at` of the team's session in status `lobby`, `pre_session`, `active`, or `wrap_up` if one exists (the most recently opened one, should more than one ever exist), and `null` otherwise. For such a session whose `room_opened_at` is NULL (one whose room opened before `room_opened_at` existed), the value SHALL fall back to its `created_at`. For such a session that was created as a draft and opened on a later day, the hint's "opened on {date}" then shows the creation date. This is an accepted, transitional mismatch that only affects sessions opened before this change shipped, and it is not a defect. For a caller with `global_role = 'application_admin'`, the value SHALL always be `null`, and the handler SHALL NOT read the team's sessions: application administrators are denied session content, and this field SHALL NOT become an unaudited way for them to learn a team's session state (see design.md Decision 7). A `draft` session SHALL NOT produce a value: a draft's room has not opened, its topic list is not yet snapshotted, and the reorder being saved will reach it. The value SHALL be read inside the reorder transaction. It is informational only and SHALL NOT change the outcome of the reorder.

#### Scenario: A team with a lobby session receives its room-open time
- **WHEN** a facilitator saves a new order for a team with a session in `lobby`
- **THEN** the response's `openSessionCreatedAt` equals that session's `room_opened_at`

#### Scenario: A draft opened on a later day reports the open time, not the draft time
- **WHEN** a draft created on September 29 is advanced to `lobby` on September 30, and the facilitator then saves a new order
- **THEN** the response's `openSessionCreatedAt` is the September 30 room-open timestamp

#### Scenario: A pre-existing open session without a room-open time falls back to creation time
- **WHEN** a facilitator saves a new order for a team whose `lobby` session has `room_opened_at` NULL
- **THEN** the response's `openSessionCreatedAt` equals that session's `created_at`

#### Scenario: A team whose only open session is a draft receives null
- **WHEN** a facilitator saves a new order for a team whose only non-terminal session is in `draft`
- **THEN** the response's `openSessionCreatedAt` is `null`

#### Scenario: A team with no open session receives null
- **WHEN** a facilitator saves a new order for a team whose sessions are all `complete` or `abandoned`
- **THEN** the response's `openSessionCreatedAt` is `null`

#### Scenario: An application administrator always receives null
- **WHEN** an `application_admin` saves a new order, or submits the current order unchanged, for a team with a session in `lobby`
- **THEN** the response is `200 OK` with `openSessionCreatedAt: null`
