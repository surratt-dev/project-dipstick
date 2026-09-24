## ADDED Requirements

### Requirement: `SessionLobbyPage`'s `lobby`-branch heading and Start Session label are aligned with `DraftSessionHost`'s

`SessionLobbyPage`'s `lobby`-branch heading and Start Session control label SHALL read as describing the same action and the same product as `DraftSessionHost`'s equivalent `lobby`-status heading and Start Session control label (see the `session-creation` capability's corresponding requirement). This is a copy/labeling alignment on a component this change already touches, not a shared-component refactor or a redesign.

#### Scenario: Facilitator sees consistent heading and control label on both surfaces
- **WHEN** a facilitator views `SessionLobbyPage`'s `lobby` branch for a session they facilitate, having previously seen `DraftSessionHost`'s `lobby`-status rendering for the same session
- **THEN** the heading text and Start Session control label on `SessionLobbyPage` read as the same action and product as what they saw on `DraftSessionHost`

### Requirement: Non-facilitator waiting copy on `SessionLobbyPage`'s `lobby` branch omits the raw session ID and reassures the participant

`SessionLobbyPage`'s `lobby`-branch waiting message, shown to non-facilitator participants, SHALL NOT display the raw `sessionId`. It SHALL include a one-line reassurance that the facilitator will start the session shortly.

#### Scenario: Non-facilitator sees reassurance copy without a raw session ID
- **WHEN** a non-facilitator participant views `SessionLobbyPage`'s `lobby` branch
- **THEN** the waiting message does not display the raw `sessionId`
- **AND** the waiting message includes a one-line reassurance that the facilitator will start the session shortly
