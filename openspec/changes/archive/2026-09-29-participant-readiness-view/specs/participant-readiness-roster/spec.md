## ADDED Requirements

### Requirement: The roster is Facilitator-only

The application SHALL render the participant readiness roster (participant names and connection state, for a session in `lobby` status) only to the session's Facilitator. A non-facilitator (Engineer) viewing the session room during `lobby` status SHALL see a waiting message only — no participant names, no participant count, and no indication of how many others have joined.

#### Scenario: Facilitator sees the roster
- **WHEN** the Facilitator views the session room for a session in `lobby` status
- **THEN** they see a list of participants who have joined, by name

#### Scenario: Participant does not see the roster
- **WHEN** an Engineer (non-facilitator) views the session room for a session in `lobby` status
- **THEN** they see a waiting message with no participant names, no participant count, and no indication of how many others have joined

### Requirement: The roster is visible on every facilitator-facing surface for `lobby` status, without navigation

The roster SHALL be visible on both `DraftSessionHost` (the Facilitator's landing page after creating a session) and `SessionLobbyPage`'s `lobby` branch, without requiring the Facilitator to navigate away from whichever page they are on. Both surfaces SHALL consume the same shared roster component/hook rather than independent implementations.

#### Scenario: Facilitator sees the roster without leaving their landing page
- **WHEN** the Facilitator is on `DraftSessionHost` for a session in `lobby` status
- **THEN** the roster is visible on that page, with no navigation required to see it

#### Scenario: Facilitator sees the roster after following the pre_session navigate link
- **WHEN** the Facilitator is on `SessionLobbyPage`'s `lobby` branch
- **THEN** the roster is visible on that page as well

### Requirement: The roster shows an explicit empty-state prompt when no one has joined

When a session in `lobby` status has zero participants, the roster area SHALL display a prompt indicating no one has joined yet, rather than an empty or blank list. The join link SHALL remain displayed alongside the empty-state prompt.

#### Scenario: Facilitator sees the empty-roster prompt before anyone joins
- **WHEN** the Facilitator views the roster for a session in `lobby` status with zero participants
- **THEN** the roster area displays a prompt indicating no one has joined yet
- **AND** the join link remains visible

### Requirement: The roster updates in real time as participants join

As each Engineer's session-scoped WebSocket connection registers, the roster SHALL update to include them without requiring a page refresh, consuming the existing `participant_joined` WebSocket event.

#### Scenario: A new participant appears live
- **WHEN** an Engineer's session-scoped WebSocket connection registers for a session in `lobby` status
- **THEN** the Facilitator's roster updates to include that participant within the same session, without a page refresh

### Requirement: A disconnected participant's row is held, not removed, and does not change position

Rows are keyed by the participant's `userId`. When a participant's session-scoped WebSocket connection deregisters, the roster SHALL mark their existing row as disconnected rather than removing it. When that participant reconnects (including via their own page refresh), the roster SHALL clear the disconnected marker on the existing row rather than creating a new row. A participant's position in the roster SHALL NOT change as a result of disconnecting or reconnecting.

#### Scenario: Disconnection is reflected without removing the row
- **WHEN** a participant's session-scoped WebSocket connection deregisters (tab close, navigation away, or connection drop)
- **THEN** the Facilitator's roster marks that participant's row as disconnected, in real time, without removing it from the list

#### Scenario: Reconnection clears the marker on the same row
- **WHEN** a previously-disconnected participant's session-scoped WebSocket connection registers again
- **THEN** the roster clears the disconnected marker on their existing row
- **AND** no duplicate row is created
- **AND** the participant's position in the list is unchanged from before the disconnection

#### Scenario: The disconnected marker does not indicate a cause
- **WHEN** the roster displays a disconnected marker for any participant
- **THEN** the marker indicates only that the participant is disconnected, and does not distinguish the cause (network drop, reauth, or any other reason)

### Requirement: The roster persists across the Facilitator's own page refresh

Refreshing the page SHALL NOT lose any participant from the roster. The initial roster fetch SHALL be restored from the session's durable participant record, not from in-memory connection-registry state.

#### Scenario: Facilitator refreshes the page
- **WHEN** the Facilitator refreshes `DraftSessionHost` or `SessionLobbyPage` while a session is in `lobby` status
- **THEN** the participant list is restored from the session record
- **AND** no participants are lost, including any currently marked disconnected

### Requirement: Roster entries are sorted alphabetically by participant name and the sort is stable across reconnect

The roster SHALL be sorted alphabetically by participant display name. A participant's position SHALL NOT change as a result of disconnecting and reconnecting (including their own page refresh).

#### Scenario: Roster is displayed in alphabetical order
- **WHEN** the Facilitator views the roster with more than one participant present
- **THEN** participants are listed in alphabetical order by name

#### Scenario: Reconnect does not reorder the list
- **WHEN** a participant disconnects and later reconnects
- **THEN** their position in the alphabetically-sorted list is unchanged

### Requirement: Each roster entry shows the participant's name with no additional per-row status label for the "present" state

Each participant entry SHALL display the participant's name. Appearing in the list, undecorated, constitutes the "present, but the session has not yet begun" status; no additional label (e.g., "Present") is required or SHALL be added for that state. The disconnected marker is the only per-row indicator this view renders.

#### Scenario: A present participant's row has no additional status label
- **WHEN** a participant is connected and present in a `lobby`-status session
- **THEN** their roster entry shows their name only, with no separate "present" or "waiting" label

### Requirement: The roster provides no quorum, expected-attendee-count, or facilitator-removal affordance

The roster SHALL NOT display an expected-attendee count, a quorum indicator (e.g., "3 of 8"), or any framing implying a target number of participants. The roster SHALL NOT provide a control for the Facilitator to remove a participant from the list.

#### Scenario: No quorum counter is shown
- **WHEN** the Facilitator views the roster at any point during `lobby` status
- **THEN** no count, ratio, or quorum-style indicator is displayed alongside the participant list

#### Scenario: No removal control is offered
- **WHEN** the Facilitator views any participant's row, including a disconnected one
- **THEN** no control is offered to remove that participant from the roster

### Requirement: The roster's initial fetch is authorized identically to session-scoped WebSocket access

The REST endpoint serving the initial/refresh roster fetch SHALL apply the same authorization grant `evaluateSessionSubscriberAccess` applies for the session-scoped WebSocket connection, including the Engineering Manager exclusion. A user who would be excluded from the roster's WebSocket delivery SHALL NOT appear in the REST fetch response either.

#### Scenario: Roster fetch excludes a user who fails session-subscriber authorization
- **WHEN** the roster fetch endpoint is called for a session
- **THEN** the response includes only participants who would be granted session-scoped WebSocket access under `evaluateSessionSubscriberAccess`

#### Scenario: An Engineering Manager never appears in the roster
- **WHEN** a user with an Engineering Manager role (by `users.global_role` or `team_memberships.role` for the relevant team) has somehow registered a `session_participants` row
- **THEN** that user does not appear in the roster's REST fetch response or in `participant_joined` updates delivered to the Facilitator
