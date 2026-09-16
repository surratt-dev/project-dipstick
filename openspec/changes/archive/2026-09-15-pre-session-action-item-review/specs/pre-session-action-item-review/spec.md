## ADDED Requirements

### Requirement: Participant-facing endpoint returns the pre-session action item review

The application SHALL provide `GET /api/v1/sessions/:sessionId/action-items-review`, authorized via `evaluateSessionSubscriberAccess(userId, sessionId)`, so that any authorized subscriber to a session — not only the facilitator — can retrieve the same open/in-progress action item data the facilitator receives on `POST /start` (UC1). The endpoint SHALL reuse the existing `fetchPreSessionActionItems(teamId)` query logic without duplicating it, and SHALL NOT introduce a second, independent authorization check.

#### Scenario: An authorized participant retrieves the review

- **WHEN** an authenticated user with an active `session_participants` row for the session (and an active, non-removed team membership) calls this endpoint while the session is in `pre_session` status
- **THEN** the request succeeds and the response includes every open and in-progress action item for the session's team, oldest-created first

#### Scenario: The session's facilitator retrieves the review

- **WHEN** the authenticated user is the session's facilitator and calls this endpoint while the session is in `pre_session` status
- **THEN** the request succeeds and the response includes the same action item data a participant would receive for this session

#### Scenario: A caller with no relationship to the session receives 404

- **WHEN** `evaluateSessionSubscriberAccess` returns `null` for the caller and session — including when the session does not exist at all
- **THEN** the request is rejected with `404`, identical in shape whether the session is missing or the caller simply has no standing on it

#### Scenario: An Engineering Manager cannot retrieve the review

- **WHEN** the authenticated user's only relationship to the session's team is an `engineering_manager` role
- **THEN** `evaluateSessionSubscriberAccess` returns `null` and the request is rejected with `404`, per that helper's existing no-EM-grant behavior — this endpoint introduces no separate EM exclusion logic

### Requirement: The review endpoint is gated to the pre_session phase only

The application SHALL restrict `GET /api/v1/sessions/:sessionId/action-items-review` to sessions currently in `pre_session` status. A session in any other status SHALL NOT return action item review data through this endpoint, distinguishing "session exists but review has ended or not started" from "no access at all" (default behavior; not a permanent guarantee of what a late joiner eventually sees). The `409` response body SHALL include `currentSessionStatus` (the session's actual status) and `isFacilitator` (computed identically to the success-path field, from the same authorization grant, regardless of session status) — added during design review (engineer finding #2) so the frontend can determine its full render branch (`lobby` vs. `active`, and whether to show facilitator-only controls) from this one endpoint, without a second, team-scoped status call.

#### Scenario: A session that has advanced to active voting rejects the review request

- **WHEN** an otherwise-authorized caller (facilitator or participant) requests the review endpoint for a session whose status is `active`
- **THEN** the request is rejected with `409 Conflict`, not `404`, no action item data is returned, and the response body's `currentSessionStatus` is `active`

#### Scenario: A session still in the lobby rejects the review request

- **WHEN** an otherwise-authorized caller requests the review endpoint for a session whose status is `lobby`
- **THEN** the request is rejected with `409 Conflict`, no action item data is returned, and the response body's `currentSessionStatus` is `lobby`

#### Scenario: A late joiner arriving after the session is active does not see the review

- **WHEN** a participant joins a session's room after the session has already transitioned to `active`
- **THEN** the review endpoint returns `409 Conflict` for that participant, and the frontend does not attempt to reconstruct or display a closed review

### Requirement: The review endpoint response indicates whether the caller is the facilitator, on every response path

The application SHALL include an `isFacilitator` boolean in the review endpoint's response, `true` when the authorization grant's path is `facilitator` and `false` when it is `participant`, so the frontend has a single trustworthy source for whether to render facilitator-only controls without a second, independently-maintained check. This field SHALL be present on the `409` response path as well as the `200` path — the underlying grant is resolved before the session-status gate runs, so `isFacilitator` is known regardless of the session's actual status, and the `lobby`-branch "Start Session" control (see below) depends on it being available while the session is still in `lobby`.

#### Scenario: Facilitator's response is flagged accordingly

- **WHEN** the session's facilitator successfully retrieves the review
- **THEN** the response body's `isFacilitator` field is `true`

#### Scenario: Participant's response is flagged accordingly

- **WHEN** a non-facilitator participant successfully retrieves the review
- **THEN** the response body's `isFacilitator` field is `false`

#### Scenario: Facilitator's `isFacilitator` flag is present even while the session is still in the lobby

- **WHEN** the session's facilitator requests the review endpoint while the session's status is `lobby`
- **THEN** the request is rejected with `409 Conflict` per the session-status gate, and the response body's `isFacilitator` field is still `true`

### Requirement: A facilitator-only "Start Session" control makes the lobby-to-review transition reachable

**Added during design review (engineer finding #1):** without a frontend trigger for the already-implemented `POST /api/v1/sessions/:sessionId/start`, no session can ever leave `lobby` in the running application. The application SHALL render a "Start Session" control on `SessionLobbyPage`'s `lobby` branch, visible only when the review endpoint's `isFacilitator` field (from its `409` response while the session is in `lobby`) is `true`, and SHALL wire it to `POST /api/v1/sessions/:sessionId/start` without introducing a new transition mechanism or modifying that endpoint's behavior.

#### Scenario: Facilitator starts the session from the lobby

- **WHEN** the session's facilitator activates the "Start Session" control while the session is in `lobby`
- **THEN** `POST /start` is called, the session transitions to `pre_session`, and all participants' screens (including the facilitator's) move to the review branch upon receiving the resulting `session_state_change` event

#### Scenario: A non-facilitator participant has no Start Session control

- **WHEN** a non-facilitator participant views the `lobby` branch
- **THEN** no control to start the session is rendered on their screen

#### Scenario: Start Session fails

- **WHEN** `POST /start` fails for the facilitator (e.g. a network error, or the session was already started from another tab)
- **THEN** the facilitator's screen shows an inline retry affordance and remains on the `lobby` branch; the session is not assumed to have transitioned

### Requirement: The pre-session review screen displays open action items to all session participants

The application SHALL render, for every participant present during the `pre_session` phase, a read-only list of the team's open and in-progress action items, each showing: description, owner display name, current status, originating session number (`originatingSessionNumber` from the review data — a human-facing integer, e.g. "Session #12" — not `originatingSessionId`'s UUID; matches the existing `Session #N` display pattern already used in `EmSessionHistoryPage.tsx` and `EmTrendDataPage.tsx`), and a staleness indicator (see the staleness requirements below). The screen SHALL be shown to all participants — engineers and facilitator — simultaneously, and SHALL NOT expose any inline control to change an item's status in this change (deferred; see the change's proposal for the follow-up commitment).

#### Scenario: All participants see the same read-only list

- **WHEN** a session enters `pre_session` status with one or more open or in-progress action items for the team
- **THEN** every participant's screen displays each item's description, owner display name, status, originating session number (rendered as "Session #N"), and staleness indicator
- **AND** no participant's screen renders a control to change any item's status

#### Scenario: No cross-team or cross-owner comparison is possible

- **WHEN** the review screen renders action items for a session
- **THEN** only items belonging to that session's own team are shown, and no aggregation, ranking, or comparison across owners, teams, or sessions is presented anywhere on the screen

### Requirement: Staleness level is computed from the fixed 1/2/3-session mapping, not a configurable multiplier

**Resolved propose-stage blocking finding (BA review):** the application SHALL compute an action item's staleness level by comparing sessions elapsed since its last update directly against the fixed literals 1, 2, and 3 — `none` for 0 sessions elapsed, `yellow` for exactly 1, `orange` for exactly 2, `red` for 3 or more — per UC: Flag Stale Action Items' decided requirement. This SHALL NOT be computed as a multiple of `application_settings.staleness_threshold_sessions` or any other configurable value; that setting is not read by this computation. (See this change's design.md Decision 7 for why the previously-shipped multiplier behavior was corrected rather than adopted as the new requirement.)

#### Scenario: One session elapsed computes yellow regardless of any configured threshold value

- **WHEN** an action item has 1 completed session elapsed since its last status update, irrespective of the current value stored in `application_settings.staleness_threshold_sessions`
- **THEN** the item's staleness level is `yellow`

#### Scenario: Two sessions elapsed computes orange regardless of any configured threshold value

- **WHEN** an action item has 2 completed sessions elapsed since its last status update
- **THEN** the item's staleness level is `orange`

#### Scenario: Three or more sessions elapsed computes red regardless of any configured threshold value

- **WHEN** an action item has 3 or more completed sessions elapsed since its last status update
- **THEN** the item's staleness level is `red`

#### Scenario: Zero sessions elapsed computes no indicator

- **WHEN** an action item has 0 completed sessions elapsed since its last status update (created or updated in the most recently completed session)
- **THEN** the item displays no staleness indicator

### Requirement: An always-visible legend explains the staleness color scale, and matches the values actually computed

The application SHALL display a persistently visible legend or tooltip on the review screen explaining what each staleness color means (1 session elapsed = yellow, 2 sessions = orange, 3+ sessions = red), so a participant encountering a colored indicator for the first time does not require live explanation from the facilitator. The legend's stated thresholds SHALL match the thresholds the preceding requirement's computation actually applies — this is a route-test-verified invariant (see this change's tasks.md), not an assumption.

#### Scenario: Legend is visible without interaction

- **WHEN** the review screen is rendered with any staleness-colored item present
- **THEN** the legend explaining the color scale is visible on the screen without requiring a click, hover-only reveal, or navigation away from the list

#### Scenario: Legend thresholds agree with computed staleness levels

- **WHEN** the review data is fetched at any value of `application_settings.staleness_threshold_sessions` (including the default)
- **THEN** an item computed as `yellow` has exactly 1 session elapsed, an item computed as `orange` has exactly 2, and an item computed as `red` has 3 or more — matching the legend's stated text with no discrepancy

### Requirement: A summary line communicates the review's overall state at a glance

The application SHALL display a one-line, non-judgmental summary at the top of the review list, always present whenever open or in-progress items exist (its content changes; the line itself does not disappear, so its position on the screen stays predictable), so the facilitator can absorb the state of the room before reading the list line by line. The summary's count SHALL be a plain union of items at any non-`none` staleness level (yellow + orange + red combined) — not red-only, and not a severity-weighted figure.

#### Scenario: Summary reflects the count of stale items

- **WHEN** the review screen renders with one or more items carrying a non-`none` staleness indicator
- **THEN** a one-line summary at the top of the screen states the combined count of yellow, orange, and red items as needing attention (e.g., "3 items need attention"), phrased without blame or urgency language directed at any individual

#### Scenario: Summary line shows neutral copy, not silence, when nothing is stale

- **WHEN** the review screen renders with open or in-progress items present but none carrying a staleness indicator
- **THEN** the summary line is still shown, displaying neutral copy that does not claim items "need attention" (e.g., "N open items — none need attention") rather than being omitted entirely

### Requirement: The review screen presents an empty state when no open action items exist

The application SHALL render a clear "no open action items" empty state — identical for all participants, minus the facilitator's advance control — when the team has zero open or in-progress action items, whether because no prior sessions exist or all prior items are resolved.

#### Scenario: First session for a team shows the empty state

- **WHEN** a team's first-ever session enters `pre_session` status
- **THEN** the review screen shows the empty state, and the facilitator's advance control is available

#### Scenario: All prior items resolved shows the empty state

- **WHEN** every action item from the team's prior completed sessions has status `resolved`
- **THEN** the review screen shows the same empty state as the no-prior-sessions case

### Requirement: Only the facilitator sees and can activate the control to advance past the review

The application SHALL render the "Begin First Topic" control only for the session's facilitator, driven by the review endpoint's `isFacilitator` flag, and SHALL wire it to the existing `POST /api/v1/sessions/:sessionId/begin-voting` endpoint without introducing a new transition mechanism. Activating the control SHALL rely on `begin-voting`'s existing `session_state_change` broadcast to move every participant's screen off the review simultaneously — no new WebSocket event type is introduced by this capability.

#### Scenario: Facilitator advances the session

- **WHEN** the facilitator activates the "Begin First Topic" control after the review data has loaded successfully
- **THEN** `POST /begin-voting` is called, the session transitions to `active`, and all participants' screens leave the review screen upon receiving the resulting `session_state_change` event

#### Scenario: A non-facilitator participant has no advance control

- **WHEN** a non-facilitator participant views the review screen
- **THEN** no control to advance the session is rendered on their screen

### Requirement: Defined error states prevent blank screens and unsafe advancement

The application SHALL present an explicit error state — never a blank screen or an indefinite spinner — when the review endpoint fails for any participant, including the facilitator, and SHALL keep the "Begin First Topic" control disabled until that same review endpoint has loaded successfully, so the session cannot advance to voting on a failed query. **Corrected during design review (engineer finding #3):** an earlier version of this requirement gated "Begin First Topic" on the facilitator's `POST /start` response instead — under this change's actual frontend architecture (design.md Decision 3), the facilitator's review screen is fed by the same `GET /action-items-review` call as every other participant, not by `POST /start`'s payload, so there is exactly one data source and one error path for this control, not two.

#### Scenario: Review endpoint fails for a participant

- **WHEN** `GET /api/v1/sessions/:sessionId/action-items-review` fails for an authorized participant (network error or server error)
- **THEN** that participant's screen shows an explicit error state with a retry affordance, not a blank screen or an indefinite spinner

#### Scenario: Review endpoint fails for the facilitator

- **WHEN** `GET /api/v1/sessions/:sessionId/action-items-review` fails for the session's facilitator (network error or server error)
- **THEN** the facilitator's screen shows the same explicit error state with a retry affordance as any other participant, and the "Begin First Topic" control remains disabled until a subsequent request succeeds

#### Scenario: A single item's staleness cannot be computed

- **WHEN** staleness cannot be determined for one action item (e.g., a session-history lookup fails for that item)
- **THEN** that item is displayed without a staleness indicator, and the rest of the review screen renders normally without being blocked

### Requirement: Response timing and caching do not create an authorization side channel

**Added during design review (security findings F1/F2):** `GET /api/v1/sessions/:sessionId/action-items-review` is the first HTTP route built on `evaluateSessionSubscriberAccess`, whose three response paths (`404`, `409`, `200`) have different query-cost profiles. Consistent with every other endpoint in this codebase that gates on a live-database authorization helper (`team-content-access`'s timing-floor and no-cache requirements), the application SHALL apply a constant minimum response-time floor to every response path of this endpoint, denied and authorized alike, and SHALL set `Cache-Control: no-store` on every response.

#### Scenario: Denied and authorized responses are not distinguishable by timing

- **WHEN** this endpoint returns `404`, `409`, or `200` for any caller
- **THEN** the response time is padded to at least the same constant floor applied to every other content endpoint in this codebase, so an authenticated caller cannot use response latency to distinguish "no access," "wrong status," and "success"

#### Scenario: Responses are not cached

- **WHEN** this endpoint returns any response, successful or denied
- **THEN** the response includes `Cache-Control: no-store`, and the response is not served from any HTTP cache layer on a subsequent request
