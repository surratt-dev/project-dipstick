## ADDED Requirements

### Requirement: Each successful template maintenance write commits exactly one audit row in the same transaction, carrying before and after values

A successful, non-no-op request to the default-topic maintenance family SHALL write exactly one `audit_log` row through `withAuditTransaction`, committed atomically with the domain write, with `operation` one of `topic.default_added`, `topic.default_edited`, `topic.default_archived`, `topic.default_restored`, `topic.default_reordered`; `team_id` the sentinel `00000000-0000-0000-0000-000000000001`; and `actor_user_id`, `actor_global_role` and `actor_ip` (`request.ip`, which is trustworthy only under the platform's single trusted proxy, `trustProxy: 1`) filled as for other audited topic writes; `actor_roles` is `NULL` ("not captured", not a failure). The column `timestamp` is the row's time. The five names SHALL be one exported constant, and every query that selects them SHALL use an explicit `operation = ANY` list, never `LIKE 'topic.default_%'`. `metadata.topicId` and the ids in a reorder's lists SHALL be taken from the database rows, not from the request. `metadata` SHALL be `{ topicId, operation, changedFields, before, after }`: `before` and `after` hold the full values of the changed fields (`name`, `prompt`, `firstSessionDescription` as plain text; `status` and `displayOrder` as values); add records `before: null` and the full new row; archive and restore record the status transition and resulting position, and archive also lists renumbered `{ topicId, from, to }`; reorder omits `topicId` and records the full ordered id lists before and after. A failure to write the row SHALL roll the template write back. A no-op request and every rejected request SHALL write no success row. The event names SHALL be added to the closed `AuditEventName` union and SHALL be distinct from `topic.write_denied_template`.

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

A `403 DEFAULT_MAINTENANCE_ADMIN_ONLY` SHALL write one `topic.default_maintenance_denied` row, fail-open (a lost row never changes the response), bounded per actor by the shared denial-audit limiter, with `team_id` null and metadata holding only the method and the route template (not the raw URL), never a request body or an id echo. Beyond the bound the log-only `topic.denial_audit_suppressed` event SHALL carry the route family and the running suppressed count (sampled at counts 1, 2, 4, 8, ...) for the actor and window. When the limiter store is unavailable the seam writes no row and SHALL emit one log event per actor per window; that blind spot is accepted and recorded.

#### Scenario: Denial bound
- **WHEN** one actor is refused `DENIAL_AUDIT_LIMIT.limit` + 1 times in the window (10 + 1 today, read from the constant)
- **THEN** 10 rows exist and the 11th denial emits only the log-only `topic.denial_audit_suppressed` event

#### Scenario: Denial row
- **WHEN** a facilitator is refused
- **THEN** one `topic.default_maintenance_denied` row exists with the actor and no topic text

#### Scenario: Fail-open
- **WHEN** the denial audit write fails
- **THEN** the response is still the `403`
