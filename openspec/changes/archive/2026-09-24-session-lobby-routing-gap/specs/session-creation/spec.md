## ADDED Requirements

### Requirement: Live-readiness-view renders a Start Session control while the session is in `lobby`

`DraftSessionHost`'s live participant-readiness view SHALL render a "Start Session" control whenever `currentSessionState === 'lobby'`. No additional authorization gating is required beyond `DraftSessionHost`'s existing facilitator-only access (enforced server-side via `GET .../facilitator-state`'s `facilitator_id === caller` check). Activating the control SHALL call `POST /api/v1/sessions/:sessionId/start`. On success, the view SHALL update `currentSessionState` to `pre_session` in local state and re-render in place — the same in-place-update pattern used by the existing "Open the room" control, with no navigation away from `/team/:teamId/session/:sessionId`. On failure, the view SHALL show an inline, retryable error and remain on the `lobby` rendering; the session's actual status is not assumed to have changed.

#### Scenario: Facilitator starts the session from `DraftSessionHost`
- **WHEN** the facilitator activates the "Start Session" control while `currentSessionState === 'lobby'`
- **THEN** `POST /api/v1/sessions/:sessionId/start` is called
- **AND** on success, the view updates `currentSessionState` to `pre_session` in place, without navigating away from `/team/:teamId/session/:sessionId`

#### Scenario: Start Session fails and the facilitator can retry in place
- **WHEN** the facilitator activates "Start Session" and the request fails
- **THEN** the view shows an inline, retryable error and remains on the `lobby` rendering
- **AND** the session's local state is not updated to `pre_session`

### Requirement: Live-readiness-view offers a way to reach the `pre_session` review once the session has started

Whenever `currentSessionState` is `pre_session` or a later non-terminal status (`active`, `wrap_up`), `DraftSessionHost`'s live participant-readiness view SHALL render a link or button that navigates the facilitator to `/session/:sessionId`. This requirement exists so that starting the session (the preceding requirement) does not leave the facilitator on static status text with no way to reach the review or session screen — the same failure mode this change's `lobby`-status gap represents, one status later.

#### Scenario: Navigate link appears once the session leaves `lobby`
- **WHEN** `currentSessionState` is `pre_session` on `DraftSessionHost`'s live-readiness-view
- **THEN** a link or button is rendered that navigates to `/session/:sessionId`

#### Scenario: Facilitator follows the navigate link to reach the review
- **WHEN** the facilitator activates the navigate link while `currentSessionState === 'pre_session'`
- **THEN** the browser navigates to `/session/:sessionId`, where `SessionLobbyPage` renders the `pre_session` review for the facilitator

### Requirement: Live-readiness-view copy is aligned with `SessionLobbyPage`'s equivalent `lobby`-state copy

The `lobby`-status rendering of `DraftSessionHost`'s live-readiness-view SHALL use a heading and Start Session control label that read as the same product as `SessionLobbyPage`'s `lobby`-branch heading and Start Session control label, so a facilitator who lands on either surface mid-transition does not perceive them as two different tools. This requirement governs label/heading text alignment only; it does not require the two components to share implementation or a common rendered component.

#### Scenario: Heading and control label match in substance across both surfaces
- **WHEN** a facilitator views `DraftSessionHost`'s `lobby`-status rendering and, separately, `SessionLobbyPage`'s `lobby`-branch rendering for the same session
- **THEN** the heading text and the Start Session control's label read as describing the same action and the same product on both surfaces
