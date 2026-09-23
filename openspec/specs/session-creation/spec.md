# session-creation

## Purpose

Defines requirements for facilitator-initiated session creation for an existing team: the eligible-teams listing, the facilitator-from-another-team enforcement point, the concurrent-active-session block, audit logging for denial and success, the draft-status landing control view, and the "Open the room" advance action. The new-team variant of session creation, and any picker personalization, are explicitly out of scope for this capability today and left for it to grow into later.

## Requirements

### Requirement: Facilitator-from-another-team enforcement at session creation

A user attempting to create a session for a team via `POST /api/v1/teams/:teamId/sessions/draft` SHALL be rejected if they have an active `team_memberships` row (`removed_at IS NULL`) for `:teamId`. This check is a hard block with no exception path, enforced server-side at this endpoint, independent of and re-validated regardless of whatever eligible-teams list the caller was shown before submitting. "Not a member" for this check means no row with `removed_at IS NULL`; a user previously removed from the team is eligible to facilitate it again.

The endpoint SHALL evaluate two independent conditions, in order, with distinguishable rejection reasons:
1. `users.global_role !== 'facilitator'` → `403`, with an error message identifying "not a facilitator" as the reason.
2. An active `team_memberships` row exists for the caller and `:teamId` → `403`, with an error message identifying the cross-team constraint by name (e.g., "You cannot create a session for a team you belong to"). This message is distinguishable from condition 1's message.

Both checks read directly from the database on every request; neither may be satisfied from a client-supplied value, a cached role, or the eligible-teams list response. This holds regardless of whether the request originates from the session-creation picker UI or is submitted directly (e.g., via API call).

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

Upon successful creation, the facilitator SHALL be navigated to a real, bookmarkable, refresh-safe route (`/team/:teamId/session/:sessionId`) rendering their own control view for the new `draft`-status session — not a participant-facing room and not an already-open lobby. This route SHALL be rehydratable independent of the create flow: on any mount, the frontend SHALL fetch current session status from `GET /api/v1/teams/:teamId/sessions/:sessionId/facilitator-state` (which already enforces `facilitator_id === caller` server-side) and render the draft control view when status is `draft`, or the live participant-readiness view otherwise. The control view SHALL display: available team context (team name and `lastSessionAt`, if any), the generated join link (visibly marked as not yet joinable), and an explicit "Open the room" action. The session SHALL NOT be automatically advanced to `lobby` as part of creation.

Because no `session_status` transition in this system is reversible, activating "Open the room" SHALL first require a lightweight inline confirmation before the request fires. Once confirmed, it SHALL call the existing session-advance endpoint (`POST /api/v1/teams/:teamId/sessions/:sessionId/advance`). On success, the session transitions to `lobby` and becomes joinable, and the same control view updates in place to the live participant-readiness view, with no additional navigation. On failure, the control view remains unchanged — the draft session is not affected by a failed advance attempt — and displays an inline, retryable error.

#### Scenario: Facilitator lands in draft control view after creation, not an open lobby
- **WHEN** a facilitator successfully creates a session for an existing team
- **THEN** the resulting session has status `draft`
- **AND** the facilitator is navigated to `/team/:teamId/session/:sessionId`, showing their own control view with team context, the join link marked not-yet-joinable, and an "Open the room" action
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
