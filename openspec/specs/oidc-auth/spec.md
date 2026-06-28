# oidc-auth

## Purpose

Defines requirements for the OIDC authentication flow, session management, sign-out, session expiry, and token refresh strategy.

## Requirements

### Requirement: OIDC authentication redirect
The application SHALL redirect unauthenticated requests to any protected route to the configured OIDC identity provider's authorization endpoint. The redirect SHALL use the authorization code flow with PKCE. The application SHALL NOT display any interstitial page between the user's navigation and the IdP redirect.

#### Scenario: Unauthenticated user navigates to protected route
- **WHEN** a user without an active session navigates to any application route
- **THEN** the application redirects the user to the OIDC identity provider's authorization endpoint with `response_type=code`, a PKCE code challenge (`S256` method), and the `offline_access` scope

#### Scenario: No interstitial before IdP redirect
- **WHEN** a user without an active session navigates to the application
- **THEN** zero application-controlled screens are displayed before the IdP redirect occurs

---

### Requirement: OIDC callback and token validation
The application SHALL accept the authorization code at the registered callback endpoint (`GET /auth/callback`), exchange it for ID and access tokens, and validate the ID token. Validation SHALL include signature verification via the IdP's JWKS endpoint, expiry (`exp`), audience (`aud`), issuer (`iss`), and nonce claims. The application SHALL reject tokens that fail any validation check. The OIDC state parameter SHALL be single-use: retrieved from Redis and immediately deleted on callback.

#### Scenario: Valid authorization code exchange
- **WHEN** the IdP redirects to the callback endpoint with a valid authorization code
- **THEN** the application exchanges the code for tokens using the stored PKCE code verifier, validates the ID token, and creates an authenticated session

#### Scenario: Token signature validation failure
- **WHEN** the IdP returns a token with an invalid signature
- **THEN** the application rejects the token and does not create a session

#### Scenario: Token expiry validation
- **WHEN** the IdP returns an expired token
- **THEN** the application rejects the token and does not create a session

#### Scenario: Audience claim mismatch
- **WHEN** the ID token's `aud` claim does not match the application's registered client ID
- **THEN** the application rejects the token and does not create a session

#### Scenario: State parameter is single-use
- **WHEN** the callback endpoint processes a state parameter
- **THEN** the state is retrieved from Redis and immediately deleted; a replayed callback with the same state is rejected

---

### Requirement: Session cookie management
The application SHALL create an authenticated session represented by an HttpOnly, Secure (in production), SameSite=Strict cookie. Session data SHALL be stored server-side in Redis via `connect-redis`. The cookie SHALL contain only the session identifier. The session TTL in Redis SHALL be 2 hours.

#### Scenario: Session cookie attributes
- **WHEN** a session is created after successful authentication
- **THEN** the response sets a cookie with `HttpOnly`, `SameSite=Strict`, and (in production) `Secure` attributes

#### Scenario: Session data stored in Redis
- **WHEN** a session is created
- **THEN** the session data (user ID, encrypted tokens, session creation timestamp, token expiry) is stored in Redis with a 2-hour TTL under the key prefix `dipstick:session:`

#### Scenario: Subsequent requests validated against Redis
- **WHEN** a request includes a valid session cookie
- **THEN** the application retrieves the session from Redis and confirms it has not expired before processing the request

#### Scenario: Session fixation prevention
- **WHEN** the OIDC callback creates an authenticated session
- **THEN** any pre-authentication session is destroyed and a new session is regenerated before populating user data

---

### Requirement: Sign-out with session invalidation
The application SHALL provide a sign-out endpoint (`POST /auth/logout`) that invalidates the server-side session in Redis, clears the session cookie, and returns a redirect URL. If the IdP supports `end_session_endpoint`, the redirect URL SHALL point to the IdP's end-session endpoint with the ID token hint. After sign-out, subsequent requests with the old session identifier SHALL be rejected.

#### Scenario: Successful sign-out
- **WHEN** an authenticated user sends a POST to `/auth/logout`
- **THEN** the session is destroyed in Redis and the response includes a redirect URL

#### Scenario: IdP end-session redirect
- **WHEN** the IdP supports `end_session_endpoint` and an ID token is available
- **THEN** the sign-out response includes a redirect URL to the IdP's end-session endpoint with `id_token_hint` and `post_logout_redirect_uri`

#### Scenario: Old session rejected after sign-out
- **WHEN** a request uses a session cookie from a session that has been signed out
- **THEN** the application rejects the request with a 401 response

---

### Requirement: Sign-out confirmation for active session participants
Any authenticated user who is a participant in a session with status `active` (in progress) SHALL receive a confirmation prompt before sign-out completes. The sign-out endpoint SHALL return `{ confirmRequired: true, activeSessions: [...] }` when unconfirmed. The caller re-submits with `?confirmed=true` to proceed. Sessions with status `lobby` or `pre_session` SHALL NOT trigger the confirmation.

#### Scenario: Participant in active session signs out
- **WHEN** a user who is a participant in an active session initiates sign-out without `?confirmed=true`
- **THEN** the endpoint returns `{ confirmRequired: true, activeSessions: [sessionIds] }` without destroying the session

#### Scenario: Confirmed sign-out proceeds
- **WHEN** a user submits `POST /auth/logout?confirmed=true`
- **THEN** the session is invalidated and the user is signed out regardless of active session participation

#### Scenario: Scheduled session does not trigger confirmation
- **WHEN** a user who is a participant in a session with status `lobby` or `pre_session` initiates sign-out
- **THEN** the sign-out proceeds without a confirmation prompt

---

### Requirement: Session expiry with sliding window and absolute lifetime
Sessions SHALL expire after 2 hours of inactivity (no authenticated requests). Each authenticated request SHALL touch the session to refresh the Redis TTL (rolling sessions). The absolute maximum session lifetime SHALL be 90 minutes from initial authentication, regardless of activity. The middleware enforces the absolute lifetime by comparing `sessionCreatedAt` against the current time.

#### Scenario: Idle session expires
- **WHEN** a session has received no authenticated requests for 2 hours
- **THEN** the session key expires in Redis and subsequent requests receive a 401 response

#### Scenario: Active session TTL refreshed
- **WHEN** an authenticated request is processed within the session's TTL
- **THEN** the session TTL in Redis is reset to 2 hours via session touch

#### Scenario: Absolute session lifetime enforced
- **WHEN** a session has been active for 90 minutes since initial authentication
- **THEN** the middleware destroys the session and returns a 401 with message "Your session has expired. Please sign in again."

---

### Requirement: Silent token refresh
The application SHALL request the `offline_access` scope to obtain a refresh token. Tokens SHALL be encrypted at rest using AES-256-GCM with a key derived via `scrypt` from `TOKEN_ENCRYPTION_KEY` (or `SESSION_SECRET` as fallback). When the access token has less than 5 minutes of remaining lifetime, the middleware SHALL silently exchange the refresh token for a new access token. Refresh failures are retried up to 2 times with a 5-second delay. If a refresh token is revoked (`invalid_grant`), the session is immediately destroyed.

#### Scenario: Token refreshed before expiry
- **WHEN** an authenticated request is processed and the access token has less than 5 minutes remaining
- **THEN** the middleware exchanges the refresh token for a new access token transparently

#### Scenario: Refresh token expired or revoked
- **WHEN** the refresh token exchange fails with `invalid_grant`
- **THEN** the session is immediately destroyed and the user receives a 401

#### Scenario: Transient refresh failure with retry
- **WHEN** the refresh token exchange fails with a transient error
- **THEN** the middleware retries up to 2 times with 5-second delays before destroying the session

#### Scenario: Tokens encrypted at rest
- **WHEN** session data is stored in Redis
- **THEN** access tokens, refresh tokens, and ID tokens are encrypted with AES-256-GCM; plaintext tokens never appear in Redis

---

### Requirement: Application does not store credentials
The application SHALL NOT store or manage passwords, credentials, or authentication secrets for users. Authentication SHALL be delegated entirely to the configured OIDC identity provider.

#### Scenario: No credential storage
- **WHEN** the application database schema is inspected
- **THEN** no tables or columns exist for storing user passwords, password hashes, or authentication credentials

---

### Requirement: Role-blind authentication
The sign-in flow SHALL be identical for all users regardless of their application role (`participant`, `engineering_manager`). No visible branching, different screens, or role-specific behavior SHALL occur during the authentication flow. Role resolution SHALL happen server-side after the identity assertion is accepted, based on team memberships.

#### Scenario: Same flow for all roles
- **WHEN** a participant and an engineering_manager each complete the sign-in flow
- **THEN** both experience the same redirect, callback, and session creation sequence with no role-specific differences

#### Scenario: Role resolved after authentication
- **WHEN** authentication completes and a session is created
- **THEN** the user's roles are resolved from team_memberships when the `/auth/session` endpoint is called, not during the authentication flow itself
