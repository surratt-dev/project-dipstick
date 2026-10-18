# bulk-restore-default-topics

## Purpose

Defines `POST /api/v1/teams/:teamId/topics/restore-defaults` (issue #218): one request that reactivates every archived default topic of a team that is not skipped by the normalized-name duplicate rule. Covers authorization (the standing facilitator-or-admin rule shared with single restore), the check-ordering cascade, ordering and determinism of restored positions, the skip-and-report duplicate rule (`planDefaultRestore`), the empty and idempotent response, atomicity and concurrency under the per-team topic lock, the timing floor on every exit, the no-effect-on-open-sessions guarantee, and the response shape. Audit (`topic.defaults_restored`), rate limiting and the frontend control are specified in `audit-logging-operations`, `topic-write-rate-limiting` and `topic-management-screen`. Introduced by `bulk-restore-default-topics`.

## Requirements

### Requirement: A facilitator or administrator can restore all restorable archived default topics in one request

`POST /api/v1/teams/:teamId/topics/restore-defaults` SHALL, for a caller who satisfies the standing facilitator-or-admin rule of `restore-topic` (a `facilitator` who is not an active member of the team, OR an `application_admin` whatever their membership, #208), on an unlocked team, reactivate every topic of that team with `status = 'archived'` and `is_default = true` that is not skipped by the duplicate rule, in one database transaction taken under the per-team topic advisory lock. The endpoint SHALL take no input: the handler SHALL never read the request body, and the set restored SHALL be computed solely from server state. Framework-level content-type parsing and the default 1 MiB body limit apply before the handler (malformed JSON 400, unknown content type 415, oversized body 413); those responses SHALL change no state. It SHALL NOT be configurable by any flag, environment variable, or setting. It SHALL NOT modify custom topics, active topics, archived non-default topics, the order of active topics, annotations, votes, or `session_topics`. It SHALL reactivate the original rows and never insert copies.

#### Scenario: Archived defaults are restored in one request
- **WHEN** a non-member standing facilitator posts to the endpoint for an unlocked team with five archived default topics and no custom topics
- **THEN** the response is `200 OK` with `restored` listing five entries `{topicId, name, displayOrder}` and `skipped` empty
- **AND** all five topics have `status = 'active'`, `restored_by` set to the caller and `restored_at` set

#### Scenario: Only archived defaults are touched
- **WHEN** the team also has an archived custom topic (`is_default = false`) and an active custom topic
- **THEN** the archived custom topic remains archived and the active custom topic keeps its `display_order`

#### Scenario: Original rows are reactivated and history returns
- **WHEN** a restored default had `votes`, `session_topics` and action-item records before it was archived
- **THEN** its `topics.id` is unchanged and those records are unchanged and accessible

#### Scenario: A request body is ignored
- **WHEN** the caller sends a well-formed body naming topic ids or extra fields
- **THEN** the set restored is exactly the set the server computes, and the response is not a 400

#### Scenario: Unusual or oversized bodies
- **WHEN** the caller sends a small `text/plain` body, a form-urlencoded body, or a body larger than 1 MiB
- **THEN** the response is the handler result or a framework 413 or 415 (never a 5xx), no topic changes, and no body content appears in logs

### Requirement: Restored defaults are appended in best-effort prior relative order, matching sequential single restores

Archived `display_order` values are not maintained after archive and may be stale, tied or negative; the order is therefore a deterministic sort key, not a promise that it matches what the facilitator last saw. The restored topics SHALL be assigned `display_order` values `B+1, B+2, ...` where `B = COALESCE(MAX(display_order) over the team's active topics, 0)`, ordered within the batch by each row's prior `display_order` ascending, then `id` ascending. For any starting state, the resulting rows (`status`, `display_order`, `restored_at`/`restored_by` semantics) SHALL equal those produced by restoring the non-skipped topics one at a time through single restore in that same order.

#### Scenario: Prior relative order is kept
- **WHEN** archived defaults with prior `display_order` 4, 2, 5 are restored to a team whose highest active `display_order` is B
- **THEN** the topic with prior order 2 receives B+1, the one with 4 receives B+2, the one with 5 receives B+3

#### Scenario: Gaps in prior order are irrelevant
- **WHEN** archived defaults have prior `display_order` 2, 9 and 40
- **THEN** they receive B+1, B+2, B+3 in that order

#### Scenario: Tie on prior order breaks by id
- **WHEN** two archived defaults share a prior `display_order`
- **THEN** the one with the lower `id` is placed first

#### Scenario: Restore appends after custom topics
- **WHEN** the team has two active custom topics at positions 1 and 2 and three archived defaults
- **THEN** the defaults are placed at 3, 4, 5 and the custom topics keep positions 1 and 2

#### Scenario: Zero active topics starts at 1
- **WHEN** the team has no active topics
- **THEN** the first restored topic receives `display_order` 1

#### Scenario: Stale, tied or negative archived positions
- **WHEN** archived defaults have identical, negative or historically inverted `display_order` values (the legacy migration-18 shape)
- **THEN** the result is collision-free and deterministic (repeating the same starting state gives the same placement), and equals the sequential single restores in that order

#### Scenario: Bulk equals sequential single restores
- **WHEN** the same starting state is run through bulk restore and, separately, through single restore of the non-skipped topics in the batch order
- **THEN** the final rows are identical (table-driven test comparing both paths)

### Requirement: An archived default whose name matches an active topic is skipped and reported, never duplicated

An archived default SHALL be skipped, and reported in `skipped` with reason `NAME_ACTIVE`, when its name matches, after `trim()` then `toLowerCase()` (no locale argument), the name of an active topic of the team or of an archived default restored earlier in the same batch. Names are compared by their current value (a renamed default is compared by its current name); `is_default` remains the only marker of a default. Prompts are not compared. Skipped topics SHALL remain archived and unchanged. This `trim().toLowerCase()` comparison implemented by `planDefaultRestore` is the only same-name rule for bulk restore; it is a UX and duplicate rule, not an identity check, and the template-based `defaultTopicsNotActive` and the client-side `findDuplicate` hint SHALL NOT be used to decide bulk availability. Evaluation SHALL be sequential in restore order, so of two archived defaults sharing one name at most one, the first in restore order, is restored.

#### Scenario: A name already active is skipped
- **WHEN** the archived default "Code Quality" exists and an active topic named "code quality " (trailing space, different case) exists
- **THEN** "Code Quality" is not restored and appears in `skipped` with reason `NAME_ACTIVE`, and it remains archived

#### Scenario: Two archived defaults share one name
- **WHEN** two archived defaults are named "Delivery" and "delivery" and neither name is active
- **THEN** exactly the one earlier in restore order is restored and the other is skipped with `NAME_ACTIVE`

#### Scenario: Case and Unicode forms are distinct by decision
- **WHEN** an archived default is named "Équipe" and an active topic is named "equipe", or the two differ only by NFC versus NFD form
- **THEN** they are different names and the archived default is restored (the rule is `trim().toLowerCase()` with no locale or normalization form, a recorded decision)

#### Scenario: Blank-named legacy defaults
- **WHEN** an archived default has a blank or whitespace-only name
- **THEN** it is restored unless an earlier row in the same batch has the same normalized (empty) name, in which case it is skipped with `NAME_ACTIVE`

#### Scenario: Winner among same-named archived defaults ignores history
- **WHEN** two same-named archived defaults exist and the later one in restore order has votes
- **THEN** the earlier one in restore order is restored regardless of history

#### Scenario: Skipping is an outcome, not a failure
- **WHEN** some archived defaults are skipped and others restored
- **THEN** the response is `200 OK` with both arrays populated and the transaction commits

### Requirement: Only a standing facilitator or an administrator may bulk restore

The endpoint SHALL admit a caller only if they are a `facilitator` who is not an active member of the team, or an `application_admin` whatever their membership (#208), by delegating to `checkStandingFacilitatorOrAdminAuthorization(userId, teamId)` unchanged. Every other caller SHALL receive `403` with the machine-readable code `NOT_A_FACILITATOR` (not a facilitator or admin) or `FACILITATOR_IS_TEAM_MEMBER` (facilitator who is a member).

#### Scenario: A member facilitator is refused
- **WHEN** a facilitator who is an active member of the team posts to the endpoint
- **THEN** the response is `403 Forbidden` with `FACILITATOR_IS_TEAM_MEMBER`, and no row changes

#### Scenario: A non-facilitator is refused
- **WHEN** a caller who is neither facilitator nor application administrator posts to the endpoint
- **THEN** the response is `403 Forbidden` with `NOT_A_FACILITATOR`

#### Scenario: An administrator is admitted whatever their membership
- **WHEN** an `application_admin` with no membership, a `participant` membership, or an `engineering_manager` membership on the team posts to the endpoint
- **THEN** each request is admitted past the role check

### Requirement: Bulk restore evaluates checks in the live single-restore order, without topic-specific steps

The endpoint SHALL evaluate in this order, rejecting on the first failure and evaluating nothing later. This is the order of the live single-restore handler body and of issue #218 (the older order in the single-restore header comment is not authoritative): (0) session authentication by the `authMiddleware` `onRequest` hook, before the handler runs (`401`); (1) a non-canonical `teamId` is answered `404 TEAM_NOT_FOUND` by the handler before the role check, issuing no authorization, membership, team or topic query, and the `teamId` is lowercased only after that check; (2) role authorization (`403`); (3) the topic-write rate limit (`429`, or `503` failing closed); (4) team existence, with the template team (`DEFAULT_TOPICS_TEAM_ID`) answered byte-identically to a nonexistent team (`404`, `TEAM_NOT_FOUND`); (5) the customization lock (`409`, `TOPIC_CUSTOMIZATION_LOCKED`, audited through the shared `topic.write_denied_locked` path); (6) the transaction. There SHALL be no topic-existence `404` and no topic-status `422`. The lock check SHALL precede any emptiness determination, so a locked team receives `409` even when nothing is archived. For a non-canonical `teamId` the observable outcome per caller class is: unauthenticated `401`; every authenticated caller (non-facilitator, member facilitator, non-member facilitator, administrator) the same `404`.

#### Scenario: A non-canonical team id is 404 before the role check, for every authenticated caller class
- **WHEN** the `teamId` is not a canonical UUID and the authenticated caller is, in turn, a non-facilitator, a member facilitator, a non-member facilitator, and an administrator
- **THEN** each response is the same `404 TEAM_NOT_FOUND` and the handler issues no SQL query

#### Scenario: A non-canonical team id from an unauthenticated caller
- **WHEN** the `teamId` is not a canonical UUID and the request carries no valid session
- **THEN** the response is `401`, produced by the authentication middleware before the handler

#### Scenario: A nonexistent team is byte-identical to single restore
- **WHEN** an authorized caller posts for a well-formed team id that names no team
- **THEN** the `404 TEAM_NOT_FOUND` body and headers are byte-identical (apart from the correlation id) to those single restore returns for the same caller and team id, and for an administrator to those of assign-defaults

#### Scenario: The template team is indistinguishable from a missing team
- **WHEN** the `teamId` equals the template team id, in both lock states
- **THEN** the response is byte-identical to the `404 TEAM_NOT_FOUND` for a nonexistent team (apart from the correlation id)

#### Scenario: A locked team is refused
- **WHEN** the team has no completed session, even if it holds archived default rows
- **THEN** the response is `409 Conflict` with `TOPIC_CUSTOMIZATION_LOCKED` and no row changes

#### Scenario: A locked team with nothing archived is still refused
- **WHEN** the team has no completed session and holds no archived topics at all
- **THEN** the response is `409 Conflict` with `TOPIC_CUSTOMIZATION_LOCKED`, not `200` (a noted deviation from the literal reading of #218 AC5, which applies to unlocked teams)

#### Scenario: Routing (regression guard)
- **WHEN** requests are made to `POST /topics/restore-defaults`, `PUT /topics/order` and `POST /topics/:topicId/restore`
- **THEN** each resolves to its own handler

### Requirement: A constant timing floor applies at every exit

`applyTimingFloor` SHALL be applied at every exit of the endpoint: all 4xx, 429, 503, both `200` outcomes, and the thrown-error path (after rollback, before the error is rethrown to the global handler). This deliberately differs from single restore, whose thrown path skips the floor. The empty `200` and the non-empty `200` SHALL be timing-indistinguishable under the floor, and the floor is the shared content timing floor (`TIMING_FLOOR_MS`, read by every content route). The floor SHALL be at or above the measured p95/p99 of the non-empty `200` at N=12 and at a 50-row fixture; **that measurement is not yet done** (change tasks 4.12 and 4.14 remain open: no `timing-oracle.test.ts` extension, no 50-row median report, no p95/p99 run), the floor is still the 150 ms placeholder, and production deployment stays blocked on the existing `TODO-GROUP6` in `content/timing-oracle.ts` until a named owner closes it.

#### Scenario: Floor on handled exits
- **WHEN** the endpoint returns 403, 404, 409, 429, 503, an empty 200 or a non-empty 200
- **THEN** each response is delayed at least to the floor (covered by unit tests with a mocked floor; real-time p95/p99 evidence is the open measurement above)

#### Scenario: Floor on the thrown path
- **WHEN** a forced row-count mismatch or audit-insert failure makes the handler throw
- **THEN** the transaction is rolled back and the response (the standard 500 envelope) is delayed at least to the floor

#### Scenario: Cache-Control on every exit
- **WHEN** the endpoint returns 403, 404, 409, 429, 503, 200 (empty and non-empty) or 500
- **THEN** the response carries `Cache-Control: no-store`

### Requirement: Nothing to restore is a successful, stateless response

When no archived default is restorable, the endpoint SHALL return `200 OK` with `restored: []` (and `skipped` listing any defaults skipped under the duplicate rule, possibly empty), SHALL end its transaction with `ROLLBACK` (nothing was written; the lock is released immediately), SHALL write no `audit_log` row, SHALL change no state, and SHALL consume one unit of the caller's topic-write rate limit like any admitted request. It SHALL NOT return a 4xx or 409 for emptiness.

#### Scenario: Nothing archived
- **WHEN** the team has no archived default topics
- **THEN** the response is `200 OK` with both arrays empty and no audit row is written

#### Scenario: A second consecutive request is idempotent
- **WHEN** a successful bulk restore is immediately followed by a second bulk request and no default was skipped
- **THEN** the second response is `200 OK` with both arrays empty and writes no audit row

#### Scenario: Only skipped defaults remain
- **WHEN** every archived default is skipped by the duplicate rule
- **THEN** the response is `200 OK` with `restored` empty and `skipped` populated, and no audit row is written

### Requirement: Bulk restore is atomic and safe under concurrency

The restorable set SHALL be computed inside the transaction after the per-team topic lock is held. Either all computed topics are restored or none are; a failure SHALL leave every topic unchanged. The handler SHALL issue a number of SQL statements independent of the number of topics restored, performing the status flip as a single `UPDATE`; the test asserts that the statement count (excluding BEGIN and COMMIT, measured with a query counter) for one restorable topic equals the count for twelve. No cap on the number restored is enforced or intended; tests also exercise a 50-row fixture. If the `UPDATE` affects a different number of rows than the plan, the transaction SHALL roll back and the request SHALL fail as a thrown error (below). Concurrent bulk requests, or a bulk request concurrent with Add, single restore, archive, reorder or room open, SHALL be serialized by the same lock.

#### Scenario: Two concurrent bulk requests
- **WHEN** two bulk requests for one team run concurrently
- **THEN** no duplicate active row and no `display_order` collision results, both requests return `200 OK`, the union of the two `restored` arrays equals the full restorable set, their intersection is empty (which request wins is not asserted), and exactly one `topic.defaults_restored` audit row exists

#### Scenario: Concurrent single Add
- **WHEN** an Add and a bulk restore run concurrently on one team
- **THEN** no unique-index violation occurs and every active `display_order` is distinct

#### Scenario: Failure leaves nothing changed
- **WHEN** the audit insert fails inside the transaction
- **THEN** the transaction rolls back and no topic's status or order has changed, and the response is `500` with the application's standard error envelope (including `correlationId`) and no database detail

#### Scenario: A restore never commits without its audit row
- **WHEN** the audit insert is forced to fail
- **THEN** every topic in the plan is still archived afterwards

#### Scenario: Log emit failure after COMMIT
- **WHEN** `emitAuditEvent` throws after COMMIT
- **THEN** the response is still `200` with the committed result, the failure is logged without topic names, and the timing floor is still applied

#### Scenario: Row-count mismatch fails closed
- **WHEN** the status-flip `UPDATE` affects a different number of rows than the plan
- **THEN** the transaction rolls back, no topic has changed, and the response is `500` with the standard error envelope and no database detail; no partial `200` is ever returned

#### Scenario: Concurrent bulk and room open
- **WHEN** a bulk restore and room open for the team's session run concurrently
- **THEN** the session's `session_topics` snapshot is either entirely the pre-restore or entirely the post-restore set, never a mixture

#### Scenario: Concurrent bulk and a same-named Add
- **WHEN** a bulk restore and an Add of a custom topic with the name of an archived default run concurrently
- **THEN** no unique-index violation occurs, every active `display_order` is distinct, and the outcome is determined by lock order (the default is skipped if the Add committed first)

#### Scenario: Concurrent bulk and single restore of one topic
- **WHEN** a bulk restore and a single restore of one of the same topics run concurrently
- **THEN** the topic is active exactly once and every active `display_order` is distinct

### Requirement: Bulk restore never changes a session whose room is already open

The order and content of a session's topics are fixed at room open from the `session_topics` snapshot. A bulk restore SHALL NOT alter any `session_topics` row, and nothing about the restore (control, result, actor, or timing) SHALL appear in any participant-facing or session view.

#### Scenario: Restore during an open session
- **WHEN** a team's session is in `lobby` or in progress and a bulk restore commits
- **THEN** that session's `session_topics` rows (ids, names, prompts, order) are unchanged

#### Scenario: Restore while the session is a draft
- **WHEN** a team's session is in `draft` and a bulk restore commits before room open
- **THEN** the restored topics are included when the room opens

#### Scenario: A restored default joins the next snapshot
- **WHEN** a bulk restore commits and the team's next session then reaches room open
- **THEN** the session's snapshot includes the restored topics at their restored positions, with no restore-specific flag

### Requirement: The response reports actual outcomes

A `200` response SHALL have the shape `{ restored: [{topicId, name, displayOrder}], skipped: [{topicId, name, reason}] }`, where `reason` is currently only `NAME_ACTIVE` (a new reason is an additive change; clients SHALL tolerate an unknown reason), `restored` is ordered by `displayOrder`, and `skipped` is ordered by the restore-order sort (prior `display_order` ascending, then `id` ascending). It SHALL be computed from what the transaction did, not from any client-supplied list.

#### Scenario: A topic restored singly between preview and confirm
- **WHEN** one of the previewed defaults is restored individually before the bulk request is processed
- **THEN** the response is `200 OK` and that topic is absent from `restored`
