## MODIFIED Requirements

### Requirement: Draft-status landing after session creation

Upon successful creation, the facilitator SHALL be navigated to a real, bookmarkable, refresh-safe route (`/team/:teamId/session/:sessionId`) rendering their own control view for the new `draft`-status session — not a participant-facing room and not an already-open lobby. This route SHALL be rehydratable independent of the create flow: on any mount, the frontend SHALL fetch current session status from `GET /api/v1/teams/:teamId/sessions/:sessionId/facilitator-state` (which already enforces `facilitator_id === caller` server-side) and render the draft control view when status is `draft`, or the live participant-readiness view otherwise. The control view SHALL display: available team context (team name and `lastSessionAt`, if any), the team's join link, and an explicit "Open the room" action. The session SHALL NOT be automatically advanced to `lobby` as part of creation.

The join link displayed and copyable from this view SHALL be a real, redeemable `join_links` token (obtained via the `join-link` capability's get-or-create requirement), assembled into the exact URL path the backend's join-redemption route is registered at. It SHALL NOT be sourced from any session-scoped token minted alongside the session row. Because this token is redeemable the moment it is displayed — team membership has never been gated on session status, and gating it is out of scope here — the badge accompanying it during `draft`, and no other status, SHALL describe what happens if the link is used right away, not merely which noun is gated: **"This link works already — anyone who opens it before you open the room won't see a waiting screen yet."** This wording replaces any prior "not yet joinable" phrasing, which becomes untrue the moment the link is backed by a real, always-redeemable team join link rather than an inert placeholder. No equivalent caution is added to the live participant-readiness view a session transitions to once it leaves `draft`; the badge shown during `draft` is treated as sufficient, since it is displayed before the facilitator decides whether and when to share the link — see design.md Decision 5.

This requirement governs redemption and its own display copy only. It makes no claim about what an Engineer who redeems the link during `lobby` subsequently sees — the redirect destination for that case is governed by the `join-link` capability's "Session-aware join link landing" requirement, not by this requirement. That destination is now correct for `lobby` (as it is for `pre_session` and `active`); whether a first-time-joining Engineer is actually authorized to see content once there is a separate, still-open gap (see the `join-link` capability's requirement for detail).

Because no `session_status` transition in this system is reversible, and because opening the room is the moment the session's topic list is locked in (room open, see `session-topic-lifecycle`), activating "Open the room" SHALL first require a lightweight inline confirmation before the request fires. The confirmation SHALL read: **"Opening the room lets participants join immediately and locks in this session's {N} topics in their current order. Topic changes after this apply to your next session. This cannot be undone."** `{N}` is the draft facilitator state's `activeTopicCount`, and "topics" is written "topic" when N is 1. When the facilitator activates "Open the room", the draft host SHALL refetch facilitator state and SHALL show the confirmation only after that refetch returns, so N is never stale; while the refetch is in flight, "Open the room" SHALL show a pending state and SHALL NOT fire a second refetch. This refetch, and the refetches after a `422` or `409` below, SHALL NOT replace the control view with a loading state or a full-page error; on failure the control view stays in place and shows an inline error. If the refetch returns a `draft` session with `activeTopicCount` of 1 or more, the confirmation SHALL be shown with that N. If it returns `activeTopicCount: 0`, the confirmation SHALL NOT be shown, and the zero-topic disabled state below SHALL apply. If it returns a status other than `draft` (the room was opened elsewhere, for example from another tab), the view SHALL update to the live participant-readiness view with no error. If the refetch fails, the confirmation SHALL NOT be shown, and the view SHALL show its existing inline, retryable error. The confirmation SHALL be calm and factual, with no warning icon and no error colour. When `activeTopicCount` is 0, "Open the room" SHALL be disabled and the view SHALL show, next to it, "This team has no active topics. Add or restore a topic on Topic Management before opening the room." with a link to the team's Topic Management screen.

Once confirmed, the view SHALL call the existing session-advance endpoint (`POST /api/v1/teams/:teamId/sessions/:sessionId/advance`). On success, the session transitions to `lobby` and becomes joinable, and the same control view updates in place to the live participant-readiness view, with no additional navigation. If the advance returns `422`, the view SHALL refetch facilitator state, and if the session is now in `lobby` or later, it SHALL treat the open as successful and update to the live participant-readiness view with no error. The decision SHALL be based on the refetched status, not on the error message. If the refetch after a `422` shows the session still in `draft`, or the refetch itself fails, the view SHALL show an inline error with a retry action. If the advance returns `409` with `error.code: "NO_ACTIVE_TOPICS"`, the view SHALL refetch facilitator state and SHALL show no retry action; the zero-topic disabled state then applies, and its copy is the only message shown. Only if that refetch fails SHALL the view show the response message inline, still with no separate retry action; "Open the room" SHALL then stay enabled, so that its next activation re-runs the confirmation refetch, and the view never needs a page reload to recover. On any other failure (not `422`, and not `409 NO_ACTIVE_TOPICS`), the control view remains unchanged — the draft session is not affected by a failed advance attempt — and displays an inline, retryable error. The wording of the pending label on "Open the room", of the inline error after a failed confirmation refetch, and of the fixed `500` messages is not normative; the strings that ship are listed in the change's release notes for the facilitator walkthrough.

#### Scenario: Facilitator lands in draft control view after creation, not an open lobby
- **WHEN** a facilitator successfully creates a session for an existing team
- **THEN** the resulting session has status `draft`
- **AND** the facilitator is navigated to `/team/:teamId/session/:sessionId`, showing their own control view with team context, the join link, and an "Open the room" action
- **AND** no participant can join the session in this state

#### Scenario: Draft control view survives a page refresh
- **WHEN** a facilitator on their own `draft` session's control view refreshes the page, or navigates to `/team/:teamId/session/:sessionId` directly (bookmark or typed URL)
- **THEN** the same control view is rendered again, rehydrated from `GET /api/v1/teams/:teamId/sessions/:sessionId/facilitator-state`
- **AND** the facilitator is not routed back to the picker

#### Scenario: Opening the room requires confirmation and succeeds
- **WHEN** the facilitator activates "Open the room" on a `draft` session they created, confirms the inline prompt, and the advance request succeeds
- **THEN** the session transitions to `lobby`
- **AND** the control view updates in place to the live participant-readiness view without navigating away
- **AND** the join link becomes usable for joining

#### Scenario: The confirmation states the lock-in with the topic count
- **WHEN** the facilitator activates "Open the room" for a team with 9 active topics
- **THEN** the confirmation reads "Opening the room lets participants join immediately and locks in this session's 9 topics in their current order. Topic changes after this apply to your next session. This cannot be undone."

#### Scenario: The confirmation uses the singular for one topic
- **WHEN** the facilitator activates "Open the room" for a team with exactly 1 active topic
- **THEN** the confirmation reads "... locks in this session's 1 topic in their current order. ..."

#### Scenario: A team with no active topics cannot open the room from the draft view
- **WHEN** the draft facilitator state reports `activeTopicCount: 0`
- **THEN** "Open the room" is disabled
- **AND** the view shows "This team has no active topics. Add or restore a topic on Topic Management before opening the room." with a link to Topic Management

#### Scenario: A double-click opens the room once, with no error shown
- **WHEN** the facilitator's first advance request succeeds and a second, concurrent advance request returns `422`
- **THEN** the view refetches facilitator state, sees `lobby`, and shows the live participant-readiness view
- **AND** no error banner is shown

#### Scenario: Opening the room fails and the facilitator can retry without side effects
- **WHEN** the facilitator activates "Open the room", confirms, and the advance request fails with a network error or a `5xx`
- **THEN** the session remains in `draft` status
- **AND** the facilitator remains on the same control view with an inline error and a retry action
- **AND** retrying does not require re-creating the session or navigating away and back

#### Scenario: A 422 whose refetch still shows draft offers a retry
- **WHEN** the advance returns `422` and the refetched facilitator state shows the session still in `draft`
- **THEN** the view shows an inline error and a retry action

#### Scenario: A 422 whose refetch fails offers a retry
- **WHEN** the advance returns `422` and the refetch of facilitator state itself fails
- **THEN** the view shows an inline error and a retry action
- **AND** it does not show the live participant-readiness view

#### Scenario: A team with no active topics by the time the advance runs gives a clear dead end with no retry
- **WHEN** the confirmation was shown with `activeTopicCount: 1`, the team has zero active topics by the time the advance runs (a data-drift state no API sequence produces, seeded directly in tests), and the facilitator confirms, so the advance returns `409` with `error.code: "NO_ACTIVE_TOPICS"`
- **THEN** the session remains `draft`
- **AND** after the refetch, "Open the room" is disabled and the view shows the no-active-topics copy and the link to Topic Management, as the only message, with no retry action

#### Scenario: A 409 whose refetch fails shows the server message without a retry
- **WHEN** the advance returns `409` with `error.code: "NO_ACTIVE_TOPICS"` and the refetch of facilitator state fails
- **THEN** the view shows the response message inline, with no separate retry action
- **AND** "Open the room" stays enabled, so its next activation re-runs the confirmation refetch (which shows the confirmation, or the zero-topic disabled state) and the page never needs a reload to recover
- **AND** the control view is not replaced by a loading state or a full-page error

#### Scenario: The confirmation appears only after a fresh count is fetched
- **WHEN** the facilitator activates "Open the room" and the refetch of facilitator state returns a `draft` session with `activeTopicCount: 6`
- **THEN** the confirmation appears after the refetch returns, and reads "... locks in this session's 6 topics in their current order. ..."

#### Scenario: A fresh count of zero shows the disabled state instead of the confirmation
- **WHEN** the facilitator activates "Open the room" and the refetch returns `activeTopicCount: 0`
- **THEN** no confirmation is shown
- **AND** "Open the room" is disabled, with the no-active-topics copy and the link to Topic Management

#### Scenario: A room already opened elsewhere is shown as open, with no error
- **WHEN** the facilitator activates "Open the room" and the refetch returns a status other than `draft`
- **THEN** no confirmation is shown, and the view updates to the live participant-readiness view with no error

#### Scenario: A failed count refetch does not show a stale confirmation
- **WHEN** the facilitator activates "Open the room" and the refetch of facilitator state fails
- **THEN** no confirmation is shown
- **AND** the view shows an inline, retryable error

#### Scenario: Draft-view join link is redeemable, not inert
- **WHEN** an Engineer follows the join link displayed on a `draft`-status session's control view
- **THEN** `GET /api/join/:token` validates the token against the team's real `join_links` row and admits the Engineer to the team
- **AND** this holds regardless of the session's `draft` status, because team join has never been gated on session status

#### Scenario: Early-redemption badge describes the operational risk, not the gated noun
- **WHEN** a facilitator views a `draft`-status session's control view before activating "Open the room"
- **THEN** the badge next to the join link reads "This link works already — anyone who opens it before you open the room won't see a waiting screen yet."
- **AND** no copy on the page describes the link as "not yet joinable"

#### Scenario: No additional caution is shown once the room is open
- **WHEN** a facilitator's session transitions from `draft` to `lobby` (a successful "Open the room")
- **THEN** the resulting live participant-readiness view displays no join-link caution or badge of its own
- **AND** this is not an oversight: the `draft`-stage badge above is the only caution shown regarding early redemption, considered sufficient because it is displayed before the facilitator decides whether and when to share the link — a decision already made by the time the session reaches `lobby`

#### Scenario: This requirement does not speak to lobby-landing behavior
- **WHEN** an Engineer redeems a session's join link while that session's status is `lobby`
- **THEN** this requirement makes no claim about what page or state the Engineer subsequently lands on — the redirect destination is governed by the `join-link` capability's "Session-aware join link landing" requirement, not by this requirement

### Requirement: New-team creation via `POST /api/v1/teams`

The application SHALL provide `POST /api/v1/teams`, callable only by a caller whose `users.global_role` is `facilitator`, which creates a new team, assigns it the canonical default topic set (see `default-topic-provisioning`), creates that team's first session, and snapshots that session's topic list — all in a single database transaction. The session created by this endpoint SHALL be recorded with `is_first_session = true`, computed explicitly for this flow rather than inherited from any other session-creation code path. On success, the new session SHALL land directly in `lobby` status (see the draft-skip requirement below), not `draft`. Its creation is therefore its room open (see `session-topic-lifecycle`): the session SHALL have `room_opened_at` set at insert, and its `session_topics` rows SHALL be written from the new team's topics in the same transaction, after the topic copy and the session insert. Locking the list immediately, with no draft window, is intended. If the topic copy yields zero active topics (the template team has no defaults), the whole transaction SHALL roll back, the response SHALL be `500` with `error.category: "internal_error"`, the fixed message "Team creation is unavailable because the default topic set is not configured. Contact an administrator.", and the request's `correlationId`, and an error-level log line SHALL record the condition, including the template team id and the same `correlationId`. The response body SHALL NOT include the template team id or any SQL or constraint detail. Any other failure of the snapshot statement SHALL roll back the transaction and produce a `500` with `error.category: "internal_error"`, a fixed message, and the request's `correlationId`; the database error SHALL be logged with the same `correlationId` and SHALL NOT be echoed in the response. (This app registers no global error handler today; the handler returns this fixed body itself.) The wording of that fixed message is not normative. It is not audited, because an audit row would roll back with the transaction. A failure at any step of the transaction SHALL leave no team, topic, session, or session-topic record behind.

#### Scenario: Facilitator creates a new team and its first session
- **WHEN** an authenticated caller with `users.global_role = 'facilitator'` submits `POST /api/v1/teams` with a unique, non-empty team name
- **THEN** a new `teams` row is created with that name
- **AND** the new team's `topics` rows are populated from the canonical default topic set
- **AND** a new `sessions` row is created for the new team and the caller, with `status = 'lobby'`, `is_first_session = true`, and `room_opened_at` set
- **AND** the session has one `session_topics` row per default topic, in canonical order, numbered 1..N
- **AND** a join link is generated for the session
- **AND** all of the above commit in a single transaction

#### Scenario: Non-facilitator caller is rejected
- **WHEN** a caller whose `users.global_role` is not `facilitator` submits `POST /api/v1/teams`
- **THEN** the request is rejected with `403`
- **AND** no team, topic, or session record is created
- **AND** an `audit_log` row is written identifying the actor, the actor's global role, and the actor's IP

#### Scenario: Empty team name is rejected
- **WHEN** a caller submits `POST /api/v1/teams` with an empty or whitespace-only team name
- **THEN** the request is rejected with a validation error
- **AND** no team, topic, or session record is created

#### Scenario: Transaction failure leaves no partial state
- **WHEN** `POST /api/v1/teams` fails at any point after the team insert has been attempted (topic copy, session insert, topic snapshot, or audit write)
- **THEN** the entire transaction rolls back
- **AND** no team, topic, session, or `session_topics` record from this request exists afterward

#### Scenario: An empty default-topic template rolls back the whole request
- **WHEN** `POST /api/v1/teams` runs while the template team has no default topics
- **THEN** the response is `500` with `error.category: "internal_error"`, the message "Team creation is unavailable because the default topic set is not configured. Contact an administrator.", and a `correlationId`
- **AND** the response body does not contain the template team id
- **AND** no team, topic, session, or `session_topics` record from this request exists afterward
- **AND** an error-level log line records the configuration fault and includes the template team id and the response's `correlationId`

#### Scenario: A successful team-and-session creation is audited
- **WHEN** a caller successfully creates a new team and its first session via `POST /api/v1/teams`
- **THEN** an `audit_log` row is written in the same transaction as the `INSERT INTO teams` and `INSERT INTO sessions` rows, identifying the actor, the actor's global role, the actor's IP, the new team's id, and the new session's id
- **AND** its metadata includes `topic_count` (the number of `session_topics` rows written) and `topic_ids` (their `topic_id` values in snapshot `display_order`), subject to the content boundary in "The room-open audit row records the snapshot"

## ADDED Requirements

### Requirement: Opening the room snapshots the session's topic list in the same transaction

`POST /api/v1/teams/:teamId/sessions/:sessionId/advance` SHALL complete every authorization check (session existence, team match, caller is the session's facilitator, caller's live facilitator role) before it takes the team's advisory lock, so an unauthorized caller can never hold that lock. It SHALL then, in one transaction: take the team's advisory lock, keyed on the session row's `team_id` in canonical UUID text form (`pg_advisory_xact_lock(hashtext(team_id::uuid::text))`, the same key every structural topic write uses); transition the session with `UPDATE sessions SET status = 'lobby', room_opened_at = now() WHERE id = $1 AND team_id = $2 AND facilitator_id = $3 AND status = 'draft'`; and, only if that statement updated exactly one row, insert the session's `session_topics` snapshot (see `session-topic-lifecycle`) and write the `session.state_changed` audit row. If the snapshot fails or would insert zero rows, the transaction SHALL roll back: `sessions.status` remains `draft`, `room_opened_at` remains `NULL`, and no `session.state_changed` audit row and no `session_state_change` event are produced. A zero-row snapshot is answered as the `409 NO_ACTIVE_TOPICS` below. Any other failure inside the transaction (the snapshot insert, the lock, the conditional update, the audit insert, or the commit) SHALL roll back and produce a `500` with `error.category: "internal_error"`, a fixed message, and a `correlationId`; the underlying error SHALL be logged server-side with the same `correlationId` and SHALL NOT be echoed in the response. (This app registers no global error handler today, so the handler returns this fixed body itself.) The wording of those fixed messages is not normative. The `session_state_change` event SHALL be published only after the transaction commits. The success response shape is unchanged.

#### Scenario: A successful open writes status, timestamp, snapshot, and audit together
- **WHEN** the facilitator advances a `draft` session for a team with 7 active topics
- **THEN** the session is `lobby`, `room_opened_at` is set, it has 7 `session_topics` rows, and one `session.state_changed` audit row exists for `draft → lobby`, all committed together

#### Scenario: A snapshot failure leaves the draft untouched
- **WHEN** the snapshot insert fails during `/advance`
- **THEN** the session remains `draft` with `room_opened_at` NULL and zero `session_topics` rows
- **AND** no `session.state_changed` audit row and no `session_state_change` event are produced
- **AND** the response is `500` with `error.category: "internal_error"`, a fixed message, and a `correlationId`, and contains no database error text

#### Scenario: Any other room-open transaction failure returns a fixed 500
- **WHEN** a statement other than the snapshot fails inside the `/advance` transaction (for example the audit insert)
- **THEN** the transaction rolls back and the session remains `draft` with `room_opened_at` NULL
- **AND** the response is `500` with `error.category: "internal_error"`, a fixed message, and a `correlationId`
- **AND** the database error is logged with that `correlationId` and is not echoed in the response

### Requirement: Opening the room is refused when the team has no active topics

If the team has zero active topics when `/advance` runs (evaluated under the team's advisory lock), the request SHALL be rejected with `409`, `error.category: "precondition_failed"`, and `error.code: "NO_ACTIVE_TOPICS"`, with the message "This team has no active topics. Add or restore a topic on Topic Management before opening the room." The session SHALL remain in `draft`, and no audit row and no event SHALL be written. A session with a single active topic SHALL be allowed to open. Authorization comes first: a caller who is not the session's facilitator SHALL receive `403` whatever the team's active topic count, so topic state cannot be probed without authorization. The status check comes next: a session not in `draft` SHALL receive `422` whatever the team's active topic count, and SHALL never receive `409 NO_ACTIVE_TOPICS`.

#### Scenario: Zero active topics returns NO_ACTIVE_TOPICS
- **WHEN** the facilitator advances a `draft` session for a team with no active topics
- **THEN** the response is `409` with `error.category: "precondition_failed"`, `error.code: "NO_ACTIVE_TOPICS"`, and the message above
- **AND** the session remains `draft` with no `session_topics` rows, no `session.state_changed` audit row, and no `session_state_change` event

#### Scenario: A session not in draft gets 422 even when the team has no active topics
- **WHEN** the facilitator calls `/advance` for a session in `lobby` whose team has zero active topics
- **THEN** the response is `422`, not `409`
- **AND** no row, audit entry, or event is written

#### Scenario: A non-creator gets 403, not 409, on a team with no active topics
- **WHEN** a user who is not the session's facilitator calls `/advance` for a `draft` session whose team has zero active topics
- **THEN** the response is `403`, not `409`
- **AND** no row, audit entry for the open, or event is written

#### Scenario: One active topic is enough
- **WHEN** the facilitator advances a `draft` session for a team with exactly one active topic
- **THEN** the session opens with one `session_topics` row at `display_order = 1`

### Requirement: A concurrent second "Open the room" is a clean 422 that writes nothing

When two `/advance` requests for the same `draft` session run concurrently, exactly one SHALL succeed. The other SHALL return the same `422` the endpoint returns today for a session not in `draft`, including its message naming the session's current status (re-read inside the transaction when the conditional update matches no row). It SHALL write no audit row and no `session_topics` rows, and SHALL NOT return a 5xx. This SHALL be verified by an integration test that runs two genuinely concurrent transactions against the real Postgres instance of the integration lane (`.github/workflows/integration.yml`), each on its own pool connection, not only by asserting which SQL the code issues. That test SHALL fail, not skip, when the integration lane's Postgres is unreachable.

#### Scenario: Double advance gives one success and one 422
- **WHEN** two `/advance` requests for the same `draft` session are sent concurrently
- **THEN** one returns success and the other returns `422`
- **AND** the session has exactly one set of `session_topics` rows and exactly one `draft → lobby` `session.state_changed` audit row
- **AND** neither response is a 5xx

### Requirement: Sessions record when their room opened

`sessions` SHALL have a nullable `room_opened_at timestamptz` column, added by an additive migration with no backfill. `/advance` SHALL set it in the conditional `draft → lobby` update, and `POST /api/v1/teams` SHALL set it at insert. It SHALL remain `NULL` while a session is in `draft`, and SHALL never be changed after it is set.

#### Scenario: A draft has no room-open time
- **WHEN** a facilitator creates a draft session
- **THEN** its `room_opened_at` is NULL

#### Scenario: Opening the room sets the room-open time once
- **WHEN** the draft is advanced to `lobby` and later started and run to `complete`
- **THEN** `room_opened_at` equals the time of the advance and is unchanged by every later transition

### Requirement: The draft facilitator state reports the team's active topic count

`GET /api/v1/teams/:teamId/sessions/:sessionId/facilitator-state` SHALL include `activeTopicCount: number` (a JSON number, never a string: the current count of topics with `status = 'active'` for the session row's team) when the session is in `draft`, and SHALL omit the field for every other status. Clients SHALL NOT treat an absent field as zero. The field is a hint for the confirmation copy and the disabled state. The `/advance` guard remains authoritative.

#### Scenario: The draft state carries the count
- **WHEN** the facilitator fetches facilitator state for a `draft` session whose team has 9 active topics
- **THEN** the response includes `activeTopicCount: 9`

#### Scenario: Non-draft states omit the count
- **WHEN** the facilitator fetches facilitator state for a session in `lobby`, `pre_session`, `active`, or `wrap_up`
- **THEN** the response has no `activeTopicCount` field
- **AND** the view does not show the zero-topic disabled state

### Requirement: The room-open audit row records the snapshot

The `session.state_changed` audit row written by a successful `/advance` (`draft → lobby`) SHALL include, in its metadata, `topic_count` (the number of `session_topics` rows written) and `topic_ids` (their `topic_id` values in snapshot `display_order`), in addition to its existing fields. The snapshot-derived audit content for room open (this row and `team.created_with_session`) SHALL be limited to `topic_count` and `topic_ids` (`topics.id` values). It SHALL NEVER include `topic_name`, `topic_prompt`, or `topic_annotation`. The structured audit log event emitted after commit for each of these operations SHALL carry `topicCount` and SHALL NOT carry the topic id list or any topic text.

#### Scenario: Audit metadata lists the snapshotted topics
- **WHEN** the facilitator opens the room for a team whose active topics, in order, are A, B, C
- **THEN** the `session.state_changed` audit row's metadata includes `topic_count: 3` and `topic_ids: [A, B, C]`

#### Scenario: Audit content never carries topic text
- **WHEN** a room opens through `/advance` or `POST /api/v1/teams` for topics with names, prompts, and annotations
- **THEN** neither the `audit_log` row's metadata nor the emitted audit log event contains any topic name, prompt, or annotation
- **AND** the emitted audit log event carries `topicCount` equal to the row's `topic_count`

### Requirement: Opening the room requires the caller's live facilitator role

`/advance` SHALL reject with `403` (`error.category: "forbidden"`) a caller whose current `users.global_role` is not `facilitator` (including a caller with no user row), even when the caller is the session's `facilitator_id`. The check SHALL run after the session-existence, team-match, and session-facilitator checks and before the status check and the transaction. A rejection SHALL write an `audit_log` row with operation `session.advance_denied_role`, identifying the actor, the actor's global role, the actor's IP, the team id, and the session id. The session SHALL remain `draft`, and no `session_topics` rows and no `session_state_change` event SHALL be produced.

#### Scenario: A creator whose facilitator role was revoked cannot open the room
- **WHEN** a user created a `draft` session as a facilitator, their `global_role` is then changed away from `facilitator`, and they call `/advance`
- **THEN** the response is `403`
- **AND** the session remains `draft` with zero `session_topics` rows
- **AND** an `audit_log` row with operation `session.advance_denied_role` is written
