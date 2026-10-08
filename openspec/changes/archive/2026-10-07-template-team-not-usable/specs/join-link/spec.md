# Spec Delta: join-link

## ADDED Requirements

### Requirement: Join links are never created for the template team

`POST /api/teams/:teamId/join-links` with `teamId = DEFAULT_TOPICS_TEAM_ID` SHALL return `403` "You are not a member of this team.", the response the endpoint returns for a missing team, and SHALL create no `join_links` row. The draft-session get-or-create path SHALL never create or return a template join link.

#### Scenario: Creating a template join link is refused
- **WHEN** an authenticated caller sends `POST /api/teams/<DEFAULT_TOPICS_TEAM_ID>/join-links`
- **THEN** the response is `403` with the message "You are not a member of this team."
- **AND** no `join_links` row is created

#### Scenario: The refusal is observable as the guard's
- **WHEN** any authenticated caller sends the request for the template
- **THEN** one `team.template_access_denied` row with `surface: "join_link"` is written, because the template check runs after authentication and before the membership check. On this route the membership check is the authorization, and its `403` is also the missing-team response, so placing the guard first is what makes it observable as distinct from the ordinary non-member `403`

### Requirement: A join link that resolves to the template team is treated as an unknown token

`GET /api/join/:token` and the join step of `GET /auth/callback` SHALL, when the token resolves to `DEFAULT_TOPICS_TEAM_ID`, behave exactly as they do for an unknown token: redirect to `/join-error?joinError=invalid` and create or reactivate no `team_memberships` row. The existing invalid-link page and its copy SHALL be unchanged.

#### Scenario: Direct redemption of a template link
- **GIVEN** the token lookup resolves to the template team (simulated, because the migration revokes every existing template link and the constraint prevents new ones)
- **WHEN** an authenticated user requests `GET /api/join/<that token>`
- **THEN** the response redirects to `/join-error?joinError=invalid`
- **AND** no `team_memberships` row is created, and one `team.template_access_denied` row with `surface: "join_link"` is written without the token

#### Scenario: Redemption through login
- **GIVEN** an unauthenticated user follows a join link whose lookup resolves to the template team (simulated as above) and completes login
- **WHEN** `GET /auth/callback` runs the pending join
- **THEN** the user is redirected to `/join-error?joinError=invalid`, the login itself succeeds, and no `team_memberships` row is created

#### Scenario: The participant sees the existing invalid-link page
- **WHEN** a participant lands on `/join-error?joinError=invalid` from a template link
- **THEN** the page reads "This link is not valid." and tells them to ask the person who invited them for a new link, exactly as for any unknown token

### Requirement: The redemption template check runs before the link-state and login checks

In both redemption paths the template check SHALL run immediately after the token row is found, before the revoked/expired check and, on the direct path, before the redirect of an unauthenticated caller to login. Both paths SHALL emit `join.link_rejected` with `reason: "template"` for a template link.

#### Scenario: A revoked template link is invalid, not expired
- **GIVEN** the token lookup resolves to a template link whose `revoked_at` is set (as the migration leaves every existing template link)
- **WHEN** any caller requests `GET /api/join/<that token>`, or the callback runs the pending join for it
- **THEN** the response redirects to `/join-error?joinError=invalid`, not `joinError=expired`

#### Scenario: A logged-out caller is not sent to login for a template link
- **GIVEN** the token lookup resolves to the template team
- **WHEN** a caller with no session requests `GET /api/join/<that token>`
- **THEN** the response redirects to `/join-error?joinError=invalid` without a redirect to `/auth/login`
- **AND** the `team.template_access_denied` event is emitted and no `audit_log` row is written, because there is no actor
