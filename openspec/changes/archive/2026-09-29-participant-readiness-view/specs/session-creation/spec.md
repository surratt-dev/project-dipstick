## ADDED Requirements

### Requirement: `DraftSessionHost`'s live-readiness-view opens a session-scoped WebSocket connection while the session is in `lobby`

`DraftSessionHost`'s `live-readiness-view` SHALL open a session-scoped WebSocket connection (via the same `useConnectionHealth` pattern used elsewhere in the application) while `currentSessionState === 'lobby'`, so it can receive `participant_joined`/`participant_left` events and render the participant readiness roster (see `participant-readiness-roster` capability) without requiring the Facilitator to navigate to a different page.

#### Scenario: DraftSessionHost opens a WebSocket connection during lobby
- **WHEN** the Facilitator views `DraftSessionHost` for a session in `lobby` status
- **THEN** a session-scoped WebSocket connection is opened for that session

### Requirement: `DraftSessionHost`'s live-readiness-view renders the participant readiness roster

While `currentSessionState === 'lobby'`, `DraftSessionHost`'s `live-readiness-view` SHALL render the participant readiness roster, using the same shared roster component/hook rendered on `SessionLobbyPage`'s `lobby` branch.

#### Scenario: Facilitator sees the roster on their landing page
- **WHEN** the Facilitator views `DraftSessionHost` for a session in `lobby` status with one or more participants who have joined
- **THEN** the participant readiness roster is visible on `DraftSessionHost`, listing those participants
