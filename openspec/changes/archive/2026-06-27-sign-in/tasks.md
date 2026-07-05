# Sign-In — Implementation Tasks

**Revised:** 2026-06-25
**Author:** Marcus Oyelaran, Senior Full Stack Engineer

---

## 1. Database Migration and Shared Types

- [ ] 1.1 Create `packages/backend/migrations/5_create_join_links.sql` — `join_links` table with columns: `id` (UUID PK DEFAULT gen_random_uuid()), `team_id` (FK to teams NOT NULL), `token` (VARCHAR(64) NOT NULL UNIQUE), `created_by` (FK to users NOT NULL), `created_at` (TIMESTAMPTZ NOT NULL DEFAULT NOW()), `expires_at` (TIMESTAMPTZ NOT NULL), `revoked_at` (TIMESTAMPTZ nullable); index on `token`
  - **Design ref:** Join link token format and storage
  - **Test:** Run migration against a clean database; verify table exists with correct columns, constraints, and index

- [ ] 1.2 Add auth-related shared types to `packages/shared/src/types/auth.ts` and re-export from `packages/shared/src/index.ts`; verify `npm run build` in `packages/shared` compiles without errors. Types must match the design's Shared Type Definitions section exactly:
  - `AuthSession` — `{ user: { id: string; displayName: string; email: string }; teamMemberships: Array<{ teamId: string; teamName: string; role: MembershipRole }>; sessionCreatedAt: string; expiresAt: string }`
  - `JoinLink` — `{ id: string; teamId: string; token: string; expiresAt: string; createdAt: string }`
  - `AuthErrorCategory` — union type: `'provider_unavailable' | 'authentication_failed' | 'session_expired' | 'invalid_request'`
  - `AuthError` — `{ error: { category: AuthErrorCategory; message: string; correlationId: string } }`
  - **Design ref:** Shared Type Definitions, Error Response Format
  - **Test:** `npm run build` in `packages/shared` succeeds; types are importable from `@dipstick/shared`

## 2. OIDC Client and Session Infrastructure

- [ ] 2.1 Add dependencies to `packages/backend/package.json`: `openid-client`, `@fastify/session`, `connect-redis`, `@fastify/cookie`
  - **Design ref:** OIDC client library, Session management
  - **Test:** `npm install` succeeds; packages resolve

- [ ] 2.2 Create `packages/backend/src/auth/oidc-client.ts` — OIDC client initialization using discovery against the configured `OIDC_ISSUER`; exports functions for `getAuthorizationUrl(state, nonce)`, `handleCallback(code, nonce)`, `refreshToken(refreshToken)`. Authorization URL must include `response_type=code`, PKCE challenge (`S256`), `offline_access` scope, state, and nonce parameters
  - **Design ref:** OIDC client library, OIDC Protocol Security Controls (PKCE)
  - **Test:** Unit test: OIDC client initializes via discovery; `getAuthorizationUrl` returns URL with required parameters (state, nonce, code_challenge, offline_access scope)

- [ ] 2.3 Create `packages/backend/src/auth/token-encryption.ts` — AES-256-GCM encrypt/decrypt utility for refresh tokens. Key derived from `TOKEN_ENCRYPTION_KEY` environment variable (falls back to `SESSION_SECRET`). Exports `encryptToken(plaintext): string` and `decryptToken(ciphertext): string`
  - **Design ref:** Token refresh strategy (refresh token encryption)
  - **Test:** Unit test: encrypt then decrypt round-trips to original value; different plaintexts produce different ciphertexts; tampered ciphertext throws on decrypt

- [ ] 2.4 Create `packages/backend/src/auth/session-store.ts` — Redis-backed session store using `@fastify/session` + `connect-redis` with `prefix: 'dipstick:session:'`. Session data includes user ID, encrypted tokens (using token-encryption utility from 2.3), and `sessionCreatedAt` timestamp (ISO 8601). Redis TTL: 2 hours with sliding window on each authenticated request. Functions: `createSession(userId, tokenData)`, `getSession(sessionId)`, `destroySession(sessionId)`, `refreshSessionTTL(sessionId)`
  - **Design ref:** Session management (`@fastify/session` with `connect-redis`), Redis Key Namespace Convention, Session Lifetime Enforcement
  - **Test:** Unit test: session creation returns valid session ID; TTL refresh extends expiry; `destroySession` makes subsequent `getSession` return null; expired sessions are not retrievable; refresh tokens are stored encrypted (not plaintext)

- [ ] 2.5 Create `packages/backend/src/auth/middleware.ts` — Fastify `onRequest` hook that: (a) skips validation for public routes (`/health/*`, `/auth/*`, `/api/join/*`); (b) validates session cookie and retrieves session from Redis; (c) checks absolute session lifetime — if `Date.now() - sessionCreatedAt > 90 minutes`, invalidates session (deletes Redis key, clears cookie), returns 401; (d) triggers silent token refresh when access token has < 5 minutes remaining — distinguishes revocation (`invalid_grant` → immediate invalidation, no retry, log as `token_refresh_revoked`) from transient failure (5xx/timeout → retry up to 2 times with 5-second intervals, then invalidate, log as `token_refresh_transient_failure`); (e) refreshes Redis TTL on each valid request (sliding window); (f) rejects with 401 if session is invalid or missing
  - **Design ref:** Session Lifetime Enforcement, Token refresh strategy
  - **Test:** Unit test: public routes bypass validation; missing cookie returns 401; expired session returns 401; valid session passes through; absolute lifetime > 90 min returns 401; near-expiry token triggers refresh; revoked refresh token invalidates session immediately; transient refresh failure retries then invalidates

- [ ] 2.6 Update `packages/backend/src/config.ts` to add optional `TOKEN_ENCRYPTION_KEY` and `APP_ORIGIN` to validated config. Add production isolation guard: when `NODE_ENV=production`, validate that `OIDC_ISSUER` does not contain `localhost`, `127.0.0.1`, `0.0.0.0`, or any RFC 1918 private address (`10.x`, `172.16-31.x`, `192.168.x`); if it does, log a fatal error ("FATAL: OIDC_ISSUER points to a local/private address in production mode. The simulated OIDC provider must not be used in production.") and exit with non-zero code
  - **Design ref:** Simulated OIDC Provider: Production Isolation
  - **Test:** Unit test: config loads with valid env; production mode rejects localhost issuer; production mode rejects private IP issuer; development mode allows localhost issuer

## 3. Cross-Cutting Infrastructure

- [ ] 3.1 Install `@fastify/cors` and configure in `packages/backend/src/app.ts` — development: `origin: ['http://localhost:5173', 'http://localhost:3000']`; production: `origin: [config.APP_ORIGIN]`; both: `credentials: true`, `methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']`, `allowedHeaders: ['Content-Type', 'Authorization']`
  - **Design ref:** CORS Configuration
  - **Depends on:** 2.6 (APP_ORIGIN config)
  - **Test:** Integration test: cross-origin request from allowed origin succeeds with credentials; request from disallowed origin is rejected; wildcard origin is never used

- [ ] 3.2 Install `@fastify/helmet` (or implement custom `onSend` hook) and configure security headers in `packages/backend/src/app.ts`: `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Strict-Transport-Security: max-age=31536000; includeSubDomains` (production only; omitted when `NODE_ENV=development`)
  - **Design ref:** Security Headers
  - **Test:** Integration test: responses include all required headers; HSTS is present in production mode and absent in development mode

- [ ] 3.3 Configure Fastify request log redaction in `packages/backend/src/app.ts` — custom request serializer that redacts the token segment of `/api/join/:token` routes, logging the path as `/api/join/[REDACTED]`
  - **Design ref:** Request Log Redaction
  - **Test:** Unit test: request to `/api/join/abc123` is logged as `/api/join/[REDACTED]`; requests to other routes are logged normally

- [ ] 3.4 Create `packages/backend/src/auth/audit-logger.ts` — structured audit event emitter using Fastify's Pino logger (child logger). Exports a function `emitAuditEvent(eventName, fields)` that emits structured JSON log entries. Define the 12 audit event types with their required fields per the design's Audit Logging table:
  - `auth.authorization_initiated`, `auth.callback_received`, `auth.success`, `auth.failure`, `auth.first_access_created`, `auth.session_created`, `auth.session_invalidated`, `auth.token_refresh_success`, `auth.token_refresh_failure`, `join.link_created`, `join.link_redeemed`, `join.link_rejected`
  - **Design ref:** Audit Logging (SEC-13)
  - **Test:** Unit test: each event type emits structured JSON with all required fields; no audit event includes raw tokens or secrets

- [ ] 3.5 Register session plugin (`@fastify/session` with `connect-redis`), `@fastify/cookie`, CORS, security headers, request log redaction, and auth middleware in `packages/backend/src/app.ts`. Cookie configuration: `httpOnly: true`, `secure: true` in production / `secure: false` when `NODE_ENV=development`, `sameSite: 'strict'`, `path: '/'`
  - **Design ref:** Session management (cookie configuration, Local Development Cookie Exception)
  - **Depends on:** 2.1, 2.4, 2.5, 3.1, 3.2, 3.3
  - **Test:** Integration test: app starts and registers all plugins without errors; session cookie is set with correct attributes

## 4. Authentication Routes

- [ ] 4.1 Create `packages/backend/src/routes/auth.ts` — Fastify plugin registering auth routes under `/auth`
  - **Design ref:** (structural)
  - **Test:** Plugin registers without errors

- [ ] 4.2 Implement `GET /auth/login` — generates PKCE code verifier/challenge (S256), generates cryptographically random state (32 bytes, base64url) and nonce (CSPRNG). Stores in Redis at `dipstick:auth:state:{stateValue}` with 10-minute TTL; stored object: `{ nonce, pendingJoinToken?, createdAt }`. Redirects to IdP authorization endpoint with `response_type=code`, PKCE challenge, `offline_access` scope, state, and nonce parameters. Emits `auth.authorization_initiated` audit event
  - **Design ref:** OIDC Protocol Security Controls (State, Nonce, PKCE), Redis Key Namespace Convention, Audit Logging
  - **Test:** Unit test: redirect URL includes state, nonce, code_challenge, offline_access; Redis key is created with correct TTL and structure; audit event is emitted

- [ ] 4.3 Implement `GET /auth/callback` — OIDC protocol validation: retrieve state from query parameter, look up `dipstick:auth:state:{stateValue}` in Redis (reject if missing/expired), exchange authorization code for tokens via OIDC client with PKCE verifier, validate ID token (signature via JWKS, expiry, audience, issuer), verify nonce claim in ID token matches stored nonce, delete state Redis key immediately (single-use). Emits `auth.callback_received` audit event. On any validation failure: emit `auth.failure` audit event and return error page with correlation ID
  - **Design ref:** OIDC Protocol Security Controls (State, Nonce, PKCE), Audit Logging
  - **Depends on:** 2.2, 4.2
  - **Test:** Unit test: valid callback exchanges code and validates tokens; missing state returns error; expired state returns error; nonce mismatch returns error; state key is deleted after use (replay rejected); audit events are emitted for both success and failure paths

- [ ] 4.4 Implement `GET /auth/callback` — application logic (continuation of 4.3): resolve or create user account via account-resolver (First Access), destroy any pre-authentication session and create a fresh session with a new session ID (session fixation prevention), populate new session with user ID, encrypted tokens, and `sessionCreatedAt` timestamp. Check for `pendingJoinToken` in the (already-retrieved) state data — if present, execute join flow (validate token, add membership as `participant`, emit `join.link_redeemed`). Redirect to destination: if join completed and active in-progress session exists for team, redirect to `/session/:sessionId`; if join completed with no active session, redirect to `/team/:teamId`; if no pending join, redirect to default landing. Emits `auth.success`, `auth.session_created`, and (if First Access) `auth.first_access_created` audit events
  - **Design ref:** Session Fixation Prevention, Account matching, Join link destination preservation, Session-aware join link landing, Audit Logging
  - **Depends on:** 4.3, 5.1 (account resolver)
  - **Test:** Unit test: first-time user creates account and session; returning user matches by `(oidc_subject, oidc_issuer)` not email; pre-existing session is destroyed before new session is created (fixation prevention); pending join token triggers team membership creation with role `participant`; active in-progress session triggers redirect to session; scheduled-but-not-started session does not trigger session redirect; audit events emitted for all paths

- [ ] 4.5 Implement `POST /auth/logout` — check for active session participation: query sessions where user is a participant and status = `'active'` (in progress only; scheduled sessions do not trigger confirmation). If active participation exists and `confirmed=true` is not set, return `200 OK` with `{ confirmRequired: true, activeSessions: [...] }`. On confirmed logout (or no active participation): destroy Redis session, clear session cookie, redirect to IdP `end_session_endpoint` (discovered via `.well-known/openid-configuration`) with `id_token_hint` and `post_logout_redirect_uri`. If IdP does not support `end_session_endpoint`, skip IdP redirect and redirect to application sign-in page directly; log a warning. Emits `auth.session_invalidated` audit event with reason `explicit_logout`
  - **Design ref:** Sign-out flow, Audit Logging
  - **Test:** Unit test: user in active session without `confirmed=true` gets confirmRequired response; confirmed logout destroys session and clears cookie; IdP end_session_endpoint redirect includes id_token_hint; missing end_session_endpoint falls back to app redirect with warning logged; scheduled sessions do not trigger confirmation; audit event emitted

- [ ] 4.6 Implement `GET /auth/session` — returns current user identity as `AuthSession` type (user object with id, displayName, email; teamMemberships array with teamId, teamName, role; sessionCreatedAt; expiresAt) or 401 if no valid session
  - **Design ref:** Shared Type Definitions (`AuthSession`)
  - **Test:** Unit test: valid session returns AuthSession shape; no session returns 401

## 5. First Access and Account Resolution

- [ ] 5.1 Create `packages/backend/src/auth/account-resolver.ts` — `resolveOrCreateAccount(idTokenClaims)`: queries `users` by compound key `(oidc_subject, oidc_issuer)`; if not found, inserts with `ON CONFLICT (oidc_subject, oidc_issuer) DO UPDATE SET display_name = EXCLUDED.display_name, email = EXCLUDED.email, updated_at = NOW() RETURNING *` for concurrent safety; returns user record with team memberships
  - **Design ref:** Account matching (compound key), Concurrency (batch arrival)
  - **Test:** Unit test: first-time user creates account; returning user matches by `(oidc_subject, oidc_issuer)` not email; email change updates profile; concurrent callbacks for same subject both succeed (no mutex, no distributed lock)

## 6. Join Link Routes

- [ ] 6.1 Create `packages/backend/src/routes/join-links.ts` — Fastify plugin for join link routes
  - **Design ref:** (structural)
  - **Test:** Plugin registers without errors

- [ ] 6.2 Implement `POST /api/teams/:teamId/join-links` — validates caller is a facilitator for the team, generates 32-byte crypto-random base64url token, inserts into `join_links` with 7-day default expiry, returns the join link URL and metadata as `JoinLink` type. Emits `join.link_created` audit event. Note on regeneration: creating a new link does not automatically revoke previous links. Facilitators can revoke an existing link by setting `revoked_at` via a separate endpoint if needed, but creating a new link is sufficient for the "regenerate" use case — the new link supersedes the old one in practice because the facilitator distributes only the new link. Old links remain valid until they expire or are explicitly revoked
  - **Design ref:** Join link token format and storage, Audit Logging
  - **Test:** Unit test: facilitator creates link successfully; non-facilitator is rejected; token is 32 bytes base64url; expiry defaults to 7 days; returned shape matches `JoinLink` type; audit event emitted

- [ ] 6.3 Implement `GET /api/join/:token` — authenticated flow: validate token (exists, not expired, not revoked); if invalid, return error page with appropriate message ("This link has expired. Ask your facilitator for a new one." for expired/revoked, or "This link is not valid." for not found); emit `join.link_rejected` audit event for invalid tokens. If valid: add user to team as `participant` via `INSERT INTO team_memberships (user_id, team_id, role) VALUES ($1, $2, 'participant') ON CONFLICT (user_id, team_id) DO NOTHING`. If membership already existed (DO NOTHING triggered), set a query parameter or response flag indicating "already a member" for the frontend to display a transient notification. Query for active in-progress session: `SELECT id FROM sessions WHERE team_id = $1 AND status = 'active' LIMIT 1` (only `'active'` status — scheduled/not-started sessions do not qualify). Redirect to `/session/:sessionId` if active session exists, otherwise redirect to `/team/:teamId`. Emit `join.link_redeemed` audit event
  - **Design ref:** Join link token format and storage, Session-aware join link landing, Concurrency (batch arrival), Audit Logging
  - **Depends on:** 3.5 (auth middleware for session validation)
  - **Test:** Unit test: valid token joins team with role `participant`; expired token returns error message; revoked token returns error message; not-found token returns error; already-a-member returns success with "already a member" indicator; concurrent redemptions are idempotent; active in-progress session triggers redirect to session; scheduled session does not trigger session redirect; audit events emitted for both success and rejection

- [ ] 6.4 Implement `GET /api/join/:token` — unauthenticated flow: validate token exists and is not expired/revoked (return error page if invalid). Store pending join token in the OIDC state Redis key (handled by redirecting to `/auth/login` with the token context — the login handler from 4.2 stores `pendingJoinToken` in the state Redis entry). Redirect to `/auth/login`. The callback handler (4.4) completes the join after authentication
  - **Design ref:** Join link destination preservation across OIDC redirect
  - **Test:** Unit test: unauthenticated user with valid token is redirected to `/auth/login`; expired token returns error page without redirecting to login; after completing auth, user lands on team (tested end-to-end in verification)

- [ ] 6.5 Write tests for join link flow: valid link joins team, expired link shows error message, revoked link shows error message, already-a-member triggers transient notification indicator, unauthenticated user completes full redirect chain, concurrent redemptions are idempotent
  - **Design ref:** Join link token format and storage, Concurrency

## 7. Error Handling and Auth Failure Logging

- [ ] 7.1 Create `packages/backend/src/auth/error-handler.ts` — maps OIDC error codes and network failures to plain-language error responses per the design's Error Response Format: `{ error: { category, message, correlationId } }`. Categories: `provider_unavailable` (IdP unreachable/5xx), `authentication_failed` (IdP error, user cancelled), `session_expired`, `invalid_request`. Messages suggest a next action (retry, contact IT). No IdP-specific error details, state/nonce values, authorization codes, or stack traces in response bodies
  - **Design ref:** Error Response Format
  - **Test:** Unit test: each error category maps to a plain-language message with a suggested action; no response contains raw IdP error details or protocol values

- [ ] 7.2 Add server-side authentication failure logging to the callback route (4.3) and error handler: all authentication failures are logged with error type, timestamp, IdP error codes (if any), source IP, and correlation ID. Log entries use structured JSON format via Pino. The correlation ID links the user-facing error response to the detailed server-side log entry. Emit `auth.failure` audit event for all failure paths
  - **Design ref:** Audit Logging (`auth.failure` event), Error Response Format (correlationId)
  - **Depends on:** 3.4 (audit logger), 4.3 (callback route)
  - **Test:** Unit test: authentication failure produces structured log entry with all required fields; correlation ID in log matches correlation ID in error response; IdP error codes appear in server log but not in response body

- [ ] 7.3 Create `packages/frontend/src/pages/AuthErrorPage.tsx` — renders error messages from query parameters with retry button and IT contact guidance where appropriate. Distinguishes user-resolvable errors (retry button) from IT-required errors (contact information)
  - **Design ref:** Error Response Format, auth-error-handling acceptance criteria
  - **Test:** Component renders error message, retry button, and IT contact info as appropriate per error category

- [ ] 7.4 Create `packages/frontend/src/pages/AuthLoadingPage.tsx` — branded loading state shown during application-controlled redirect processing (post-callback token exchange). Note: if this threatens the implementation timeline, it is the first deferral candidate per proposal guidance
  - **Design ref:** auth-error-handling acceptance criteria (in-transit loading state)
  - **Test:** Component renders branded loading indicator without blank screen

## 8. Frontend Auth Integration

- [ ] 8.1 Update `packages/frontend/vite.config.ts` — add `/auth` to the Vite dev server proxy alongside `/api`: `proxy: { "/api": "http://localhost:3000", "/auth": "http://localhost:3000" }`
  - **Design ref:** Vite proxy configuration
  - **Depends on:** must be complete before any frontend auth work is testable against the backend
  - **Test:** Manual: requests to `/auth/login` from the Vite dev server reach the Fastify backend, not the Vite dev server

- [ ] 8.2 Install `@fastify/cors` dependency must be registered (task 3.1) before frontend auth integration is testable. This is a dependency checkpoint, not a separate task
  - *(Note: this is a dependency reminder — CORS from task 3.1 must be in place before tasks 8.3+ can be tested from the Vite dev server)*

- [ ] 8.3 Create `packages/frontend/src/auth/AuthContext.tsx` — React context provider that calls `GET /auth/session` on mount, exposes `AuthSession` (user identity, team memberships, session metadata) and loading state, redirects to `/auth/login` on 401
  - **Design ref:** Shared Type Definitions (`AuthSession`)
  - **Depends on:** 3.1 (CORS), 8.1 (Vite proxy)
  - **Test:** Unit test: context provides user data when session is valid; context redirects to login on 401; context shows loading state during session check

- [ ] 8.4 Create `packages/frontend/src/auth/ProtectedRoute.tsx` — wrapper component that renders children only when authenticated, shows loading state while session is being verified
  - **Design ref:** (standard auth pattern)
  - **Test:** Unit test: renders children when authenticated; shows loading when verifying; redirects when unauthenticated

- [ ] 8.5 Create `packages/frontend/src/pages/NoTeamPage.tsx` — no-team landing page: displays authenticated user's name, explains no team membership, shows single instruction to follow a join link from facilitator. No navigation menu, no empty dashboards, no feature chrome. Communicates: (a) the user is authenticated, (b) they have no team membership, (c) how to join a team via a join link, (d) no further setup is required
  - **Design ref:** first-access acceptance criteria
  - **Test:** Component renders user name, join link instructions; does not render navigation, empty lists, or feature chrome

- [ ] 8.6 Create `packages/frontend/src/pages/TeamPage.tsx` — minimal team view placeholder (team name, member list) that serves as the post-join landing destination. Must support displaying a transient "You are already a member of this team" notification when a duplicate join is detected (signaled via query parameter or route state from the join flow). The notification does not require user action to dismiss — it auto-dismisses after a short duration
  - **Design ref:** join-link acceptance criteria (already-a-member notification)
  - **Test:** Component renders team name and member list; displays transient notification when already-a-member flag is present; notification auto-dismisses without user action

- [ ] 8.7 Update `packages/frontend/src/App.tsx` — wrap app in `AuthContext`, add routes for `/auth/error`, `/auth/loading`, `/no-team`, and the default authenticated landing page; route to no-team page when user has zero team memberships
  - **Design ref:** first-access acceptance criteria (routing logic)
  - **Test:** Integration test: zero-membership user sees NoTeamPage; user with memberships sees team view; unauthenticated user is redirected to login

- [ ] 8.8 Create `packages/frontend/src/components/SignOutButton.tsx` — calls `POST /auth/logout`, handles 200 response with `confirmRequired: true` by showing confirmation dialog ("You are in an active session. Signing out will remove you from the session. Continue?"), re-calls with `?confirmed=true` on user confirmation. Handles network failure during sign-out by advising user to close the browser as a fallback
  - **Design ref:** Sign-out flow, UC: Sign Out (browser close fallback)
  - **Test:** Unit test: sign-out call succeeds and redirects; confirmRequired response shows dialog; confirmed re-call proceeds; network failure shows browser-close guidance

## 9. Simulated OIDC Provider Configuration

- [ ] 9.1 Update `docker/oidc/config.js` — enable `offline_access` scope, enable refresh token grant type, configure token lifetimes (access token: 1 hour, refresh token: 8 hours) to exercise the refresh flow during development. Enforce PKCE: `pkce: { required: () => true }`. Ensure `issueRefreshToken` is configured to issue refresh tokens when `offline_access` is granted. Verify all four pre-seeded test accounts (`participant@example.com`, `facilitator@example.com`, `manager@example.com`, `admin@example.com`) can complete the full sign-in flow including token refresh. Add comment to `docker-compose.yml` on the oidc service: `# DEVELOPMENT ONLY -- do not deploy to production environments`
  - **Design ref:** OIDC client library (PKCE), Token refresh strategy, Simulated OIDC Provider: Production Isolation
  - **Test:** Manual: each test account completes sign-in; token refresh occurs after access token expiry; PKCE is enforced (request without code_challenge is rejected)

- [ ] 9.2 Update `.env.example` with any new or changed environment variable defaults: `TOKEN_ENCRYPTION_KEY`, `APP_ORIGIN`, and any other variables added during implementation
  - **Design ref:** (operational)
  - **Test:** `.env.example` contains all required variables with descriptions

## 10. Documentation

- [ ] 10.1 Document the redirect chain for a first-time user completing join-link-through-auth: expected number of page transitions and approximate timing for both first-time users (First Access) and returning users. Include the sequence: join link click → backend validation → IdP redirect → IdP authentication → callback → account resolution → join execution → destination redirect. Document which transitions are application-controlled vs. IdP-controlled
  - **Design ref:** auth-error-handling acceptance criteria (redirect chain documentation)
  - **Test:** Document exists and covers both first-time and returning user flows with transition counts and timing estimates

## 11. Verification

- [ ] 11.1 Run `npm run build` from project root — all packages compile without TypeScript errors including new auth types
- [ ] 11.2 Run `npm run lint` from project root — ESLint passes across all packages including new files
- [ ] 11.3 Run `npm run test` from project root — all auth-related tests pass
- [ ] 11.4 Manual verification: `docker compose up`, navigate to app, confirm redirect to simulated IdP, authenticate as `participant@example.com`, confirm session cookie is set with correct attributes (HttpOnly, SameSite=Strict, Secure=false in dev), confirm no-team landing page is displayed
- [ ] 11.5 Manual verification: generate a join link as facilitator, follow it as an unauthenticated user, confirm full join-link-through-auth flow lands on team view in a single uninterrupted flow
- [ ] 11.6 Manual verification: follow a join link as an authenticated user who is already a member, confirm transient "You are already a member of this team" notification appears and auto-dismisses
- [ ] 11.7 Manual verification: sign out, confirm session is invalidated, confirm redirect to IdP end_session_endpoint (or fallback), confirm browser back button does not restore access
- [ ] 11.8 Manual verification: let access token expire (or set short lifetime for test), confirm silent refresh occurs without user interruption
- [ ] 11.9 Verify expired join link displays "This link has expired. Ask your facilitator for a new one."
- [ ] 11.10 Verify revoked join link displays appropriate error message
- [ ] 11.11 Verify structured audit log entries are emitted for: login initiation, callback, success, failure, session creation, session invalidation, join link creation, join link redemption, join link rejection
- [ ] 11.12 Verify request logs do not contain join link tokens (redacted as `[REDACTED]`)
- [ ] 11.13 Verify security headers are present on responses (Referrer-Policy, X-Frame-Options, X-Content-Type-Options)
- [ ] 11.14 Verify production isolation guard: set `NODE_ENV=production` and `OIDC_ISSUER=http://localhost:4011`, confirm application refuses to start

---

## Reviewer Feedback Disposition

### Ingrid Sollenberger (Solution Architect) — "Revise before implementation"

| # | Finding | Disposition | How Addressed |
|---|---------|-------------|---------------|
| 1.1 | Session library mismatch — task 2.1 listed `@fastify/secure-session` | **Incorporated** | Task 2.1 now lists `@fastify/session`, `connect-redis`, `@fastify/cookie`. All session store tasks (2.4, 3.5) reference `@fastify/session` + `connect-redis`. |
| 1.2 | Shared types need to match revised design | **Incorporated** | Task 1.2 specifies the exact `AuthSession` structure from the design (nested `user` object, `sessionCreatedAt`, `expiresAt`). |
| 1.3 | OIDC nonce lifecycle has no task | **Incorporated** | Tasks 4.2 and 4.3 explicitly include nonce generation, Redis storage alongside state, and nonce verification against the ID token `nonce` claim. |
| 1.4 | Session fixation prevention has no task | **Incorporated** | Task 4.4 explicitly requires destroying any pre-authentication session and creating a fresh session with a new ID. |
| 2.1 | IdP logout on sign-out missing | **Incorporated** | Task 4.5 includes `end_session_endpoint` redirect with `id_token_hint` and `post_logout_redirect_uri`, with graceful fallback. |
| 2.2 | Production isolation guard missing | **Incorporated** | Task 2.6 implements the production isolation check in the config startup path. Verification 11.14 confirms it. |
| 2.3 | CORS configuration missing | **Incorporated** | Task 3.1 installs `@fastify/cors` and configures it. Task 8.2 establishes CORS as a dependency before frontend auth work. |
| 2.4 | Security headers missing | **Incorporated** | Task 3.2 installs `@fastify/helmet` or equivalent and configures all specified headers. |
| 2.5 | Audit logging missing | **Incorporated** | Task 3.4 creates the audit logger with all 12 event types. Audit event emission is wired into every auth route task (4.2–4.5) and join link task (6.2–6.4). Verification 11.11 confirms. |
| 2.6 | Refresh token encryption missing | **Incorporated** | Task 2.3 creates the AES-256-GCM encryption utility. Task 2.4 stores refresh tokens encrypted. |
| 2.7 | Request log redaction missing | **Incorporated** | Task 3.3 configures request log redaction. Verification 11.12 confirms. |
| 2.8 | Vite proxy update missing | **Incorporated** | Task 8.1 adds `/auth` to Vite proxy. |
| 2.9 | Role value — `'engineer'` should be `'participant'` | **Incorporated** | All tasks use `'participant'` for the default membership role, matching the `membership_role` enum. |
| 2.10 | Redis namespace prefix for connect-redis missing | **Incorporated** | Task 2.4 specifies `prefix: 'dipstick:session:'`. |
| 3.1 | Task 3.3 (callback) too large | **Incorporated** | Split into task 4.3 (OIDC protocol validation) and task 4.4 (application logic: account resolution, session creation, pending join, redirect). |
| 3.2 | Task 5.3 (join route) too large | **Incorporated** | Split into task 6.3 (authenticated flow) and task 6.4 (unauthenticated flow). |
| 3.3 | Tasks 1.2+1.3+1.4 should merge | **Incorporated** | Merged into single task 1.2 (define types, re-export, verify build). |
| 4.1 | Session store needs test criteria | **Incorporated** | Task 2.4 includes specific test criteria for session CRUD, TTL, expiry, and encrypted storage. |
| 4.2 | Auth middleware needs test criteria | **Incorporated** | Task 2.5 includes test criteria for each branching path. |
| 4.3 | Tasks 8.1+8.2 not independently testable | **Incorporated** | Merged into single task 9.1 with clear done condition: all test accounts complete sign-in including token refresh. |
| 5 (structural) | New group for cross-cutting infrastructure | **Incorporated** | Group 3 (Cross-Cutting Infrastructure) covers CORS, security headers, request log redaction, audit logging, and plugin registration — all before auth routes in group 4. |
| 5 (structural) | Vite proxy to frontend group | **Incorporated** | Task 8.1 (Vite proxy) is in group 8 (Frontend Auth Integration). |
| 5 (structural) | Refresh token encryption before consumers | **Incorporated** | Task 2.3 (token encryption utility) precedes task 2.4 (session store) and task 2.5 (middleware). |

### Marcus Delgado (Business Analyst) — "Approve with required revisions"

| # | Finding | Disposition | How Addressed |
|---|---------|-------------|---------------|
| 1 | No frontend task for "already a member" transient notification UI | **Incorporated** | Task 6.3 signals already-a-member status to the frontend. Task 8.6 implements the transient notification display on TeamPage — auto-dismissing, no user action required. Verification 11.6 confirms. |
| 2 | "Active session" not qualified as "in progress" state | **Incorporated** | Tasks 4.4, 4.5, 6.3 all explicitly state `'active'` status (in progress only) and explicitly exclude scheduled-but-not-started sessions. |
| 3 | No task for server-side auth failure logging | **Incorporated** | Task 7.2 requires structured logging of all auth failures with error type, timestamp, IdP error codes, source IP, and correlation ID. Task 3.4 (audit logger) emits `auth.failure` events. |
| 4 | Join link regeneration vs. revocation unclear | **Incorporated** | Task 6.2 includes an explicit note: creating a new link does not auto-revoke previous links; new link supersedes old in practice because facilitator distributes only the new link; old links remain valid until expiry or explicit revocation. |
| 5 | No task for redirect chain documentation | **Incorporated** | Task 10.1 documents the redirect chain with page transitions and timing for both first-time and returning users. |

### Observations Acknowledged (not required revisions)

| Source | Observation | Status |
|--------|-------------|--------|
| Marcus D. #3 | AuthLoadingPage tension with zero-interstitial criteria | Task 7.4 notes deferral candidacy per proposal guidance. Resolution documented: if built, the "zero application-controlled screens" criteria are relaxed; if deferred, criteria are literally satisfied. |
| Marcus D. #4 | Batch arrival / concurrency validation | Not in scope for this task list per executive review disposition (validate smaller first, harden later). Noted for subsequent pass. |
| Marcus D. (UC) | Sign-out network failure — "advised to close browser" | Task 8.8 includes network failure handling with browser-close guidance. |
