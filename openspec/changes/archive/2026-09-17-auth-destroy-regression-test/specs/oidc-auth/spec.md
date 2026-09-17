## MODIFIED Requirements

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
- **THEN** any pre-authentication session state is invalidated by regenerating the session identifier before populating user data, without relying on a separate destroy operation

#### Scenario: Session fixation prevention uses regenerate() alone, not destroy() plus regenerate()
- **WHEN** the OIDC callback completes a successful authentication and establishes a new session
- **THEN** the session store's `regenerate()` operation is invoked exactly once on that path, and the session store's `destroy()` operation is not invoked on that path
