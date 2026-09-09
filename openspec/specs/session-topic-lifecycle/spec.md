# session-topic-lifecycle

## Purpose

Defines the session-and-topic phase state machine: `lobby → pre_session` (`SESSION-004`), `pre_session → active` (`SESSION-005`), topic-to-topic advance and `active → wrap_up` entry (`SESSION-012`), and the reveal write (`voting → revealed`) with its hard preconditions (no re-reveal, no advance before reveal) and their calm, non-error-chrome UX treatment. Includes the vote lock-in / reveal race-condition fix as a correctness requirement of the reveal guarantee this capability establishes — a vote must not be admitted into a topic whose reveal has already committed.

This spec covers: the session-phase entry points that let a session legally reach `active`; the atomic, precondition-guarded reveal write and its concurrency behavior; the vote lock-in / reveal race fix; topic-to-topic advance and wrap-up entry as a single branching endpoint; and the explicit rule that mid-session topic-skipping is not supported.

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

The application SHALL NOT provide a mechanism to move a session's current topic from `voting` directly to `complete` without an intervening reveal. A topic that no longer applies to a team SHALL be removed from the topic list before the session is **created** (FR-8.2) — the topic list is snapshotted into `session_topics` at session creation (`SESSION-001`), not at session start (`SESSION-004`), so an edit made after a session already exists has no effect on that session's topic list, however long it remains in `lobby` before starting.

#### Scenario: No skip action exists mid-session

- **WHEN** a session is `active` and its current topic is `voting`
- **THEN** the only state transitions available for that topic are reveal (`voting → revealed`) or continued voting
- **AND** no endpoint transitions the topic directly from `voting` to `complete`
