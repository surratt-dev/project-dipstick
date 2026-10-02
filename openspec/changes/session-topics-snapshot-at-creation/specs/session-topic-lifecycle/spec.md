## MODIFIED Requirements

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

## ADDED Requirements

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
