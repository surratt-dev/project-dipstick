## MODIFIED Requirements

### Requirement: No-team landing page
A user with no active team memberships and `canFacilitateSessions = false` SHALL be presented with a dedicated landing page at `/no-team`. The routing decision — whether to direct a user to `/no-team`, to a team view, or to the session-creation entry point — is made server-side in the authentication callback (for the team-view vs. no-team branch) and by the frontend's `AuthenticatedLanding` routing (for the `canFacilitateSessions` carve-out below), against live team membership and `canFacilitateSessions` data. The client SHALL NOT determine the team-view-vs-no-team routing via a separate API call after receiving an initial redirect to `/`.

**Facilitator carve-out:** A user with no active team memberships but `canFacilitateSessions = true` (see `project-structure`'s `AuthSession.canFacilitateSessions`) SHALL NOT be routed to `/no-team`. This user is routed instead to the session-creation entry point defined by the `session-creation` capability. The zero-team-membership state is a normal, expected condition for a facilitator — not an error state, and not one that should surface participant-facing "ask your facilitator for a join link" copy to the person who *is* the facilitator.

The no-team condition is evaluated at every sign-in, not only on first access. A previously active user from whom all team memberships have been removed will be routed to `/no-team` on their next sign-in (or to the session-creation entry point, if that user's `canFacilitateSessions` is `true`), with the same content as a first-time user in the corresponding branch.

The no-team page SHALL present the following elements and nothing else:

1. The authenticated user's display name
2. A statement that the user is not yet a member of any team
3. An instruction to request a join link from a facilitator
4. A brief reassurance that no further setup is required from the user
5. A sign-out affordance

Element 4 exists to reduce first-time user anxiety — it is a passive statement, not an action or an affordance. It does not expose any feature surface and does not conflict with the "single action" constraint (sign-out remains the only interactive element).

The page SHALL NOT be rendered inside any layout wrapper that contributes navigation elements (no application navigation bar, no sidebar, no header navigation links, no feature menus — not even empty, collapsed, or disabled versions of them). The sign-out affordance is the only interactive element. This constraint is enforced at the routing layer, not only at the component level, and is locked by a regression test at `src/pages/__tests__/App.test.tsx`. A user navigating directly to `/no-team` after having joined a team SHALL be redirected to their team view (bookmark guard).

#### Scenario: New user sees no-team page
- **WHEN** a user with no team memberships and `canFacilitateSessions = false` completes authentication
- **THEN** the server-side redirect in the authentication callback routes to `/no-team`, not to `/`; the page renders the user's display name, a statement of no team membership, an instruction to request a join link, a reassurance that no further setup is required, and a sign-out affordance

#### Scenario: No feature chrome on no-team page
- **WHEN** the no-team landing page is displayed
- **THEN** no application navigation menu, no empty session list, no empty trend dashboard, and no feature-specific UI elements are rendered; the page DOM contains no element contributed by a shared layout component; `document.querySelector("nav")` returns null and no element with role `navigation` is present

#### Scenario: User with team bypasses no-team page
- **WHEN** a user with one or more team memberships completes authentication
- **THEN** the server-side redirect in the authentication callback routes to `/team/:teamId`, not to `/no-team`

#### Scenario: Facilitator with zero team memberships bypasses no-team page
- **WHEN** a user with zero team memberships and `canFacilitateSessions = true` completes authentication and lands on the authenticated application shell
- **THEN** `AuthenticatedLanding` routes the user to the session-creation entry point, not to `/no-team`
- **AND** the participant-facing "ask your facilitator for a join link" copy is not shown to this user

#### Scenario: Facilitator who loses their only team membership is not misrouted
- **WHEN** a user with `canFacilitateSessions = true` and one team membership has that membership removed, and subsequently signs in again
- **THEN** the user is routed to the session-creation entry point, not to `/no-team`
