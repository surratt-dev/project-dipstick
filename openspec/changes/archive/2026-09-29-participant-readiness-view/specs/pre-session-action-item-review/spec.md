## ADDED Requirements

### Requirement: `SessionLobbyPage`'s `lobby` branch renders the participant readiness roster for the Facilitator

`SessionLobbyPage`'s `lobby` branch SHALL render the participant readiness roster (see `participant-readiness-roster` capability) for the Facilitator, using the same shared roster component/hook rendered on `DraftSessionHost`'s `live-readiness-view`. Non-facilitator viewers of this branch continue to see the existing waiting message only, with no participant names or count.

#### Scenario: Facilitator sees the roster on SessionLobbyPage's lobby branch
- **WHEN** the Facilitator views `SessionLobbyPage` for a session in `lobby` status with one or more participants who have joined
- **THEN** the participant readiness roster is visible, listing those participants

#### Scenario: Non-facilitator continues to see only the waiting message
- **WHEN** an Engineer (non-facilitator) views `SessionLobbyPage`'s `lobby` branch
- **THEN** they see the existing waiting message, with no participant names, no participant count, and no roster
