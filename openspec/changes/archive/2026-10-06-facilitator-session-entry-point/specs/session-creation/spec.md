# Spec Delta

## MODIFIED Requirements

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
