# session-topic-lifecycle

## Purpose

Defines the session-and-topic phase state machine: `lobby → pre_session` (`SESSION-004`), `pre_session → active` (`SESSION-005`), topic-to-topic advance and `active → wrap_up` entry (`SESSION-012`), and the reveal write (`voting → revealed`) with its hard preconditions (no re-reveal, no advance before reveal) and their calm, non-error-chrome UX treatment. Includes the vote lock-in / reveal race-condition fix as a correctness requirement of the reveal guarantee this capability establishes — a vote must not be admitted into a topic whose reveal has already committed.

This spec covers: the session-phase entry points that let a session legally reach `active`; the atomic, precondition-guarded reveal write and its concurrency behavior; the vote lock-in / reveal race fix; topic-to-topic advance and wrap-up entry as a single branching endpoint; the team annotation carried on `SESSION-005`/`SESSION-012`'s `currentTopic`, read only from the `session_topics` snapshot (added by `topic-annotation`); the room-open topic snapshot itself, its contents, timing, and isolation from later topic edits (added by `session-topics-snapshot-at-creation`, #175); canonical-id validation at the route boundary for routes that authorize on, lock on, or snapshot a team's topics; and the explicit rule that mid-session topic-skipping is not supported. The session topic snapshot is not configurable.

This spec does NOT cover: the WebSocket delivery-time authorization, dispatch, or payload-construction logic that fans these transitions' events out to subscribers (see `websocket-session-authorization`); the HTTP content-access authorization layer used to read session/team content (see `team-content-access`); team membership removal or its mid-session effects (deferred to a future change); action item finalization (already satisfied by the existing session-complete write, `SESSION-006` — not part of this state machine).

**Implementation and verification status (`session-lifecycle-transitions`, backend implementation review):** All requirements below are implemented, and the backend integration/unit test suite (418 passed, 1 pre-existing skip unrelated to this capability, 0 failed) passes against every one of them, including the authorization-before-precondition ordering rule for the `already_revealed`/`advance_blocked` error states. Two verification gaps are named explicitly rather than left implicit:
- The concurrent-reveal and lock-in/reveal-race scenarios above are verified by tests asserting the code issues the correct conditional `UPDATE` / `SELECT ... FOR UPDATE` and branches correctly on the result — not by a test exercising two genuinely concurrent transactions against a live Postgres instance, because no live-database integration test lane exists anywhere in this codebase (a pre-existing, codebase-wide constraint, not something introduced by this change). Both implementation reviews independently re-derived the row-locking mechanism from Postgres semantics and confirmed it sound by inspection. A real-Postgres concurrency test is recommended before production rollout.
- Cross-verification of this change's writes against the end-to-end tasks they unblock in `websocket-delivery-time-authorization`'s own task list has not been run — it requires a live Docker/Postgres/Redis stack unavailable in the review sandbox. This is an open follow-up verification step, not a defect in what shipped.

Two items this spec's backend fully supports but does not itself implement or verify: the frontend rendering of the `already_revealed`/`advance_blocked` states (see `team-content-access` spec's Error States 1a/1b for the required UX contract), and the client-side WebSocket team-channel subscription a session-scoped client needs to actually receive a `topic_history_update` event (delivered on the team-scoped registry by design, not the session-scoped one a participant's other events arrive on). Both are named, unimplemented frontend follow-up work, not silently assumed complete.

---

## Requirements

### Requirement: Session advances from lobby to pre-session action item review

The application SHALL provide an endpoint (`SESSION-004`) that transitions a session from `lobby` to `pre_session`, callable only by the session's facilitator, only while the session is in `lobby` status. The transition SHALL set `sessions.started_at` and return the team's open/in-progress action items from prior completed sessions for the pre-session review (FR-3.1).

#### Scenario: Facilitator starts the session from the lobby

- **WHEN** the session's facilitator calls `SESSION-004` while the session is in `lobby` status
- **THEN** `sessions.status` transitions to `pre_session` and `sessions.started_at` is set
- **AND** the response includes open and in-progress action items from the team's completed sessions, oldest first
- **AND** a `session_state_change` WebSocket event is published to the session's subscribers after the transaction commits

#### Scenario: Non-facilitator cannot start the session

- **WHEN** a user who is not the session's facilitator calls `SESSION-004`
- **THEN** the request is rejected with `403 Forbidden`
- **AND** `sessions.status` is unchanged

#### Scenario: Starting a session that has already left the lobby is rejected

- **WHEN** `SESSION-004` is called for a session whose status is not `lobby`
- **THEN** the request is rejected with `409 Conflict`
- **AND** no state is changed

#### Scenario: Facilitator with no open action items can proceed immediately

- **WHEN** the pre-session review returns zero open or in-progress action items for the team
- **THEN** the response clearly indicates this state
- **AND** the facilitator can advance to voting without acknowledging or dismissing any item

### Requirement: Session advances from pre-session review to active voting

The application SHALL provide an endpoint (`SESSION-005`) that transitions a session from `pre_session` to `active`, callable only by the session's facilitator, only while the session is in `pre_session` status. The transition SHALL, in the same transaction, set `sessions.voting_started_at`, set `sessions.current_topic_id` to the session's first topic (by `display_order`), and set that first topic's `session_topics.status` to `voting`.

#### Scenario: Facilitator begins voting after the pre-session review

- **WHEN** the session's facilitator calls `SESSION-005` while the session is in `pre_session` status
- **THEN** `sessions.status` transitions to `active`, `sessions.voting_started_at` is set, and `sessions.current_topic_id` is set to the first topic
- **AND** that first topic's `session_topics.status` transitions to `voting`
- **AND** a `session_state_change` WebSocket event is published to the session's subscribers after the transaction commits
- **AND** participants may not trigger this transition (FR-3.4)

#### Scenario: Beginning voting from an invalid session state is rejected

- **WHEN** `SESSION-005` is called for a session whose status is not `pre_session`
- **THEN** the request is rejected with `409 Conflict`
- **AND** neither `sessions` nor `session_topics` is modified

### Requirement: Reveal is a one-way, precondition-guarded state transition

The application SHALL implement the reveal action as an atomic write transitioning a topic's `session_topics.status` from `voting` to `revealed` and setting `session_topics.revealed_at`, gated by a hard precondition that the topic is currently `voting`. A reveal attempt against a topic that is not currently `voting` SHALL be rejected without modifying any state, and SHALL NOT re-trigger event delivery for a topic that was already revealed.

#### Scenario: Facilitator reveals a topic in the voting phase

- **WHEN** the session's facilitator triggers reveal for a topic whose `session_topics.status` is `voting`
- **THEN** `session_topics.status` transitions to `revealed` and `session_topics.revealed_at` is set
- **AND** a `session.reveal_triggered` audit log entry is written in the same transaction
- **AND** a `vote_revealed` WebSocket event is published to the session's subscribers only after the transaction commits

#### Scenario: A second reveal on an already-revealed topic is rejected without re-publishing

- **WHEN** the session's facilitator triggers reveal for a topic whose `session_topics.status` is already `revealed`
- **THEN** the request is rejected with `409 Conflict` and an `already_revealed` error state
- **AND** no `vote_revealed` event is published
- **AND** no additional `session.reveal_triggered` audit log entry is written

#### Scenario: Concurrent reveal attempts for the same topic produce exactly one committed transition

- **WHEN** two reveal requests for the same topic are submitted concurrently while the topic is `voting`
- **THEN** exactly one request commits the `voting → revealed` transition
- **AND** the other request is rejected with the `already_revealed` error state
- **AND** exactly one `vote_revealed` event is published

### Requirement: Vote lock-in is rejected once its topic's reveal has committed

The application SHALL NOT admit a vote into a topic whose `session_topics.status` is not `voting` at the moment of insertion. A lock-in request racing a concurrent reveal for the same topic SHALL resolve so that no vote is both inserted after the reveal's precondition check passes and included in the revealed result for that topic.

#### Scenario: Lock-in is rejected for a topic that has already been revealed

- **WHEN** a participant submits a lock-in request for a topic whose `session_topics.status` is `revealed`
- **THEN** the request is rejected with `422` (`invalid_request` category — the same code the handler's pre-existing `topic_status !== 'voting'` check already returns for this substantive failure, so one status code means one thing regardless of which check path catches it)
- **AND** no row is inserted into `votes`

#### Scenario: A lock-in racing a concurrent reveal for the same topic does not corrupt the revealed set

- **WHEN** a lock-in request and a reveal request for the same topic are submitted concurrently while the topic is `voting`
- **THEN** the two requests resolve in a consistent order — either the lock-in commits and is included in the reveal, or the reveal commits first and the lock-in is rejected
- **AND** no vote is inserted after the reveal transaction has committed for that topic

### Requirement: Topic advance and wrap-up entry are gated by a hard reveal precondition

The application SHALL provide an endpoint (`SESSION-012`) that transitions a session from its current revealed topic to either the next topic in `display_order` (setting the new topic to `voting` and updating `sessions.current_topic_id`) or, when no next topic exists, into `wrap_up` (setting `sessions.status = 'wrap_up'`, `sessions.wrap_up_started_at`, and clearing `sessions.current_topic_id`). This transition SHALL be gated by a hard precondition that the current topic's `session_topics.status` is `revealed`; an attempt to advance before the current topic has been revealed SHALL be rejected without modifying any state.

#### Scenario: Facilitator advances to the next topic after reveal

- **WHEN** the session's facilitator calls `SESSION-012` and the current topic's status is `revealed` and a next topic exists in `display_order`
- **THEN** the current topic's `session_topics.status` transitions to `complete`
- **AND** the next topic's `session_topics.status` transitions to `voting`
- **AND** `sessions.current_topic_id` updates to the next topic, and `sessions.status` remains `active`
- **AND** the response's `status` field is `'active'`, with a populated `currentTopic` for the new topic
- **AND** a `topic_history_update` WebSocket event (`updateType: "topic_advanced"`) is published to the team's subscribers after the transaction commits

#### Scenario: Facilitator advances past the final topic into wrap-up

- **WHEN** the session's facilitator calls `SESSION-012` and the current topic's status is `revealed` and no next topic exists in `display_order`
- **THEN** the current topic's `session_topics.status` transitions to `complete`
- **AND** `sessions.status` transitions to `wrap_up`, `sessions.wrap_up_started_at` is set, and `sessions.current_topic_id` is cleared
- **AND** the response's `status` field is `'wrap_up'`, with `wrapUpStartedAt` set and no `currentTopic`
- **AND** a `session_state_change` WebSocket event is published to the session's subscribers after the transaction commits
- **AND** participants may not trigger this transition (FR-6.1)

#### Scenario: Advancing before the current topic is revealed is rejected

- **WHEN** the session's facilitator calls `SESSION-012` and the current topic's `session_topics.status` is `voting` (not yet revealed)
- **THEN** the request is rejected with `409 Conflict` and an `advance_blocked` error state whose `requiresReveal` field is `true`
- **AND** no state is modified

### Requirement: Mid-session topic-skipping is not supported

The application SHALL NOT provide a mechanism to move a session's current topic from `voting` directly to `complete` without an intervening reveal. A topic that no longer applies to a team SHALL be removed from the topic list before the session's **room opens** (FR-8.2). The topic list is snapshotted into `session_topics` at room open (see "Room open is the single moment a session's topic list is snapshotted"), not at draft creation and not at session start (`SESSION-004`). An edit made after a session's room has opened has no effect on that session's topic list, however long the session remains in `lobby` or `pre_session` before voting begins. An edit made while the session is still in `draft` does reach that session.

#### Scenario: No skip action exists mid-session

- **WHEN** a session is `active` and its current topic is `voting`
- **THEN** the only state transitions available for that topic are reveal (`voting → revealed`) or continued voting
- **AND** no endpoint transitions the topic directly from `voting` to `complete`

#### Scenario: An edit made during the draft reaches the session

- **WHEN** a team's session is in `draft` and the facilitator archives a topic, then opens the room
- **THEN** the session's `session_topics` rows do not include the archived topic

#### Scenario: An edit made after room open does not reach the session

- **WHEN** a team's session is in `lobby` and the facilitator then archives one of its topics
- **THEN** that session's `session_topics` rows still include the archived topic, and the session still presents it

### Requirement: Session topic payloads carry the team annotation from the session snapshot only

The begin-voting response (`SESSION-005`, `currentTopic`) and the topic-advance response (`SESSION-012`, `currentTopic` when `status = 'active'`) SHALL include `topicAnnotation: string | null`, read only from `session_topics.topic_annotation` for that session topic. Neither response SHALL read the annotation from `topics.team_annotation`, so an annotation edited after a session's topics were snapshotted SHALL NOT change what that session shows. Any in-session display of the annotation SHALL use these payloads, not TOPIC-001 or TOPIC-002.

#### Scenario: Begin-voting returns the snapshotted annotation
- **WHEN** a session's first `session_topics` row has `topic_annotation = 'X'` and the facilitator calls `SESSION-005`
- **THEN** the response's `currentTopic.topicAnnotation` is `"X"`

#### Scenario: Advance returns the snapshotted annotation
- **WHEN** the next `session_topics` row has `topic_annotation = 'X'` and the facilitator calls `SESSION-012` after reveal
- **THEN** the response's `currentTopic.topicAnnotation` is `"X"`

#### Scenario: A null snapshot returns null
- **WHEN** the relevant `session_topics` row has `topic_annotation` NULL
- **THEN** `currentTopic.topicAnnotation` is `null` in both responses

#### Scenario: Editing the live topic does not change session output
- **WHEN** a `session_topics` row has `topic_annotation = 'X'`, and its source `topics.team_annotation` is subsequently set to `'Y'`
- **THEN** both `SESSION-005` and `SESSION-012` still return `topicAnnotation: "X"` for that session topic

### Requirement: A session topic snapshot copies the topic's annotation in the same write as the rest of the row

WHEN `session_topics` rows are written for a session, each row's `topic_annotation` SHALL equal its source topic's `team_annotation` at that instant, written by the same statement as the `topic_name`, `topic_prompt`, `vote_type`, and `display_order` snapshot. The annotation SHALL NOT be snapshotted at a different moment from the rest of the row. The write happens at room open (decided by #175 for the whole row). It therefore completes before the session's first `SESSION-005` (begin-voting) call can succeed, which is the first point at which a topic is presented to participants.

#### Scenario: The snapshot captures the annotation alongside the prompt
- **WHEN** a session's room opens while topic T has `team_annotation = 'X'` and `prompt = 'P'`
- **THEN** T's `session_topics` row has `topic_annotation = 'X'` and `topic_prompt = 'P'`, both written by the same statement

#### Scenario: An annotation edited during the draft is the one snapshotted
- **WHEN** a session is in `draft`, the facilitator changes topic T's annotation from `'X'` to `'Y'`, and then opens the room
- **THEN** T's `session_topics.topic_annotation` for that session is `'Y'`
- **AND** the `SESSION-005` or `SESSION-012` payload that presents T carries `topicAnnotation: "Y"`

#### Scenario: A later edit does not reach an existing snapshot
- **WHEN** a session's room has opened and the team's annotation for topic T is then changed
- **THEN** T's `session_topics.topic_annotation` for that session is unchanged

### Requirement: Room open is the single moment a session's topic list is snapshotted

*Room open* SHALL mean the moment a session's status first becomes `lobby`. That happens only through `POST /api/v1/teams/:teamId/sessions/:sessionId/advance` (`draft → lobby`) or `POST /api/v1/teams` (a new team's first session, created directly in `lobby`). Every requirement in this or any other capability that refers to the moment a session's topic list is fixed SHALL mean room open. The application SHALL write a session's `session_topics` rows at room open and at no other time. The single exception is the one-off, pre-release operator backfill (design.md, Migration Plan step 3), which SHALL run only if the operator answers "Yes" to the backfill question, and which MAY write rows only for a session that is in `lobby` or `pre_session`, has zero `session_topics` rows, and whose room opened before this change shipped, using the same snapshot statement as room open. The backfill SHALL take session ids only and derive each session's team from its session row; SHALL re-check, per session and under the team's advisory lock, that the session is still in `lobby` or `pre_session` with zero `session_topics` rows, skipping it otherwise; SHALL write, in the same transaction as each session's rows, an `audit_log` row with operation `session.topics_backfilled`, an operator/system actor marker, the session and team ids, `topic_count`, and `topic_ids` (never topic text); and SHALL write nothing unless explicitly invoked in write mode, defaulting to a dry run that lists the session ids it would touch. No application endpoint SHALL perform that backfill, and no application module SHALL import it. Creating a `draft`, starting a session (`SESSION-004`), and beginning voting (`SESSION-005`) SHALL NOT write, add, remove, or reorder `session_topics` rows. The session topic snapshot is not configurable: no setting, flag, or per-team option SHALL make a session read its topic list live.

#### Scenario: A backfill re-run skips sessions that already have rows
- **WHEN** the operator backfill runs in write mode for a session that already has `session_topics` rows
- **THEN** that session is skipped and reported, no rows are written for it, and the run does not fail with a uniqueness violation

#### Scenario: A backfill dry run writes nothing
- **WHEN** the operator backfill runs without its explicit write flag
- **THEN** it lists the session ids it would touch and writes no `session_topics` or `audit_log` rows

#### Scenario: A draft has no session topics
- **WHEN** a facilitator creates a draft session for an existing team
- **THEN** the session has zero `session_topics` rows

#### Scenario: Opening the room writes the snapshot
- **WHEN** the facilitator advances the draft to `lobby`
- **THEN** the session has one `session_topics` row per active topic the team had at that instant

#### Scenario: Every session whose room opens through either route has a snapshot
- **WHEN** a session reaches `lobby` through `/advance` or through `POST /api/v1/teams` after this change ships
- **THEN** it has at least one `session_topics` row, with `display_order = 1` present

#### Scenario: Later phases do not rewrite the snapshot
- **WHEN** a session whose room has opened is started (`SESSION-004`) and voting begins (`SESSION-005`)
- **THEN** the set of `session_topics` rows (ids, `topic_id`, `display_order`, `topic_name`, `topic_prompt`, `vote_type`, `topic_annotation`) is the same as immediately after room open, apart from per-topic `status` and timestamps

### Requirement: The snapshot contains exactly the team's active topics, densely ordered from 1

At room open, the application SHALL insert, in a single statement, exactly one `session_topics` row for each of the team's topics with `status = 'active'`, and no others. The source team SHALL be the session row's own `team_id`, resolved inside that statement; the snapshot SHALL NOT accept a team identifier from its caller, so a session can never receive another team's topics. Each row SHALL carry `topic_id`, `topic_name` ← `name`, `topic_prompt` ← `prompt`, `vote_type`, `topic_annotation` ← `team_annotation`, `display_order` ← `row_number() OVER (ORDER BY display_order, id)`, and `status = 'waiting'`. `revealed_at`, `completed_at`, `flagged_for_discussion`, and `discussion_note` SHALL keep their column defaults. The rows' `display_order` values SHALL be exactly 1..N in the team's active order, whatever gaps exist in `topics.display_order`. Custom topics (`is_default = false`) SHALL be snapshotted exactly like default topics.

#### Scenario: A session never receives another team's topics
- **WHEN** a room opens for a session of team A while team B has active topics
- **THEN** every `session_topics` row of that session references a topic whose `team_id` is team A

#### Scenario: Gaps in the active order are renumbered
- **WHEN** a team's active topics have `display_order` values {1, 3, 4} at room open
- **THEN** the session's `session_topics.display_order` values are {1, 2, 3}, in that same relative order

#### Scenario: An archived first position is renumbered
- **WHEN** a team's active topics have `display_order` values {2, 3} (position 1 archived) at room open
- **THEN** the session's `session_topics.display_order` values are {1, 2}

#### Scenario: Archived topics are excluded
- **WHEN** a team has five topics, one of them archived, at room open
- **THEN** the session has four `session_topics` rows, none of which references the archived topic

#### Scenario: A reordered list is snapshotted in its new order
- **WHEN** a team that has completed a session reorders its topics while its next session is in `draft`, then opens the room
- **THEN** begin-voting presents the topic now first in the team's order, and each `SESSION-012` advance presents the next topic in that new order until `wrap_up`

#### Scenario: A new team's first session uses the canonical default order
- **WHEN** a facilitator creates a new team via `POST /api/v1/teams`
- **THEN** the first session's `session_topics` rows are the canonical default topics, in canonical order, numbered 1..N

#### Scenario: A team still under the customization lock opens a draft first session with the canonical defaults
- **WHEN** a team with no completed session (for example, one whose `POST /api/v1/teams` session was abandoned) creates a `draft` session and advances it to `lobby`
- **THEN** that session's `session_topics` rows are the canonical default topics, in canonical order, numbered 1..N
- **AND** this follows from the lock alone: a locked team cannot archive, add, or reorder topics, so its active list is the canonical defaults, and the "no active topics" path cannot be reached for it

### Requirement: `first_session_description` is the only topic field read live during a session

`first_session_description` SHALL be the one topic field not copied into `session_topics`. It is administrator-maintained default copy, read from `topics` at begin-voting, and it is stable for a team's first session under the customization lock. No other in-session topic field (name, prompt, vote type, annotation, order) SHALL be read from `topics` by any session-phase endpoint or payload.

#### Scenario: Name and prompt come from the snapshot
- **WHEN** a session's room has opened and the source topic's `name` or `prompt` is later changed
- **THEN** `SESSION-005` and `SESSION-012` still return the snapshotted `topicName` and `topicPrompt`

### Requirement: The snapshot reflects one committed instant of the team's topic list

The snapshot SHALL reflect the team's committed active topic list at a single instant. It SHALL NOT mix the before and after states of a concurrent reorder, archive, add, or restore, and it SHALL NOT contain negative or duplicate `display_order` values. Those structural writes and room open serialize on the team's advisory lock, which room open SHALL take in a statement before the snapshot statement. Annotation edits do not take that lock; each row's annotation is consistent with the rest of that row because the snapshot is one statement, and an annotation edit committed concurrently with room open is either fully in the snapshot or fully absent from it (last-writer-wins relative to room open). This SHALL be verified by an integration test that runs two genuinely concurrent transactions against the real Postgres instance of the integration lane (`.github/workflows/integration.yml`), each on its own pool connection, not only by asserting which SQL the code issues. That test SHALL fail, not skip, when the integration lane's Postgres is unreachable.

#### Scenario: A reorder racing room open
- **WHEN** a reorder for the team and a room open for the team's draft run concurrently
- **THEN** the session's `session_topics` order equals either the full pre-reorder order or the full post-reorder order
- **AND** every `display_order` value is in 1..N with no duplicates

### Requirement: Topic edits after room open never change that session's rows, and do reach the next session

Once a session's room has opened, no topic write (reorder, archive, add, restore, or annotation edit) SHALL insert, update, or delete any of that session's `session_topics` rows. Each of those edits SHALL be reflected in the snapshot of the team's next session to reach room open.

#### Scenario: Edits during lobby leave the session unchanged
- **WHEN** a session is in `lobby` and the facilitator reorders, archives a topic, adds a custom topic, restores a topic, and edits an annotation
- **THEN** that session's `session_topics` rows are unchanged in every column
- **AND** when the team's next session reaches room open, its snapshot reflects all of those edits

#### Scenario: History survives archive, and the next snapshot excludes the topic
- **WHEN** topic T appeared in a completed session and is then archived
- **THEN** T's past `session_topics` rows still appear in that team's history and trends
- **AND** the next session's room-open snapshot does not include T

### Requirement: Begin-voting's empty-snapshot guard remains as a backstop

`SESSION-005` SHALL keep rejecting a session with no `session_topics` row at `display_order = 1` with its existing `409` and message. After this change, that guard can only fire for a session whose room opened before this change shipped.

#### Scenario: A pre-change session with no rows is still rejected cleanly
- **WHEN** a `pre_session` session has zero `session_topics` rows and its facilitator calls `SESSION-005`
- **THEN** the response is the existing `409` "This session has no topics configured and cannot begin voting", and no state changes

### Requirement: Routes that authorize on, lock on, or snapshot a team's topics accept only canonical ids

Postgres accepts non-canonical spellings of a UUID (no hyphens, braces, other groupings) and canonicalises them, so a route that authorizes on one spelling and queries with another can get two different answers for the same team. The following routes SHALL therefore reject a path id that is not in canonical 8-4-4-4-12 hexadecimal form (either letter case) with `404` and `error.category: "not_found"`, before any database query, including the authorization query: `teamId` on `POST /api/v1/teams/:teamId/sessions/draft`, on `GET /api/v1/teams/:teamId/topics/all`, and on the five topic write routes (add, archive, restore, reorder, annotate); and `sessionId` on `POST /api/v1/teams/:teamId/sessions/:sessionId/advance`. Authorization helpers SHALL NOT rewrite or coerce the id they are given; the route boundary is the only place the shape is checked, using one shared definition. Because a malformed id names no team or session, answering `404` ahead of `403` reveals nothing about whether any team exists. Non-canonical `topicId` values on archive and restore, and ids on routes this change does not touch, are out of scope.

#### Scenario: A non-canonical spelling of the caller's own team id is refused
- **WHEN** a standing facilitator of a team calls `POST /draft`, `GET /topics/all`, or any of the five topic write routes using a hyphenless, braced, or regrouped spelling of that team's id
- **THEN** the response is `404` with `error.category: "not_found"`
- **AND** no session, topic, or audit row is written

#### Scenario: A malformed session id on advance is a 404, not a 500
- **WHEN** a facilitator calls `/advance` with a `sessionId` that is not a canonical UUID
- **THEN** the response is `404` with `error.category: "not_found"`, issued before any query
- **AND** the response contains no database error text
