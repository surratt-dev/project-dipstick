# Implementation Review: Sign-In Change

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Date:** 2026-06-26
**Scope:** Architectural conformance of sign-in implementation against approved design

---

## Summary

The implementation is structurally sound. The OIDC flow, session management, token encryption, join-link-through-auth flow, and production isolation guard are all present and follow the design's intent. The boundaries between modules are clean -- the OIDC client is provider-agnostic, session data is server-side, tokens are encrypted at rest in Redis, and the frontend never touches token material.

There are findings below that need to be addressed. Most are specification deviations rather than architectural defects. Two are security-relevant.

---

## MUST FIX

### MF-1: Token encryption uses a static salt, defeating key separation

**File:** `packages/backend/src/auth/token-encryption.ts`, line 8

The `SALT` constant is hardcoded to `"dipstick-token-encryption"`. The `scryptSync` derivation uses this static salt for every key derivation. A static salt means if two deployments share the same `SESSION_SECRET` (or `TOKEN_ENCRYPTION_KEY`), they produce identical derived keys. More critically, the static salt removes the salt's purpose entirely -- it does not protect against precomputation attacks on the key derivation.

The salt should be a per-deployment random value stored alongside the configuration, or better, the `TOKEN_ENCRYPTION_KEY` should be used directly as a 32-byte key without key derivation (it is already a secret). If `scryptSync` is retained, generate a random salt and store it, or derive the salt from a second environment variable.

This is a security finding, not an architectural one, but it falls within my scope because the token encryption design is a boundary contract with Redis.

### MF-2: Session fixation prevention performs both destroy and regenerate

**File:** `packages/backend/src/routes/auth.ts`, lines 139-144

The callback handler calls `request.session.destroy()` and then `request.session.regenerate()`. The design specifies: destroy the pre-auth session, then create a fresh session with a new ID. The `destroy()` call deletes the session from Redis and clears the session object. The subsequent `regenerate()` call creates a new session -- but `regenerate()` on a destroyed session may behave unpredictably depending on the `@fastify/session` version. The typical pattern is either `destroy()` then manually re-initialize, or `regenerate()` alone (which internally creates a new session ID and discards old data).

Test this explicitly: does `regenerate()` after `destroy()` reliably produce a new, valid session with a new session ID? If it does, document why. If it does not, use `regenerate()` alone -- it already creates a new session ID and discards old data, which satisfies the session fixation prevention requirement.

### MF-3: Session-aware landing query omits `lobby` and `pre_session` statuses

**File:** `packages/backend/src/routes/auth.ts`, line 424 (in `executeJoinFlow`)
**File:** `packages/backend/src/routes/join-links.ts`, line 181

The design specifies:
```sql
SELECT id FROM sessions WHERE team_id = $1 AND status IN ('lobby', 'pre_session', 'active') LIMIT 1
```

Both implementations use only `status = 'active'`. This means a user joining via a join link while the facilitator has the session in the lobby or pre-session state will land on the team page instead of the session page. This contradicts the design's stated intent of handling the common case where "the facilitator shares a join link right before a session."

Change both queries to match the design specification.

### MF-4: `/auth/session` endpoint is behind the auth middleware but also marked as a public route

**File:** `packages/backend/src/auth/middleware.ts`, line 9

The `PUBLIC_PREFIXES` array includes `"/auth"`, which means every route under `/auth` -- including `/auth/session` -- skips the auth middleware entirely. The `/auth/session` handler (auth.ts, line 297) manually checks `session?.userId` and returns 401 if missing, so it functions correctly. However:

1. The token refresh logic in the middleware never runs for `/auth/session` requests. A user whose access token is about to expire will not get it refreshed by calling `/auth/session`. The frontend polls this endpoint to get session state; if it is the only endpoint being called, the token will expire without being refreshed.

2. The absolute lifetime check in the middleware never runs for `/auth/session`. A session that has exceeded 90 minutes will continue to return valid session data from `/auth/session` until the Redis TTL expires (up to 2 hours).

The design does not specify that `/auth/session` should be a public route. It should be a protected route that benefits from the middleware's token refresh and lifetime checks. The `/auth` prefix in `PUBLIC_PREFIXES` is too broad -- it should be limited to `/auth/login`, `/auth/callback`, and `/auth/logout` (or `/auth/error` if that is a backend route rather than a frontend route).

---

## SHOULD FIX

### SF-1: Audit event `auth.callback_received` emits `success: true` before the callback is actually successful

**File:** `packages/backend/src/routes/auth.ts`, lines 103-107

The `auth.callback_received` event is emitted with `success: true` immediately after state retrieval but before the token exchange, account resolution, and session creation. If any of those steps fail, the callback was not successful, but the audit log says it was. This event should either be moved after the full callback flow succeeds, or the `success` field should be removed from this event (the `auth.success` and `auth.failure` events already cover the outcome).

### SF-2: OIDC discovery result is cached with no invalidation

**File:** `packages/backend/src/auth/oidc-client.ts`, lines 4-6

The `oidcConfig` variable caches the discovery result for the lifetime of the process. If the IdP rotates its signing keys or changes its metadata, the application will not pick up the change until it is restarted. For local development this is irrelevant. For production, OIDC discovery should be re-fetched periodically (e.g., every 24 hours) or on verification failure.

This is not blocking for this change (local dev only), but document it as a known limitation that must be addressed before production deployment.

### SF-3: `APP_ORIGIN` fallback to empty string in production

**File:** `packages/backend/src/app.ts`, line 40
**File:** `packages/backend/src/routes/auth.ts`, lines 278-281

In production, if `APP_ORIGIN` is not set, the CORS origin falls back to `[""]` (array with empty string). This will silently reject all cross-origin requests. The design says `APP_ORIGIN` is required for production. The config validation (config.ts) lists it as optional. It should be required when `NODE_ENV=production`, just as the OIDC issuer is validated at startup.

Similarly, in the logout handler (auth.ts line 278-281), `APP_ORIGIN` falls back to empty string in production, which would produce an invalid `post_logout_redirect_uri`.

### SF-4: Join link authorization check references `global_role` column

**File:** `packages/backend/src/routes/join-links.ts`, lines 38-52

The join link creation endpoint queries `users.global_role` and checks for `facilitator`, `engineering_manager`, or `application_admin`. The design does not mention a `global_role` column -- the design's non-goals explicitly state "Implementing role assignment or the no-manager-participation enforcement -- those are session management concerns downstream of sign-in." The `users` table schema from the context section mentions `oidc_subject`, `oidc_issuer`, `display_name`, `email` -- no `global_role`.

If `global_role` exists in the schema, the authorization logic should be documented. If it does not, this query will fail at runtime. Either way, the design says join links are "generated by facilitators" but does not define how facilitator status is determined for this change. This needs clarification: is the authorization check correct against the actual schema, and is it intentional for this change to depend on role infrastructure that the design explicitly defers?

### SF-5: `connect-redis` session store does not use `disableTouch`

**File:** `packages/backend/src/auth/session-store.ts`, lines 7-13
**File:** `packages/backend/src/auth/middleware.ts`, line 121

The middleware calls `request.session.touch()` on every authenticated request (line 121). The `@fastify/session` plugin with `rolling: true` (app.ts line 73) already refreshes the session TTL on every request by re-saving the session. The explicit `touch()` call is redundant with `rolling: true`. This is not a bug, but it may cause a double Redis `EXPIRE` command per request. Verify that `rolling: true` alone handles the sliding TTL correctly and remove the explicit `touch()` if so.

### SF-6: No request log redaction for the `/auth/login?joinToken=` query parameter

**File:** `packages/backend/src/app.ts`, lines 22-30

The request serializer redacts `/api/join/:token` path segments but does not redact the `joinToken` query parameter on `/auth/login?joinToken=...`. The join token value is equally sensitive in both locations. The serializer should also redact `joinToken` from query strings.

---

## OBSERVATIONS (Non-Blocking)

### OB-1: Frontend redirects to `/auth/login` on 401 from session check

**File:** `packages/frontend/src/auth/AuthContext.tsx`, lines 35-39

When `/auth/session` returns 401, the frontend immediately redirects to `/auth/login`. This means every unauthenticated page load triggers a full OIDC redirect. For the join link flow, this is correct (the user needs to authenticate). For a user who has been signed out due to session expiry, this creates an immediate re-authentication loop if the IdP session is still active. The IdP will silently issue a new token, creating a new application session, and the user may not realize their previous session expired.

This is the correct behavior per the design (the application does not have a "you have been signed out" interstitial). Note it as a UX consideration for the team.

### OB-2: `TeamPage` displays team memberships from session data, not team-specific data

**File:** `packages/frontend/src/pages/TeamPage.tsx`, lines 44-49

The `TeamPage` renders `session.teamMemberships` as a list of all the user's team memberships, not the members of the specific team identified by the `:teamId` route parameter. This is a placeholder implementation and is fine for this change, but it will need to be replaced with a team-specific member list when the session management change is implemented.

### OB-3: Error messages passed via URL query parameters

**File:** `packages/backend/src/routes/auth.ts`, lines 76, 91, 206-208

Error details (category, message, correlationId) are passed to the frontend via URL query parameters on redirect. The messages are user-facing and contain no sensitive data, so this is not a security concern. However, long error messages may be truncated by URL length limits in some browsers. Consider using a flash message pattern (store error in Redis with a short TTL, pass only a lookup key in the URL) if message length becomes an issue.

### OB-4: Docker Compose OIDC service comment is present

**File:** `docker-compose.yml`, line 26

The design requires a comment on the OIDC service: "DEVELOPMENT ONLY -- do not deploy to production environments." This is present. Good.

### OB-5: The `account-resolver.ts` performs a SELECT then an INSERT (two queries)

**File:** `packages/backend/src/auth/account-resolver.ts`, lines 26-42

The `resolveOrCreateAccount` function issues a `SELECT` to determine `isNewUser`, then an `INSERT ... ON CONFLICT DO UPDATE`. This works correctly under concurrency (the upsert handles the race), but the `isNewUser` flag may be incorrect in a narrow race window: if two concurrent callbacks for the same new user both see `rows.length === 0` on the SELECT, both will report `isNewUser: true`, and two `auth.first_access_created` audit events will be emitted. This is cosmetically wrong but not functionally harmful. The upsert itself is correct.

A single query could handle this by checking `xmax` on the RETURNING row (non-zero `xmax` means the row was updated, not inserted), but this is a refinement, not a requirement.

---

## Design Conformance Checklist

| Design Requirement | Status | Notes |
|---|---|---|
| OIDC authorization code flow with PKCE | Conformant | S256 challenge, `openid-client` handles verification |
| State parameter lifecycle (generate, store, verify, delete) | Conformant | Redis-backed, single-use, 10-minute TTL |
| Nonce lifecycle | Conformant | Stored with state, verified via `openid-client` |
| Session fixation prevention | Needs verification | See MF-2: destroy + regenerate may be redundant or problematic |
| Cookie configuration (HttpOnly, Secure, SameSite) | Conformant | Conditional `secure` for development |
| Token encryption (AES-256-GCM) | Partially conformant | See MF-1: static salt issue |
| Absolute session lifetime (90 min) | Conformant for protected routes | See MF-4: not enforced on `/auth/session` |
| Sliding inactivity timeout (2 hr Redis TTL) | Conformant | `connect-redis` TTL + `rolling: true` |
| Token refresh (5-min threshold, retry logic) | Conformant | Revocation vs. transient error handling present |
| Account matching (oidc_subject + oidc_issuer) | Conformant | Compound key upsert matches design |
| Join link token format (32 bytes, base64url) | Conformant | |
| Join link destination preservation across OIDC redirect | Conformant | Stored in Redis state key, not in state parameter |
| Session-aware join link landing | Non-conformant | See MF-3: missing `lobby` and `pre_session` statuses |
| Sign-out with IdP session termination | Conformant | `end_session_endpoint` check present |
| Sign-out confirmation for active sessions | Conformant | 200 OK with `confirmRequired` pattern |
| Production isolation guard | Conformant | Private address check at startup |
| CORS configuration | Partially conformant | See SF-3: `APP_ORIGIN` not required in production |
| Security headers | Conformant | Helmet configured per design |
| Request log redaction | Partially conformant | See SF-6: join token in query param not redacted |
| Audit logging events | Conformant | All specified events present |
| Shared type definitions | Conformant | `AuthSession`, `JoinLink`, `AuthError` match design |
| Vite proxy configuration | Conformant | Both `/api` and `/auth` proxied |
| Redis key namespace convention | Conformant | `dipstick:session:` and `dipstick:auth:state:` prefixes |
| Simulated OIDC provider configuration | Conformant | PKCE required, `offline_access` enabled, refresh token grant |
| `join_links` migration | Conformant | Schema matches design |

---

## Boundary Assessment

The implementation maintains clean boundaries:

1. **OIDC client** (`oidc-client.ts`) is provider-agnostic. No Entra-specific behavior. The `allowInsecureRequests` configuration is scoped to enabling HTTP for local development. Swapping providers requires only configuration changes (environment variables), not code changes. This satisfies NFR-AUTH-001.

2. **Session store** is correctly server-side (Redis via `connect-redis`). Tokens never appear in browser-accessible storage. The session cookie contains only an opaque session ID.

3. **Frontend/backend contract** is defined by the shared types in `packages/shared/src/types/auth.ts`. The frontend consumes `AuthSession` from `GET /auth/session` and does not handle tokens or OIDC protocol details.

4. **Join links** are correctly separated from `sessions.join_token`. The implementation does not reference `sessions.join_token`.

5. **Audit logging** uses Fastify's Pino logger with structured events, not a separate store. The events are machine-parseable.

The one boundary concern is the `/auth` public route prefix (MF-4), which creates an unintended gap in the session lifecycle enforcement for the `/auth/session` endpoint.
