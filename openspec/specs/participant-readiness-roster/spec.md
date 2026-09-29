# participant-readiness-roster

## Purpose

The Facilitator-only, live-updating roster of who has joined a `lobby`-status session: the `GET /api/v1/sessions/:sessionId/participants-roster` initial/refresh fetch, `participant_joined`/`participant_left`-driven live updates, disconnect-hold/reconnect-restore behavior, the alphabetical stable sort, the empty-state prompt, and the participant-side waiting-screen requirement (no names or count visible to non-facilitators). Rendered identically on both `DraftSessionHost` (`session-creation`) and `SessionLobbyPage`'s `lobby` branch (`pre-session-action-item-review`) via one shared component/hook (`LobbyParticipantRoster` / `useParticipantRoster`) — see those capabilities for how each surface mounts it.

This capability depends on `session-participation`'s registration-gap closure (a `session_participants` row can be created during `lobby`/`pre_session`, not only `active`): without it, no first-time-joining Engineer can ever appear here.

Not this capability's job: vote status, readiness-to-vote signals, or quorum enforcement (`FacilitatorReadinessGrid.tsx`, issue #33 — a distinct component answering the facilitator's own connection health, not per-participant presence); facilitator-initiated removal of a participant; visual continuity across the `lobby → active` transition; surfacing a blocked/failed join attempt to the Facilitator (named deferral).

## Requirements

### Requirement: The roster is Facilitator-only

The application SHALL render the participant readiness roster (participant names and connection state, for a session in `lobby` status) only to the session's Facilitator. A non-facilitator (Engineer) viewing the session room during `lobby` status SHALL see a waiting message only — no participant names, no participant count, and no indication of how many others have joined.

#### Scenario: Facilitator sees the roster
- **WHEN** the Facilitator views the session room for a session in `lobby` status
- **THEN** they see a list of participants who have joined, by name

#### Scenario: Participant does not see the roster
- **WHEN** an Engineer (non-facilitator) views the session room for a session in `lobby` status
- **THEN** they see a waiting message with no participant names, no participant count, and no indication of how many others have joined

### Requirement: The roster is visible on every facilitator-facing surface for `lobby` status, without navigation

The roster SHALL be visible on both `DraftSessionHost` (the Facilitator's landing page after creating a session) and `SessionLobbyPage`'s `lobby` branch, without requiring the Facilitator to navigate away from whichever page they are on. Both surfaces SHALL consume the same shared roster component/hook (`LobbyParticipantRoster` wrapping `useParticipantRoster` and `ParticipantRosterView`) rather than independent implementations, and this component/hook is a distinct build from `FacilitatorReadinessGrid.tsx` (issue #33's live-voting component) — not an extension of it.

#### Scenario: Facilitator sees the roster without leaving their landing page
- **WHEN** the Facilitator is on `DraftSessionHost` for a session in `lobby` status
- **THEN** the roster is visible on that page, with no navigation required to see it

#### Scenario: Facilitator sees the roster after following the pre_session navigate link
- **WHEN** the Facilitator is on `SessionLobbyPage`'s `lobby` branch
- **THEN** the roster is visible on that page as well

### Requirement: The roster shows an explicit empty-state prompt when no one has joined

When a session in `lobby` status has zero participants, the roster area SHALL display a prompt indicating no one has joined yet, rather than an empty or blank list.

Where the host page has a join link available to display, the join link SHALL remain displayed alongside the empty-state prompt. **`DraftSessionHost` always has this available and passes it — its empty-state prompt SHALL include the join link.** `SessionLobbyPage` has no existing mechanism to fetch a session's join token and building one is out of this capability's scope; on `SessionLobbyPage`, the empty-state prompt renders without a join link. This is a known, reviewed, accepted gap against this requirement's general wording for that one surface, not an oversight — closing it requires a join-token fetch capability `SessionLobbyPage` does not otherwise need, and is left as a follow-up if it is ever wanted there.

#### Scenario: Facilitator sees the empty-roster prompt with the join link, on DraftSessionHost
- **WHEN** the Facilitator views the roster on `DraftSessionHost` for a session in `lobby` status with zero participants
- **THEN** the roster area displays a prompt indicating no one has joined yet
- **AND** the join link remains visible

#### Scenario: Facilitator sees the empty-roster prompt without a join link, on SessionLobbyPage
- **WHEN** the Facilitator views the roster on `SessionLobbyPage`'s `lobby` branch for a session with zero participants
- **THEN** the roster area displays a prompt indicating no one has joined yet
- **AND** no join link is rendered alongside it, per this surface's accepted scope gap

### Requirement: The roster updates in real time as participants join

As each Engineer's session-scoped WebSocket connection registers, the roster SHALL update to include them without requiring a page refresh, consuming the existing `participant_joined` WebSocket event.

#### Scenario: A new participant appears live
- **WHEN** an Engineer's session-scoped WebSocket connection registers for a session in `lobby` status
- **THEN** the Facilitator's roster updates to include that participant within the same session, without a page refresh

### Requirement: A disconnected participant's row is held, not removed, and does not change position

Rows are keyed by the participant's `userId`. When a participant's session-scoped WebSocket connection deregisters, the roster SHALL mark their existing row as disconnected rather than removing it. When that participant reconnects (including via their own page refresh), the roster SHALL clear the disconnected marker on the existing row rather than creating a new row. A participant's position in the roster SHALL NOT change as a result of disconnecting or reconnecting.

`participant_joined` for a `userId` the roster does not already recognize (the event carries no display name) triggers a re-fetch of this capability's roster endpoint rather than inserting a row built from the event alone — this is the same "clear the marker" mechanism operating on the first-observed case, not a separate code path.

#### Scenario: Disconnection is reflected without removing the row
- **WHEN** a participant's session-scoped WebSocket connection deregisters (tab close, navigation away, or connection drop)
- **THEN** the Facilitator's roster marks that participant's row as disconnected, in real time, without removing it from the list

#### Scenario: Reconnection clears the marker on the same row
- **WHEN** a previously-disconnected participant's session-scoped WebSocket connection registers again
- **THEN** the roster clears the disconnected marker on their existing row
- **AND** no duplicate row is created
- **AND** the participant's position in the list is unchanged from before the disconnection

#### Scenario: An unrecognized userId triggers a roster re-fetch instead of a blank row
- **WHEN** `participant_joined` names a `userId` not already present in the roster's local state
- **THEN** the roster re-fetches this capability's REST endpoint rather than rendering a row built from the event payload alone
- **AND** the resulting row displays the participant's real display name, not a blank or raw-UUID row

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

`GET /api/v1/sessions/:sessionId/participants-roster` is the REST endpoint serving the initial/refresh roster fetch. It SHALL apply the same authorization grant `evaluateSessionSubscriberAccess` applies for the session-scoped WebSocket connection, including the Engineering Manager exclusion, and SHALL do so at two independent layers:

- **Caller-level authorization:** the endpoint SHALL reject (`404`, disclosure-blind) any request where `grant?.path !== "facilitator"` — following the `dispatchParticipantJoined`/`dispatchParticipantLeft` precedent, not `action-items-review`'s precedent of accepting both grants and filtering via an `isFacilitator` response flag. A caller holding a valid `participant` grant SHALL receive the same `404` as a caller with no grant at all; the roster is unreachable by a participant grant at the server layer, not merely hidden in the UI.
- **Row-level content filtering:** independently of caller-level authorization, no row for a user who would fail `evaluateSessionSubscriberAccess` (e.g., an Engineering Manager who somehow holds a `session_participants` row) SHALL appear in the response or in `participant_joined` updates delivered to the Facilitator.

The endpoint reads from the durable `session_participants` record, not in-memory connection state, and applies `applyTimingFloor()` and `Cache-Control: no-store` on every response path (200 and 404), matching `action-items-review`'s existing convention.

#### Scenario: A participant-grant caller is rejected at the server layer, not just hidden in the UI
- **WHEN** a legitimately-registered Engineer participant calls the roster endpoint directly with their own valid `participant` grant
- **THEN** the response is `404`, identical in shape to a caller with no grant at all

#### Scenario: An Engineering Manager never appears in the roster
- **WHEN** a user with an Engineering Manager role (by `users.global_role` or `team_memberships.role` for the relevant team) has somehow registered a `session_participants` row
- **THEN** that user does not appear in the roster's REST fetch response or in `participant_joined` updates delivered to the Facilitator

#### Scenario: Denied and authorized responses are not distinguishable by timing or caching
- **WHEN** the roster endpoint returns `404` or `200` for any caller
- **THEN** the response is padded to the same constant timing floor applied to other authorization-gated content endpoints, and includes `Cache-Control: no-store`
