# session-creation

## Purpose

Defines requirements for facilitator-initiated session creation, covering two flows: session creation for an existing team (the eligible-teams listing, the facilitator-from-another-team enforcement point, the concurrent-active-session block, audit logging for denial and success, the draft-status landing control view, the "Open the room" advance action, and — once the session reaches `lobby` — `DraftSessionHost`'s own session-scoped WebSocket subscription and its rendering of the participant readiness roster, see `participant-readiness-roster`), and inline creation of a brand-new team and its first session via `POST /api/v1/teams` (team-name uniqueness, default-topic assignment via `default-topic-provisioning`, and the direct-to-`lobby` landing specific to a team with no prior context). Any picker personalization beyond the eligible-teams list and empty-state copy remains out of scope for this capability today and left for it to grow into later.

## Requirements

### Requirement: Facilitator-from-another-team enforcement at session creation

A user attempting to create a session for a team via `POST /api/v1/teams/:teamId/sessions/draft` SHALL be rejected if they have an active `team_memberships` row (`removed_at IS NULL`) for `:teamId`. This check is a hard block with no exception path, enforced server-side at this endpoint, independent of and re-validated regardless of whatever eligible-teams list the caller was shown before submitting. "Not a member" for this check means no row with `removed_at IS NULL`; a user previously removed from the team is eligible to facilitate it again.

The endpoint SHALL evaluate two independent conditions, in order, with distinguishable rejection reasons:
1. `users.global_role !== 'facilitator'` → `403`, with an error message identifying "not a facilitator" as the reason.
2. An active `team_memberships` row exists for the caller and `:teamId` → `403`, with an error message identifying the cross-team constraint by name (e.g., "You cannot create a session for a team you belong to"). This message is distinguishable from condition 1's message.

Both checks read directly from the database on every request; neither may be satisfied from a client-supplied value, a cached role, or the eligible-teams list response. This holds regardless of whether the request originates from the session-creation picker UI or is submitted directly (e.g., via API call).

This constraint is evaluated only at the moment of session creation. It is not re-evaluated against a session that already exists: a facilitator subsequently acquiring an active `team_memberships` row for the team they already facilitate has no effect on that already-created session. There is no mechanism in this system that re-checks or invalidates an existing `sessions` row in response to a later `team_memberships` change. This is a statement about the session record's own continued validity and creatability, scoped to this creation-time constraint — it makes no claim about whether that facilitator may subsequently participate in or vote within the session they facilitate. Participation and voting eligibility are governed entirely by `session-participation`'s own requirements, which this change does not modify and this requirement does not speak to.

#### Scenario: Facilitator with active membership on the target team is rejected
- **WHEN** a caller with `users.global_role = 'facilitator'` and an active (`removed_at IS NULL`) `team_memberships` row for `:teamId` calls `POST /api/v1/teams/:teamId/sessions/draft`
- **THEN** the request is rejected with `403`, the error identifies the cross-team constraint by name
- **AND** no session record is created

#### Scenario: Previously removed member is eligible to facilitate
- **WHEN** a caller with `users.global_role = 'facilitator'` has a `team_memberships` row for `:teamId` with `removed_at` set (a past, ended membership) and calls `POST /api/v1/teams/:teamId/sessions/draft`
- **THEN** the request is permitted (subject to the other requirements in this capability)

#### Scenario: Non-facilitator caller is rejected with a distinguishable message
- **WHEN** a caller whose `users.global_role` is not `facilitator` calls `POST /api/v1/teams/:teamId/sessions/draft`
- **THEN** the request is rejected with `403`, and the error message is distinguishable from the cross-team-constraint message
- **AND** no session record is created

#### Scenario: Direct API submission bypassing the picker UI is rejected identically
- **WHEN** a caller with an active `team_memberships` row for `:teamId` submits `POST /api/v1/teams/:teamId/sessions/draft` directly, without having gone through the eligible-teams picker or confirm screen
- **THEN** the request is rejected with the same `403` and the same cross-team-constraint message as the picker-driven path
- **AND** no session record is created

#### Scenario: Membership acquired after the eligible-teams list was fetched is caught at submission
- **WHEN** a caller fetches the eligible-teams list (not including `:teamId`'s exclusion, because they were not yet a member), then joins `:teamId` via a join link, then submits `POST /api/v1/teams/:teamId/sessions/draft` using the stale picker state
- **THEN** the request is rejected with `403` and the cross-team-constraint message, because the check re-reads `team_memberships` at submission time rather than trusting the earlier list

#### Scenario: A facilitator joining the facilitated team after session creation does not invalidate the existing session record
- **WHEN** a facilitator has already created a session for `:teamId` (the session exists with any status), and the facilitator subsequently acquires an active `team_memberships` row for `:teamId`
- **THEN** the existing session record remains valid and unmodified — its `status`, `facilitator_id`, and any in-progress or completed data are unchanged
- **AND** no code path re-evaluates the creation-time membership constraint against a session that already exists
- **AND** this scenario asserts only the session record's continued validity under the creation-time constraint; it makes no claim about the facilitator's eligibility to participate in or vote within that session, which is governed separately by `session-participation` and is unaffected by this change

---

### Requirement: Audit logging for draft session creation and denial

Every rejection of `POST /api/v1/teams/:teamId/sessions/draft` on the cross-team membership constraint, and every successful draft-session creation via that endpoint, SHALL write a synchronous `audit_log` row, following this codebase's existing precedent for auditing blocked privileged-boundary attempts and newly-established access grants (`team.role_change_denied`, `team.manager_established`). A successful creation's audit row SHALL be written in the same database transaction as the `INSERT INTO sessions` row it accompanies.

#### Scenario: A rejected cross-team draft-creation attempt is audited
- **WHEN** a caller is rejected under the facilitator-from-another-team enforcement requirement above (an active `team_memberships` row exists for the caller and `:teamId`)
- **THEN** an `audit_log` row is written before the `403` response is sent, identifying the actor, the actor's global role, the actor's IP, and `:teamId`

#### Scenario: A successful draft-session creation is audited
- **WHEN** a caller successfully creates a draft session for a team they are eligible to facilitate
- **THEN** an `audit_log` row is written in the same transaction as the `INSERT INTO sessions` row, identifying the actor, the actor's global role, the actor's IP, `:teamId`, and the new session's id

---

### Requirement: Eligible-teams listing for session creation

The application SHALL provide `GET /api/v1/teams/eligible-for-session`, returning the teams the authenticated caller may create a session for. A team is eligible when the caller has no active (`removed_at IS NULL`) `team_memberships` row for it and the team's `deactivated_at` is `NULL`. This is a live database read on every call; the result SHALL NOT be cached at any layer. The endpoint's own `403`-vs-`200` authorization gate is itself a live read of `users.global_role` on every call — the same query the `POST /draft` endpoint's facilitator check uses — and SHALL NOT be derived from `canFacilitateSessions` or any other value carried on the request's session/token state.

Org-wide team enumeration (every non-deactivated team's `teamName` and `lastSessionAt`, visible to every `global_role = 'facilitator'` account regardless of that account's own team memberships) is an accepted, intentional scope of this endpoint, not a disclosure gap: a facilitator may see and act on any team in the organization they don't belong to.

`lastSessionAt` is computed as `MAX(completed_at)` over that team's sessions with `status = 'complete'` only (mirroring the pre-session action-item review's convention of sourcing only from completed sessions). A team's `draft`- or otherwise-non-terminal-status session never populates `lastSessionAt`.

**Response shapes:**
- Caller's `users.global_role !== 'facilitator'` → `403`, body identifies the reason (e.g., "Only facilitators can view eligible teams").
- Caller is a facilitator → `200` with an `EligibleTeamsResponse`: `{ eligibleTeams: EligibleTeam[], callerHasTeamMemberships: boolean }` (both named, shared interfaces), where each `EligibleTeam` includes at minimum `teamId`, `teamName`, and `lastSessionAt` (nullable). `callerHasTeamMemberships` reflects whether the caller has any active team membership at all (regardless of eligibility for facilitation), independent of whether `eligibleTeams` is empty — this is what lets the frontend choose between the two empty-state copies (zero-home-team facilitator vs. facilitator whose every other team already has a live session), rather than inferring the reason from an empty array alone.

#### Scenario: Non-facilitator is rejected
- **WHEN** a caller whose `users.global_role` is not `facilitator` calls `GET /api/v1/teams/eligible-for-session`
- **THEN** the request is rejected with `403`

#### Scenario: Facilitator with eligible teams receives the list
- **WHEN** a facilitator with at least one team they are not an active member of (and which is not deactivated) calls the endpoint
- **THEN** the response is `200` with `eligibleTeams` containing each such team, including its `teamId`, `teamName`, and `lastSessionAt`

#### Scenario: Deactivated teams are excluded
- **WHEN** a facilitator is not a member of a team whose `deactivated_at` is set
- **THEN** that team does not appear in `eligibleTeams`

#### Scenario: Facilitator with zero home-team memberships still receives eligible teams
- **WHEN** a facilitator has zero active `team_memberships` rows of any kind
- **THEN** the response is `200`, `eligibleTeams` includes every non-deactivated team, and `callerHasTeamMemberships` is `false`

#### Scenario: Facilitator with a home team and zero eligible targets
- **WHEN** a facilitator has an active team membership and is also an active member of every other non-deactivated team
- **THEN** the response is `200`, `eligibleTeams` is an empty array, and `callerHasTeamMemberships` is `true`

Note: this endpoint does not filter out teams that already have a non-terminal session — membership is the only eligibility condition it evaluates. A team with a live session can still appear in `eligibleTeams`; selecting it and submitting is rejected with `409` by the concurrent-session-block requirement below. This is a deliberate choice, not an oversight: it keeps "is there a live session for this team" checked in exactly one place (submission time), consistent with this capability's posture that the eligible-teams list is a convenience for the picker UI, never a source of truth the submission path trusts.

---

### Requirement: Concurrent active session block per team

The application SHALL NOT permit a second non-terminal session (`draft`, `lobby`, `pre_session`, `active`, `wrap_up`) to exist for a team that already has one. `complete` and `abandoned` are this system's only terminal `session_status` values; the other five are all blocking, which is why the partial index covers exactly those five. This is enforced by a database-level partial unique index on `sessions.team_id`, scoped to non-terminal statuses, not by an application-level check-then-insert. A session-creation attempt that would violate this constraint SHALL be rejected with `409` using a named `SessionAlreadyExistsResponse` shape (`existingSessionId`, `existingSessionStatus`, `teamId`), so the caller can decide whether to go to it instead of retrying.

#### Scenario: Session creation blocked when a non-terminal session already exists
- **WHEN** a team already has a session with status `lobby` and a facilitator (eligible under the other requirements in this capability) attempts to create a new session for that team
- **THEN** the request is rejected with `409`
- **AND** the response identifies the existing session's status
- **AND** no new session record is created

#### Scenario: Session creation permitted after the prior session reaches a terminal state
- **WHEN** a team's only session has status `complete` or `abandoned` (a terminal status)
- **THEN** a new session-creation request for that team is permitted

#### Scenario: Concurrent creation attempts for the same team — only one succeeds
- **WHEN** two facilitators simultaneously submit `POST /api/v1/teams/:teamId/sessions/draft` for the same team, and neither has an existing non-terminal session for it
- **THEN** exactly one `INSERT` succeeds
- **AND** the other fails the unique constraint and receives the `409` response identifying the session that was just created by the first request

#### Scenario: Unrelated database errors are not misreported as a concurrent-session conflict
- **WHEN** an `INSERT` into `sessions` fails for a reason other than the `sessions_team_active_unique` constraint
- **THEN** the application does not respond with the `409` concurrent-session message; the error is handled as the system error it is

---

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

### Requirement: `DraftSessionHost`'s live-readiness-view opens a session-scoped WebSocket connection while the session is in `lobby`

`DraftSessionHost`'s live participant-readiness view SHALL open a session-scoped WebSocket connection (via the same `useConnectionHealth` pattern used elsewhere in the application) while `currentSessionState !== 'draft'`, so it can receive `participant_joined`/`participant_left` events and render the participant readiness roster (see `participant-readiness-roster` capability) without requiring the Facilitator to navigate to a different page.

This subscription is not a call added to `DraftSessionHost`'s existing render function. `DraftSessionHost` renders two branches from one component today — a `draft`-status control view and the live-readiness view — and `evaluateSessionSubscriberAccess`'s facilitator grant path excludes `draft` status entirely, so a facilitator has zero valid grant paths while the session is `draft`. Calling `useConnectionHealth` unconditionally (rather than gating its *mount*) would open a socket during `draft` that the server immediately rejects as unauthorized, and `connectionHealth.ts`'s disclosure-blind close-code handling would drive that into an indefinite exponential-backoff reconnect loop — a self-inflicted denial-of-service against the application's own authorization boundary. The live-readiness view is therefore its own child component, owning the `useConnectionHealth` call, mounted only when `currentSessionState !== 'draft'` — mount/unmount is the gate, not a status check inside the hook.

#### Scenario: DraftSessionHost opens a WebSocket connection during lobby
- **WHEN** the Facilitator views `DraftSessionHost` for a session in `lobby` status
- **THEN** a session-scoped WebSocket connection is opened for that session

#### Scenario: No WebSocket connection is opened while the session is in `draft`
- **WHEN** the Facilitator views `DraftSessionHost` for a session in `draft` status
- **THEN** no WebSocket connection is opened, and no reconnect/backoff activity occurs

#### Scenario: The live-readiness child component mounts exactly once the session leaves `draft`
- **WHEN** a session transitions from `draft` to `lobby` while the Facilitator is on `DraftSessionHost`
- **THEN** the live-readiness child component mounts (and its WebSocket connection opens) exactly once, at that transition

### Requirement: `DraftSessionHost`'s live-readiness-view renders the participant readiness roster

While `currentSessionState === 'lobby'`, `DraftSessionHost`'s live-readiness-view SHALL render the participant readiness roster, using the same shared roster component/hook rendered on `SessionLobbyPage`'s `lobby` branch, and passing the join link it already has available so the roster's empty-state prompt can display it (see `participant-readiness-roster`'s empty-state requirement).

#### Scenario: Facilitator sees the roster on their landing page
- **WHEN** the Facilitator views `DraftSessionHost` for a session in `lobby` status with one or more participants who have joined
- **THEN** the participant readiness roster is visible on `DraftSessionHost`, listing those participants

---

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

---

### Requirement: Session-creation entry point is gated on facilitator eligibility

The frontend SHALL provide a session-creation entry point (picker → confirm → create) reachable only when `AuthSession.canFacilitateSessions` is `true`. This applies regardless of whether the user has any team memberships of their own:
- A facilitator with zero team memberships is routed to this entry point rather than to the `/no-team` page (see the `first-access` capability's carve-out).
- A facilitator with one or more team memberships SHALL find a link to the entry point on the team view (`/team/:teamId`) of every team they belong to, and on any other team view they can reach.

The post-sign-in landing is not changed by this requirement.

The team-view link SHALL be rendered only when `canFacilitateSessions` is `true`, independent of which team is being viewed or of the caller's membership role on it. When `canFacilitateSessions` is `false`, the link SHALL be absent from the DOM: not hidden, disabled or collapsed.

The team-view link SHALL NOT target or imply the team being viewed:
- Its target SHALL be exactly `/sessions/new`, with no team identifier in the path, query string or navigation state.
- Its visible label SHALL convey facilitating a session for a team *other than* the one being viewed. It SHALL NOT be a bare "Start a session", "Create a session" or "Facilitate", and SHALL NOT contain the current team's name.
- The exact label string is not normative. The shipped strings are recorded in the change's PR description and asserted by the frontend tests.

The set of teams offered by the picker SHALL be determined only by `GET /api/v1/teams/eligible-for-session`. The entry point and the picker SHALL NOT add, remove or pre-select teams on the client.

When the eligible-teams response has `callerHasTeamMemberships = true` and a non-empty `eligibleTeams` list, the picker SHALL state that the caller's own team is not listed because facilitators run sessions for teams they are not on. This copy SHALL state only that membership rule. It SHALL NOT state or imply that every team other than the caller's own is listed.

When `eligibleTeams` is empty, the picker's empty-state copy SHALL NOT state or imply either of the following: that the caller belongs to every team, or that no other team exists. Teams can be absent from the list for reasons the copy does not name, such as deactivated teams. The exact strings are not normative.

The picker screen SHALL offer a way out of session creation:
- A sign-out control, for every facilitator.
- A link to the team view of one of the caller's teams, only when the caller has one or more team memberships.

These controls SHALL be rendered in every list state of the picker screen (loading, load error, empty, populated). They SHALL NOT depend on the eligible-teams request succeeding, or on the frontend's `AuthSession` having loaded (with no session, only the sign-out control is shown). They SHALL NOT be added to the confirm screen or the new-team screen. The session-expiry re-authentication treatment, which replaces the whole page, is exempt.

When the eligible-teams request is refused with `403` (the caller is no longer a facilitator), the frontend SHALL re-fetch `AuthSession` once. If the refreshed session reports `canFacilitateSessions = false`, the existing eligibility gate SHALL apply and the user is redirected to their post-sign-in landing, so that the frontend does not keep presenting facilitator entry points the server has already withdrawn. Other failures (network error, `5xx`) SHALL NOT trigger the re-fetch.

The confirm screen SHALL display, at minimum, the selected team's name and enough additional context (e.g., last session date) for a facilitator choosing among a rotating set of teams to recognize which team they are about to commit to. The bare team name alone is not sufficient. The confirm screen SHALL NOT expand into a full team history or trend view; that level of detail belongs to the post-creation draft control view, not the confirm step.

#### Scenario: Entry point is not shown to a non-facilitator
- **WHEN** an authenticated user whose `canFacilitateSessions` is `false` uses the application
- **THEN** no session-creation entry point is presented to them

#### Scenario: Entry point is shown to a facilitator with no team memberships
- **WHEN** an authenticated user with `canFacilitateSessions = true` and zero team memberships uses the application
- **THEN** the session-creation entry point is reachable to them, and they are not routed to `/no-team`

#### Scenario: Facilitator with a team membership reaches the entry point from the team view
- **GIVEN** an authenticated user with `canFacilitateSessions = true` and one or more active team memberships
- **WHEN** they view `/team/:teamId` for any team they belong to
- **THEN** the team view shows a link to `/sessions/new`
- **AND** activating that link navigates to `/sessions/new` without any URL being typed or edited
- **AND** from sign-in, the user reaches `/sessions/new` with exactly one navigation action after the post-sign-in landing on a team view

#### Scenario: The team-view entry point does not target the team being viewed
- **GIVEN** a facilitator viewing `/team/:teamId` for a team they belong to
- **THEN** the entry point's visible label refers to facilitating a session for another team and does not contain the current team's name
- **AND** the link target is exactly `/sessions/new`, with no team identifier in the path, query string or navigation state
- **AND** the picker reached through it is populated only from `GET /api/v1/teams/eligible-for-session` and pre-selects no team

#### Scenario: Team-view entry point is not shown to an Engineer
- **GIVEN** a user with `canFacilitateSessions = false` and an active `participant` membership
- **WHEN** they view `/team/:teamId`
- **THEN** no link to `/sessions/new` is present in the DOM

#### Scenario: Team-view entry point is not shown to an Engineering Manager
- **GIVEN** a user whose global role resolves to `engineering_manager`, including one whose IdP claims also map to `facilitator` (resolved by the fixed role precedence in `oidc-role-mapping`)
- **AND** `GET /auth/session` therefore returns `canFacilitateSessions = false` for them
- **WHEN** they view `/team/:teamId`
- **THEN** no link to `/sessions/new` is present in the DOM

#### Scenario: Facilitator whose membership on the viewed team is as an Engineering Manager still sees the entry point
- **GIVEN** a user with `canFacilitateSessions = true` holding an `engineering_manager` membership role on the team being viewed
- **WHEN** they view `/team/:teamId`
- **THEN** the link to `/sessions/new` is shown
- **AND** that team is not offered by the picker, because the eligible-teams listing excludes every team on which the caller holds an active membership of any role

#### Scenario: Picker explains why the caller's own team is not listed
- **GIVEN** a facilitator whose eligible-teams response has `callerHasTeamMemberships = true` and at least one eligible team
- **WHEN** the picker screen renders the list
- **THEN** it states that the caller's own team is not listed because facilitators run sessions for teams they are not on
- **AND** the statement does not claim that every other team is listed

#### Scenario: Facilitator with memberships can return to a team from the picker
- **GIVEN** a facilitator with one or more active team memberships on the `/sessions/new` picker screen
- **THEN** the screen offers a link to `/team/:teamId` for one of their teams and a sign-out control
- **AND** neither is added to the confirm screen or the new-team screen

#### Scenario: Way out is available when the eligible-teams list fails to load
- **GIVEN** a facilitator with one or more active team memberships on the `/sessions/new` picker screen
- **WHEN** `GET /api/v1/teams/eligible-for-session` fails (for example `403` after the role was revoked, or a network error)
- **THEN** the load-error message is shown
- **AND** the sign-out control and the link to `/team/:teamId` are shown
- **AND**, if the failure was `403`, the frontend re-fetches `AuthSession` once; if the refreshed session reports `canFacilitateSessions = false`, the user is instead redirected to their post-sign-in landing (their team view, or `/no-team`)

#### Scenario: Empty-state copy does not claim the caller is on every team
- **GIVEN** a facilitator whose eligible-teams response has an empty `eligibleTeams` list
- **WHEN** the picker screen renders the empty state, with `callerHasTeamMemberships` either `true` or `false`
- **THEN** the copy does not state or imply that the caller belongs to every team or that no other team exists
- **AND** the existing invitation to create a new team is still offered

#### Scenario: Zero-membership facilitator sees sign-out but no team link on the picker
- **GIVEN** a facilitator with zero team memberships on the `/sessions/new` picker screen
- **THEN** a sign-out control is shown
- **AND** no link to any team view is shown

#### Scenario: Post-sign-in landing is unchanged for a facilitator with memberships
- **WHEN** a user with `global_role = 'facilitator'` and one or more active team memberships completes sign-in with no `returnTo` and no pending join token
- **THEN** they are redirected to `/team/:teamId` for a team they belong to, not to `/sessions/new`

#### Scenario: Confirm screen shows more than the bare team name
- **WHEN** a facilitator selects a team from the eligible-teams picker
- **THEN** the confirm screen displays the team's name and additional context (e.g., last session date), not the team name alone

#### Scenario: Race-condition rejection is shown inline, not as a silent bounce
- **WHEN** a facilitator's confirm-screen submission is rejected because their team membership or the target team's session state changed since the eligible-teams list was fetched
- **THEN** the confirm screen displays the server's rejection message inline
- **AND** the facilitator is not silently returned to the picker with no explanation
- **AND** the picker's eligible-teams list is treated as stale and re-fetched the next time it is opened

#### Scenario: A concurrent-session rejection offers a path to the existing session
- **WHEN** a facilitator's confirm-screen submission is rejected with the `409` `SessionAlreadyExistsResponse` (the target team already has a non-terminal session)
- **THEN** the confirm screen's inline error includes an affordance to navigate to `/team/:teamId/session/:existingSessionId`, using the `existingSessionId` from the response body

---

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

### Requirement: `POST /api/v1/teams` evaluates checks in a fixed order — authenticate, then authorize, then validate, then check uniqueness

The handler SHALL perform its checks in this order: caller authentication (session required), caller role authorization (`facilitator`), team-name non-emptiness validation, then team-name uniqueness. Authorization SHALL be evaluated before any name-dependent check, so that a caller who is not an authenticated `facilitator` cannot learn whether any given team name is already taken.

#### Scenario: A non-facilitator caller cannot probe name existence
- **WHEN** a caller who is authenticated but whose `users.global_role` is not `facilitator` submits `POST /api/v1/teams` with the name of a team that already exists
- **THEN** the request is rejected with `403`, the same response as if the name did not collide
- **AND** the response does not indicate whether the submitted name collides with an existing team

---

### Requirement: Team-name uniqueness is enforced case-insensitively and after trimming

Team-name collisions SHALL be evaluated on the normalized form of the name — lowercased and trimmed of leading/trailing whitespace — not on raw string equality. This normalized uniqueness SHALL be enforced at the database level (not solely by an application-level pre-check), so that two concurrent requests for normalized-duplicate names cannot both succeed. A rejected submission SHALL return a typed collision response (`TeamNameCollisionResponse { errorState: "team_name_collision"; providedName: string }`), distinguishable from other validation failures (e.g., empty name) by its `errorState` discriminant, not by message text. This response SHALL be returned for a uniqueness violation on either the exact-match constraint or the normalized constraint — the caller-visible outcome does not depend on which underlying constraint the database reports.

#### Scenario: Exact duplicate name is rejected
- **WHEN** a caller submits `POST /api/v1/teams` with a name identical to an existing team's name
- **THEN** the request is rejected with a validation error identifying the name collision
- **AND** no team record is created

#### Scenario: Case- and whitespace-variant duplicate is rejected
- **WHEN** a team named "Platform Team" already exists and a caller submits `POST /api/v1/teams` with the name "platform team" (different case) or " Platform Team " (leading/trailing whitespace)
- **THEN** the request is rejected with a validation error identifying the name collision
- **AND** no team record is created

#### Scenario: Concurrent submissions for normalized-duplicate names — only one succeeds
- **WHEN** two callers simultaneously submit `POST /api/v1/teams` with names that normalize to the same value (e.g., "Platform Team" and "platform team"), and no team by that normalized name yet exists
- **THEN** exactly one request succeeds and creates the team
- **AND** the other request is rejected with the name-collision validation error, not a generic server error

#### Scenario: Distinct names are both accepted
- **WHEN** a caller submits `POST /api/v1/teams` with a name that does not normalize to match any existing team's name
- **THEN** the team is created successfully

---

### Requirement: New-team session lands directly in `lobby`, skipping `draft`

Unlike session creation for an existing team (which lands the Facilitator in a `draft`-status control view per this capability's draft-status landing requirement), a session created via `POST /api/v1/teams` SHALL be created directly in `lobby` status. The submit action that creates the team SHALL echo the submitted team name back to the Facilitator as part of the control's own label (e.g., "Create team '<name>' and open session room") before the request is sent, since there is no subsequent confirmation screen and no rename path once the team is created. Upon landing, the application SHALL display an explicit acknowledgment that the team was created and its default topics were assigned.

#### Scenario: Facilitator lands in an open, joinable lobby immediately after creating a new team
- **WHEN** a Facilitator successfully creates a new team and its session via `POST /api/v1/teams`
- **THEN** the resulting session has `status = 'lobby'`, not `draft`
- **AND** the Facilitator is navigated directly to the session's live participant-readiness view
- **AND** the join link is immediately usable

#### Scenario: Submit control echoes the typed team name before firing
- **WHEN** a Facilitator has typed a team name into the new-team form and is about to submit
- **THEN** the submit control's label includes the exact typed name (e.g., "Create team 'Platform Team' and open session room"), not a generic "Submit" or "Create"

#### Scenario: Landing view acknowledges team creation and topic assignment
- **WHEN** a Facilitator lands on the session view immediately after creating a new team
- **THEN** the view displays an explicit acknowledgment that the team was created and that its default topics were assigned, distinct from the existing-team flow's landing copy

---

### Requirement: New-team form extends the existing session-creation screen state machine

The new-team creation form SHALL be implemented as an additional screen within the same component that implements the existing-team picker and confirm screens, not as a separate page or route. Navigating from the new-team form back to the picker, at any point before the form is submitted, SHALL create no team, topic, or session record and SHALL always be available.

#### Scenario: Facilitator navigates to the new-team form from the picker
- **WHEN** a Facilitator on the eligible-teams picker selects the option to create a new team
- **THEN** the same component transitions to the new-team form screen without a full page navigation

#### Scenario: Backing out of the new-team form before submission is always safe
- **WHEN** a Facilitator on the new-team form navigates back to the picker without having submitted the form
- **THEN** no team, topic, or session record is created
- **AND** the picker screen is shown, available for immediate reselection

---

### Requirement: Empty eligible-teams state invites new-team creation

When the eligible-teams picker has no existing teams to display, its message SHALL direct the Facilitator to the new-team creation option rather than stating only that no teams are available.

#### Scenario: Picker with zero eligible existing teams still offers a path forward
- **WHEN** a Facilitator opens the session-creation picker and `eligibleTeams` is empty
- **THEN** the picker displays a message that invites creating a new team (e.g., "Don't see your team? Create one to get started"), not a message stating only that no teams are available
- **AND** the option to create a new team remains reachable from this state

---

### Requirement: Team creation does not establish membership for the creating Facilitator

`POST /api/v1/teams` SHALL NOT insert a `team_memberships` row for the caller who creates the team, regardless of the `teams.created_by_user_id` value recorded on the new team.

#### Scenario: Creating Facilitator has no membership in the team they just created
- **WHEN** a Facilitator successfully creates a new team via `POST /api/v1/teams`
- **THEN** `teams.created_by_user_id` for the new team is the creating Facilitator's user id
- **AND** no `team_memberships` row exists for the creating Facilitator and the new team
- **AND** the creating Facilitator remains eligible to facilitate a future session for this team under the ordinary facilitator-from-another-team enforcement, exactly as any other non-member would be

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
