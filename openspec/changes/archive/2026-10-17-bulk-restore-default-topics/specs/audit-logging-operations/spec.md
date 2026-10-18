## ADDED Requirements

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
