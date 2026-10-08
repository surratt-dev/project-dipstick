# Spec Delta: session-creation

## ADDED Requirements

### Requirement: Draft session creation refuses the template team as if it did not exist

`POST /api/v1/teams/:teamId/sessions/draft` with `teamId = DEFAULT_TOPICS_TEAM_ID` SHALL return the same response the endpoint returns for a canonical-format `teamId` that matches no team: `404` with `error.code: "TEAM_NOT_FOUND"`. The check SHALL run after the non-canonical `teamId` rejection, authentication (`401`) and the facilitator-role check (`403`, which also refuses an admin), and before the cross-team check. No session and no join link SHALL be created.

#### Scenario: A facilitator cannot draft a session on the template
- **WHEN** a standing facilitator with no memberships sends the draft request for the template
- **THEN** the response matches the endpoint's missing-team response in status and body (except `correlationId`)
- **AND** no `sessions` or `join_links` row is created, no `joinToken` is returned, and one `team.template_access_denied` row is written

#### Scenario: Authorization failures still come first
- **WHEN** a caller who is not a facilitator sends the draft request for the template
- **THEN** the response is the endpoint's existing `403` and no `team.template_access_denied` row is written

#### Scenario: An administrator is refused by the facilitator check
- **WHEN** an `application_admin` sends the draft request for the template
- **THEN** the response is the endpoint's existing facilitator-role `403` and no `team.template_access_denied` row is written

#### Scenario: A non-canonical template spelling is rejected at the boundary
- **WHEN** a caller sends the draft request with the template id without hyphens or wrapped in braces
- **THEN** the response is the same `404 TEAM_NOT_FOUND` parity response, returned before authorization
- **AND** no `team.template_access_denied` row is written and no `sessions` or `join_links` row is created

#### Scenario: The template refusal does not depend on the cross-team rule
- **WHEN** the draft request for the template is refused
- **THEN** the cross-team membership check is not evaluated and no cross-team denial audit row is written

#### Scenario: No timing floor is added
- **WHEN** the draft request for the template is refused
- **THEN** no timing floor is applied, because the draft endpoint's missing-team path applies none
- **AND** the structural test's per-route table records "no floor" for this route (recorded as data, not measured)

### Requirement: Team-addressed session sub-routes refuse the template team before the session lookup

On each route under `/api/v1/teams/:teamId/sessions/:sessionId`, the template check SHALL run right after authentication (and any non-canonical-id rejection), before the session lookup and any `getOrCreateJoinLink` call. Any authenticated caller SHALL receive the route's missing-session response ("Session not found." `404`; for `reveal`, its non-recoverable `409 reveal_failure`), with one `team.template_access_denied` row (`surface: "session"`), no new row and no timing floor.

#### Scenario: facilitator-state does not mint a join link for the template
- **WHEN** an authenticated caller sends `GET /api/v1/teams/<DEFAULT_TOPICS_TEAM_ID>/sessions/<any id>/facilitator-state`
- **THEN** the response is that route's "Session not found." `404`
- **AND** no `join_links` row is created and one `team.template_access_denied` row is written

#### Scenario: Completing a session on the template is refused and does not unlock it
- **WHEN** an authenticated caller sends `POST /api/v1/teams/<DEFAULT_TOPICS_TEAM_ID>/sessions/<any id>/complete`
- **THEN** the response is that route's "Session not found." `404`
- **AND** the template's lock state is unchanged

#### Scenario: The guard, not the lookup, produced the 404
- **WHEN** any of these routes is sent for the template with a session id that does not exist
- **THEN** exactly one `team.template_access_denied` row is written, which shows the guard ran before the session lookup

#### Scenario: Reveal answers the template with its missing-session 409
- **WHEN** an authenticated caller sends `POST /api/v1/teams/<DEFAULT_TOPICS_TEAM_ID>/sessions/<any id>/reveal`
- **THEN** the response is that route's non-recoverable `409` with `errorState: "reveal_failure"` and `recoverable: false`, the same response it gives a session it cannot find for the team, and the body carries no `correlationId`
- **AND** one `team.template_access_denied` row is written; a `correlationId` is generated for the structured event and logs only, not added to the response body

#### Scenario: A non-facilitator caller receives the same refusal
- **WHEN** an authenticated caller whose `global_role` is `engineer` (the global role of a participant; neither `facilitator` nor `application_admin`) sends `POST /api/v1/teams/<DEFAULT_TOPICS_TEAM_ID>/sessions/<random canonical uuid>/advance`
- **THEN** the response is that route's "Session not found." `404` with its existing body (except `correlationId`)
- **AND** exactly one `team.template_access_denied` row with `surface: "session"` and `actor_global_role = 'engineer'` is written, and no `sessions` or `join_links` row is created

#### Scenario: An unauthenticated caller is refused before the guard
- **WHEN** a caller with no session sends any of these routes for the template
- **THEN** the route's existing `401` is returned and no `team.template_access_denied` row is written

### Requirement: Team session-history reads never serve the template team

`GET /api/v1/teams/:teamId/sessions` and `GET /api/v1/teams/:teamId/sessions/:sessionId` SHALL return, for the template team, the same response they return for a team that does not exist, for a caller with the same role, and no session, vote or topic data. `evaluateTeamAccess` closes them once the migration has expired facilitator access on terminal template sessions. No route-level guard is added, so no `team.template_access_denied` row is written; the existing timing floor applies.

#### Scenario: A facilitator reads template session history
- **WHEN** a standing facilitator with no memberships requests either route for the template
- **THEN** the response matches the response for a canonical-format team id that matches no team
- **AND** no session data is returned

#### Scenario: The facilitator of a recently completed template session reads template history
- **GIVEN** a completed template session whose `facilitator_access_expires_at` was in the future before the migration ran
- **WHEN** the migration has run and that session's facilitator requests either route for the template
- **THEN** the response matches the response for a canonical-format team id that matches no team, and no session data is returned

#### Scenario: An administrator reads template session history
- **WHEN** an `application_admin` requests either route for the template
- **THEN** the response is the same `403` the route returns to an administrator for any team

### Requirement: The confirm step explains a team that is no longer available

When `POST /api/v1/teams/:teamId/sessions/draft` returns `404` on the confirm step (any `404`, including `TEAM_NOT_FOUND` and a non-canonical id), the screen SHALL show "This team is no longer available. Go back to choose another team." with a "Choose another team" button that returns to the picker and re-fetches the eligible teams. It SHALL NOT show the generic retry error. `409` and `403` keep their existing copy.

#### Scenario: A stale selection shows the unavailable-team message
- **WHEN** the facilitator confirms a team and the draft request returns `404`
- **THEN** the screen shows "This team is no longer available. Go back to choose another team."
- **AND** the generic retry error is not shown

#### Scenario: Choosing another team reloads the picker
- **WHEN** the facilitator clicks "Choose another team" on the unavailable-team message
- **THEN** the picker step is shown and `GET /api/v1/teams/eligible-for-session` is requested again, so a stale entry cannot reappear from cache

#### Scenario: A live-session conflict keeps its existing copy
- **WHEN** the draft request returns `409`
- **THEN** the screen shows the existing concurrent-session copy, unchanged

#### Scenario: Other failures keep the existing error
- **WHEN** the draft request fails with a `5xx` or a network error
- **THEN** the screen shows the existing generic error, unchanged

## MODIFIED Requirements

### Requirement: Eligible-teams listing for session creation

The application SHALL provide `GET /api/v1/teams/eligible-for-session`, returning the teams the authenticated caller may create a session for. A team is eligible when the caller has no active (`removed_at IS NULL`) `team_memberships` row for it and the team's `deactivated_at` is `NULL`, and the team is not the template team (`DEFAULT_TOPICS_TEAM_ID`). The template is excluded by binding the shared constant as a query parameter, never by a UUID literal or by name, and is never listed whatever its membership, deactivation or session state (see `default-topic-provisioning`, FR-1.7 carve-out). This is a live database read on every call; the result SHALL NOT be cached at any layer. The endpoint's own `403`-vs-`200` authorization gate is itself a live read of `users.global_role` on every call — the same query the `POST /draft` endpoint's facilitator check uses — and SHALL NOT be derived from `canFacilitateSessions` or any other value carried on the request's session/token state.

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
- **THEN** the response is `200`, `eligibleTeams` includes every non-deactivated team except the template team, and `callerHasTeamMemberships` is `false`

#### Scenario: The template team is never listed
- **WHEN** a facilitator with zero memberships calls the endpoint
- **THEN** `eligibleTeams` contains no entry with `teamId = DEFAULT_TOPICS_TEAM_ID` and no entry named `__default_topics__`
- **AND** a team the facilitator does not belong to is still listed

#### Scenario: The template was the caller's only otherwise-eligible team
- **WHEN** a facilitator is an active member of every non-deactivated real team
- **THEN** `eligibleTeams` is an empty array and the session-creation screen shows the existing empty state, with no new copy

#### Scenario: Fresh install where the template is the only team
- **GIVEN** the template is the only `teams` row
- **WHEN** a facilitator with zero memberships calls the endpoint
- **THEN** the response is `200` with `eligibleTeams = []` and `callerHasTeamMemberships = false`
- **AND** the session-creation screen shows the existing zero-home-team empty state with its Create control

#### Scenario: Facilitator with a home team and zero eligible targets
- **WHEN** a facilitator has an active team membership and is also an active member of every other non-deactivated team
- **THEN** the response is `200`, `eligibleTeams` is an empty array, and `callerHasTeamMemberships` is `true`

Note: this endpoint does not filter out teams that already have a non-terminal session — membership is the only per-caller eligibility condition it evaluates (deactivation and the template exclusion are properties of the team). A team with a live session can still appear in `eligibleTeams`; selecting it and submitting is rejected with `409` by the concurrent-session-block requirement below. This is a deliberate choice, not an oversight: it keeps "is there a live session for this team" checked in exactly one place (submission time), consistent with this capability's posture that the eligible-teams list is a convenience for the picker UI, never a source of truth the submission path trusts.
