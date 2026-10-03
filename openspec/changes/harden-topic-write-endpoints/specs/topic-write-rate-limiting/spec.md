## ADDED Requirements

### Requirement: The five topic-write endpoints share one per-actor rate-limit budget

The system SHALL enforce a single rate-limit budget per actor, keyed on the authenticated `session.userId` (never on IP address). The budget SHALL be shared by exactly these five routes: `POST /api/v1/teams/:teamId/topics` (TOPIC-003), `DELETE /api/v1/teams/:teamId/topics/:topicId` (TOPIC-004, including both the pre-flight call that returns `requiresConfirmation` and the `?confirm=true` call), `POST /api/v1/teams/:teamId/topics/:topicId/restore` (TOPIC-005), `PUT /api/v1/teams/:teamId/topics/order` (TOPIC-006) and `PUT /api/v1/teams/:teamId/topics/:topicId/annotation` (TOPIC-007). The budget SHALL be per actor, not per (actor, team). An `application_admin` and a `facilitator` SHALL use the same budget and thresholds. No GET route SHALL be limited by it.

The budget SHALL be enforced as a true sliding window held in Redis, with two windows:
- **Burst:** 120 counted requests per rolling 10 minutes per actor.
- **Daily:** 400 counted requests per rolling 24 hours per actor.

There SHALL be no global (cross-actor) topic-write limit. The values above are normative and SHALL be defined once, in one constant (`TOPIC_WRITE_LIMITS`). Any future change to them SHALL keep the burst threshold at or above 100 and the daily threshold at or above 200 (the ritual floor, traced to use case 08 and `Feature Sets.md` §8). The burst floor of 100 is the 90-request two-team baseline-restore sitting below plus about 10% margin.

#### Scenario: Requests up to the burst threshold succeed and the next one is limited
- **WHEN** one actor issues 120 counted topic-write requests within 10 minutes
- **THEN** none of them returns `429`
- **AND** the 121st topic-write request within that window returns `429` with `error.code: "TOPIC_WRITE_BURST_LIMIT_EXCEEDED"`

#### Scenario: The budget is shared across routes
- **WHEN** one actor issues 60 add requests and 60 annotation requests within 10 minutes
- **THEN** that actor's next request on any of the five routes returns `429`

#### Scenario: The budget is per actor
- **WHEN** actor A is rate limited
- **THEN** actor B's topic-write requests are unaffected

#### Scenario: The budget is shared across teams
- **WHEN** one actor exhausts the burst budget through writes on team X
- **THEN** that actor's next topic-write request on team Y returns `429`

#### Scenario: Restoring the default baseline on two teams in one sitting is never limited
- **WHEN** one actor, on each of two unlocked teams in turn, archives 11 default topics with confirmation (22 requests), restores all 11 (11 requests) and annotates all 12 (12 requests), all within 10 minutes
- **THEN** no request returns `429`

#### Scenario: A full tailoring pass followed by pre-session edits is never limited
- **WHEN** one actor, within 10 minutes and on one unlocked team, sends this 78-request fixture: a tailoring pass of 11 archive pre-flights, 11 archive confirms, 11 restores, 5 adds, 17 annotations, 3 reorders and 5 adds rejected with `422` (63 requests); then pre-session edits of 5 annotations, 1 definition clear, 4 archives (each a pre-flight plus a confirm), 4 restores and 1 reorder (15 requests)
- **THEN** no request returns `429`

### Requirement: Only requests that pass authorization and are not rate-limited are counted

A request on any of the five routes SHALL be counted against both windows if, and only if, it has passed the endpoint's identity/role authorization and has not been rejected by the limiter. Counted requests SHALL include requests that later fail with `404`, `409` or `422`, and the archive pre-flight that returns `requiresConfirmation`. A request rejected with `403`, a request rejected for a non-canonical `teamId` and a request rejected with `429` SHALL NOT be counted. A request rejected with `503` because the limiter's Redis operation raised an error SHALL NOT be counted. A request rejected with `503` because the Redis operation timed out MAY be recorded if Redis later executes the command; not counting it is best effort, and the system SHALL NOT under-count as a result. Recording a request and checking both windows SHALL be one atomic Redis operation, and the request SHALL be recorded in both windows only when both are under their limit.

#### Scenario: A 429 does not extend the wait
- **WHEN** an actor who is over the burst limit sends five more topic-write requests
- **THEN** each one returns `429`
- **AND** the number of counted entries in the actor's burst and daily windows is unchanged

#### Scenario: Unauthorized requests do not consume budget
- **WHEN** a caller whose role fails authorization sends 200 topic-write requests
- **THEN** every response is `403`, never `429`
- **AND** no entry is added to that caller's windows

#### Scenario: Failed but authorized requests are counted
- **WHEN** an authorized actor sends a request that is rejected with `422`
- **THEN** one entry is added to each of the actor's windows

### Requirement: The limiter runs after authorization and before team existence, and never reveals team existence

On each of the five routes, the limiter check SHALL run after the non-canonical `teamId` check and after identity/role authorization, and before team existence, the template-team guard, the customization lock, topic lookup and body validation. The limiter's admission check SHALL issue no database query. Only the breach path writes the audit row described in the 429 requirement. For an actor who is over budget, the `429` response SHALL be identical (status, `Cache-Control`, `error.category`, `error.code`, `error.message`) whether the `teamId` is an existing team the actor may write, a canonical UUID of no team or `DEFAULT_TOPICS_TEAM_ID`. Only `Retry-After` and `correlationId` may differ. The limiter SHALL be invoked from a shared helper called explicitly in each of the five handlers immediately after authorization. It SHALL NOT be installed as a plugin-wide `preHandler`.

#### Scenario: Identical 429 for existing, non-existent and template teams
- **WHEN** an over-budget `facilitator` writes on any of the five routes, and separately an over-budget `application_admin` writes on TOPIC-003 to 006, to (a) an existing team, (b) a canonical UUID matching no team and (c) `DEFAULT_TOPICS_TEAM_ID`
- **THEN** all three responses are `429` with the same category, code, message and `Cache-Control`
- **AND** no `topic.write_denied_template` or `topic.write_denied_locked` row is written

#### Scenario: An administrator on TOPIC-007 still receives 403
- **WHEN** an over-budget `application_admin` sends an annotation request (TOPIC-007), which administrators fail at identity/role authorization
- **THEN** the response is `403`, not `429`

#### Scenario: A non-canonical teamId is still 404 when over budget
- **WHEN** an over-budget actor sends a topic write with `teamId = "not-a-uuid"`
- **THEN** the response is `404 TEAM_NOT_FOUND`
- **AND** the actor's windows are unchanged

#### Scenario: Every topic-write route applies the limiter after authorization and before team existence
- **WHEN** a behavioural test enumerates every topic-write route registered on the app and, for each, sends (a) a request from an over-budget caller whose role fails authorization and (b) a request from an over-budget authorized actor to a canonical UUID matching no team
- **THEN** (a) returns `403` and the caller's windows are unchanged
- **AND** (b) returns `429` and issues no query against `teams`

### Requirement: A rate-limit breach returns 429 with a fixed contract and is audited before responding

On breach, the endpoint SHALL respond `429 Too Many Requests` with:
- `Retry-After` set to a whole number of seconds, at least 1, equal to the time until the oldest counted entry leaves the breached window. When both windows are at their limit, `Retry-After` SHALL be the larger of the two windows' waits, and the code and message SHALL be those of the window with the larger wait (the daily window's on a tie);
- `Cache-Control: no-store`;
- a body built by `buildErrorEnvelope("rate_limited", <message>, <code>)`, where `code` is `TOPIC_WRITE_BURST_LIMIT_EXCEEDED` or `TOPIC_WRITE_DAILY_LIMIT_EXCEEDED` (chosen as above when both are breached);
- burst message: "You've made a lot of topic changes in a short time. Changes so far are saved. Please wait a few minutes and try again.";
- daily message: "You've reached today's limit for topic changes. Changes so far are saved. You can continue tomorrow.".

The messages SHALL NOT name the team or contain a number, and SHALL be defined once in `@dipstick/shared` and imported by the backend. The system SHALL write durable `audit_log` rows for breaches once per breach episode, not once per request. A breach episode on a window begins with the first `429` that finds that window at its limit while no episode is open on it, and ends when that window next has room. On the first `429` of an episode, before the response is sent, the system SHALL synchronously write exactly one durable `audit_log` row with `operation = 'topic.write_rate_limited'`, `actor_user_id`, `actor_global_role`, `actor_ip`, `team_id` (the lowercase path value, not verified to exist) and metadata `{ limit: "burst" | "daily", windows, observedCount, endpoint, team_verified: false }`, where `windows` lists the windows whose episode began with this request. Later `429`s within the same episode SHALL write no database row. Opening and detecting an episode SHALL be part of the same atomic Redis operation as the admission check. Every `429` SHALL emit the structured event `topic.write_rate_limit_exceeded`; within an episode, the event SHALL carry the number of `429`s suppressed from the audit table so far. The audit write SHALL use the existing fail-open audit path: if it fails or does not complete within `AUDIT_WRITE_TIMEOUT_MS` (500 ms), the system SHALL still respond `429` with the same contract, SHALL emit `auth.audit_write_failed`, and SHALL NOT respond `5xx`. The response SHALL apply `applyTimingFloor`. There SHALL be no lockout: once the window clears, the actor can write again.

#### Scenario: Burst breach response
- **WHEN** an actor exceeds the burst window
- **THEN** the response is `429` with `Retry-After` ≥ 1, `Cache-Control: no-store`, `error.category: "rate_limited"`, `error.code: "TOPIC_WRITE_BURST_LIMIT_EXCEEDED"` and the burst message
- **AND** if this is the first `429` of the episode, exactly one `topic.write_rate_limited` audit row exists for it, written before the response, with `metadata.team_verified = false`

#### Scenario: Later 429s in the same episode write no audit row
- **WHEN** an actor who is over the burst limit sends 50 topic-write requests before the burst window has room again
- **THEN** all 50 return `429`
- **AND** exactly one `topic.write_rate_limited` row exists for that episode
- **AND** every `429` emits `topic.write_rate_limit_exceeded`, the later ones carrying a suppressed count

#### Scenario: A new episode after the window has room again is audited again
- **WHEN** an actor's burst episode has ended because the window had room, a request was admitted, and the actor then breaches the burst window again
- **THEN** the first `429` of the new episode writes one new `topic.write_rate_limited` row

#### Scenario: Daily breach response
- **WHEN** an actor has 400 counted requests spread over more than 40 minutes, so that the burst window is never full, and sends a 401st topic-write request within 24 hours of the first
- **THEN** the response is `429` with `error.code: "TOPIC_WRITE_DAILY_LIMIT_EXCEEDED"` and the daily message

#### Scenario: Both windows breached, daily wait longer
- **WHEN** an actor has 280 counted requests from 2 hours ago and 120 counted requests within the last 10 minutes, so both windows are at their limit and the daily wait (about 22 hours) exceeds the burst wait
- **THEN** the response is `429` with `error.code: "TOPIC_WRITE_DAILY_LIMIT_EXCEEDED"`, the daily message and a `Retry-After` equal to the daily wait, which is greater than 600

#### Scenario: Both windows breached, burst wait longer
- **WHEN** an actor has 280 counted requests from 23 hours 59 minutes ago and 120 counted requests within the last minute, so both windows are at their limit and the burst wait (about 9 minutes) exceeds the daily wait (about 1 minute)
- **THEN** the response is `429` with `error.code: "TOPIC_WRITE_BURST_LIMIT_EXCEEDED"`, the burst message and a `Retry-After` equal to the burst wait

#### Scenario: Audit write failure still answers 429
- **WHEN** an actor exceeds the burst window and the `topic.write_rate_limited` audit write throws or hangs
- **THEN** the response is the same `429` contract, sent no later than the timing floor plus 500 ms plus 250 ms
- **AND** an `auth.audit_write_failed` event is emitted and no response is `5xx`

#### Scenario: No lockout after the window clears
- **WHEN** an actor was limited and the burst window has since cleared
- **THEN** the actor's next topic write proceeds through the rest of the cascade normally

### Requirement: The limiter fails closed with 503 when Redis is unavailable or slow

If the limiter's Redis operation raises an error, or does not complete within 500 ms, the request SHALL be rejected with `503 Service Unavailable`, `Retry-After: 30`, `Cache-Control: no-store` and `buildErrorEnvelope("service_unavailable", "Topic changes are temporarily unavailable. This change wasn't saved; changes you made earlier are kept. Please try again shortly.", "TOPIC_WRITE_RATE_LIMIT_UNAVAILABLE")`. The system SHALL emit the structured event `topic.write_rate_limit_check_failed`. No topic, audit or other database write for the request SHALL take place. The response SHALL apply `applyTimingFloor`.

#### Scenario: Redis error
- **WHEN** the Redis call throws during a topic write on any of the five routes
- **THEN** the response is `503` with `error.code: "TOPIC_WRITE_RATE_LIMIT_UNAVAILABLE"` and `Retry-After: 30`
- **AND** the team's topic rows are unchanged
- **AND** no entry is added to the actor's windows

#### Scenario: Redis hangs
- **WHEN** the Redis call does not answer
- **THEN** the response is `503` with the same envelope, sent no later than the timing floor plus 500 ms plus 250 ms
- **AND** the team's topic rows are unchanged (the actor's windows MAY later record the request if Redis executes the queued command)

### Requirement: The topic-write limiter never applies to session runtime

The topic-write limiter SHALL be invoked only from the five topic-write handlers. It SHALL NOT be imported by, or applied to, `facilitator-sessions.ts`, room open, session advance, voting or any other session or WebSocket runtime module. This applies even though room open takes the same per-team topic advisory lock.

#### Scenario: Structural exclusion
- **WHEN** the structural test scans the backend sources
- **THEN** the topic-write limiter module is imported only by `routes/topics.ts` (and its own tests)

#### Scenario: An exhausted budget does not block a session
- **WHEN** a facilitator has exhausted their topic-write burst and daily budgets
- **THEN** that facilitator can still open the room and advance a session for a team they facilitate

### Requirement: The topic-write budget is independent of TEAM-006, whose behaviour is unchanged

The sliding-window mechanism SHALL live in one shared module used by both TEAM-006 and the topic-write limiter. Topic-write Redis keys SHALL live under `dipstick:ratelimit:topic-write:`, distinct from TEAM-006's `dipstick:ratelimit:team-manager:`, and all of one actor's topic-write keys SHALL share a hash tag on the actor's `userId`. TEAM-006's thresholds (20 per 10 minutes and 100 per 24 hours per actor, 100 per 10 minutes global), its counting semantics, codes, messages, audit operation, event names and key prefixes SHALL be unchanged. Its response bodies SHALL be byte-identical apart from `correlationId`.

#### Scenario: Budgets do not interact
- **WHEN** an actor exhausts the topic-write budget
- **THEN** that actor's TEAM-006 requests are not limited on that account
- **AND** exhausting the TEAM-006 budget does not limit that actor's topic writes

#### Scenario: TEAM-006 tests pass unchanged
- **WHEN** the existing TEAM-006 test files run after the extraction
- **THEN** they pass with no assertion changes (edits limited to import paths)
