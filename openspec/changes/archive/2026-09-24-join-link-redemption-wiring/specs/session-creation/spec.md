## MODIFIED Requirements

### Requirement: Draft-status landing after session creation

Upon successful creation, the facilitator SHALL be navigated to a real, bookmarkable, refresh-safe route (`/team/:teamId/session/:sessionId`) rendering their own control view for the new `draft`-status session — not a participant-facing room and not an already-open lobby. This route SHALL be rehydratable independent of the create flow: on any mount, the frontend SHALL fetch current session status from `GET /api/v1/teams/:teamId/sessions/:sessionId/facilitator-state` (which already enforces `facilitator_id === caller` server-side) and render the draft control view when status is `draft`, or the live participant-readiness view otherwise. The control view SHALL display: available team context (team name and `lastSessionAt`, if any), the team's join link, and an explicit "Open the room" action. The session SHALL NOT be automatically advanced to `lobby` as part of creation.

The join link displayed and copyable from this view SHALL be a real, redeemable `join_links` token (obtained via the `join-link` capability's get-or-create requirement), assembled into the exact URL path the backend's join-redemption route is registered at. It SHALL NOT be sourced from any session-scoped token minted alongside the session row. Because this token is redeemable the moment it is displayed — team membership has never been gated on session status, and gating it is out of scope here — the badge accompanying it during `draft`, and no other status, SHALL describe what happens if the link is used right away, not merely which noun is gated: **"This link works already — anyone who opens it before you open the room won't see a waiting screen yet."** This wording replaces any prior "not yet joinable" phrasing, which becomes untrue the moment the link is backed by a real, always-redeemable team join link rather than an inert placeholder. No equivalent caution is added to the live participant-readiness view a session transitions to once it leaves `draft`; the badge shown during `draft` is treated as sufficient, since it is displayed before the facilitator decides whether and when to share the link — see design.md Decision 5.

This requirement governs redemption and its own display copy only. It makes no claim about what an Engineer who redeems the link during `lobby` subsequently sees — that landing-page behavior is `SessionLobbyPage`'s routing, tracked separately as issue #164, and is explicitly out of scope for this requirement and for the change that modifies it. A join redeemed while the session is `active` is unaffected by that gap and completes the full participant experience today.

Because no `session_status` transition in this system is reversible, activating "Open the room" SHALL first require a lightweight inline confirmation before the request fires. Once confirmed, it SHALL call the existing session-advance endpoint (`POST /api/v1/teams/:teamId/sessions/:sessionId/advance`). On success, the session transitions to `lobby` and becomes joinable, and the same control view updates in place to the live participant-readiness view, with no additional navigation. On failure, the control view remains unchanged — the draft session is not affected by a failed advance attempt — and displays an inline, retryable error.

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

#### Scenario: Opening the room fails and the facilitator can retry without side effects
- **WHEN** the facilitator activates "Open the room", confirms, and the advance request fails
- **THEN** the session remains in `draft` status
- **AND** the facilitator remains on the same control view with an inline error and a retry action
- **AND** retrying does not require re-creating the session or navigating away and back

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
- **THEN** this requirement makes no claim about what page or state the Engineer subsequently lands on — that behavior is governed by `SessionLobbyPage`'s routing (tracked as issue #164), not by this requirement
