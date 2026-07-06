## MODIFIED Requirements

### Requirement: Join-link-through-authentication flow
An unauthenticated user who follows a join link SHALL be redirected to `/auth/login?joinToken=<token>`, which initiates the OIDC flow with the join token preserved in the OIDC `state` parameter (stored in Redis). After successful authentication (including First Access account creation if needed), the callback handler retrieves the pending join token from state and completes the join flow automatically. No manual steps SHALL occur between authentication and team membership.

When `executeJoinFlow` returns `{ redirectUrl: null }` and a `pendingJoinToken` was present in the OIDC state, the callback handler SHALL redirect to the join error page with a `?joinError=` query parameter indicating the failure reason:
- `?joinError=expired` — when the token exists but `expires_at` is in the past, or `revoked_at` is set
- `?joinError=invalid` — when the token does not exist in the database

The user SHALL NOT be routed to `/no-team` when a `pendingJoinToken` was present in the OIDC state and failed validation. The join error page is the correct destination in all failure cases.

When `executeJoinFlow` results in a new membership insertion (not an already-a-member case), the redirect URL SHALL include `?newMember=true` so the team page can display a first-time confirmation banner.

#### Scenario: Unauthenticated user follows join link
- **WHEN** an unauthenticated user visits `GET /api/join/:token`
- **THEN** the application redirects to `/auth/login?joinToken=<token>`, which redirects to the IdP, and after authentication the join flow completes automatically

#### Scenario: First-time user follows join link
- **WHEN** a user with no existing account follows a join link and authenticates
- **THEN** the application creates their account (First Access), adds them to the team with `participant` role, and directs them to the team view or active session — all without manual intervention

#### Scenario: Join destination survives IdP redirect
- **WHEN** a user follows a join link and completes the OIDC redirect chain
- **THEN** the original join link token is retrieved from the `pendingJoinToken` field in the Redis-stored OIDC state and the join flow executes

#### Scenario: Expired pendingJoinToken at callback time
- **WHEN** an authenticated user completes the OIDC flow with a `pendingJoinToken` that has expired (`expires_at` is in the past)
- **THEN** the callback handler redirects to the join error page with `?joinError=expired`
- **AND** the page displays: "This link has expired. Ask your facilitator for a new one."
- **AND** the user is not added to any team
- **AND** the user is not routed to `/no-team`

#### Scenario: Revoked pendingJoinToken at callback time
- **WHEN** an authenticated user completes the OIDC flow with a `pendingJoinToken` whose `revoked_at` is set
- **THEN** the callback handler redirects to the join error page with `?joinError=expired`
- **AND** the page displays: "This link has expired. Ask your facilitator for a new one."
- **AND** the user is not added to any team
- **AND** the user is not routed to `/no-team`

#### Scenario: Nonexistent pendingJoinToken at callback time
- **WHEN** an authenticated user completes the OIDC flow with a `pendingJoinToken` that does not exist in the database
- **THEN** the callback handler redirects to the join error page with `?joinError=invalid`
- **AND** the page displays: "This link is not valid."
- **AND** the user is not added to any team
- **AND** the user is not routed to `/no-team`

#### Scenario: Successful through-auth join for a new member
- **WHEN** an authenticated user completes the OIDC flow with a valid `pendingJoinToken` and is not already a member of the team
- **THEN** the callback handler redirects to `/team/:teamId` (or `/session/:sessionId` if a session is active) with `?newMember=true` appended

---

### Requirement: Already-a-member handling
When an authenticated user follows a join link for a team they are already a member of, the `INSERT ... ON CONFLICT DO NOTHING` ensures no duplicate membership is created. The application redirects to the team view (or active session) with `?alreadyMember=true` query parameter for the frontend to display a transient notification. This behavior SHALL apply to both the direct join path and the through-auth join path.

#### Scenario: Existing member follows join link (direct path)
- **WHEN** a user who is already a member of a team follows that team's join link directly (authenticated)
- **THEN** no duplicate membership is created, and the user is redirected to the team view (or active session) with `?alreadyMember=true`

#### Scenario: Existing member completes through-auth join (through-auth path)
- **WHEN** a user who is already a member of a team completes the OIDC flow with a `pendingJoinToken` for that team
- **THEN** no duplicate membership is created, and the user is redirected to the team view (or active session) with `?alreadyMember=true`

---

## ADDED Requirements

### Requirement: New-member confirmation on team page
When a user arrives at the team page via a successful join flow for the first time (new membership created), the team page SHALL display a transient notification banner with the content: "You've joined the team. Your facilitator will share what comes next." This banner is triggered by the `?newMember=true` query parameter. The team page SHALL remove `?newMember=true` from the URL via `replace` navigation after rendering the banner, consistent with `?alreadyMember=true` handling.

#### Scenario: New member arrives at team page after through-auth join
- **WHEN** a user is redirected to `/team/:teamId?newMember=true` after a successful through-auth join
- **THEN** the team page displays a transient notification: "You've joined the team. Your facilitator will share what comes next."
- **AND** the query parameter is removed from the URL without adding a browser history entry

#### Scenario: ?newMember=true is not shown for already-a-member arrivals
- **WHEN** a user is redirected to the team page with `?alreadyMember=true`
- **THEN** the team page displays the existing already-a-member banner and does not show the new-member banner

---

### Requirement: Role vocabulary — "Engineer" maps to `participant`
The `team_memberships.membership_role` enum value `participant` corresponds to what the use case calls "Engineer." These refer to the same person at different model layers. The global `user_role` enum on the `users` table has a separate `engineer` value; this is distinct from the membership role. These MUST NOT be conflated.

All membership insert sites SHALL include an inline comment stating this mapping. Changing the inserted role value from `participant` to `engineer` would cause a database error, as `engineer` is not a valid value in the `membership_role` enum.

#### Scenario: Role vocabulary comment present at insert site in join-links.ts
- **WHEN** a developer reads the `INSERT INTO team_memberships` call in `packages/backend/src/routes/join-links.ts`
- **THEN** an inline comment is present explaining that `role: 'participant'` corresponds to the use case's "Engineer" role and that the `membership_role` enum is distinct from the global `user_role` enum

#### Scenario: Role vocabulary comment present at insert site in auth.ts
- **WHEN** a developer reads the membership insertion logic called via `executeJoinFlow` in `packages/backend/src/routes/auth.ts`
- **THEN** an inline comment is present explaining the same vocabulary mapping

---

### Requirement: Accurate `sourceIp` in through-auth join audit events
The `executeJoinFlow` function SHALL accept a `sourceIp` parameter. Callers SHALL pass the real requester IP from `request.ip`. Audit events emitted by `executeJoinFlow` (including `join.link_rejected` events from the through-auth path) SHALL carry the real IP, not a literal placeholder string.

#### Scenario: Through-auth join audit event carries real sourceIp
- **WHEN** `executeJoinFlow` is called from the auth callback handler and emits an audit event
- **THEN** the `sourceIp` field in that audit event contains the value of `request.ip` from the callback handler, not the string `"callback"`

---

### Requirement: Join link revocation — explicitly deferred
The `join_links` table has a `revoked_at` column. The validation logic in `GET /api/join/:token` handles revoked links correctly. A write endpoint to set `revoked_at` (e.g., `DELETE /api/teams/:teamId/join-links/:linkId`) is NOT part of this change.

**Rationale:** The 7-day expiry provides time-bounded protection sufficient for initial deployment. The join link generation UI — the surface through which facilitators would access a revocation control — does not yet exist. Adding a revocation endpoint without the UI to expose it creates an incomplete capability with no user-visible value. Revocation MUST be implemented as part of the link management UI change.

**Interim mitigations available to facilitators:** (1) wait for the 7-day expiry; (2) generate a new link (does not invalidate the old one, but gives the intended recipient a working path).

#### Scenario: Revocation endpoint is not exposed in this change
- **WHEN** a facilitator wishes to revoke a join link before its 7-day expiry
- **THEN** no revocation endpoint is available; the facilitator must wait for expiry or generate a new link
