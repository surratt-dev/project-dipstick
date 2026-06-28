# join-link

## Purpose

Defines requirements for join link generation, validation, expiry, the join-link-through-authentication flow with destination preservation, session-aware landing, and batch arrival handling.

## ADDED Requirements

### Requirement: Join link generation
Facilitators SHALL be able to generate join links for their teams. Each join link SHALL contain a cryptographically random, URL-safe token. Join links SHALL expire after a configurable period with a default of 7 days. Facilitators SHALL be able to regenerate join links at any time.

#### Scenario: Facilitator generates join link
- **WHEN** an authenticated facilitator requests a join link for a team
- **THEN** the application creates a join link with a unique cryptographic token and an expiry 7 days from creation

#### Scenario: Join link token is cryptographically random
- **WHEN** a join link is generated
- **THEN** the token is 32 bytes of cryptographic randomness, base64url-encoded

#### Scenario: Facilitator regenerates join link
- **WHEN** a facilitator requests a new join link for a team that already has an active link
- **THEN** a new link is created; previously generated links remain valid until their individual expiry

### Requirement: Join link validation
The application SHALL validate join links by checking that the token exists, has not expired, and has not been revoked. Invalid or expired links SHALL display a clear message: "This link has expired. Ask your facilitator for a new one."

#### Scenario: Valid join link
- **WHEN** an authenticated user follows a join link with a valid, non-expired token
- **THEN** the user is added to the team as an Engineer

#### Scenario: Expired join link
- **WHEN** a user follows a join link whose expiry has passed
- **THEN** the application displays "This link has expired. Ask your facilitator for a new one." and does not add the user to any team

#### Scenario: Revoked join link
- **WHEN** a user follows a join link that has been revoked
- **THEN** the application displays "This link has expired. Ask your facilitator for a new one." and does not add the user to any team

#### Scenario: Nonexistent join link token
- **WHEN** a user follows a URL with a token that does not exist in the database
- **THEN** the application displays an error indicating the link is not valid

### Requirement: Join-link-through-authentication flow
An unauthenticated user who follows a join link SHALL be redirected to the identity provider for authentication. After successful authentication (including First Access account creation if needed), the join flow SHALL complete automatically and the user SHALL land on the team view or active session. The join link destination SHALL survive the IdP redirect via the OIDC `state` parameter. No manual steps SHALL occur between authentication and team membership.

#### Scenario: Unauthenticated user follows join link
- **WHEN** an unauthenticated user clicks a join link
- **THEN** the application preserves the join token, redirects to the IdP, and after authentication completes the join flow in a single uninterrupted sequence

#### Scenario: First-time user follows join link
- **WHEN** a user with no existing account follows a join link and authenticates
- **THEN** the application creates their account (First Access), adds them to the team, and directs them to the team view -- all without manual intervention

#### Scenario: Join destination survives IdP redirect
- **WHEN** a user follows a join link and completes the OIDC redirect chain
- **THEN** the original join link token is retrieved from the preserved state and the join flow executes

### Requirement: Already-a-member handling
When an authenticated user follows a join link for a team they are already a member of, the application SHALL display a transient notification ("You are already a member of this team") and redirect to the team view. The notification SHALL NOT require user action to dismiss.

#### Scenario: Existing member follows join link
- **WHEN** a user who is already a member of a team follows that team's join link
- **THEN** the application displays a transient notification and redirects to the team view without creating a duplicate membership

### Requirement: Session-aware join link landing
If an active session exists for the team at the time a join link flow completes, the user SHALL be directed to the active session after team membership is established. If no active session exists, the user SHALL land on the team view.

#### Scenario: Active session exists at join time
- **WHEN** a user completes the join flow and a session with status "lobby", "pre_session", or "active" exists for the team
- **THEN** the user is redirected to the active session

#### Scenario: No active session at join time
- **WHEN** a user completes the join flow and no active session exists for the team
- **THEN** the user is redirected to the team view

### Requirement: Batch arrival handling
The application SHALL handle concurrent join-link-through-auth flows without serialization that would cause visible delays. At least 10 concurrent flows SHALL complete independently without degraded response times.

#### Scenario: Concurrent join link redemptions
- **WHEN** 10 users click the same join link within 30 seconds
- **THEN** all 10 complete the authentication and join flow independently without blocking each other

#### Scenario: Concurrent First Access from same join link
- **WHEN** 10 first-time users follow the same join link simultaneously
- **THEN** all 10 accounts are created and all 10 team memberships are established without serialization
