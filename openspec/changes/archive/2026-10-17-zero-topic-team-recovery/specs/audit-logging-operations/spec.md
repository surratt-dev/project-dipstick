## ADDED Requirements

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

Every `403 NOT_AN_ADMIN` from `POST /api/v1/teams/:teamId/topics/assign-defaults` SHALL write exactly one `audit_log` row with `operation = 'topic.defaults_assign_denied'`, `actor_user_id`, `actor_global_role` (the caller's role, or `unknown` when the caller has no user row), `actor_ip`, `team_id` as supplied in the request, and `metadata = { endpoint, http_status: 403, reason: "NOT_AN_ADMIN", correlation_id }`, and SHALL emit one structured event. The write SHALL be bounded by a per-actor limiter, separate from the topic-write limiter (recommended default: 10 denial rows per actor per minute): beyond the bound the response remains `403`, no row is written, and a log-only suppression event is emitted. The insert SHALL be performed by a single parameterized fail-open helper shared with the TOPIC-002 denial audit, whose own row shape and metadata are unchanged. This follows the TOPIC-002 denial audit (`topic.config_list_denied`, #264), not the TOPIC-003..006 writes, which do not audit their `403`s. The write is fail-open: if the insert throws or times out the response SHALL remain the `403` and only the log-only `topic.audit_write_failed` event is emitted. The row is written before the shared rate limiter is consulted, so a 403-bound caller consumes no limiter budget. The metadata SHALL NOT contain the template team id, topic text, or any request body, header or query value.

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
