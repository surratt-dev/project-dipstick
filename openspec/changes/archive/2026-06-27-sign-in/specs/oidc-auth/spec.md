# oidc-auth

## Purpose

Defines requirements for the OIDC authentication flow, session management, sign-out, session expiry, and token refresh strategy.

## ADDED Requirements

### Requirement: OIDC authentication redirect
The application SHALL redirect unauthenticated requests to any protected route to the configured OIDC identity provider's authorization endpoint. The redirect SHALL use the authorization code flow with PKCE. The application SHALL NOT display any interstitial page between the user's navigation and the IdP redirect.

#### Scenario: Unauthenticated user navigates to protected route
- **WHEN** a user without an active session navigates to any application route
- **THEN** the application redirects the user to the OIDC identity provider's authorization endpoint with `response_type=code`, a PKCE code challenge, and the `offline_access` scope

#### Scenario: No interstitial before IdP redirect
- **WHEN** a user without an active session navigates to the application
- **THEN** zero application-controlled screens are displayed before the IdP redirect occurs

### Requirement: OIDC callback and token validation
The application SHALL accept the authorization code at the registered callback endpoint, exchange it for ID and access tokens, and validate the ID token. Validation SHALL include signature verification against the IdP's JWKS endpoint, expiry (`exp`), audience (`aud`), and issuer (`iss`) claims. The application SHALL reject tokens that fail any validation check.

#### Scenario: Valid authorization code exchange
- **WHEN** the IdP redirects to the callback endpoint with a valid authorization code
- **THEN** the application exchanges the code for tokens, validates the ID token, and creates an authenticated session

#### Scenario: Token signature validation failure
- **WHEN** the IdP returns a token with an invalid signature
- **THEN** the application rejects the token and does not create a session

#### Scenario: Token expiry validation
- **WHEN** the IdP returns an expired token
- **THEN** the application rejects the token and does not create a session

#### Scenario: Audience claim mismatch
- **WHEN** the ID token's `aud` claim does not match the application's registered client ID
- **THEN** the application rejects the token and does not create a session

### Requirement: Session cookie management
The application SHALL create an authenticated session represented by an encrypted, HttpOnly, Secure, SameSite=Strict cookie. Session data SHALL be stored server-side in Redis. The cookie SHALL contain only the session identifier.

#### Scenario: Session cookie attributes
- **WHEN** a session is created after successful authentication
- **THEN** the response sets a cookie with `HttpOnly`, `Secure`, and `SameSite=Strict` attributes

#### Scenario: Session data stored in Redis
- **WHEN** a session is created
- **THEN** the session data (user identity, token metadata, expiry) is stored in Redis with a 2-hour TTL

#### Scenario: Subsequent requests validated against Redis
- **WHEN** a request includes a valid session cookie
- **THEN** the application retrieves the session from Redis and confirms it has not expired before processing the request

### Requirement: Sign-out with session invalidation
The application SHALL provide a sign-out endpoint that invalidates the server-side session in Redis, clears the session cookie from the client, and redirects the user to the sign-in page. After sign-out, subsequent requests with the old session identifier SHALL be rejected.

#### Scenario: Successful sign-out
- **WHEN** an authenticated user sends a sign-out request
- **THEN** the session is deleted from Redis, the session cookie is cleared, and the user is redirected to the sign-in page

#### Scenario: Old session rejected after sign-out
- **WHEN** a request uses a session cookie from a session that has been signed out
- **THEN** the application rejects the request and redirects to the IdP for re-authentication

#### Scenario: Browser back button after sign-out
- **WHEN** a user navigates back in the browser after signing out
- **THEN** the application does not restore access to protected content

### Requirement: Sign-out confirmation for active session participants
Any authenticated user who is a participant in a session with status "active" (in progress) SHALL receive a confirmation prompt before sign-out completes. The confirmation SHALL NOT block sign-out; it SHALL require a single explicit confirmation action. Scheduled sessions that have not started SHALL NOT trigger the confirmation.

#### Scenario: Participant in active session signs out
- **WHEN** a user who is a participant in an active session initiates sign-out
- **THEN** the application returns a response indicating confirmation is required and identifies the active session(s)

#### Scenario: Confirmed sign-out proceeds
- **WHEN** a user confirms sign-out despite being in an active session
- **THEN** the session is invalidated and the user is signed out

#### Scenario: Scheduled session does not trigger confirmation
- **WHEN** a user who is a participant in a session with status "lobby" or "pre_session" initiates sign-out
- **THEN** the sign-out proceeds without a confirmation prompt

### Requirement: Session expiry with sliding window
Sessions SHALL expire after 2 hours of inactivity (no authenticated requests). Each authenticated request SHALL refresh the session TTL. The absolute maximum session lifetime SHALL be 90 minutes from initial authentication, regardless of activity.

#### Scenario: Idle session expires
- **WHEN** a session has received no authenticated requests for 2 hours
- **THEN** the session is invalidated in Redis and subsequent requests are redirected to re-authentication

#### Scenario: Active session TTL refreshed
- **WHEN** an authenticated request is processed within the session's TTL
- **THEN** the session TTL in Redis is reset to 2 hours

#### Scenario: Absolute session lifetime enforced
- **WHEN** a session has been active for 90 minutes since initial authentication
- **THEN** the session is invalidated regardless of recent activity and the user is redirected to re-authenticate

### Requirement: Silent token refresh
The application SHALL request the `offline_access` scope to obtain a refresh token. The refresh token SHALL be stored server-side in Redis (never in browser-accessible storage). When the access token has less than 5 minutes of remaining lifetime, the application SHALL silently exchange the refresh token for a new access token without user interruption.

#### Scenario: Token refreshed before expiry
- **WHEN** an authenticated request is processed and the access token has less than 5 minutes remaining
- **THEN** the application exchanges the refresh token for a new access token transparently, without redirecting the user

#### Scenario: Refresh token expired or revoked
- **WHEN** the refresh token exchange fails because the token is expired or revoked
- **THEN** the application invalidates the session and redirects the user to re-authenticate

#### Scenario: Refresh token not in browser storage
- **WHEN** a session is active
- **THEN** the refresh token is stored only in the server-side Redis session and is not accessible to client-side JavaScript

### Requirement: Application does not store credentials
The application SHALL NOT store or manage passwords, credentials, or authentication secrets for users. Authentication SHALL be delegated entirely to the configured OIDC identity provider.

#### Scenario: No credential storage
- **WHEN** the application database schema is inspected
- **THEN** no tables or columns exist for storing user passwords, password hashes, or authentication credentials

### Requirement: Role-blind authentication
The sign-in flow SHALL be identical for all users regardless of their application role (Engineer, Facilitator, Engineering Manager). No visible branching, different screens, or role-specific behavior SHALL occur during the authentication flow. Role resolution SHALL happen server-side after the identity assertion is accepted.

#### Scenario: Same flow for all roles
- **WHEN** an Engineer and an Engineering Manager each complete the sign-in flow
- **THEN** both experience the same redirect, callback, and session creation sequence with no role-specific differences

#### Scenario: Role resolved after authentication
- **WHEN** authentication completes and a session is created
- **THEN** the user's role is resolved from the database (team memberships) and included in the session data, but does not affect the authentication flow itself
