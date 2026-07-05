## Context

The Engineering Health Check application has a working scaffold (Fastify backend, React frontend, PostgreSQL, Redis, simulated OIDC provider via Docker Compose) but no authentication layer. The architecture document (ADR-005) specifies OIDC delegation with provider abstraction. The BRD (FR-1.1) requires authentication exclusively via an external OIDC provider with no application-managed credentials. The security requirements (SEC-1 through SEC-6) mandate full token validation, HttpOnly/Secure/SameSite=Strict cookies, and refresh token handling.

The existing backend has a Fastify app shell with health endpoints, a PostgreSQL connection pool, and a Redis client. The existing database schema includes `users` and `teams` tables. The `users` table uses `oidc_subject` and `oidc_issuer` columns with a compound unique constraint `(oidc_subject, oidc_issuer)`. The `membership_role` enum defines `'participant'` and `'engineering_manager'` as the valid values. The `sessions` table has its own `join_token` column for session-level join tokens.

The simulated OIDC provider (`node-oidc-provider`) runs in Docker Compose on port 4011 with pre-seeded test accounts.

The exploration notes (Devon Calloway, Internal Champion) establish that sign-in must be role-blind, zero-interstitial, and that the join-link-through-authentication flow is the primary adoption path. The subject claim (`sub`) is the account matching attribute. Join links expire after 7 days. Sign-out confirmation extends to all active session participants, not just facilitators.

## Goals / Non-Goals

**Goals:**
- Implement the complete OIDC authentication flow against the existing simulated provider, verifiable with a single `docker compose up && npm run dev`
- Create accounts automatically on first access using the IdP subject claim as the stable identifier, matched against the compound key `(oidc_subject, oidc_issuer)`
- Implement join links that survive the OIDC redirect chain and land users on their team (or active session) in a single uninterrupted flow
- Establish the session management foundation (cookie-based sessions, Redis-backed session store, token refresh) that the live voting feature will build on
- Handle batch arrival: 10+ concurrent join-link-through-auth flows without serialization or degraded response times
- Provide plain-language error messages for all authentication failure modes
- Enforce OIDC protocol security controls (state CSRF, nonce replay prevention, PKCE, session fixation prevention) explicitly and verifiably

**Non-Goals:**
- Connecting to a real identity provider (Microsoft Entra) -- that is a deployment concern, not an implementation concern
- Implementing role assignment or the no-manager-participation enforcement -- those are session management concerns downstream of sign-in
- Implementing the facilitator view, session lobby, or any session lifecycle beyond "is there an active session for this team"
- Implementing team creation -- teams are created through session setup, which is a separate change
- Multi-IdP support -- single provider only per the exploration notes
- WebSocket authentication -- that will be addressed in the live session change, building on the session infrastructure created here

## Decisions

### OIDC client library: `openid-client`

**Decision:** Use the `openid-client` npm package for the OIDC integration.

**Rationale:** `openid-client` is a certified OpenID Connect Relying Party implementation. It handles discovery (`.well-known/openid-configuration`), authorization code flow with PKCE, token validation (signature via JWKS, expiry, audience, issuer), and refresh token exchange. It is provider-agnostic by design, satisfying NFR-AUTH-001. The library performs full token validation by default, satisfying SEC-2.

`openid-client` supports explicit state and nonce handling. Both must be configured and used -- see the OIDC Protocol Security Controls section below.

**Alternatives considered:**
- `passport` + `passport-openidconnect`: Passport's middleware model adds abstraction that obscures the OIDC flow. For a single-provider setup with explicit token handling requirements, direct `openid-client` usage is clearer and more auditable.
- Microsoft-specific MSAL: Rejected per ADR-005 -- creates provider lock-in.

---

### Session management: `@fastify/session` with `connect-redis`

**Decision:** Use `@fastify/session` with `connect-redis` for cookie-based sessions backed by Redis.

**Rationale:** The architecture specifies signed, HttpOnly, Secure, SameSite=Strict session cookies (Section 6.2). `@fastify/session` stores a session ID in a signed cookie and keeps all session data server-side in Redis via `connect-redis`. This is the correct architecture for OIDC session management because:

- OIDC tokens (access token, refresh token, ID token) are too large for cookie storage. An access token alone can be 1-2KB; combined with a refresh token and session metadata, the total exceeds the 4KB browser cookie limit.
- Server-side session revocation on sign-out requires deleting a Redis key. Cookie-only sessions cannot be invalidated before their expiry.
- The sliding-window inactivity timeout requires refreshing a TTL on each request, which `connect-redis` provides natively.

The session store in Redis uses the key pattern `dipstick:session:{sessionId}` with a 2-hour TTL (refreshed on each authenticated request, implementing the sliding inactivity window). See the Session Lifetime Enforcement section for the separate absolute lifetime check.

The session cookie is signed (not encrypted), which is sufficient because the cookie contains only an opaque session ID -- no sensitive data. The actual sensitive data (tokens, user context) lives in Redis.

**Cookie configuration:**
- `httpOnly: true` -- not accessible to client-side JavaScript
- `secure: true` in production; `secure: false` when `NODE_ENV=development` (required because `http://localhost` does not support `Secure` cookies -- see Local Development Cookie Exception below)
- `sameSite: 'strict'` -- prevents CSRF via cross-site requests
- `path: '/'`
- `maxAge`: not set on the cookie itself; session lifetime is controlled server-side via Redis TTL and the absolute lifetime timestamp

**Local Development Cookie Exception:** The `Secure` cookie attribute prevents cookies from being sent over non-HTTPS connections. In local development (`http://localhost`), this means cookies would never be set. The implementation must conditionally set `secure: false` when `NODE_ENV=development`. This is the exception; production configuration (`secure: true`) is the default. The conditional must be environment-variable-driven, not a code path that could be accidentally left in production.

**Alternatives considered:**
- `@fastify/secure-session` with libsodium encryption: This library encrypts the entire session payload into the cookie. There is no server-side store and no session ID. This means tokens cannot be stored (cookie size limit), sessions cannot be revoked server-side (no Redis key to delete), and sliding TTL refresh has no mechanism. Despite the stronger cookie encryption, it does not support the session management model this design requires.
- Cookie-only sessions (no server-side store): Rejected because session revocation on sign-out requires server-side state.

---

### OIDC Protocol Security Controls

This section specifies the OIDC protocol-level security controls that must be implemented. These are not optional "if the library supports it" features -- they are required controls that must be verified in code review.

#### State Parameter (CSRF Protection)

The OIDC `state` parameter serves two purposes: CSRF protection for the callback endpoint, and carrying the pending-join nonce through the IdP redirect.

**Lifecycle:**
1. **Generate:** On each authorization request (`/auth/login`), generate a cryptographically random state value using a CSPRNG (e.g., `crypto.randomBytes(32).toString('base64url')`)
2. **Store:** Store the state value in Redis with key `dipstick:auth:state:{stateValue}`, TTL 10 minutes. The value stored at this key includes the pending-join nonce (if any) and the OIDC nonce (see below)
3. **Send:** Include the state value in the authorization request to the IdP
4. **Verify:** On callback (`/auth/callback`), retrieve the state from the `state` query parameter. Look up `dipstick:auth:state:{stateValue}` in Redis. If the key does not exist (expired or never created) or the value does not match, abort the flow with an authentication error. This prevents CSRF attacks where an attacker crafts a callback URL with their own authorization code
5. **Delete:** After successful verification, delete the Redis key immediately. The state is single-use -- replay is not possible

#### Nonce (ID Token Replay Prevention)

The OIDC `nonce` parameter prevents replay attacks where a previously-issued ID token is reused.

**Lifecycle:**
1. **Generate:** On each authorization request, generate a cryptographically random nonce using a CSPRNG
2. **Store:** Store the nonce alongside the state in the same Redis key (`dipstick:auth:state:{stateValue}`). The stored object contains: `{ nonce, pendingJoinNonce?, createdAt }`
3. **Send:** Include the nonce in the authorization request to the IdP. The IdP embeds it in the returned ID token
4. **Verify:** On callback, after state verification, extract the stored nonce from Redis. Verify that the `nonce` claim in the received ID token matches the stored value. If it does not match, abort the flow. `openid-client` supports nonce verification -- it must be explicitly passed the expected nonce value during token validation
5. **Cleanup:** The nonce is deleted as part of the state key deletion (step 5 above)

#### PKCE (Proof Key for Code Exchange)

PKCE prevents authorization code interception attacks. `openid-client` generates and verifies PKCE challenge/verifier pairs automatically when configured.

**Requirement:** PKCE is always used for authorization requests. The `code_challenge_method` is `S256`.

**Simulated provider:** The simulated OIDC provider (`node-oidc-provider`) must be configured with `pkce: { required: () => true }` to enforce the same validation as a production Entra tenant (which requires PKCE for public clients by default). This ensures the development environment catches any PKCE misconfiguration before it reaches production.

#### Session Fixation Prevention

When a user completes the OIDC callback and transitions from unauthenticated to authenticated, the session ID must change to prevent session fixation attacks.

**Requirement:** The OIDC callback handler must:
1. Destroy any existing session (if a pre-authentication session exists)
2. Create a fresh session with a new session ID
3. Populate the new session with the authenticated user's data (user ID, tokens, `sessionCreatedAt` timestamp)

No data from a pre-authentication session is migrated to the authenticated session. The only pre-authentication state that matters (pending join context) is stored in Redis under its own key, not in the session.

---

### Account matching: IdP subject claim with issuer compound key

**Decision:** The `oidc_subject` and `oidc_issuer` claims from the OIDC ID token are the compound key for matching identity assertions to application accounts.

**Rationale:** Email addresses change (name changes, domain migrations). The subject claim is stable by OIDC specification. The compound key `(oidc_subject, oidc_issuer)` ensures that two different OIDC providers could theoretically issue the same `sub` value without collision -- the schema correctly handles multi-provider scenarios even though this change implements single-provider only.

On callback, the application queries:
```sql
SELECT * FROM users WHERE oidc_subject = $1 AND oidc_issuer = $2
```

If no row exists, a new user is created (First Access). If a row exists, the session is created for that user.

Display name and email from the ID token claims are stored and updated on each sign-in to keep profile data current, but they are not used for identity matching.

**First Access upsert:**
```sql
INSERT INTO users (oidc_subject, oidc_issuer, display_name, email)
VALUES ($1, $2, $3, $4)
ON CONFLICT (oidc_subject, oidc_issuer)
DO UPDATE SET display_name = EXCLUDED.display_name, email = EXCLUDED.email, updated_at = NOW()
RETURNING *
```

The conflict target is the compound unique constraint `users_oidc_unique`, not a single column.

---

### Join link token format and storage

**Decision:** Join links use a cryptographically random URL-safe token (32 bytes, base64url-encoded) stored in a `join_links` table.

**Relationship to `sessions.join_token`:** The `sessions` table has its own `join_token` column. These are two distinct concepts:
- **`join_links` (this change):** Team membership enrollment. A facilitator generates a join link to invite people to the team. The token is long-lived (7-day default expiry), reusable by multiple people, and results in a `team_memberships` row. This is the scope of this change.
- **`sessions.join_token` (session management scope):** Session participation. A token for joining a specific live session. This is used during session lifecycle (lobby, active) and is managed by the session management change. This change does not create, modify, or consume `sessions.join_token`.

When the design says "session-aware join link landing," it means: after completing the team join link flow and creating the `team_memberships` row, the backend queries for an active session for that team and redirects accordingly. The redirect URL uses the session ID, not the session's `join_token`. The session join token is a session management concern.

**Schema:**
```sql
CREATE TABLE join_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id),
  token VARCHAR(64) NOT NULL UNIQUE,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX idx_join_links_token ON join_links(token);
```

**Token lifecycle:** Generated by facilitators via `POST /api/teams/:teamId/join-links`. Default expiry: 7 days from creation. Validated by `POST /api/join/:token` which checks existence, expiry, and revocation. Expired or revoked links return a clear message: "This link has expired. Ask your facilitator for a new one."

**Alternatives considered:**
- Signed JWT tokens (no database storage): Rejected because revocation requires either a blacklist (effectively a database) or short expiry. A 7-day JWT that cannot be revoked is an unacceptable access vector.
- UUIDs as tokens: Rejected because UUIDs are not cryptographically random in all implementations and have a smaller entropy space than 32 random bytes.

---

### Join link destination preservation across OIDC redirect

**Decision:** The OIDC `state` parameter carries the original destination (join link token) through the IdP redirect, with the join context stored in Redis.

**Implementation:** When an unauthenticated user hits `/api/join/:token`, the backend:
1. Generates the OIDC state and nonce values (per the OIDC Protocol Security Controls section)
2. Stores the join token in the state Redis key: `dipstick:auth:state:{stateValue}` contains `{ nonce, pendingJoinToken: token, createdAt }`
3. Redirects to the IdP authorization endpoint with the state, nonce, and PKCE parameters

After the IdP callback:
1. The backend verifies state and nonce (per protocol controls)
2. Retrieves the `pendingJoinToken` from the state Redis key
3. Deletes the state Redis key (single-use)
4. Completes authentication (including First Access if needed)
5. Executes the join flow using the retrieved token
6. Redirects to the team view or active session

**Rationale:** The OIDC `state` parameter is the standard mechanism for preserving application state across the authorization redirect. Storing the actual join token in Redis (referenced by the state value) rather than in the `state` parameter directly avoids leaking the token to the IdP and keeps the `state` parameter short.

**Alternatives considered:**
- Browser `localStorage` or `sessionStorage`: Not available before the first page load; the join link may be the user's first interaction with the application.
- Query parameter on the callback URL: The OIDC redirect URI must be exact (SEC-6); dynamic query parameters would require wildcard URIs.

---

### Session-aware join link landing

**Decision:** After join flow completion, the backend checks for an active session for the team and redirects accordingly.

**Implementation:** After `team_memberships` insert, query `SELECT id FROM sessions WHERE team_id = $1 AND status IN ('lobby', 'pre_session', 'active') LIMIT 1`. If found, redirect to `/session/:sessionId`. Otherwise, redirect to `/team/:teamId`.

This is a simple query at join-flow completion time, not a persistent subscription. It handles the common case (facilitator shares join link right before a session) without introducing WebSocket dependencies.

---

### Sign-out flow

**Decision:** Sign-out invalidates the application session, clears the session cookie, and terminates the IdP session.

**Sign-out confirmation scope:** Sign-out confirmation is triggered for any authenticated user who is a participant in a session with status `active` (in progress), not just facilitators.

**Implementation:**

1. On `POST /auth/logout`, before invalidating the session, query:
   ```sql
   SELECT s.id FROM sessions s
   JOIN session_participants sp ON s.id = sp.session_id
   WHERE sp.user_id = $1 AND s.status = 'active'
   ```
2. If results exist, return a `200 OK` with `{ confirmRequired: true, activeSessions: [...] }`. The frontend displays the confirmation dialog. A subsequent `POST /auth/logout?confirmed=true` proceeds with invalidation.

   Note: The `confirmed=true` query parameter is a UX convenience, not a security control. The confirmation dialog prevents accidental sign-out during active sessions; it is not intended to prevent a deliberate sign-out. A user or script that calls the endpoint directly with `confirmed=true` bypasses the dialog, which is acceptable -- the user has the right to sign out at any time.

3. On confirmed sign-out:
   a. Delete the Redis session key
   b. Clear the session cookie
   c. Redirect the user to the IdP's `end_session_endpoint` (discovered via `.well-known/openid-configuration`) with `id_token_hint` (the ID token from the session) and `post_logout_redirect_uri` (the application's sign-in page)
   d. If the IdP does not support `end_session_endpoint` (the discovery document does not include it), skip the IdP redirect and redirect to the application's sign-in page directly. Log a warning: the user's IdP session remains active

**Rationale for IdP session termination:** If only the application session is destroyed but the IdP session remains active, the user can immediately re-authenticate without credentials by visiting the application. The IdP's session cookie is still valid and the IdP will issue a new token silently. This undermines the sign-out action. Per Section 8.2 of the architecture document: "Session invalidated on explicit logout; logout propagated to identity provider."

Scheduled sessions that have not started do not trigger the confirmation.

---

### Session Lifetime Enforcement

**Decision:** Two independent lifetime controls govern session validity: a sliding inactivity timeout and an absolute maximum lifetime. Both are checked on every authenticated request.

**Sliding inactivity timeout (2 hours):** The Redis session key TTL is set to 2 hours. On each authenticated request, the TTL is refreshed (sliding window). If a user is idle for 2 hours, the Redis key expires and the session is no longer valid. The next request receives a 401 and the user must re-authenticate.

**Absolute maximum lifetime (90 minutes):** A `sessionCreatedAt` timestamp (ISO 8601) is stored in the session data at session creation time. The `onRequest` hook checks this timestamp on every authenticated request. If `Date.now() - sessionCreatedAt > 90 minutes`, the session is invalidated (Redis key deleted, cookie cleared) regardless of activity, and the user must re-authenticate. This value is never refreshed -- it is set once at session creation.

**Interaction:** A continuously active user hits the 90-minute absolute wall and must re-authenticate. An idle user's session expires after 2 hours of no requests via Redis TTL. In practice, the 90-minute absolute limit is the binding constraint for active users; the 2-hour inactivity timeout catches abandoned sessions.

---

### Token refresh strategy

**Decision:** The backend requests `offline_access` scope during the OIDC authorization request to obtain a refresh token. Refresh is triggered when the access token has less than 5 minutes of remaining lifetime.

**Implementation:** The refresh token is stored server-side in the Redis session (never in browser-accessible storage, per SEC-5). Before storing, the refresh token is encrypted using AES-256-GCM with a key derived from the application's `SESSION_SECRET` (or a dedicated `TOKEN_ENCRYPTION_KEY` environment variable if configured). The encrypted token is stored; the plaintext token never persists in Redis.

A Fastify `onRequest` hook checks the access token expiry on each request. If the token is within 5 minutes of expiry, the hook silently exchanges the refresh token (decrypted from Redis) for a new access token using the OIDC client. The new refresh token (if issued) is encrypted and stored, replacing the old one. If the refresh fails, the behavior depends on the failure type:

- **Revocation (HTTP 400 with `invalid_grant`):** The refresh token has been revoked at the IdP (e.g., user terminated). Invalidate the session immediately. No retry. Log as `token_refresh_revoked`.
- **Transient failure (HTTP 5xx, network timeout):** The IdP is temporarily unreachable. Retry up to 2 additional times with 5-second intervals. If all retries fail, invalidate the session and redirect to re-authenticate. Log as `token_refresh_transient_failure`.

The absolute session lifetime is 90 minutes (SEC-4). Even with successful token refreshes, a session older than 90 minutes requires re-authentication (enforced by the `sessionCreatedAt` check, not by token refresh logic).

---

### Concurrency: batch arrival handling

**Decision:** The OIDC callback handler and First Access account creation use no application-level serialization. Concurrent requests are handled independently.

**Implementation:** The `users` table has a unique constraint on `(oidc_subject, oidc_issuer)`. First Access uses:
```sql
INSERT INTO users (oidc_subject, oidc_issuer, display_name, email)
VALUES ($1, $2, $3, $4)
ON CONFLICT (oidc_subject, oidc_issuer)
DO UPDATE SET display_name = EXCLUDED.display_name, email = EXCLUDED.email, updated_at = NOW()
RETURNING *
```

This handles the race condition where two concurrent callbacks for the same user both attempt account creation -- one inserts, the other updates, and both get back the same user record. No mutex, no distributed lock.

Join link redemption uses a similar pattern:
```sql
INSERT INTO team_memberships (user_id, team_id, role)
VALUES ($1, $2, 'participant')
ON CONFLICT (user_id, team_id) DO NOTHING
```

Concurrent joins for the same user and team are idempotent. The role value is `'participant'`, matching the `membership_role` enum defined in migration 1.

---

### Vite proxy configuration

**Decision:** The Vite dev server proxy must cover both `/api` and `/auth` route prefixes.

The design adds routes at `/auth/login`, `/auth/callback`, and `/auth/logout`. The existing Vite proxy only covers `/api/*`. Without adding `/auth`, browser requests to `http://localhost:5173/auth/login` will hit the Vite dev server (returning the SPA's `index.html` or a 404) instead of the Fastify backend.

**Required configuration:**
```ts
proxy: {
  "/api": "http://localhost:3000",
  "/auth": "http://localhost:3000",
}
```

Note: The OIDC callback redirect URI is registered as `http://localhost:3000/auth/callback` (hitting the backend directly), so the IdP redirect bypasses the Vite proxy. But the initial login redirect from the frontend (`/auth/login`) and the logout POST (`/auth/logout`) go through the Vite dev server and require the proxy entry.

---

### Simulated OIDC Provider: Production Isolation

**Decision:** The application must validate at startup that the simulated OIDC provider is not used in production.

**Implementation:** During application startup, when `NODE_ENV=production`, the application validates the `OIDC_ISSUER` environment variable:
1. If `OIDC_ISSUER` contains `localhost`, `127.0.0.1`, `0.0.0.0`, or any RFC 1918 private address (`10.x`, `172.16-31.x`, `192.168.x`), the application logs a fatal error and exits with a non-zero exit code
2. The error message is explicit: "FATAL: OIDC_ISSUER points to a local/private address in production mode. The simulated OIDC provider must not be used in production."

**Rationale:** The simulated provider has pre-seeded test accounts with known credentials. If it is accidentally deployed to production -- or if the production application is misconfigured to point to a development instance -- any person who knows the test account credentials can authenticate as any test user. This is a critical risk (F-08) with a simple mitigation.

The simulated provider's Docker service is for local development only. The `docker-compose.yml` file should include a comment on the `oidc` service: `# DEVELOPMENT ONLY -- do not deploy to production environments`.

---

### CORS Configuration

**Decision:** The backend must configure CORS with explicit origin enumeration. Wildcard origins are prohibited (SEC-23).

**Implementation using `@fastify/cors`:**

**Development:**
```ts
{
  origin: ['http://localhost:5173', 'http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}
```

**Production:**
```ts
{
  origin: [config.APP_ORIGIN], // e.g., 'https://dipstick.example.com'
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}
```

`credentials: true` is required for cookie-based authentication -- without it, browsers will not send the session cookie on cross-origin requests.

The `APP_ORIGIN` environment variable must be added to the required config for production deployments. For local development, the origins are hardcoded to the known dev server ports.

---

### Security Headers

**Decision:** The backend sets security headers on all responses to prevent common web vulnerabilities.

**Headers applied via a Fastify `onSend` hook or `@fastify/helmet`:**

| Header | Value | Purpose |
|--------|-------|---------|
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Prevents join link tokens in URLs from leaking via the `Referer` header to external resources |
| `X-Frame-Options` | `DENY` | Prevents clickjacking by disallowing iframe embedding |
| `X-Content-Type-Options` | `nosniff` | Prevents MIME type sniffing |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | Enforces HTTPS after first visit (production only; omitted when `NODE_ENV=development`) |
| `Content-Security-Policy` | Deferred to a separate change | A full CSP is out of scope for this change but is noted as a gap that must be addressed before production deployment |

`Referrer-Policy` is particularly important for this change: join link tokens appear in URLs (`/api/join/:token`), and without a restrictive referrer policy, those tokens may be leaked to external sites via the `Referer` header if any page contains external resources.

---

### Request Log Redaction

**Decision:** Join link tokens must be redacted from server request logs.

Fastify's default request logging logs the full request URL, which means join link tokens appear in server logs. While join link tokens are not secrets in the traditional sense (they are distributed to team members), they are bearer credentials -- anyone who possesses the token can use it to join the team.

**Implementation:** Configure Fastify's request serializer to redact the token segment of `/api/join/:token` routes. The logged path should appear as `/api/join/[REDACTED]`. This applies to Fastify's built-in request logging; application-level audit logs (see Audit Logging below) may log the join link ID (UUID primary key) but not the token value.

---

### Error Response Format

**Decision:** Authentication error responses return only safe, generic information. No IdP-specific error details are included in HTTP response bodies.

**Response format for authentication errors:**
```json
{
  "error": {
    "category": "provider_unavailable | authentication_failed | session_expired | invalid_request",
    "message": "A plain-language, user-facing message suggesting a next action",
    "correlationId": "uuid-v4"
  }
}
```

The `correlationId` maps to the detailed server-side log entry, which contains the full IdP error response, stack trace, and protocol-level details. This allows operators to diagnose failures without exposing internal details to the client.

**Prohibited in response bodies:** Raw IdP error messages, state or nonce values, authorization codes, stack traces, OIDC configuration details.

---

### Audit Logging

**Decision:** The sign-in change emits structured audit log events for all authentication-related actions. These are machine-parseable structured log entries, not ad hoc `console.log` calls.

**Audit events:**

| Event | Required Fields |
|-------|----------------|
| `auth.authorization_initiated` | timestamp, sourceIp, hasJoinContext (boolean), stateNonce |
| `auth.callback_received` | timestamp, sourceIp, stateNonce, success (boolean) |
| `auth.success` | timestamp, userId, oidcSubject, oidcIssuer, isFirstAccess (boolean) |
| `auth.failure` | timestamp, sourceIp, failureCategory, idpErrorCode (server log only, never in response) |
| `auth.first_access_created` | timestamp, userId, oidcSubject, oidcIssuer |
| `auth.session_created` | timestamp, userId, sessionId |
| `auth.session_invalidated` | timestamp, userId, sessionId, reason (`explicit_logout` | `absolute_timeout` | `idle_timeout` | `token_revoked` | `refresh_failure`) |
| `auth.token_refresh_success` | timestamp, userId, sessionId |
| `auth.token_refresh_failure` | timestamp, userId, sessionId, failureType (`revoked` | `transient`), retryCount |
| `join.link_created` | timestamp, userId, teamId, linkId, expiresAt |
| `join.link_redeemed` | timestamp, userId, teamId, linkId |
| `join.link_rejected` | timestamp, sourceIp, linkId, reason (`expired` | `revoked` | `not_found`) |

These events satisfy SEC-13 (audit logging for authentication success/failure, session creation/invalidation, access control denials). The implementation must use the application's structured logging framework (e.g., Fastify's built-in Pino logger with structured JSON output), not a separate audit log table at this stage. If a dedicated audit table is needed for compliance, it can be added as a follow-on change without altering the event definitions.

---

### Redis Key Namespace Convention

**Decision:** All Redis keys used by this application follow a namespaced convention to prevent key collisions as Redis usage grows across features.

**Convention:** `dipstick:{feature}:{type}:{identifier}`

**Keys introduced by this change:**

| Key Pattern | TTL | Purpose |
|-------------|-----|---------|
| `dipstick:session:{sessionId}` | 2 hours (sliding) | Session data store (`@fastify/session` + `connect-redis`) |
| `dipstick:auth:state:{stateValue}` | 10 minutes | OIDC authorization state (state, nonce, pending join context) |

Future features should follow this convention. The session management change (live voting) will use `dipstick:voting:{sessionId}:state`, `dipstick:voting:{sessionId}:participants`, etc.

Note: The `connect-redis` store must be configured with a `prefix` option set to `dipstick:session:` to ensure session keys follow the convention.

---

### Shared Type Definitions

**Decision:** The following shared types are defined in `packages/shared/src/types/` and exported from the shared package index. These are the boundary contracts between frontend and backend for this change.

**`AuthSession`** -- returned by `GET /auth/session`, consumed by the frontend auth context provider:
```typescript
export interface AuthSession {
  user: {
    id: string;
    displayName: string;
    email: string;
  };
  teamMemberships: Array<{
    teamId: string;
    teamName: string;
    role: MembershipRole;
  }>;
  sessionCreatedAt: string; // ISO 8601
  expiresAt: string; // ISO 8601 (absolute lifetime)
}
```

**`JoinLink`** -- returned by `POST /api/teams/:teamId/join-links`:
```typescript
export interface JoinLink {
  id: string;
  teamId: string;
  token: string;
  expiresAt: string; // ISO 8601
  createdAt: string; // ISO 8601
}
```

**`AuthError`** -- shape of all authentication error responses:
```typescript
export type AuthErrorCategory =
  | 'provider_unavailable'
  | 'authentication_failed'
  | 'session_expired'
  | 'invalid_request';

export interface AuthError {
  error: {
    category: AuthErrorCategory;
    message: string;
    correlationId: string;
  };
}
```

---

## Risks / Trade-offs

**Risk: `offline_access` scope not granted by the simulated OIDC provider** -- The `node-oidc-provider` configuration must explicitly enable the `offline_access` scope and refresh token grant. If misconfigured, sessions will not survive beyond the access token lifetime. **Mitigation:** The OIDC provider configuration in `docker/oidc/config.js` must be updated as part of this change to enable `offline_access`. The `issueRefreshToken` configuration must also be verified, as recent versions of `node-oidc-provider` only issue refresh tokens when `offline_access` is explicitly granted. This must be verified end-to-end before the token refresh strategy is considered complete.

**Risk: `offline_access` scope not granted by the production Entra tenant** -- The exploration notes flag this as open question 1. If the organization's Entra configuration does not grant `offline_access`, the token refresh strategy fails. **Mitigation:** This must be validated with IT before production deployment. For this change (local dev only), the simulated provider is fully under our control.

**Risk: Redis unavailability breaks authentication** -- If Redis is down, no new sessions can be created and no existing sessions can be validated. **Mitigation:** The health endpoint already reports Redis status. Authentication failure due to Redis returns a clear error ("Sign-in is temporarily unavailable"). The application does not fall back to a degraded mode -- this is the correct posture per the exploration notes (no offline or degraded-mode access).

**Risk: Join link token in URL history** -- The join link token appears in the browser's URL bar and history. If someone with access to the browser history clicks the link after it has been redeemed, they reach the join flow. **Mitigation:** Join links are reusable by design (the facilitator sends one link to the whole team). The 7-day expiry limits the exposure window. After expiry, the link returns a clear error. The `Referrer-Policy: strict-origin-when-cross-origin` header prevents the token from leaking via the Referer header to external resources.

**Risk: State parameter size with nested redirect flows** -- The OIDC state parameter must survive the full redirect chain. Some IdPs have size limits on the state parameter. **Mitigation:** The state parameter is the cryptographic random value itself (43 characters, base64url-encoded). The actual join and nonce data live in Redis. This keeps the state parameter well within any IdP's size limits.

**Risk: Rate limiting not specified** -- The `/auth/callback` and `/api/join/:token` endpoints are not rate-limited in this design. An attacker could flood these endpoints to cause the backend to spam token requests at the IdP or consume Redis memory with pending-join keys. **Mitigation:** This is a deployment concern. Rate limiting should be implemented at the reverse proxy / load balancer layer for production. For local development, it is not a concern. This should be documented in the deployment runbook as a production prerequisite.

## Migration Plan

This is additive work on top of the existing scaffold. No existing functionality is being replaced or removed.

**Database migration:** A single new migration adds the `join_links` table. The existing `users` table already has the `oidc_subject` and `oidc_issuer` columns with the compound unique constraint from migration 2.

**Rollback:** Remove the auth middleware and the new routes. The application reverts to an unauthenticated state. No data migration required -- any accounts or join links created during development are test data.

## Open Questions

1. **Confirm `offline_access` with IT before production deployment.** The simulated provider supports it. The production Entra tenant may or may not. This does not block implementation but blocks production deployment.

2. **Session cookie domain configuration.** For local development, the cookie domain is `localhost`. For production, it must match the deployed domain. This is a deployment configuration concern, not an implementation blocker, but should be documented in the deployment runbook.

3. **`APP_ORIGIN` environment variable for production CORS.** The CORS configuration requires knowing the deployed application origin. This is a deployment configuration concern. For local development, the origins are hardcoded.

4. **`TOKEN_ENCRYPTION_KEY` vs. `SESSION_SECRET` for refresh token encryption.** The design specifies that refresh tokens are encrypted before storage in Redis using a key derived from `SESSION_SECRET` or a dedicated `TOKEN_ENCRYPTION_KEY`. The dedicated key is preferred (separation of concerns) but adds a configuration requirement. This should be decided before implementation.

---

## Reviewer Feedback Disposition

### Engineer Review (Marcus Oyelaran) -- Required Revisions

| # | Finding | Disposition | How Addressed |
|---|---------|-------------|---------------|
| 1 | `@fastify/secure-session` does not work as described; encrypts entire payload into cookie, no server-side store | **Incorporated** | Switched to `@fastify/session` + `connect-redis`. The session management decision now correctly describes server-side session storage with a signed session ID cookie. The alternatives section documents why `@fastify/secure-session` was rejected. |
| 2 | Column is `oidc_subject`/`oidc_issuer` compound key, not `idp_subject_id` | **Incorporated** | All references updated to `oidc_subject` and `oidc_issuer`. The First Access query and upsert now use the compound constraint `(oidc_subject, oidc_issuer)`. The account matching section title and rationale updated to reflect the compound key. |
| 3 | Relationship between `sessions.join_token` and `join_links` table unclear | **Incorporated** | Added explicit "Relationship to `sessions.join_token`" subsection under join link token format. Documents that `join_links` are for team membership enrollment (this change) and `sessions.join_token` is for session participation (session management scope). Clarifies that session-aware landing uses session ID, not session join token. |
| 4 | Vite proxy does not cover `/auth/*` routes | **Incorporated** | Added dedicated "Vite proxy configuration" decision section specifying the required proxy configuration for both `/api` and `/auth` prefixes. |
| 5 | Session lifetime: 2hr Redis TTL vs 90min absolute not reconciled | **Incorporated** | Added dedicated "Session Lifetime Enforcement" decision section. States both limits explicitly: 2-hour sliding Redis TTL for inactivity timeout, 90-minute absolute maximum via `sessionCreatedAt` timestamp checked on every request. Documents the interaction between the two. |
| 6 | Missing shared types: `AuthSession`, `JoinLink`, `AuthError` | **Incorporated** | Added "Shared Type Definitions" section with full TypeScript interface definitions for all three types. These are the boundary contracts between frontend and backend. |
| 7 | PKCE optional in simulated provider | **Incorporated** | Added PKCE subsection under OIDC Protocol Security Controls. Requires `pkce: { required: () => true }` in the simulated provider configuration. |
| 8 | `membership_role` enum has no `'engineer'` value; should be `'participant'` | **Incorporated** | All references to the `'engineer'` role updated to `'participant'`, matching the `membership_role` enum in migration 1 and the `MembershipRole` type in `packages/shared/src/types/user.ts`. |

### Engineer Review (Marcus Oyelaran) -- Observations (Non-Blocking)

| # | Observation | Disposition | How Addressed |
|---|-------------|-------------|---------------|
| A | 409 Conflict for sign-out confirmation is semantically wrong | **Incorporated** | Changed to `200 OK` with `{ confirmRequired: true, activeSessions: [...] }`. The frontend sends the initial check, gets the confirmation requirement, shows the dialog, and sends `POST /auth/logout?confirmed=true`. |
| B | Redis key namespace convention needed | **Incorporated** | Added "Redis Key Namespace Convention" section establishing the `dipstick:{feature}:{type}:{identifier}` pattern. All Redis keys in this change follow the convention. The `connect-redis` prefix configuration is specified. |
| C | Verify `offline_access` scope behavior end-to-end | **Incorporated** | Added to Risks section: the `issueRefreshToken` configuration must be verified in `node-oidc-provider`, and the token refresh flow must be tested end-to-end before considered complete. |
| D | Rate limiting as deployment concern | **Incorporated** | Added to Risks section as a deployment concern. Rate limiting should be at the reverse proxy / load balancer layer for production. Documented as a deployment runbook item. |
| E | Secure cookie local dev exception | **Incorporated** | Added "Local Development Cookie Exception" subsection under the session management decision. Documents the conditional `secure: false` when `NODE_ENV=development`, states that production is the default, and requires the conditional to be environment-variable-driven. |

### Security Review (Tomas Ferreira) -- MUST FIX

| # | Finding | Disposition | How Addressed |
|---|---------|-------------|---------------|
| F-01 | OIDC state parameter CSRF lifecycle not specified | **Incorporated** | Added "State Parameter (CSRF Protection)" subsection under OIDC Protocol Security Controls with the full lifecycle: generate (CSPRNG), store (Redis with TTL), send, verify, delete (single-use). |
| F-02 | Nonce handling not mentioned | **Incorporated** | Added "Nonce (ID Token Replay Prevention)" subsection. Nonce is generated per authorization request, stored alongside state in Redis, and verified against the `nonce` claim in the ID token. |
| F-03 | Session fixation prevention not addressed | **Incorporated** | Added "Session Fixation Prevention" subsection. The callback handler must destroy any pre-auth session and create a fresh session with a new ID. No pre-auth data is migrated. |
| F-05 | Contradictory session lifetimes; no absolute maximum enforcement | **Incorporated** | Added "Session Lifetime Enforcement" section reconciling both values. Sliding 2-hour Redis TTL for inactivity; 90-minute absolute via `sessionCreatedAt` timestamp checked on every request. |
| F-07 | Sign-out does not terminate IdP session | **Incorporated** | Sign-out flow now includes redirect to the IdP's `end_session_endpoint` with `id_token_hint` and `post_logout_redirect_uri`. Handles the case where the endpoint is not supported (fail open with warning). |
| F-08 | No mechanism to prevent simulated OIDC provider in production | **Incorporated** | Added "Simulated OIDC Provider: Production Isolation" section. Application validates `OIDC_ISSUER` at startup when `NODE_ENV=production` and refuses to start if it points to a local/private address. |
| F-12 | CORS configuration absent | **Incorporated** | Added "CORS Configuration" section with explicit origin enumeration for development and production. Wildcard origins prohibited. `credentials: true` specified. |
| F-15 | Audit logging events not specified | **Incorporated** | Added "Audit Logging" section with a full event table covering all authentication-related actions, required fields per event, and the requirement for structured, machine-parseable log entries. |

### Security Review (Tomas Ferreira) -- SHOULD FIX

| # | Finding | Disposition | How Addressed |
|---|---------|-------------|---------------|
| F-04 | Refresh tokens stored unencrypted in Redis | **Incorporated** | Token refresh strategy now specifies AES-256-GCM encryption of refresh tokens before Redis storage. Key derived from `SESSION_SECRET` or dedicated `TOKEN_ENCRYPTION_KEY`. |
| F-09 | Refresh failure does not distinguish revocation from transient error | **Incorporated** | Token refresh strategy now distinguishes `invalid_grant` (immediate invalidation, no retry) from 5xx/timeout (retry 2x with 5s intervals, then invalidate). Both logged with distinct event types. |
| F-10 | Error responses may leak IdP internals | **Incorporated** | Added "Error Response Format" section. Responses contain only category, user-facing message, and correlation ID. Prohibited content explicitly listed. |
| F-13 | Pending join Redis keys not cleaned up after use | **Incorporated** | The OIDC Protocol Security Controls section specifies that the state Redis key (which contains the pending join context) is deleted immediately after successful verification. Single-use by design. |
| F-16 | Sign-out confirmation bypassable via query parameter | **Accepted as UX-only** | Documented explicitly in the sign-out flow: the `confirmed=true` parameter is a UX convenience, not a security control. The user has the right to sign out at any time. |
| F-17 | Security headers not specified | **Incorporated** | Added "Security Headers" section specifying Referrer-Policy, X-Frame-Options, X-Content-Type-Options, and HSTS. CSP noted as a gap for a follow-on change. |
| F-18 | Join link tokens in server request logs | **Incorporated** | Added "Request Log Redaction" section. Fastify's request serializer must redact the token segment of `/api/join/:token` routes. |

### Security Review (Tomas Ferreira) -- ACCEPTABLE (no action required)

| # | Finding | Disposition |
|---|---------|-------------|
| F-06 | Join link enumeration resistance | **Acknowledged.** 256-bit entropy is sufficient. Rate limiting noted as deployment concern in Risks section. |
| F-11 | Secure cookie flag incompatible with local dev HTTP | **Addressed** under Local Development Cookie Exception (also overlaps with Engineer observation E). |
| F-14 | Last-write-wins on concurrent profile updates | **Acknowledged.** Acceptable per the design's existing rationale -- profile data is refreshed from the IdP on every sign-in. |
