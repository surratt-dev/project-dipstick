## MODIFIED Requirements

### Requirement: Reorder never modifies an existing session's topic sequence

The reorder SHALL write only to `topics`. It SHALL NOT insert, update, or delete any `session_topics` row, and it SHALL NOT be blocked because the team has a session in any status. No endpoint SHALL accept a topic order scoped to a single session. A session's topic sequence is fixed at room open (see `session-topic-lifecycle`). A reorder saved while the team's session is still in `draft` is used by that session when its room opens. A reorder saved after room open is used by the team's next session.

#### Scenario: Reorder does not affect a session whose room is open
- **WHEN** an unlocked team has a session in `lobby` or `active` status and the facilitator saves a new order
- **THEN** the save succeeds
- **AND** that session's `session_topics.display_order` values are unchanged

#### Scenario: Reorder does not rewrite history
- **WHEN** a team has completed sessions and a new order is saved
- **THEN** no `session_topics` row for any completed session is modified

#### Scenario: The reorder transaction writes no session_topics row
- **WHEN** any reorder succeeds
- **THEN** the number and content of `session_topics` rows is identical before and after the request

#### Scenario: A reorder during the draft is used when the room opens
- **WHEN** an unlocked team's session is in `draft`, the facilitator saves a new order, and then opens the room
- **THEN** that session's `session_topics` rows follow the new order, numbered 1..N

#### Scenario: A reorder after room open reaches the next session
- **WHEN** a facilitator saves a new order while the team's session is in `lobby`, and the team's next session later reaches room open
- **THEN** the next session's `session_topics` rows follow the new order

### Requirement: The reorder response indicates to a facilitator whether a created, not-yet-completed session keeps its original order

The `200` response SHALL include `openSessionCreatedAt: string | null`. The field name is kept for compatibility. Its value is the **room-open time** of the team's open session, not that session's creation time. For a caller with `global_role = 'facilitator'`, the value SHALL be the `room_opened_at` of the team's session in status `lobby`, `pre_session`, `active`, or `wrap_up` if one exists (the most recently opened one, should more than one ever exist), and `null` otherwise. For such a session whose `room_opened_at` is NULL (one whose room opened before `room_opened_at` existed), the value SHALL fall back to its `created_at`. For such a session that was created as a draft and opened on a later day, the hint's "opened on {date}" then shows the creation date. This is an accepted, transitional mismatch that only affects sessions opened before this change shipped, and it is not a defect. For a caller with `global_role = 'application_admin'`, the value SHALL always be `null`, and the handler SHALL NOT read the team's sessions: application administrators are denied session content, and this field SHALL NOT become an unaudited way for them to learn a team's session state (see design.md Decision 7). A `draft` session SHALL NOT produce a value: a draft's room has not opened, its topic list is not yet snapshotted, and the reorder being saved will reach it. The value SHALL be read inside the reorder transaction. It is informational only and SHALL NOT change the outcome of the reorder.

#### Scenario: A team with a lobby session receives its room-open time
- **WHEN** a facilitator saves a new order for a team with a session in `lobby`
- **THEN** the response's `openSessionCreatedAt` equals that session's `room_opened_at`

#### Scenario: A draft opened on a later day reports the open time, not the draft time
- **WHEN** a draft created on September 29 is advanced to `lobby` on September 30, and the facilitator then saves a new order
- **THEN** the response's `openSessionCreatedAt` is the September 30 room-open timestamp

#### Scenario: A pre-existing open session without a room-open time falls back to creation time
- **WHEN** a facilitator saves a new order for a team whose `lobby` session has `room_opened_at` NULL
- **THEN** the response's `openSessionCreatedAt` equals that session's `created_at`

#### Scenario: A team whose only open session is a draft receives null
- **WHEN** a facilitator saves a new order for a team whose only non-terminal session is in `draft`
- **THEN** the response's `openSessionCreatedAt` is `null`

#### Scenario: A team with no open session receives null
- **WHEN** a facilitator saves a new order for a team whose sessions are all `complete` or `abandoned`
- **THEN** the response's `openSessionCreatedAt` is `null`

#### Scenario: An application administrator always receives null
- **WHEN** an `application_admin` saves a new order, or submits the current order unchanged, for a team with a session in `lobby`
- **THEN** the response is `200 OK` with `openSessionCreatedAt: null`
