# join-link

## Purpose

Defines requirements for join link generation, validation, expiry, the join-link-through-authentication flow with destination preservation, session-aware landing, and batch arrival handling.

## Requirements

### Requirement: Join link generation
Facilitators (users with `facilitator`, `engineering_manager`, or `application_admin` global role, or `engineering_manager` team membership role) SHALL be able to generate join links for their teams via `POST /api/teams/:teamId/join-links`. Each join link SHALL contain a cryptographically random, URL-safe token (32 bytes, base64url-encoded). Join links SHALL expire after 7 days by default. Facilitators SHALL be able to generate new join links at any time; previously generated links remain valid until their individual expiry.

#### Scenario: Facilitator generates join link
- **WHEN** an authenticated user with appropriate role requests a join link for a team
- **THEN** the application creates a join link with a unique cryptographic token and an expiry 7 days from creation, and returns a `JoinLink` response with `id`, `teamId`, `token`, `createdAt`, and `expiresAt`

#### Scenario: Join link token is cryptographically random
- **WHEN** a join link is generated
- **THEN** the token is 32 bytes of cryptographic randomness, base64url-encoded

#### Scenario: Facilitator generates additional join link
- **WHEN** a facilitator requests a new join link for a team that already has an active link
- **THEN** a new link is created; previously generated links remain valid until their individual expiry

#### Scenario: Non-facilitator cannot generate join link
- **WHEN** a user without facilitator/manager/admin role attempts to create a join link
- **THEN** the application returns a 403 error

---

### Requirement: Join link validation
The application SHALL validate join links by checking that the token exists, has not expired, and has not been revoked. Invalid or expired links SHALL display the message: "This link has expired. Ask your facilitator for a new one." Nonexistent tokens SHALL display: "This link is not valid."

#### Scenario: Valid join link
- **WHEN** an authenticated user follows a join link (`GET /api/join/:token`) with a valid, non-expired token
- **THEN** the user is added to the team with `participant` role

#### Scenario: Expired join link
- **WHEN** a user follows a join link whose expiry has passed
- **THEN** the application redirects to an error page with message "This link has expired. Ask your facilitator for a new one." and does not add the user to any team

#### Scenario: Revoked join link
- **WHEN** a user follows a join link that has been revoked (`revoked_at` is set)
- **THEN** the application redirects to an error page with message "This link has expired. Ask your facilitator for a new one." and does not add the user to any team

#### Scenario: Nonexistent join link token
- **WHEN** a user follows a URL with a token that does not exist in the database
- **THEN** the application redirects to an error page with message "This link is not valid."

---

### Requirement: Join-link-through-authentication flow
An unauthenticated user who follows a join link SHALL be redirected to `/auth/login?joinToken=<token>`, which initiates the OIDC flow with the join token preserved in the OIDC `state` parameter (stored in Redis). After successful authentication (including First Access account creation if needed), the callback handler retrieves the pending join token from state and completes the join flow automatically. No manual steps SHALL occur between authentication and team membership.

#### Scenario: Unauthenticated user follows join link
- **WHEN** an unauthenticated user visits `GET /api/join/:token`
- **THEN** the application redirects to `/auth/login?joinToken=<token>`, which redirects to the IdP, and after authentication the join flow completes automatically

#### Scenario: First-time user follows join link
- **WHEN** a user with no existing account follows a join link and authenticates
- **THEN** the application creates their account (First Access), adds them to the team with `participant` role, and directs them to the team view or active session -- all without manual intervention

#### Scenario: Join destination survives IdP redirect
- **WHEN** a user follows a join link and completes the OIDC redirect chain
- **THEN** the original join link token is retrieved from the `pendingJoinToken` field in the Redis-stored OIDC state and the join flow executes

---

### Requirement: Already-a-member handling
When an authenticated user follows a join link for a team they are already a member of, the `INSERT ... ON CONFLICT DO NOTHING` ensures no duplicate membership is created. The application redirects to the team view (or active session) with `?alreadyMember=true` query parameter for the frontend to display a transient notification.

#### Scenario: Existing member follows join link
- **WHEN** a user who is already a member of a team follows that team's join link
- **THEN** no duplicate membership is created, and the user is redirected to the team view (or active session) with `?alreadyMember=true`

---

### Requirement: Session-aware join link landing
If an active session exists for the team (status `active`) at the time a join link flow completes, the user SHALL be directed to `/session/:sessionId`. If no active session exists, the user SHALL land on `/team/:teamId`.

#### Scenario: Active session exists at join time
- **WHEN** a user completes the join flow and a session with status `active` exists for the team
- **THEN** the user is redirected to `/session/:sessionId`

#### Scenario: No active session at join time
- **WHEN** a user completes the join flow and no active session exists for the team
- **THEN** the user is redirected to `/team/:teamId`

---

### Requirement: Batch arrival handling
The application SHALL handle concurrent join-link-through-auth flows without serialization that would cause visible delays. The `ON CONFLICT DO NOTHING` upsert pattern ensures concurrent team membership insertions do not conflict.

#### Scenario: Concurrent join link redemptions
- **WHEN** 10 users click the same join link within 30 seconds
- **THEN** all 10 complete the authentication and join flow independently without blocking each other

#### Scenario: Concurrent First Access from same join link
- **WHEN** 10 first-time users follow the same join link simultaneously
- **THEN** all 10 accounts are created and all 10 team memberships are established without serialization
