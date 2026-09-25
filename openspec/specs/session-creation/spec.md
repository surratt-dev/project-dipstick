# session-creation

## Purpose

Defines requirements for facilitator-initiated session creation, covering two flows: session creation for an existing team (the eligible-teams listing, the facilitator-from-another-team enforcement point, the concurrent-active-session block, audit logging for denial and success, the draft-status landing control view, and the "Open the room" advance action), and inline creation of a brand-new team and its first session via `POST /api/v1/teams` (team-name uniqueness, default-topic assignment via `default-topic-provisioning`, and the direct-to-`lobby` landing specific to a team with no prior context). Any picker personalization beyond the eligible-teams list and empty-state copy remains out of scope for this capability today and left for it to grow into later.

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
- **THEN** this requirement makes no claim about what page or state the Engineer subsequently lands on — the redirect destination is governed by the `join-link` capability's "Session-aware join link landing" requirement, not by this requirement

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

The frontend SHALL provide a session-creation entry point (picker → confirm → create) reachable only when `AuthSession.canFacilitateSessions` is `true`. This applies regardless of whether the user has any team memberships of their own — a facilitator with zero team memberships is routed to this entry point rather than to the `/no-team` page (see the `first-access` capability's carve-out).

The confirm screen SHALL display, at minimum, the selected team's name and enough additional context (e.g., last session date) for a facilitator choosing among a rotating set of teams to recognize which team they are about to commit to — the bare team name alone is not sufficient. The confirm screen SHALL NOT expand into a full team history or trend view; that level of detail belongs to the post-creation draft control view, not the confirm step.

#### Scenario: Entry point is not shown to a non-facilitator
- **WHEN** an authenticated user whose `canFacilitateSessions` is `false` uses the application
- **THEN** no session-creation entry point is presented to them

#### Scenario: Entry point is shown to a facilitator with no team memberships
- **WHEN** an authenticated user with `canFacilitateSessions = true` and zero team memberships uses the application
- **THEN** the session-creation entry point is reachable to them, and they are not routed to `/no-team`

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

The application SHALL provide `POST /api/v1/teams`, callable only by a caller whose `users.global_role` is `facilitator`, which creates a new team, assigns it the canonical default topic set (see `default-topic-provisioning`), and creates that team's first session — all in a single database transaction. The session created by this endpoint SHALL be recorded with `is_first_session = true`, computed explicitly for this flow rather than inherited from any other session-creation code path. On success, the new session SHALL land directly in `lobby` status (see the draft-skip requirement below), not `draft`. A failure at any step of the transaction SHALL leave no team, topic, or session record behind.

#### Scenario: Facilitator creates a new team and its first session
- **WHEN** an authenticated caller with `users.global_role = 'facilitator'` submits `POST /api/v1/teams` with a unique, non-empty team name
- **THEN** a new `teams` row is created with that name
- **AND** the new team's `topics` rows are populated from the canonical default topic set
- **AND** a new `sessions` row is created for the new team and the caller, with `status = 'lobby'` and `is_first_session = true`
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
- **WHEN** `POST /api/v1/teams` fails at any point after the team insert has been attempted (topic copy, session insert, or audit write)
- **THEN** the entire transaction rolls back
- **AND** no team, topic, or session record from this request exists afterward

#### Scenario: A successful team-and-session creation is audited
- **WHEN** a caller successfully creates a new team and its first session via `POST /api/v1/teams`
- **THEN** an `audit_log` row is written in the same transaction as the `INSERT INTO teams` and `INSERT INTO sessions` rows, identifying the actor, the actor's global role, the actor's IP, the new team's id, and the new session's id

---

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
