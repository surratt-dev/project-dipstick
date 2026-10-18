# audit-logging-operations

## Purpose

Defines requirements for operating the audit-event logging system safely: documenting
gaps between what `emitAuditEvent`'s log-level override protects against and what it
doesn't, keeping that gap discoverable from both the deployment runbook and the code,
and tracking deferred follow-on work traceably.

## Requirements

### Requirement: Deployment runbook documents the transport-level filtering gap

`docs/deployment.md` SHALL include a `### Logging` subsection, under `## Running the
Application`, that documents: (1) that `emitAuditEvent`'s child-logger `level = "info"`
override protects audit events from application-wide log-level changes only, and does not
protect against a pino transport configured with its own level filter; (2) the specific
audit events that have no database backing and are therefore actually at risk from
transport-level filtering; (3) that most security-relevant audit events also write an
`audit_log` database row in the same transaction as the state change, which is the
authoritative record and is unaffected by transport configuration; and (4) that
`emitAuditEvent` (`packages/backend/src/auth/audit-logger.ts`) must be revisited before any
pino transport with a level filter is adopted.

#### Scenario: Operator configuring a filtering transport can identify at-risk events

- **WHEN** an operator preparing to configure a pino transport with a level filter reads
  the `### Logging` subsection of `docs/deployment.md`
- **THEN** they can identify, by name, which audit events are log-only with no database
  backing and therefore at risk of being silently dropped by the transport

#### Scenario: Runbook explains why the existing log-level fix does not cover transports

- **WHEN** an operator reads the `### Logging` subsection
- **THEN** it explains that `emitAuditEvent`'s child-logger level override guards against
  application-wide log-level changes only, and explicitly states that transport-level
  filtering is not covered by that protection

#### Scenario: Runbook states the required precondition before adopting a filtering transport

- **WHEN** an operator reads the `### Logging` subsection
- **THEN** it states that `emitAuditEvent` in `audit-logger.ts` must be revisited (e.g. a
  level floor on the transport, or routing audit events to an unfiltered destination) before
  any pino transport with a level filter is adopted

### Requirement: Deferred startup-reachability check is recorded as a traceable future consideration

The deployment runbook's `### Logging` subsection SHALL record the startup audit-event
reachability check requested in GitHub issue #3 as an explicit "Future consideration": not
built in this change, with its own trigger condition (build it alongside the
`emitAuditEvent` transport rework, before any filtering transport ships to production), and
a direct reference to issue #3. This requirement exists so the deferral is discoverable from
the shipped documentation rather than only from change-history artifacts, and so issue #3 can
close without silently dropping the action it requested.

#### Scenario: Reader finds the deferred startup check and its trigger condition

- **WHEN** a reader consults the `### Logging` subsection for the status of issue #3's
  startup-reachability-check request
- **THEN** they find a "Future consideration" note stating the check is not built now,
  naming the condition under which it should be built, and referencing issue #3

### Requirement: Transport-filtering caveat is discoverable from the code, not only the runbook

`packages/backend/src/auth/audit-logger.ts` SHALL include an inline comment, adjacent to the
child-logger level override in `emitAuditEvent`, stating that the override does not protect
against transport-level filtering and pointing to the `### Logging` subsection of
`docs/deployment.md` for the events at risk and the required precondition.

#### Scenario: Engineer reading emitAuditEvent encounters the transport-filtering caveat

- **WHEN** an engineer reads `emitAuditEvent` in `audit-logger.ts`, near the child-logger
  level override
- **THEN** an inline comment states that the override does not cover transport-level
  filtering and directs them to `docs/deployment.md`'s `### Logging` subsection for details

### Requirement: Assigning the default topics to a team is audited in the same transaction as the copy

Every accepted `POST /api/v1/teams/:teamId/topics/assign-defaults` request SHALL write exactly one `audit_log` row with `operation = 'topic.defaults_assigned'` in the same database transaction as the topic inserts. The row SHALL carry the acting administrator in `actor_user_id`, `actor_global_role` (always `application_admin`), `actor_ip`, and the target team in `team_id`, and `metadata` containing only `{ topic_count, correlation_id }`: the number of topics created and the request correlation id. The metadata SHALL NOT contain topic text, topic names, topic ids, or the template team id. The `audit_log` row is the system of record; the emitted event is a convenience notification and its loss SHALL NOT affect the row. After the transaction commits, the handler SHALL also call `emitAuditEvent` with the same operation; a failure of the post-commit event SHALL NOT change the response. A rejected request (`403`, `404`, `409`, `429`, `503`, `500`) SHALL write no `topic.defaults_assigned` row. The template-team refusal reuses the existing `topic.write_denied_template` operation, with `metadata.attempted_operation = 'topic.defaults_assigned'`, and introduces no new denial operation.

#### Scenario: A successful assignment writes one audit row in the same transaction
- **WHEN** an `application_admin` successfully assigns the defaults to a team
- **THEN** exactly one `audit_log` row with `operation = 'topic.defaults_assigned'`, the correct `team_id`, `actor_global_role = 'application_admin'` and `metadata = { "topic_count": <n>, "correlation_id": <id> }` exists
- **AND** the row and the topic inserts commit or roll back together

#### Scenario: The audit metadata holds counts only
- **WHEN** the `topic.defaults_assigned` row is read
- **THEN** its `metadata` has only the keys `topic_count` and `correlation_id` and contains no topic text, topic id or template team id

#### Scenario: A rolled-back assignment leaves no audit row
- **WHEN** the audit insert or any topic insert fails and the transaction rolls back
- **THEN** no topic and no `topic.defaults_assigned` row persists, and the response is `500`

#### Scenario: The row records who and for which team
- **WHEN** an `application_admin` assigns the defaults to a team
- **THEN** the row's `actor_user_id` is that admin's user id and its `team_id` is the target team id

#### Scenario: Refusals write no success row
- **WHEN** an assign-defaults request is refused with `403`, `404`, `409`, `429` or `503`
- **THEN** no `topic.defaults_assigned` row is written

#### Scenario: The structured event follows the commit
- **WHEN** an assignment succeeds
- **THEN** `emitAuditEvent` is called with `topic.defaults_assigned` only after the transaction has committed

### Requirement: A non-admin refusal of assign-defaults is audited, fail-open

Every `403 NOT_AN_ADMIN` from `POST /api/v1/teams/:teamId/topics/assign-defaults` SHALL write exactly one `audit_log` row with `operation = 'topic.defaults_assign_denied'`, `actor_user_id`, `actor_global_role` (the caller's role, or `unknown` when the caller has no user row), `actor_ip`, `team_id` as supplied in the request, and `metadata = { endpoint, http_status: 403, reason: "NOT_AN_ADMIN", correlation_id }`, and SHALL emit one structured event. The write SHALL be bounded by a per-actor limiter, separate from the topic-write limiter (recommended default: 10 denial rows per actor per minute): beyond the bound the response remains `403`, no row is written, and a log-only suppression event is emitted. The insert SHALL be performed by a single parameterized fail-open helper shared with the TOPIC-002 denial audit, whose own row shape and metadata are unchanged. This follows the TOPIC-002 denial audit (`topic.config_list_denied`, #264), not the TOPIC-003..006 writes, which do not audit their `403`s. The write is fail-open: if the insert throws or times out the response SHALL remain the `403` and only the log-only `topic.audit_write_failed` event is emitted. If the per-actor limiter cannot be loaded or consulted (a failed module import, a Redis error or timeout), the denial is treated exactly as a limiter store error: no row, a log-only `topic.denial_audit_suppressed` event with reason `limiter_error`, and the response stays `403`, never a `500`. The row is written before the shared rate limiter is consulted, so a 403-bound caller consumes no limiter budget. The metadata SHALL NOT contain the template team id, topic text, or any request body, header or query value.

#### Scenario: A non-admin refusal writes one denial row
- **WHEN** a facilitator posts to `assign-defaults` for a team with zero active topics
- **THEN** the response is `403` `NOT_AN_ADMIN` and exactly one `topic.defaults_assign_denied` row exists with that actor, the supplied `team_id` and `metadata = { endpoint, http_status: 403, reason: "NOT_AN_ADMIN" }`

#### Scenario: A denial for a nonexistent team is still recorded
- **WHEN** a non-admin posts to `assign-defaults` for a well-formed team id that names no team
- **THEN** the response is `403` and one `topic.defaults_assign_denied` row is written

#### Scenario: Denial rows are bounded per actor
- **WHEN** one actor triggers more `403 NOT_AN_ADMIN` responses than the per-actor bound within the window
- **THEN** every response is still `403`, rows beyond the bound are not written, and a log-only suppression event is emitted

#### Scenario: The denial row identifies the caller by their stored role set
- **WHEN** the denial row is written for a caller with a users row
- **THEN** `actor_roles` is the caller's stored role set, and a caller with no users row yields `actor_global_role = 'unknown'` and NULL `actor_roles`

#### Scenario: A failed denial insert does not change the response
- **WHEN** the `topic.defaults_assign_denied` insert throws or times out
- **THEN** the response is still `403` `NOT_AN_ADMIN` and `topic.audit_write_failed` is emitted at error level

### Requirement: An empty-template failure of assign-defaults is audited fail-open after the rollback

When `assign-defaults` finds that the template yields zero rows, it SHALL roll back, respond `500` `DEFAULT_TOPICS_UNAVAILABLE`, record an error-level `request.log.error` entry that names the template team id and the correlation id, and then write one `audit_log` row with `operation = 'topic.defaults_assign_failed'`, the acting administrator, `actor_ip`, the target `team_id`, and `metadata = { endpoint, http_status: 500, reason: "DEFAULT_TOPICS_UNAVAILABLE", correlation_id }`. The row SHALL be written after the `ROLLBACK`, outside the rolled-back transaction, through the same fail-open helper as the denial row: if the insert throws or times out the response SHALL remain the `500` and only the log-only `topic.audit_write_failed` event is emitted. The metadata SHALL NOT contain the template team id or topic text. Team creation with an empty template (#175) is unchanged. The deployment runbook SHALL describe this operation and the log search that joins on the correlation id.

#### Scenario: The empty-template failure is logged and audited
- **WHEN** `assign-defaults` fails because the template is empty
- **THEN** an error-level log entry exists that names the template team id and the response's `correlationId`, and exactly one `topic.defaults_assign_failed` row exists with that `correlation_id`
- **AND** the response body and the row do not contain the template team id

#### Scenario: The failure row does not resurrect the rolled-back work
- **WHEN** `assign-defaults` fails because the template is empty
- **THEN** no topic and no `topic.defaults_assigned` row persists for the team

#### Scenario: A failed failure-audit insert does not change the response
- **WHEN** the `topic.defaults_assign_failed` insert throws or times out
- **THEN** the response is still `500` `DEFAULT_TOPICS_UNAVAILABLE` and `topic.audit_write_failed` is emitted

### Requirement: The runbook documents how to find zero-topic teams and assignment audit rows

The deployment runbook (`docs/deployment.md`) SHALL include a short (about half a page) section titled "Zero-topic teams" that gives: (1) the diagnostic query for teams with zero active topics, excluding the template team; (2) how to find `topic.defaults_assigned`, `topic.defaults_assign_denied` and `topic.defaults_assign_failed` rows in `audit_log` (by operation, with the acting user and team on the row), the retention that applies (the audit-log policy), and the denial-row ceiling; (3) the empty-template failure above and what to do about it (restore the template's active default topics in team configuration; the in-app button cannot help), and that any bulk repair script must apply the same zero-active precondition and write one row per team under the same operation name; and (4) a statement that recovery is done in-app by an application administrator on the Topic Management screen, not by a hand-run database fix.

#### Scenario: An operator can detect and recover a zero-topic team from the runbook alone
- **WHEN** an operator reads the runbook section
- **THEN** they find the diagnostic query, the audit lookup, the empty-template log gap, and the in-app recovery instruction

### Requirement: A non-empty bulk restore of default topics is audited with one row, in the same transaction

A request to `POST /api/v1/teams/:teamId/topics/restore-defaults` that restores at least one topic SHALL write exactly one `audit_log` row with `operation = 'topic.defaults_restored'`, `team_id` set to the team, `actor_user_id`, `actor_global_role` (from the authorization result) and `actor_ip` (`request.ip`, the trusted-proxy-resolved address, as for the other topic writes) set to the caller, with nothing from the request body or headers stored, in the same database transaction as the topic updates (a failed insert rolls the restore back). The row's `metadata` SHALL be `{ restored: [{topic_id, display_order}], restored_count, skipped: [{topic_id, reason}], skipped_count }` (as built; no `correlation_id` key is stored in the row), with `skipped` capped at 100 entries (`skipped_count` is always the true total) and SHALL NOT contain topic names, prompts, annotations, or any other topic text. A structured log event `topic.defaults_restored` SHALL be emitted after COMMIT as a convenience notification; the audit row is the system of record. The bulk path SHALL NOT write `topic.restored` rows. A request that restores nothing SHALL write no row (such requests are visible only through the rate limiter's own logging; accepted, since no state changed). A restore SHALL never commit without its audit row. Rows follow the existing `audit_log` retention policy (`docs/deployment.md`; no table-specific purge). Because single restore writes one `topic.restored` row per topic and bulk writes one `topic.defaults_restored` row, a query for who restored a topic SHALL union both operations; the per-row `restored_by` and `restored_at` columns are the authoritative per-topic provenance in both paths. Topic ids and positions identify which topics came back (issue #218 AC4 is read as satisfied by ids). Audit rows SHALL NOT be surfaced to participants or in any team-facing view.

#### Scenario: One row per non-empty request
- **WHEN** a bulk restore restores five topics
- **THEN** exactly one `topic.defaults_restored` row exists for that request, listing five restored topic ids with `display_order` positions, and no `topic.restored` row is written

#### Scenario: Skipped topics are recorded
- **WHEN** a request restores three topics and skips two under the duplicate rule
- **THEN** the single row lists three restored and two skipped entries with reason `NAME_ACTIVE`

#### Scenario: Empty request writes nothing
- **WHEN** the request restores no topic
- **THEN** no `audit_log` row is written

#### Scenario: Metadata carries no topic text
- **WHEN** any `topic.defaults_restored` row is inspected
- **THEN** it contains no topic name or prompt

#### Scenario: Metadata is bounded
- **WHEN** more than 100 defaults are skipped
- **THEN** `skipped` holds 100 entries and `skipped_count` holds the true total

#### Scenario: Actor fields
- **WHEN** a row is inspected
- **THEN** `actor_ip` equals the request's resolved client IP and no request header or body value is stored

#### Scenario: Audit failure rolls back
- **WHEN** the audit insert fails
- **THEN** no topic is restored and the caller receives `500` with the application's standard error envelope (including `correlationId`) and no database detail

---

### Requirement: Each successful template maintenance write commits exactly one audit row in the same transaction, carrying before and after values

A successful, non-no-op request to the default-topic maintenance family SHALL write exactly one `audit_log` row through `withAuditTransaction`, committed atomically with the domain write, with `operation` one of `topic.default_added`, `topic.default_edited`, `topic.default_archived`, `topic.default_restored`, `topic.default_reordered`; `team_id` the sentinel `00000000-0000-0000-0000-000000000001`; and `actor_user_id`, `actor_global_role` and `actor_ip` (`request.ip`, which is trustworthy only under the platform's single trusted proxy, `trustProxy: 1`) filled as for other audited topic writes; `actor_roles` is `NULL` ("not captured", not a failure). The column `timestamp` is the row's time. The five names SHALL be one exported constant, and every query that selects them SHALL use an explicit `operation = ANY` list, never `LIKE 'topic.default_%'`. `metadata.topicId` and the ids in a reorder's lists SHALL be taken from the database rows, not from the request. `metadata` SHALL be `{ topicId, operation, changedFields, before, after }`: `before` and `after` hold the full values of the changed fields (`name`, `prompt`, `firstSessionDescription` as plain text; `status` and `displayOrder` as values); add records `before: null` and the full new row; archive and restore record the status transition and resulting position, and archive always lists renumbered `{ topicId, from, to }` in `after` (add and restore list it only when a pre-existing gap was repaired); reorder omits `topicId` and records the full ordered id lists before and after. A failure to write the row SHALL roll the template write back. A no-op request and every rejected request SHALL write no success row. The event names SHALL be added to the closed `AuditEventName` union and SHALL be distinct from `topic.write_denied_template`.

This is a documented, scoped exception to the convention that audit rows carry no topic names or prompt text: that convention protects team-authored content, while template content is global and non-personal, and these rows are the only history of the template. The exception applies to exactly these five operation names; the metadata of every other operation SHALL remain free of topic text. It does not extend to the application log: the structured log event emitted for each of the five operations SHALL carry identifiers and `changedFields` only (`operation`, `topicId` where applicable, actor user id and role, `actorIp`, `correlationId`) and SHALL NOT carry `before`, `after` or any name, prompt or description text. Template audit rows are exempt from routine retention but are not undeletable: the runbook SHALL define a break-glass redaction (replace text with a tombstone and a `redacted` marker of who, when and why, leaving `timestamp`, `operation`, actor and `topicId` intact) as the only sanctioned mutation of `audit_log`.

#### Scenario: One row per write
- **WHEN** an administrator edits one prompt
- **THEN** exactly one `topic.default_edited` row exists with `changedFields: ["prompt"]` and the full before and after prompt text

#### Scenario: Audit failure rolls back
- **WHEN** the audit insert fails during an add
- **THEN** the request fails and the template has no new row

#### Scenario: No-op writes nothing
- **WHEN** an edit changes nothing
- **THEN** no `audit_log` row is written

#### Scenario: Reorder records the lists
- **WHEN** the order changes
- **THEN** one `topic.default_reordered` row holds the full before and after id lists

#### Scenario: The log event carries no text
- **WHEN** each of the five operations succeeds with distinctive name, prompt and description text
- **THEN** the emitted log event contains no `before`, `after` or text value, only identifiers and `changedFields`

#### Scenario: Selecting maintenance rows does not match assign-defaults rows
- **GIVEN** `topic.defaults_assigned`, `topic.defaults_assign_denied` and `topic.defaults_assign_failed` rows keyed to the sentinel
- **WHEN** maintenance rows are selected
- **THEN** none of them is returned

#### Scenario: Ids come from the row
- **WHEN** a path id is supplied in upper case
- **THEN** the audit `metadata.topicId` is the canonical lowercase database id

#### Scenario: Metadata is closed and bounded
- **WHEN** any maintenance row is inspected
- **THEN** its metadata keys are exactly the documented set and its text fields respect the field limits

#### Scenario: The text exception does not spread
- **WHEN** audit rows of every other operation are inspected
- **THEN** none contains a topic name, prompt or description field

---

### Requirement: A non-admin refusal of the maintenance family is audited fail-open and bounded

A `403 DEFAULT_MAINTENANCE_ADMIN_ONLY` SHALL write one `topic.default_maintenance_denied` row, fail-open (a lost row never changes the response), bounded per actor by the shared denial-audit limiter, with `team_id` null and metadata holding only `endpoint` (the method plus the route template, not the raw URL), `http_status`, `reason` and `correlation_id`, never a request body or an id echo. Beyond the bound the log-only `topic.denial_audit_suppressed` event SHALL carry the route family and the running suppressed count (sampled at counts 1, 2, 4, 8, ...) for the actor and window. When the limiter store is unavailable the seam writes no row and SHALL emit one log event per actor per window; that blind spot is accepted and recorded.

#### Scenario: Denial bound
- **WHEN** one actor is refused `DENIAL_AUDIT_LIMIT.limit` + 1 times in the window (10 + 1 today, read from the constant)
- **THEN** 10 rows exist and the 11th denial emits only the log-only `topic.denial_audit_suppressed` event

#### Scenario: Denial row
- **WHEN** a facilitator is refused
- **THEN** one `topic.default_maintenance_denied` row exists with the actor and no topic text

#### Scenario: Fail-open
- **WHEN** the denial audit write fails
- **THEN** the response is still the `403`
