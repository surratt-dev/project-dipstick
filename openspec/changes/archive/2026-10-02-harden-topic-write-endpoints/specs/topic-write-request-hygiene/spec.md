## ADDED Requirements

### Requirement: Topic-write handlers lowercase teamId immediately after the canonical-UUID check

Each of the five topic-write handlers (TOPIC-003 add, 004 archive, 005 restore, 006 reorder and 007 annotation) SHALL convert the `teamId` path value to lowercase immediately after `rejectNonCanonicalTeamId` accepts it. Every later use SHALL use the lowercase value: database queries, the per-team advisory lock, the template-team comparison, audit rows, structured logs, limiter metadata and response bodies. The template-team guard SHALL reject every letter-case spelling of `DEFAULT_TOPICS_TEAM_ID`.

#### Scenario: Audit rows use the lowercase teamId
- **WHEN** a successful topic write is made through a path whose `teamId` is uppercase
- **THEN** the audit row's `team_id` and every structured log `teamId` for that request are lowercase

#### Scenario: The template guard is case-insensitive by construction
- **WHEN** a unit test replaces the template sentinel with an ID containing hex letters and sends a write using the uppercase spelling of that ID
- **THEN** the response is `404 TEAM_NOT_FOUND` and a `topic.write_denied_template` row is written

### Requirement: Topic writes on different letter cases of one team serialize on the same lock

All four lock-taking topic-write handlers (add, archive, restore and reorder) SHALL serialize against each other, and against room open, regardless of the letter case of `teamId` in the request path.

#### Scenario: Concurrent archives on mixed-case paths cannot remove the last active topic
- **WHEN** a team has exactly two active topics, and two `DELETE …/topics/:topicId?confirm=true` requests for those two topics run concurrently, one on a lowercase `teamId` path and one on an UPPERCASE path
- **THEN** exactly one returns `200`, the other returns `409 TOPIC_LAST_ACTIVE`
- **AND** exactly one active topic remains

#### Scenario: Add, restore and reorder serialize on an uppercase path
- **WHEN** an add, a restore or a reorder on an UPPERCASE `teamId` path runs while the lowercase-keyed team lock is held
- **THEN** that request waits for the lock before writing

#### Scenario: Room open and an uppercase-path reorder serialize in both directions
- **WHEN** a reorder on an UPPERCASE `teamId` path runs while room open holds that team's lock, and separately room open runs while that reorder holds it
- **THEN** in each case the second operation waits until the first releases the lock
- **AND** the test drives room open through its existing route, with no change to `facilitator-sessions.ts`

### Requirement: No team-scoped topic route returns 5xx for a malformed path identifier

A non-canonical `teamId` on any team-scoped topic route, read or write, SHALL be answered `404 TEAM_NOT_FOUND`, with the timing floor applied and no database query issued. This happens before authorization: a malformed ID names no team, so the `404` depends only on the caller's own input. A non-canonical `topicId` on archive, restore and annotation SHALL be answered `404` with `buildErrorEnvelope("not_found", "Topic not found.", "TOPIC_NOT_FOUND")` at the topic-existence step, with no query against `topics`. Identifier validation SHALL be performed in the handlers and their shared helpers. It SHALL NOT be done with a Fastify route-parameter schema, because a schema would answer `400` without the timing floor or the house envelope.

#### Scenario: Malformed topicId on archive, restore and annotation
- **WHEN** an authorized actor on an existing, unlocked team sends archive, restore or annotation with `topicId` set to a hyphenless UUID, a braced UUID, `not-a-uuid` or `%20`
- **THEN** each response is `404` with `error.code: "TOPIC_NOT_FOUND"`
- **AND** no query against `topics` is issued for that `topicId`, and no response is `5xx`

#### Scenario: Malformed teamId on the topic read routes
- **WHEN** any caller requests `GET /api/v1/teams/not-a-uuid/topics` or `GET /api/v1/teams/not-a-uuid/topics/all`
- **THEN** the response is `404` with `error.code: "TEAM_NOT_FOUND"`, never `5xx`
- **AND** no query is issued for that `teamId`

#### Scenario: Malformed teamId precedes authorization
- **WHEN** a caller who would fail authorization sends a topic write with `teamId = "not-a-uuid"`
- **THEN** the response is `404 TEAM_NOT_FOUND`, not `403`
