## MODIFIED Requirements

### Requirement: Default topic set is copied into a newly created team's own topics rows

When a new team is created, the application SHALL copy the canonical default topic set into new `topics` rows owned by the new team. The canonical default topic set is the `topics` rows belonging to the sentinel `__default_topics__` system team (`team_id = '00000000-0000-0000-0000-000000000001'`) where `is_default = true` AND `status = 'active'`. A template row whose `status` is not `active` SHALL never be copied (BRD 6.4, FR-8.1, FR-8.6). Each copied row SHALL carry the new team's own `team_id`, its own generated `id`, `status = 'active'`, and the source row's `name`, `prompt`, `vote_type`, `is_default`, and `first_session_description`, unmodified; the annotation columns SHALL remain unset. The copied rows' `display_order` SHALL be numbered 1 to n with no gaps or duplicates, in canonical order (template `display_order` ascending, ties broken by source `id` ascending). The new team has no other topic rows before the copy. This copy SHALL occur in the same database transaction as the team's creation. The copy SHALL be a real, independent row per topic, so that a later edit to either the canonical defaults or the new team's own topic configuration never affects the other. An archived default on the template is a data fault, not a way to retire a default for new teams.

#### Scenario: New team receives its own copy of every active default topic
- **WHEN** a new team is created
- **THEN** for every `topics` row where `team_id = '00000000-0000-0000-0000-000000000001'`, `is_default = true` and `status = 'active'`, a corresponding new `topics` row is created with the new team's `team_id`, a new `id`, `status = 'active'`, and the same `name`, `prompt`, `vote_type`, `is_default = true`, and `first_session_description`
- **AND** the annotation columns of every copied row are unset

#### Scenario: An archived template default is not copied
- **GIVEN** the template has an active default X and an archived default Y
- **WHEN** a new team is created
- **THEN** the new team has X as an active topic and has no topic named Y in any status

#### Scenario: Copied topics preserve canonical ordering and are numbered 1 to n
- **GIVEN** a healthy template whose active defaults sit at positions 1 to 12
- **WHEN** the default topic set is copied to a new team
- **THEN** the copied topics' `display_order` values equal the source rows' values, and the set renders in the same canonical order

#### Scenario: Gaps in template positions do not reach the new team
- **GIVEN** the template's active defaults sit at positions 1, 3 and 7
- **WHEN** a new team is created
- **THEN** the new team's active topics sit at positions 1, 2 and 3, in the template's order

#### Scenario: An archived and an active template default at one position do not fail creation
- **GIVEN** the template has an archived default P1 and an active default P1 at the same `display_order`
- **WHEN** a new team is created
- **THEN** the response is 201, the new team has exactly one topic at position 1, and it is the active one

#### Scenario: Duplicate active template positions do not fail creation
- **GIVEN** a test transaction that drops the partial unique index `topics_team_active_order` and always rolls back, and a source team holding two active defaults at one position
- **WHEN** the copy (`copyCanonicalDefaults`) is run for a new team, with the source team supplied through its test-only `sourceTeamId` seam (the route never passes it)
- **THEN** the new team's positions are 1 to n with no duplicate, and the two rows are ordered by source `id`
- **AND** this scenario is a required automated test at the copy-function level, not a route-level test: the dropped-index state cannot be reached through `POST /api/v1/teams` inside a rolled-back transaction, and the route is covered by the gap and archived/active-collision scenarios

#### Scenario: Single active default
- **GIVEN** the template has exactly one active default
- **WHEN** a new team is created
- **THEN** the new team has one active topic at position 1 and its first session is startable

#### Scenario: Active and archived template defaults of one name
- **GIVEN** the template has an active and an archived default with the same name
- **WHEN** a new team is created
- **THEN** only the active one is copied, once

#### Scenario: A null first-session description stays null
- **GIVEN** a template default whose `first_session_description` is NULL
- **WHEN** a new team is created
- **THEN** the copied row's `first_session_description` is NULL

#### Scenario: Every copied column equals the template's
- **WHEN** a new team is created
- **THEN** for each copied row `name`, `prompt`, `vote_type`, `is_default` and `first_session_description` equal the template row's, and no annotation column is set

#### Scenario: The first session's snapshot follows the copy
- **WHEN** a new team is created
- **THEN** the first session's topic snapshot is taken after the copy in the same transaction, and the session's topic names and positions, in order, equal the team's (generated ids are not compared)
- **AND** the first session starts with at least one topic

#### Scenario: A healthy template's creation response is unchanged
- **GIVEN** the healthy twelve-topic template
- **WHEN** a new team is created
- **THEN** the HTTP status, the response body shape, and the response values (excluding generated ids and timestamps) equal those produced before this change

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
- **AND** no team record exists without a topic configuration, and no membership, topic, session or audit row from that request persists

## ADDED Requirements

### Requirement: The copy and the restore list share one definition of the canonical default set

The set of topic names copied at team creation and the set of default topic names that TOPIC-002 `defaultTopicsNotActive` reports for a team with no topics SHALL be the same set, defined once by the predicate `team_id = <template> AND is_default = true AND status = 'active'`.

#### Scenario: Copied names equal the restore list for an empty team
- **GIVEN** a template state with an archived default (and, separately, a healthy template)
- **WHEN** a team is created and the names it received are compared with the names `defaultTopicsNotActive` reports for a team with no topics
- **THEN** the two sets are equal

#### Scenario: The restore list is the set difference for a team that holds some defaults
- **GIVEN** a team holding some, but not all, of the active template defaults
- **WHEN** the team's `defaultTopicsNotActive` is read
- **THEN** it contains exactly the active template defaults the team lacks as active topics, and that set equals the canonical default names minus the team's active topic names

### Requirement: A damaged template is signalled to operators and does not fail creation

Team creation SHALL examine every template row, of any status, for four anomalies: `duplicate_active_order` (two or more active default rows share a `display_order`); `non_active_default` (a row with `is_default = true` has a `status` other than `active`); `non_contiguous_order` (the distinct `display_order` values of the active default rows, sorted, are not exactly 1 to m, where m is the number of distinct values, so a nonzero start (including a start at 0) or any hole counts, and duplicates alone do not; when m = 0, that is, there are no active defaults, the condition holds vacuously and `non_contiguous_order` is NOT raised, because that state is reported by the creation failure below, not by this signal); and `non_default_row` (any row with `is_default = false`, whatever its status). When one or more apply, creation SHALL still succeed and exactly one `warn`-level log entry with message `template_anomaly` SHALL be written per creation request, carrying `templateTeamId`, `anomalies` (every type that applies), `topicIds` and `correlationId` (the request's `request.id`). The entry SHALL contain ids and anomaly codes only, never a topic name, prompt or other row text, and the check SHALL be performed after the creation transaction has committed so that a failure of the check cannot fail or abort creation. `topicIds` SHALL be the de-duplicated union of: all rows sharing a duplicated position, each non-active default row, and each non-default row, in canonical order then id, capped at 50; `non_contiguous_order` contributes no ids, so the list MAY be empty. Entries SHALL NOT be de-duplicated across requests: repeated or concurrent creations each write one entry. A healthy template SHALL write no such entry. If the check itself fails, creation SHALL still succeed and a `warn`-level entry with message `template_anomaly_check_failed` SHALL be written, carrying `templateTeamId` and `errCode` (the database error code when the failure is a database error, otherwise absent) and no row text, message or SQL text. No facilitator-visible banner, copy or response field SHALL be added.

#### Scenario: Anomalous template creates the team and logs once
- **GIVEN** a template with an archived default and a position gap
- **WHEN** a new team is created
- **THEN** creation succeeds
- **AND** exactly one `warn` entry `template_anomaly` lists `non_active_default` and `non_contiguous_order`, and `topicIds` holds the archived default's id

#### Scenario: Each anomaly type is detected
- **GIVEN** a template showing, in turn, a non-active default, active defaults starting at position 2, and an archived non-default row
- **WHEN** a new team is created in each state
- **THEN** exactly one entry is written each time, naming `non_active_default`, `non_contiguous_order`, and `non_default_row` respectively, with a closed key set, ids and codes only, and `correlationId` equal to the request id
- **AND** the creation response is unchanged

#### Scenario: Duplicate active position is detected by the pure detector only
- **GIVEN** active template defaults sharing a `display_order`
- **WHEN** `detectTemplateAnomalies` is run over the template facts
- **THEN** it reports `duplicate_active_order`, lists every row at the shared position in `topicIds`, and does not report `non_contiguous_order`
- **AND** there is no route-level `duplicate_active_order` test, because `topics_team_active_order` makes the state unreachable through the route without dropping the index, which the route tests do not do

#### Scenario: No active defaults raises no non-contiguous anomaly
- **GIVEN** no active default rows (m = 0)
- **WHEN** `detectTemplateAnomalies` is run
- **THEN** it reports no anomaly for the active-default set, and creation fails as specified in the requirement "A template with no active defaults fails creation without persisting anything"

#### Scenario: Healthy template is silent
- **GIVEN** the healthy twelve-topic template
- **WHEN** a new team is created
- **THEN** no `template_anomaly` entry is written

#### Scenario: Persistent fault logs on every creation
- **GIVEN** a damaged template left unrepaired
- **WHEN** two teams are created
- **THEN** two `template_anomaly` entries are written, one per request

### Requirement: A template with no active defaults fails creation without persisting anything

When the template has no active default rows, `POST /api/v1/teams` SHALL respond HTTP 500 with error code `internal_error` and the message "Team creation is unavailable because the default topic set is not configured. Contact an administrator.", with a `correlationId` in the body and no template id in the body. The transaction SHALL roll back so that no team, membership, topic, session or audit row persists, and an error-level log entry SHALL name the template team id and the correlation id.

#### Scenario: Empty template
- **GIVEN** the template has no active default rows
- **WHEN** a facilitator creates a team
- **THEN** the status is exactly 500, the code is `internal_error`, the message is the one above, the body carries a `correlationId`, and it holds no template id
- **AND** no team, membership, topic, session or audit row from that request exists
- **AND** an error-level entry names the template team id

### Requirement: The template's canonical-set invariants are asserted on every merge

An automated integration test SHALL fail, naming the violated invariant, if: the active default count differs from the baseline N (N = 12) or the active default names differ from the baseline list; the active default positions are not exactly 1 to N; any default row has a `status` other than `active`; any non-default row exists on the template; or any membership or session exists on the template; or, for any baseline topic, its `prompt`, `vote_type` or `first_session_description` differs from the baseline. The checks are a pure function over fetched rows, so the failure messages are themselves tested. The baseline list lives in the invariants test file (named in `tasks.md`), not in application code, and SHALL be updated by whatever change edits the defaults (F5, #216). Because Vitest runs files in parallel and several files swap or archive template rows, the invariants test and every test that mutates the template SHALL run under a cross-process Postgres advisory lock on a fixed key (`acquireTemplateLock` / `withTemplateLock` in the test helpers); tests that only create teams take no lock and derive expectations from an in-test snapshot, never from the baseline list.

#### Scenario: A seed edit that archives a default fails CI
- **WHEN** a migration leaves a default row on the template archived
- **THEN** the invariants test fails and names the "no non-active default" invariant

#### Scenario: A seed edit that changes a default's prompt fails CI
- **WHEN** a migration changes the `prompt` of a baseline default on the template
- **THEN** the invariants test fails and names the "baseline content" invariant
