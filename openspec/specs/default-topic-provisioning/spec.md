# default-topic-provisioning

## Purpose

Defines the mechanism that copies the canonical default topic set — the `topics` rows belonging to the sentinel `__default_topics__` system team (`team_id = '00000000-0000-0000-0000-000000000001'`) where `is_default = true` — into a newly created team's own `topics` rows at team-creation time (see `session-creation`'s `POST /api/v1/teams` requirement). The copy is a real, independent row per topic, not a reference, so a later edit to either the canonical defaults or a team's own topic configuration never retroactively affects the other. This capability owns only the copy mechanism; it has a hard runtime dependency on the sentinel team's `topics` rows being correct, but no dependency on how they became correct — that correctness is the responsibility of the seed data that populates the sentinel team, tracked separately. Whether a team's copied topic configuration is customizable ("locked" until the team's first session completes) is a derived state owned by topic-customization enforcement, not a column this capability writes.

## Requirements

### Requirement: Default topic set is copied into a newly created team's own topics rows

When a new team is created, the application SHALL copy the canonical default topic set — the `topics` rows belonging to the sentinel `__default_topics__` system team (`team_id = '00000000-0000-0000-0000-000000000001'`) where `is_default = true` — into new `topics` rows owned by the new team. Each copied row SHALL carry the new team's own `team_id`, its own generated `id`, and the source row's `name`, `prompt`, `vote_type`, `display_order`, `is_default`, and `first_session_description`, unmodified. This copy SHALL occur in the same database transaction as the team's creation. The copy SHALL be a real, independent row per topic — not a reference to the sentinel rows — so that a later edit to either the canonical defaults or the new team's own topic configuration never affects the other.

#### Scenario: New team receives its own copy of every default topic
- **WHEN** a new team is created
- **THEN** for every `topics` row where `team_id = '00000000-0000-0000-0000-000000000001'` and `is_default = true`, a corresponding new `topics` row is created with the new team's `team_id`, a new `id`, and the same `name`, `prompt`, `vote_type`, `display_order`, `is_default = true`, and `first_session_description`

#### Scenario: Copied topics preserve canonical ordering
- **WHEN** the default topic set is copied to a new team
- **THEN** the copied topics' `display_order` values match the source rows' `display_order` values, so the copied set renders in the same canonical order

#### Scenario: Editing a team's copied topics does not affect the canonical defaults or any other team
- **WHEN** a team's copied topic configuration is later modified (e.g., a topic is removed or annotated, once customization is unlocked)
- **THEN** the sentinel `__default_topics__` team's source rows are unchanged
- **AND** no other team's copied topic configuration is affected

#### Scenario: A later change to the canonical defaults does not retroactively affect an already-created team
- **WHEN** the sentinel `__default_topics__` team's source rows change in a future application version
- **THEN** teams that were created before that change retain the topic configuration they were originally assigned

#### Scenario: Topic-copy failure prevents team creation from completing
- **WHEN** the default-topic copy step fails during team creation
- **THEN** the team-creation transaction rolls back
- **AND** no team record exists without a topic configuration

---

### Requirement: A new team's topic configuration carries no separate "locked" column

The topic-provisioning mechanism SHALL NOT write or maintain a dedicated "locked" flag on the `topics` table or elsewhere. Whether a team's topic configuration is customizable is determined entirely by whether the team has a completed session on record — an evaluation owned by topic-customization enforcement, not by this provisioning step.

#### Scenario: No lock column is written at provisioning time
- **WHEN** a new team's default topics are provisioned
- **THEN** no column or record anywhere in the schema is set to represent "this team's topics are locked" as a stored value
- **AND** the team's copied topics are otherwise complete and correctly ordered

### Requirement: The template team is never written through a team-scoped topic-write endpoint

The sentinel `__default_topics__` template team (`team_id = DEFAULT_TOPICS_TEAM_ID = '00000000-0000-0000-0000-000000000001'`) SHALL NOT be modified through any team-scoped topic-write endpoint. This is a structural property of the template. It SHALL NOT depend on the template's customization-lock state, on whether any session exists for the template, or on what `team_memberships` contains for it.

**Scope.** The rule covers every endpoint that creates, updates, archives, restores, reorders or annotates a `topics` row for a `:teamId` path parameter. Today these are TOPIC-003 (`POST /api/v1/teams/:teamId/topics`), TOPIC-004 (`DELETE /api/v1/teams/:teamId/topics/:topicId`), TOPIC-005 (`POST /api/v1/teams/:teamId/topics/:topicId/restore`), TOPIC-006 (`PUT /api/v1/teams/:teamId/topics/order`) and TOPIC-007 (`PUT /api/v1/teams/:teamId/topics/:topicId/annotation`). Any endpoint added later that writes `topics` for a `:teamId` SHALL fall under the same rule, wherever its path is. Read endpoints (TOPIC-001, TOPIC-002, and `GET /api/v1/teams/:teamId/topics/all`) are out of scope. They SHALL continue to serve the template's rows, as FR-8.6 requires.

**Position in the check order.** On each in-scope endpoint, the template check SHALL run after the non-canonical `teamId` rejection, after identity/role authorization, and after team existence. It SHALL run before the customization lock and before every endpoint-specific check. A caller who fails authorization SHALL still receive that endpoint's `403`. In particular, an `application_admin` calling TOPIC-007 against the template SHALL still receive `403` (FR-8.7). The customization lock SHALL NOT be evaluated for the template on these endpoints.

**Response (per-endpoint parity).** A rejected request SHALL receive the same response that **the same endpoint** returns for a canonical-format `teamId` that matches no team, for a caller with the same role:
- the same status (`404 Not Found`);
- the same body, field for field, except `correlationId`: `{ error: { category: "not_found", code: "TEAM_NOT_FOUND", message: "Team not found.", correlationId } }`;
- the same set of response header names, each with the same value, except `date`;
- `applyTimingFloor` applied before the response is sent.

The guard SHALL NOT add, remove or change any header. If an endpoint sends `Cache-Control: no-store` on its missing-team `404` (today TOPIC-006 and TOPIC-007), the template `404` carries it as well. If it does not (today TOPIC-003, TOPIC-004 and TOPIC-005), the template `404` does not either. The response SHALL NOT include any field, header or message that tells the caller the team is the template.

**Accepted difference from a missing team.** One observable difference is accepted on purpose: if the audit insert takes longer than the timing floor, the template response can arrive later than the missing-team response. No other difference is permitted. (A former accepted difference, `403 FACILITATOR_IS_TEAM_MEMBER` for a facilitator holding an active template membership, is retired: no active `team_memberships` row on the template can exist; see "The template team is never a session, membership or join-link subject".)

**Audit.** Each rejected request SHALL attempt to write exactly one `audit_log` row before the response is sent, inside the timing floor. The row SHALL have:
- `operation = 'topic.write_denied_template'`
- `actor_user_id`, `actor_global_role`, `actor_ip`
- `team_id = DEFAULT_TOPICS_TEAM_ID`
- `metadata` containing only `endpoint` and `attempted_operation`

`metadata.endpoint` SHALL be the method-plus-path-template string already used by `topic.write_denied_locked` for that endpoint (for example `"DELETE /api/v1/teams/:teamId/topics/:topicId"`), never a TOPIC-00x label. `metadata.attempted_operation` SHALL be:
- `topic.custom_added` for TOPIC-003
- `topic.archived` for TOPIC-004
- `topic.restored` for TOPIC-005
- `topic.reordered` for TOPIC-006
- `topic.annotation_updated` for TOPIC-007

The metadata SHALL NOT contain a `topicId`, the request body, a topic name, an order payload, or annotation text.

A structured audit event named `topic.write_denied_template` SHALL be emitted through `emitAuditEvent` for every rejected request, whether or not the insert succeeded. It SHALL carry the row's fields (actor user id, actor global role, actor IP, team id, endpoint, attempted operation), plus the response's `correlationId` and whether the row was written. The `correlationId` SHALL NOT be added to the row's `metadata`. The row is intended for incident review. It SHALL NOT be shown to facilitators, and it SHALL NOT trigger an alert. No `topic.write_denied_locked` row and no success-operation row (`topic.custom_added`, `topic.archived`, `topic.restored`, `topic.reordered`, `topic.annotation_updated`) SHALL be written for a rejected request. No `topic.write_denied_template` row SHALL be written for a request that is rejected before the template step (a non-canonical `teamId`, a `403`, or a missing team).

**Audit failure.** If the `topic.write_denied_template` insert throws, the handler SHALL catch the error, log it at error level with the stable marker field `audit_write_failed: true`, the operation name, the `correlationId`, and the database error's code and message only (not the raw error object, its `detail` or its parameters, and never the request body), and still send the `404` described under **Response**. A failed audit write SHALL NOT produce a `500` on this path and SHALL NOT change the status, body or headers of the response. This differs on purpose from the lock-denial path, which this requirement does not change.

**No write.** A rejected request SHALL leave every `topics` row of the template unchanged.

**Structural coverage.** An automated test SHALL enumerate the application's registered routes from the Fastify instance itself, never from a hand-written list of known routes. It SHALL select every route whose methods include `POST`, `PUT`, `PATCH`, `DELETE` or a wildcard, and whose path matches `/api/teams/:<any parameter name>/topics` or `/api/v<N>/teams/:<any parameter name>/topics` (versioned or unversioned, matching the existing unversioned join-links convention) followed by `/` or the end of the path, together with an explicit extra list of in-scope routes outside that prefix. The extra list is empty today. The author of any `topics`-writing route outside the prefix SHALL add it to the extra list in the same change. There SHALL be no exemption list. Excluding an in-scope route from the test requires a change to this requirement. For each selected route, the test SHALL send one request built deterministically:
- the caller is a standing facilitator with no team membership;
- the first path parameter is `DEFAULT_TOPICS_TEAM_ID`, whatever it is named;
- every other path parameter is the fixed canonical UUID `ffffffff-ffff-4fff-bfff-ffffffffffff`;
- the body is `{}`.

The test SHALL assert `404` with `error.code: "TEAM_NOT_FOUND"` and exactly one `topic.write_denied_template` row for that request. Its result SHALL NOT depend on the template's customization-lock state. It SHALL assert after every request that every template `topics` row, in every status, is unchanged from a snapshot taken before the first request, and SHALL restore the template in a `finally` by updating the snapshot's rows by id and deleting only added `is_default = false` rows that are not in the snapshot (so it never removes another test file's fixture rows).

This test is how the "SHALL NOT be relaxed" clause below is enforced.

**FR-8.1 boundary.** The team-scoped topic-write endpoints are not the Application Administrator maintenance path that FR-8.1 refers to. Until a dedicated maintenance path exists, the default set is maintained through database migrations only. If that path is built, it SHALL be a separate endpoint with its own authorization and audit. This guard SHALL NOT be relaxed to serve it.

#### Scenario: Each topic-write endpoint answers the template exactly as it answers a missing team (tested in both lock states)
- **GIVEN** one of TOPIC-003 to TOPIC-007, and an authorized caller for that endpoint (a standing facilitator with no membership for all five, or an `application_admin` for TOPIC-003 to TOPIC-006)
- **WHEN** the caller sends the same request once with `teamId = DEFAULT_TOPICS_TEAM_ID` and once with a canonical-format `teamId` that matches no team, first with the shared lock-check function reporting the template locked and again with it reporting the template unlocked (a test substitution, because no template `sessions` row can be created)
- **THEN** in every case the two responses have the same status (`404`), the same body except `correlationId` (`error.category: "not_found"`, `error.code: "TEAM_NOT_FOUND"`, `error.message: "Team not found."`), and the same header names and values except `date`
- **AND** exactly one `topic.write_denied_template` row is written for the template request, with `metadata` equal to `{ endpoint: <that endpoint's method-plus-path string>, attempted_operation: <that endpoint's mapped operation> }` and no other keys
- **AND** no `topic.write_denied_locked` row and no success-operation row is written for either request
- **AND** no audit row of any kind is written for the missing-team request

#### Scenario: A failed audit insert does not change the response
- **GIVEN** the `topic.write_denied_template` insert throws
- **WHEN** an authorized caller sends any in-scope request with `teamId = DEFAULT_TOPICS_TEAM_ID`
- **THEN** the response is the same `404 TEAM_NOT_FOUND` response, with the same headers, that the endpoint sends for a missing team, and not `500`
- **AND** the failure is logged at error level with `audit_write_failed: true`, without the raw database error object
- **AND** the `topic.write_denied_template` structured event is still emitted with the actor, actor role, actor IP, endpoint, attempted operation and the response's `correlationId`
- **AND** the customization lock is not evaluated

#### Scenario: Authorization failures against the template still return 403
- **WHEN** a caller whose `global_role` is neither `facilitator` nor `application_admin` sends a request to any in-scope endpoint for the template
- **THEN** the response is `403 Forbidden` with `error.code: "NOT_A_FACILITATOR"`
- **AND** no `topic.write_denied_template` row is written

#### Scenario: An administrator annotating the template receives 403
- **WHEN** an `application_admin` sends `PUT /api/v1/teams/:teamId/topics/:topicId/annotation` with `teamId = DEFAULT_TOPICS_TEAM_ID`
- **THEN** the response is `403 Forbidden`, as for any team (FR-8.7)
- **AND** no `topic.write_denied_template` row is written

#### Scenario: No membership rows on the template
- **GIVEN** `team_memberships` has no rows for `DEFAULT_TOPICS_TEAM_ID`
- **WHEN** a standing facilitator sends any in-scope request for the template
- **THEN** the response is `404 TEAM_NOT_FOUND`

#### Scenario: Another user holds a membership on the template
- **WHEN** any code path attempts to give another user an active `team_memberships` row on `DEFAULT_TOPICS_TEAM_ID` (an insert, or setting `removed_at = NULL`)
- **THEN** the database refuses the write, so this state cannot arise
- **AND** a standing facilitator with no membership who sends any in-scope request for the template receives `404 TEAM_NOT_FOUND`

#### Scenario: The caller holds a membership on the template
- **WHEN** any code path attempts to give the caller an active `team_memberships` row on `DEFAULT_TOPICS_TEAM_ID`
- **THEN** the database refuses the write, so this state cannot arise
- **AND** no caller can receive `403 FACILITATOR_IS_TEAM_MEMBER` from a topic-write endpoint for the template (former accepted difference #1, now retired)

#### Scenario: A non-canonical spelling of the template id follows the existing route-boundary rejection
- **WHEN** a caller sends a request whose `teamId` is the template id without hyphens, or wrapped in braces
- **THEN** the request is handled by the existing `rejectNonCanonicalTeamId` behaviour, unchanged by this requirement, before any authorization or template check runs
- **AND** no `topic.write_denied_template` row is written

#### Scenario: Reads of the template are unaffected
- **WHEN** a caller authorized for TOPIC-002 reads `GET /api/v1/teams/<DEFAULT_TOPICS_TEAM_ID>/topics`
- **THEN** the response is `200` with the same rows in the same order as before this change
- **AND WHEN** an authorized facilitator reads `GET /api/v1/teams/<DEFAULT_TOPICS_TEAM_ID>/topics/all`
- **THEN** the response is `200`, `canAddTopics` is `true` (it depends on role only), `isCustomizationLocked` is `true` and `lockReason` is `"canonical_defaults"`, whatever the template's session history
- **AND** the Topic Management screen therefore offers no write control on the template

#### Scenario: Default topics on a real team remain archivable and restorable
- **GIVEN** an unlocked non-template team with an active `is_default = true` topic
- **WHEN** an authorized facilitator archives that topic and then restores it
- **THEN** both requests return `200`
- **AND** one `topic.archived` row and one `topic.restored` row are written, and no `topic.write_denied_template` row is written

#### Scenario: Team creation copies the pre-attempt baseline
- **GIVEN** a snapshot of every template topic row in every status, keyed by `id`, is taken
- **WHEN** each of TOPIC-003 to TOPIC-007 is sent against the template with a request that would succeed on an unlocked team, each is rejected with `404`, and then `POST /api/v1/teams` is called
- **THEN** the team-creation response is `201`
- **AND** the template's own topic rows still equal the snapshot: the same ids, no added rows, and the same `name`, `prompt`, `vote_type`, `display_order`, `status`, archive fields and annotation fields
- **AND** the new team's topics, in every status, equal the snapshot's `is_default = true` rows on `name`, `prompt`, `vote_type`, `display_order` and `status`

#### Scenario: A newly registered topic-write route is covered
- **WHEN** the application registers a route with a `POST`, `PUT`, `PATCH`, `DELETE` or wildcard method whose path matches `/api/teams/:<any parameter name>/topics` or `/api/v<N>/teams/:<any parameter name>/topics` followed by `/` or the end of the path, or a route on the structural test's extra list
- **THEN** the structural route test sends that route the deterministic request described under **Structural coverage**
- **AND** the test fails unless the response is `404` with `error.code: "TEAM_NOT_FOUND"` and exactly one `topic.write_denied_template` row is written for that request, whatever the template's lock state

### Requirement: The template team is never a session, membership or join-link subject

The system SHALL NOT create any `sessions`, `team_memberships` or `join_links` row whose `team_id` is `DEFAULT_TOPICS_TEAM_ID`, and SHALL NOT return an existing such row to an active or usable state. The rule is structural. It SHALL NOT depend on the template's lock state, its session history or its membership rows. Topic reads (TOPIC-001, TOPIC-002) and the copy of the template into new teams (`POST /api/v1/teams`) are unaffected.

#### Scenario: A draft session cannot be created for the template
- **WHEN** a standing facilitator with no memberships sends `POST /api/v1/teams/<DEFAULT_TOPICS_TEAM_ID>/sessions/draft`
- **THEN** no `sessions` row and no `join_links` row is created for the template

#### Scenario: No membership can be created for the template
- **WHEN** an `application_admin` sends TEAM-006 for the template, or a caller redeems a join link that resolves to the template through `GET /api/join/:token` or through the join inside `GET /auth/callback`
- **THEN** no `team_memberships` row for the template is created or reactivated

#### Scenario: Team creation still copies the template
- **WHEN** a facilitator creates a new team through `POST /api/v1/teams`
- **THEN** the new team receives the template's default topics exactly as before this change

### Requirement: No configuration enables the template team as a session or membership subject

The template guard module and the eligible-teams query SHALL read no configuration value, environment variable or flag. No configuration value, environment variable, feature flag, role or administrator override SHALL enable use of the template team as the subject of a session, a membership or a join link. A facilitator practice or sandbox capability, if one is ever built, SHALL be a separately designed feature that never writes to the template or to a real team's history.

#### Scenario: An administrator has no override
- **WHEN** an `application_admin` sends any session, membership or join-link request for the template
- **THEN** the request is refused exactly as it is for any other caller who passes that endpoint's authorization
- **AND** where an administrator does not pass the endpoint's authorization (today only `POST /api/v1/teams/:teamId/sessions/draft`, which requires the `facilitator` global role), the administrator receives that endpoint's `403` and no `team.template_access_denied` row

#### Scenario: The guard reads no configuration
- **WHEN** an automated source-inspection test reads the template guard module and the eligible-teams query
- **THEN** neither imports the configuration module nor reads `process.env` or any flag, so no configuration value can change the template decision

### Requirement: FR-1.7 does not apply to the template team

FR-1.7 requires that a team with no completed session appear in the facilitator's list of available teams. The template team is not a team for FR-1.7 purposes. It SHALL NOT appear in any facilitator-facing list of teams, and its absence SHALL NOT be treated as an FR-1.7 violation.

#### Scenario: The template is absent from the picker although it has no completed session
- **WHEN** a facilitator with zero memberships requests `GET /api/v1/teams/eligible-for-session`
- **THEN** `eligibleTeams` does not contain `DEFAULT_TOPICS_TEAM_ID`
- **AND** every other non-deactivated team appears as before

### Requirement: The database refuses template rows in sessions, memberships and join links

`sessions`, `team_memberships` and `join_links` SHALL each carry a check constraint that refuses `team_id = DEFAULT_TOPICS_TEAM_ID` on every insert and update. Where a table holds no template rows, the constraint SHALL be fully validated. Where historical template rows exist, the constraint SHALL still be enforced for every new insert and update while leaving those rows in place.

#### Scenario: A fresh database validates all three constraints
- **WHEN** migrations run on an empty database (CI or a new installation)
- **THEN** all three constraints exist and are validated
- **AND** a direct `INSERT` of a template row into any of the three tables fails with SQLSTATE `23514`

#### Scenario: A database with historical template rows still enforces the constraint
- **GIVEN** a database with a completed template session and its votes
- **WHEN** migrations run
- **THEN** the migration succeeds, the completed session and its votes are unchanged except for the session's `facilitator_access_expires_at` clamp described below, and the `sessions` constraint exists but is not validated
- **AND** any new `INSERT` or `UPDATE` that sets a template `team_id` on `sessions` fails with SQLSTATE `23514`

#### Scenario: A bypassed guard fails closed and visibly
- **WHEN** a request reaches a write of a template row without being refused by the application guard
- **THEN** the database refuses the write, nothing is persisted, and the request fails with `500`
- **AND** the failure is logged with the marker `template_constraint_violation`, and the `500` is not converted into a `404`
- **AND** the `500` body does not contain the constraint name or any text ending in `_not_template_team`

#### Scenario: Other server errors keep their existing response
- **WHEN** a request fails with any error that is not a violation of a `_not_template_team` constraint
- **THEN** its response is the same as before this change

### Requirement: Existing template rows are neutralised once and preserved where terminal

Before adding the constraints, the migration SHALL revoke open template join links, soft-remove active template memberships, abandon template sessions in `draft`, `lobby`, `pre_session`, `active` or `wrap_up` (setting `abandoned_at`), and clamp each completed template session's `facilitator_access_expires_at` to no later than the migration time. Terminal sessions and votes are otherwise unchanged. Without template rows it SHALL change nothing.

#### Scenario: Open template rows are closed and terminal history is kept
- **GIVEN** a template join link that is not revoked, an active template membership, a template session in `lobby` and a completed template session with votes
- **WHEN** the migration runs
- **THEN** the link has `revoked_at` set, the membership has `removed_at` set, the `lobby` session is `abandoned` with `abandoned_at` set, and the completed session and its votes are unchanged apart from `facilitator_access_expires_at`

#### Scenario: A recently completed template session no longer grants its facilitator access
- **GIVEN** a completed template session whose `facilitator_access_expires_at` is tomorrow
- **WHEN** the migration runs
- **THEN** that session's `facilitator_access_expires_at` is no later than the migration time
- **AND** its facilitator receives no template data from `GET /api/v1/teams/<DEFAULT_TOPICS_TEAM_ID>/trends`, `/action-items`, `/sessions` or `/sessions/:sessionId`, each answering as for a missing team

#### Scenario: The migration is a no-op without template rows
- **GIVEN** no template rows exist in the three tables
- **WHEN** the migration runs
- **THEN** no row in `join_links`, `team_memberships` or `sessions` changes
- **AND** no `team.template_cleanup` audit row is written

### Requirement: The template cleanup is serialised with the constraints and audited

The migration SHALL lock the three tables from before the cleanup until the constraints exist, failing fast on lock contention. For each table in which it changed rows, it SHALL write one `audit_log` row with `operation = 'team.template_cleanup'`, the seeded system user as actor (`actor_global_role = 'system'`), `team_id = DEFAULT_TOPICS_TEAM_ID`, and `metadata` listing each changed row's id and prior values.

#### Scenario: The cleanup is recorded with prior values
- **GIVEN** the template rows of "Open template rows are closed and terminal history is kept"
- **WHEN** the migration runs
- **THEN** one `team.template_cleanup` audit row exists per changed table, whose `metadata` lists the changed row ids with their prior `status`, `revoked_at`, `removed_at` or `facilitator_access_expires_at`

#### Scenario: A concurrent template write cannot slip between cleanup and constraint
- **WHEN** another connection tries to insert a template row while the migration holds its locks
- **THEN** that insert waits and is then refused with SQLSTATE `23514`

### Requirement: Every template refusal on a session, membership or join-link route is audited

Each request refused by the template guard SHALL emit the event `team.template_access_denied` and, subject to "Template denial rows need an actor and are bounded", attempt one `audit_log` row with that operation, the actor's user id, global role and IP, the template `team_id`, and `metadata` with only `endpoint` (method plus route pattern) and `surface` (`session`, `membership` or `join_link`). A failed write SHALL NOT change the response and SHALL be logged with `audit_write_failed: true`.

#### Scenario: A refused draft is audited
- **WHEN** a standing facilitator sends `POST /api/v1/teams/<DEFAULT_TOPICS_TEAM_ID>/sessions/draft`
- **THEN** exactly one `team.template_access_denied` row is written with `metadata` equal to `{ endpoint: "POST /api/v1/teams/:teamId/sessions/draft", surface: "session" }`

#### Scenario: A refused redemption is audited without the token
- **WHEN** an authenticated caller redeems a join link that resolves to the template
- **THEN** exactly one `team.template_access_denied` row is written with `surface: "join_link"`
- **AND** the row's `metadata` does not contain the token

### Requirement: Template denial rows need an actor and are bounded

A refusal with no authenticated user SHALL emit the event only. The actor's global role SHALL be read from `users` when the route has not loaded it, never a placeholder. At most one row SHALL be written per actor and endpoint in any 60-second window, claimed in Redis before the insert; later refusals emit the event with `audit_row_suppressed: true`. A claimed window whose row was not written SHALL be released. The write SHALL be bounded by the audit-write timeout.

#### Scenario: A logged-out refusal emits the event and writes no row
- **WHEN** a caller with no session follows a join link that resolves to the template
- **THEN** the `team.template_access_denied` event is emitted and no `audit_log` row is written

#### Scenario: Repeated refusals by one actor are bounded
- **GIVEN** an authenticated user has been refused by the template guard on one endpoint
- **WHEN** the same user is refused on the same endpoint again within 60 seconds
- **THEN** the response is unchanged, the event is emitted with `audit_row_suppressed: true`, and no further `audit_log` row is written
- **AND** a refusal on a different endpoint, or after the window, writes a row

#### Scenario: The dedupe window is claimed atomically in the dipstick Redis namespace
- **WHEN** an authenticated actor is refused by the template guard
- **THEN** the window is claimed with `SET NX PX 60000` on the key `dipstick:template-denial:<actorUserId>:<endpoint>` before the insert, so concurrent refusals cannot both write
- **AND** if Redis errors, the row is still written

#### Scenario: An actor with no users row writes no row
- **WHEN** the refused actor has no `users` row
- **THEN** no `audit_log` row is written (never a placeholder role) and the failure is logged with `audit_write_failed: true`

#### Scenario: A failed insert does not suppress the next row
- **GIVEN** the `team.template_access_denied` insert for an actor and endpoint fails or times out
- **WHEN** the same actor is refused on the same endpoint again within 60 seconds
- **THEN** that later refusal writes its row, because the claimed slot was released when the insert failed

#### Scenario: The denial row records the actor's real role
- **WHEN** a caller whose `global_role` is `engineer` (the global role of a participant) is refused on a session sub-route for the template
- **THEN** the row's `actor_global_role` is `engineer`

#### Scenario: An audit failure does not change the response
- **GIVEN** the `team.template_access_denied` insert throws
- **WHEN** any guarded request for the template is sent
- **THEN** the response is the same one the endpoint sends for a missing team
- **AND** the failure is logged at error level with `audit_write_failed: true`

#### Scenario: Requests refused before the guard write no template audit row
- **WHEN** a request for the template fails a check that runs before the guard on that route (authentication everywhere; the role or admin checks that precede it on `draft`, TEAM-005, TEAM-006 and the members listing)
- **THEN** that endpoint's `401` or `403` is returned and no `team.template_access_denied` row is written
- **AND** on the session sub-routes and on join-link creation, whose authorization depends on rows the template cannot have, every authenticated caller reaches the guard

### Requirement: The template check recognises every spelling of the template id

The template check SHALL treat a path value as the template whenever Postgres would read it as `DEFAULT_TOPICS_TEAM_ID`, including upper case, no hyphens and braces, so that a route which passes the raw value to SQL cannot be reached with another spelling. It SHALL compare the normalised value, not the string, and SHALL NOT add a non-canonical-id rejection to any route that accepts one today.

#### Scenario: A non-canonical spelling gets the template answer
- **WHEN** an administrator sends `POST /api/v1/teams/{00000000-0000-0000-0000-000000000001}/managers` or `GET /api/v1/teams/00000000000000000000000000000001/members`
- **THEN** the response matches that endpoint's missing-team response, never `200` or `500`
- **AND** one `team.template_access_denied` row is written and no template row is created

#### Scenario: A real team's non-canonical spelling is unchanged
- **WHEN** a caller sends a non-canonical spelling of a real team's id to a guarded route that accepts one today
- **THEN** the response is the same as before this change

### Requirement: The template guard covers every team-addressed session, membership and join-link route

An automated test SHALL enumerate the registered routes from the application instance and select, in any HTTP method, every route whose path matches `/api(/v<N>)?/teams/:<param>/(sessions|members|managers|join-links)` followed by `/` or the end of the path, plus an explicit extra list holding `GET /api/join/:token` and `GET /auth/callback`. There SHALL be no exemption list.

#### Scenario: A new route under the prefix is covered
- **WHEN** a route is registered under `/api/v1/teams/:teamId/sessions/…` in any method
- **THEN** the structural test selects it and fails until that route has a table entry and answers the template with its missing-team response

### Requirement: The structural template test asserts each route's response, audit and row state, and proves it can fail

Each selected route SHALL have an entry in a per-route table that names its actor and request. A selected route without an entry SHALL fail the test. For each route the test SHALL assert that route's template response, the `team.template_access_denied` row when the actor passes authorization, and that no new template row exists in the three tables. A probe self-test SHALL show that an unguarded route under the prefix fails the suite.

#### Scenario: Only a closed set of routes may skip the audit assertion
- **WHEN** a table entry marks a route as refused before the guard
- **THEN** the test fails unless the set of such entries is exactly `GET /api/v1/teams/:teamId/sessions`, `GET /api/v1/teams/:teamId/sessions/:sessionId`, `GET /api/join/:token` and `GET /auth/callback`
- **AND** each such entry still asserts the route's missing-team response and that no new template row exists

#### Scenario: Each audited route is probed with non-canonical spellings
- **WHEN** the structural test exercises a route whose entry expects the audit row
- **THEN** it sends the canonical, the no-hyphen and the braced spelling of the template id
- **AND** each returns the same parity response, never `500`, with the audit row and no new template row
- **AND** on a route that already rejects non-canonical ids at its boundary before authorization (a closed set, today only `POST /api/v1/teams/:teamId/sessions/draft`), the no-hyphen and braced spellings return the same parity response with no audit row and no new template row

#### Scenario: Only draft is exempt from the admin parity assertion
- **WHEN** the structural test runs its `application_admin` pass
- **THEN** every audited route gives the administrator the parity response and one audit row, except the closed set of routes whose authorization refuses an administrator before the guard (today only `POST /api/v1/teams/:teamId/sessions/draft`, which answers its `403` with no row)
- **AND** the test fails unless that set, and the set of boundary-rejecting routes, each equal exactly `["POST /api/v1/teams/:teamId/sessions/draft"]`

#### Scenario: No response leaks the constraint name
- **WHEN** the structural test file finishes
- **THEN** no response body it received contains `_not_template_team`

#### Scenario: A selected route without a table entry fails
- **WHEN** a selected route has no entry in the per-route table
- **THEN** the structural test fails and names the route

#### Scenario: The probe proves the test can fail
- **WHEN** the self-test registers a temporary unguarded `POST /api/v1/teams/:teamId/sessions/__probe` that inserts a session
- **THEN** the structural assertions fail for that route, both when it has no table entry and when it has one (the constraint answers a sanitized `500`, not the expected `404`)

#### Scenario: No template rows remain after the suite
- **WHEN** the structural test file finishes
- **THEN** no template row created during the run exists in `sessions`, `team_memberships` or `join_links`
