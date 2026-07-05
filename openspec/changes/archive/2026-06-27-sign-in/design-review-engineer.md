# Design Review: Sign-In Change

**Reviewer:** Marcus Oyelaran, Senior Full Stack Engineer
**Date:** 2025-06-25
**Verdict:** Approve with required revisions

---

## Summary

The design is solid. The OIDC flow, join-link-through-auth state preservation, First Access upsert, and batch concurrency handling are all well-reasoned. The technology choices are practical and the boundaries between auth middleware, routes, and session management are clean in principle.

There are several implementation-level issues that need resolution before this can be built without backtracking.

---

## Required Revisions

### 1. `@fastify/secure-session` does not work the way this design assumes

The design says: "`@fastify/secure-session` with Redis store" -- session data stored in Redis with the session ID in the cookie.

That is not what `@fastify/secure-session` does. It encrypts the entire session payload into the cookie using libsodium. There is no session ID. There is no server-side store. The cookie IS the session.

This means:
- You cannot store access tokens, refresh tokens, and user data in the session without exceeding browser cookie size limits (4KB). An OIDC access token alone can be 1-2KB. Add a refresh token and user metadata and you are over.
- You cannot revoke sessions server-side by deleting a Redis key, because there is no Redis key. The cookie is self-contained. Session revocation requires either a deny-list (which is the Redis store you thought you had) or waiting for expiry.
- The "sliding window TTL refresh on each request" described in the design has no mechanism in `@fastify/secure-session`. Cookie expiry is set at creation time; you would need to re-encrypt and re-issue the cookie on every request to simulate sliding expiry.

**Resolution:** Switch to `@fastify/session` with `connect-redis`. This actually does what the design describes: stores a session ID in a signed cookie, stores session data in Redis, supports server-side revocation, and supports TTL refresh. The design rejected this option saying `@fastify/secure-session` provides "encrypted cookies out of the box, reducing the attack surface" -- but that benefit is irrelevant when the cookie contains only an opaque session ID. The session ID does not need to be encrypted; it needs to be signed (which `@fastify/session` does) and the actual sensitive data lives in Redis where it belongs.

Alternatively, use `@fastify/secure-session` for ONLY the session ID and build a manual Redis lookup layer on top. But that is just reinventing `@fastify/session` with extra steps.

**Impact:** This is a foundational mistake. If someone implements the design as written, they will hit the cookie size limit within the first test and have to redesign the session layer.

---

### 2. The `users` table column is `oidc_subject`, not `idp_subject_id`

The design references `idp_subject_id` as the column name for the subject claim. The actual migration (migration 2) uses `oidc_subject` with a compound unique constraint `(oidc_subject, oidc_issuer)`.

The design's First Access query is written as `SELECT * FROM users WHERE idp_subject_id = $1`. That column does not exist. The correct query must match on both `oidc_subject` and `oidc_issuer` -- the unique constraint is compound, not single-column.

The design's upsert is `INSERT INTO users (...) ON CONFLICT (idp_subject_id) DO UPDATE ...`. The conflict target must be `(oidc_subject, oidc_issuer)`.

This matters for provider abstraction: two different OIDC providers could theoretically issue the same `sub` value. The schema correctly handles this. The design does not.

**Resolution:** Update all references to use the actual column names and compound constraint. The First Access upsert should be:
```sql
INSERT INTO users (oidc_subject, oidc_issuer, display_name, email)
VALUES ($1, $2, $3, $4)
ON CONFLICT (oidc_subject, oidc_issuer)
DO UPDATE SET display_name = EXCLUDED.display_name, email = EXCLUDED.email, updated_at = NOW()
RETURNING *
```

---

### 3. The `join_links` table design conflicts with existing schema patterns

The design proposes a standalone `join_links` table with its own token column. But the existing `sessions` table already has a `join_token` column with a unique constraint (`sessions_join_token_unique`). The shared types in `session.ts` include `joinToken: string` on the `Session` interface.

This is a design-level conflict. There appear to be two separate join token concepts:
- Session join tokens (already in the schema, on the `sessions` table) -- presumably for joining an active session
- Team join links (proposed in this design) -- for joining a team

The design must clarify the relationship between these. Specifically:
- Are session join tokens used at all in the sign-in flow, or are they a session-management concern?
- When the design says "session-aware join link landing," does the redirect use the team join link's token or the session's `join_token`?
- Can/should the team join link subsume the session join token for the "join link shared before a session" use case?

**Resolution:** Document the distinction explicitly. My read is that `join_links` are for team membership enrollment (this change) and `sessions.join_token` is for joining an already-created session (session management scope). But the design needs to say this clearly, because someone implementing "session-aware join link landing" will see both token columns and make assumptions.

---

### 4. The Vite proxy does not cover `/auth/*` routes

The `vite.config.ts` proxy configuration only proxies `/api/*` to the backend. The design adds routes at `/auth/login`, `/auth/callback`, and `/auth/logout` -- none of which are under `/api/`.

During local development, a browser request to `http://localhost:5173/auth/login` will hit the Vite dev server, not the Fastify backend. The Vite dev server will either return the SPA's `index.html` (if using fallback) or a 404.

The OIDC callback is somewhat protected because the redirect URI is registered as `http://localhost:3000/auth/callback` (hitting the backend directly). But the initial login redirect from the frontend and the logout POST will break unless the proxy is updated.

**Resolution:** Add `/auth` to the Vite proxy configuration:
```ts
proxy: {
  "/api": "http://localhost:3000",
  "/auth": "http://localhost:3000",
}
```

This is a one-line fix but it will block every developer who tries to test the flow locally if it is missed.

---

### 5. Absolute session lifetime conflicts between design and architecture

The design states: "The absolute session lifetime is 90 minutes (SEC-4)."

The architecture document (Section 6.2) states: "Sessions expire after 2 hours of inactivity."

These are different things -- one is absolute, one is inactivity-based -- but they also state different values. The 90-minute absolute cap is a hard re-auth requirement. The 2-hour inactivity timeout is for idle sessions. Both can coexist, but the design does not acknowledge the 2-hour inactivity timeout at all. The Redis session TTL is described as "2-hour TTL" (matching the architecture) but the absolute lifetime is 90 minutes.

**Resolution:** State both limits explicitly:
- Redis session key TTL: 2 hours (refreshed on each request = sliding window for inactivity)
- Absolute session lifetime: 90 minutes from creation (stored in session data, checked on each request, no refresh)

This means a continuously active user hits the 90-minute wall and re-authenticates. An idle user's session expires after 2 hours of no requests. Both behaviors are correct per the architecture; the design just needs to say both clearly.

---

### 6. Missing shared types for auth-related contracts

The proposal lists new shared types: `AuthSession`, `JoinLink`, `AuthError`. These do not exist in `packages/shared/src/types/` and are not exported from the shared index.

The design does not define these types. The implementation team will need to define them, and without a specification, each developer will invent their own shapes.

**Resolution:** Define the shared types in the design. At minimum:

- `AuthSession`: What does the frontend receive from `GET /auth/session`? User ID, display name, email, team memberships, current team? This is the contract the frontend auth context provider consumes.
- `JoinLink`: What does `POST /api/teams/:teamId/join-links` return? Token, expiry, team ID?
- `AuthError`: What shape do authentication errors take? Error code enum, user-facing message, retry-eligible boolean?

These types are the boundary contract between frontend and backend for this entire change. They should not be left to implementation time.

---

### 7. PKCE is configured as optional in the simulated provider

The OIDC provider config has `pkce: { required: () => false }`. The design mentions "authorization code flow with PKCE" as a feature of `openid-client`.

If PKCE is optional in the simulated provider, the implementation may work without PKCE locally and then fail against a production Entra tenant that requires it (Entra requires PKCE for public clients by default).

**Resolution:** Set `pkce: { required: () => true }` in the simulated OIDC provider configuration. The design says the simulated provider must enforce the same validation as production. PKCE is part of that. If `openid-client` handles PKCE transparently (it does), there is no cost to requiring it.

---

### 8. The `membership_role` enum does not include `engineer`

The design says: "The user is added to the team with the default role of Engineer." The upsert example uses `'engineer'` as the role value: `INSERT INTO team_memberships (user_id, team_id, role) VALUES ($1, $2, 'engineer')`.

The actual `membership_role` enum in migration 1 needs to be checked, but the shared types define `MembershipRole` as `"participant" | "engineering_manager"`. There is no `"engineer"` value. The join link insertion will fail with an enum constraint violation.

**Resolution:** Use `'participant'` as the default role value in the join link flow, or update the enum if `engineer` is the intended value. The shared types say `participant`. The database enum says `membership_role`. The design says `engineer`. These three things need to agree.

---

## Observations (Non-Blocking)

### A. The sign-out `409 Conflict` response is semantically wrong

The design returns `409 Conflict` when a user in an active session tries to sign out, to trigger a confirmation dialog. A `409` means the request conflicts with the current state of the resource. Sign-out does not conflict with anything; the server is asking for confirmation.

A `200` with `{ confirmRequired: true, activeSessions: [...] }` is cleaner. The frontend sends a preliminary check, gets back the confirmation requirement, shows the dialog, and then sends the actual logout. Two requests, clear semantics. Or use a query parameter on the first request (`POST /auth/logout?dryRun=true`) to check without acting.

This will not break anything, but it will confuse anyone reading the API contract later.

### B. The `pending-join:{nonce}` Redis key has no namespacing conflict protection

The design uses `pending-join:{randomNonce}` for preserving join context across the OIDC redirect. The session store uses `session:{sessionId}`. The live voting feature (future) uses `session:{id}:state`, `session:{id}:participants`, etc.

These patterns are fine individually. But there is no documented Redis key namespace convention. Before three different features independently invent key patterns, establish the convention now: `dipstick:auth:pending-join:{nonce}`, `dipstick:session:{id}`, etc. A prefix convention costs nothing to establish and prevents key collisions as the Redis usage grows.

### C. The `offline_access` scope is listed in the OIDC provider's `scopes` array but `refresh_token` grant type behavior should be verified

The OIDC provider configuration includes `grant_types: ["authorization_code", "refresh_token"]` on the client and `scopes: ["openid", "profile", "email", "offline_access"]` globally. This should work, but the `node-oidc-provider` library also requires that the `offline_access` scope be explicitly requested in the authorization request AND that the provider's configuration does not have `issueRefreshToken` disabled. The default behavior in recent versions of `node-oidc-provider` is to issue refresh tokens only when the `offline_access` scope is granted. Verify this works end-to-end before treating it as settled.

### D. No rate limiting on `/auth/callback` or `/api/join/:token`

The design handles batch arrival (10+ concurrent users) but does not mention abuse protection. The `/auth/callback` endpoint receives an authorization code and exchanges it for tokens -- each call hits the OIDC provider's token endpoint. Without rate limiting, a malicious actor could flood this endpoint with fabricated callbacks and cause the backend to spam token requests at the IdP.

For local dev this does not matter. For production, this should be noted as a deployment concern.

### E. Cookie `Secure` flag in local development

The design specifies `Secure` cookies (SEC requirement). Over `http://localhost`, browsers will not send cookies with the `Secure` flag. The implementation must conditionally set `Secure: false` when `NODE_ENV=development`. This is a known pattern but it is not documented in the design and will trip someone up during local testing.

---

## What the Design Gets Right

- The OIDC state parameter approach for preserving join context is correct and avoids the common pitfalls (leaking tokens to the IdP, dynamic redirect URIs).
- The `ON CONFLICT ... DO UPDATE` pattern for First Access is the right concurrency solution. No distributed locks, no race conditions, deterministic outcome.
- Storing the join token in Redis (referenced by nonce) rather than in the state parameter directly is a good security decision.
- The separation between team join links (this change) and session management (future change) is clean, assuming the relationship to `sessions.join_token` is clarified.
- The error handling taxonomy (IdP-unreachable vs. IdP-error vs. user-cancelled) covers the real failure modes.

---

## Implementation Sequencing Note

If I were building this, I would implement in this order:

1. Session management layer first (`@fastify/session` + `connect-redis`, cookie config, session middleware)
2. OIDC client setup and `/auth/login` + `/auth/callback` routes (against the simulated provider)
3. First Access upsert in the callback handler
4. `GET /auth/session` endpoint + shared `AuthSession` type
5. Auth middleware on protected routes
6. Frontend auth context provider + protected route wrapper
7. Join links table migration + generation endpoint
8. Join-link-through-auth flow (state parameter, pending join Redis key, callback redirect)
9. Sign-out with confirmation
10. Token refresh hook

Each step is independently testable. The join-link-through-auth flow (step 8) is the most complex single piece and should not be attempted until steps 1-6 are solid.
