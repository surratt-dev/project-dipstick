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

**Accepted differences from a missing team.** Two observable differences are accepted on purpose:
1. A standing facilitator who holds an active `team_memberships` row on the template fails authorization with `403 FACILITATOR_IS_TEAM_MEMBER`, which a missing team never produces.
2. If the audit insert takes longer than the timing floor, the template response can arrive later than the missing-team response.

No other difference is permitted.

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
- **WHEN** the caller sends the same request once with `teamId = DEFAULT_TOPICS_TEAM_ID` and once with a canonical-format `teamId` that matches no team, first while the template has no completed session and again while a `sessions` row with `team_id = DEFAULT_TOPICS_TEAM_ID` and `status = 'complete'` exists
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
- **GIVEN** `team_memberships` has an active row on `DEFAULT_TOPICS_TEAM_ID` for a user other than the caller
- **WHEN** a standing facilitator who has no membership sends any in-scope request for the template
- **THEN** the response is `404 TEAM_NOT_FOUND`

#### Scenario: The caller holds a membership on the template
- **GIVEN** `team_memberships` has an active row on `DEFAULT_TOPICS_TEAM_ID` for the caller
- **WHEN** the caller is a standing facilitator and sends any in-scope request for the template
- **THEN** the response is `403 FACILITATOR_IS_TEAM_MEMBER` (an accepted difference from a missing team), and no `topic.write_denied_template` row is written
- **AND WHEN** the caller is instead an `application_admin` and sends TOPIC-003 to TOPIC-006 for the template
- **THEN** the response is `404 TEAM_NOT_FOUND`, because administrators are exempt from the membership check

#### Scenario: A non-canonical spelling of the template id follows the existing route-boundary rejection
- **WHEN** a caller sends a request whose `teamId` is the template id without hyphens, or wrapped in braces
- **THEN** the request is handled by the existing `rejectNonCanonicalTeamId` behaviour, unchanged by this requirement, before any authorization or template check runs
- **AND** no `topic.write_denied_template` row is written

#### Scenario: Reads of the template are unaffected
- **WHEN** a caller authorized for TOPIC-002 reads `GET /api/v1/teams/<DEFAULT_TOPICS_TEAM_ID>/topics`
- **THEN** the response is `200` with the same rows in the same order as before this change
- **AND WHEN** an authorized facilitator reads `GET /api/v1/teams/<DEFAULT_TOPICS_TEAM_ID>/topics/all`
- **THEN** the response is `200`, `canAddTopics` is `true` (it depends on role only), and `isCustomizationLocked` follows the lock (it is `false` once the template has a completed session)
- **AND** a screen that offers write controls on the template, all of which answer `404`, is an accepted known gap and not a regression (follow-up F1)

#### Scenario: Default topics on a real team remain archivable and restorable
- **GIVEN** an unlocked non-template team with an active `is_default = true` topic
- **WHEN** an authorized facilitator archives that topic and then restores it
- **THEN** both requests return `200`
- **AND** one `topic.archived` row and one `topic.restored` row are written, and no `topic.write_denied_template` row is written

#### Scenario: Team creation copies the pre-attempt baseline
- **GIVEN** the template has a completed session, and a snapshot of every template topic row in every status, keyed by `id`, is taken
- **WHEN** each of TOPIC-003 to TOPIC-007 is sent against the template with a request that would succeed on an unlocked team, each is rejected with `404`, and then `POST /api/v1/teams` is called
- **THEN** the team-creation response is `201`
- **AND** the template's own topic rows still equal the snapshot: the same ids, no added rows, and the same `name`, `prompt`, `vote_type`, `display_order`, `status`, archive fields and annotation fields
- **AND** the new team's topics, in every status, equal the snapshot's `is_default = true` rows on `name`, `prompt`, `vote_type`, `display_order` and `status`

#### Scenario: A newly registered topic-write route is covered
- **WHEN** the application registers a route with a `POST`, `PUT`, `PATCH`, `DELETE` or wildcard method whose path matches `/api/teams/:<any parameter name>/topics` or `/api/v<N>/teams/:<any parameter name>/topics` followed by `/` or the end of the path, or a route on the structural test's extra list
- **THEN** the structural route test sends that route the deterministic request described under **Structural coverage**
- **AND** the test fails unless the response is `404` with `error.code: "TEAM_NOT_FOUND"` and exactly one `topic.write_denied_template` row is written for that request, whatever the template's lock state
