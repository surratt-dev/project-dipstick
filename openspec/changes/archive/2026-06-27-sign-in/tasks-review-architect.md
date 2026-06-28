# Tasks Review -- Solution Architect

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Change:** sign-in
**Date:** 2026-06-25
**Verdict:** Revise before implementation

---

## Summary

The task list reflects the original design but has not been updated to account for the significant revisions that followed the engineer and security reviews. Several design decisions that were added or substantially changed -- session library, OIDC protocol controls, IdP logout, security headers, audit logging, refresh token encryption, CORS, production isolation -- have no corresponding tasks. The task ordering is mostly sound for what it covers, but the gaps mean an implementer working from this task list will either miss required work or discover it mid-implementation and improvise, which is exactly how implicit architectural decisions get made.

---

## 1. Dependency Ordering Issues

### 1.1 Session library mismatch (Task 2.1)

Task 2.1 lists `@fastify/secure-session` as a dependency. The design was revised to use `@fastify/session` + `connect-redis`. This is not a cosmetic difference -- it changes the session architecture from encrypted-cookie to server-side-store. The dependency list, session store implementation (2.3), and app registration (2.6) all need to reflect `@fastify/session` and `connect-redis`.

**Action:** Update task 2.1 to install `@fastify/session`, `connect-redis`, and `@fastify/cookie`. Remove `@fastify/secure-session`.

### 1.2 Shared types before consumers (Task 1.2) -- Good

The shared types are defined in task group 1 before backend routes (group 3) and frontend (group 7) consume them. This is correct. However, the type definitions in task 1.2 need to match the revised design's `AuthSession` interface (which includes `sessionCreatedAt`, `expiresAt`, and the nested `user` object structure) rather than the flat structure currently described.

**Action:** Update task 1.2 to match the type definitions in the design's Shared Type Definitions section exactly.

### 1.3 OIDC state/nonce lifecycle has no task

The design specifies a detailed lifecycle for the OIDC `state` and `nonce` parameters (generate, store in Redis, verify on callback, delete). Tasks 3.2 and 3.3 mention state and PKCE but do not mention nonce at all. The nonce verification must be explicit -- `openid-client` does not do it automatically; it must be passed the expected nonce value. An implementer reading only the tasks would not know this.

**Action:** Expand tasks 3.2 and 3.3 to explicitly include nonce generation, Redis storage alongside state, and nonce verification against the ID token `nonce` claim.

### 1.4 Session fixation prevention has no task

The design requires that the OIDC callback handler destroy any pre-authentication session and create a fresh session with a new ID. This is not mentioned in task 3.3. Session fixation is a security control that must be explicitly implemented and tested, not left to implicit framework behavior.

**Action:** Add session fixation prevention to task 3.3 or create a sub-task under 3.3.

---

## 2. Missing Tasks (Design Revisions Not Reflected)

These are design decisions that were added or substantially revised after the tasks were written. Each requires at least one task.

### 2.1 IdP logout on sign-out (MISSING)

The design specifies that `POST /auth/logout` must redirect to the IdP's `end_session_endpoint` with `id_token_hint` and `post_logout_redirect_uri`. Task 3.4 describes application session destruction and cookie clearing but does not mention IdP session termination. Without this, a signed-out user can immediately re-authenticate without credentials because the IdP session cookie is still valid.

**Action:** Update task 3.4 to include IdP `end_session_endpoint` redirect with graceful fallback when the endpoint is not supported.

### 2.2 Production isolation guard (MISSING)

The design requires a startup validation that rejects `OIDC_ISSUER` pointing to localhost or private addresses when `NODE_ENV=production`. No task exists for this.

**Action:** Add a task under group 2 (infrastructure) or group 8 (provider config): implement the production isolation check in the application startup path. This is a safety control that prevents deploying with the simulated provider.

### 2.3 CORS configuration (MISSING)

The design specifies `@fastify/cors` with explicit origin enumeration, `credentials: true`, and environment-specific configuration. No task exists for this. Without CORS configuration, cookie-based authentication will fail on cross-origin requests from the Vite dev server.

**Action:** Add a task to install `@fastify/cors` and configure it in `app.ts` with the development and production origin lists.

### 2.4 Security headers (MISSING)

The design specifies `Referrer-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, and HSTS via `@fastify/helmet` or a custom `onSend` hook. `Referrer-Policy` is particularly important for this change because join link tokens appear in URLs.

**Action:** Add a task to install and configure `@fastify/helmet` (or equivalent) with the headers specified in the design.

### 2.5 Audit logging (MISSING)

The design specifies 12 structured audit events with required fields. No task exists for implementing the audit logger or emitting these events. This is not optional -- it satisfies SEC-13.

**Action:** Add a task to implement the structured audit event emitter (using Pino's child logger or similar) and a task to wire audit events into each auth route and the session middleware.

### 2.6 Refresh token encryption (MISSING)

The design specifies AES-256-GCM encryption of refresh tokens before Redis storage, with key derivation from `SESSION_SECRET` or `TOKEN_ENCRYPTION_KEY`. Task 2.3 (session store) mentions token storage but not encryption. Storing refresh tokens in plaintext in Redis is a security finding (F-04) that was marked as incorporated.

**Action:** Add a task for the token encryption utility (encrypt/decrypt functions) and update the session store task to use encrypted storage for refresh tokens.

### 2.7 Request log redaction (MISSING)

The design requires Fastify's request serializer to redact join link tokens from logged URLs. Without this, bearer credentials appear in server logs.

**Action:** Add a task to configure request log redaction for `/api/join/:token` routes.

### 2.8 Vite proxy update (MISSING)

The design specifies that the Vite dev server proxy must be updated to forward `/auth` routes to the backend. Without this, frontend-initiated requests to `/auth/login` and `/auth/logout` hit the Vite dev server instead of Fastify.

**Action:** Add a task to update `vite.config.ts` to proxy `/auth` alongside `/api`.

### 2.9 Role value correction (NOT REFLECTED)

The design was revised to use `'participant'` (matching the `membership_role` enum) instead of `'engineer'`. Task 5.3 still says "Engineer." The proposal's acceptance criteria also say "Engineer" but the design and the enum say `'participant'`.

**Action:** Update task 5.3 to use `'participant'`.

### 2.10 Redis namespace prefix for connect-redis (MISSING)

The design specifies that `connect-redis` must be configured with `prefix: 'dipstick:session:'`. This is not mentioned in task 2.3 or 2.6.

**Action:** Add the prefix configuration requirement to task 2.3.

---

## 3. Task Sizing

### 3.1 Task 3.3 is too large

Task 3.3 (`GET /auth/callback`) covers: PKCE code exchange, ID token validation, account resolution (First Access), session creation, session fixation prevention, pending join execution, redirect logic, and (per the design revisions) nonce verification. This is the most complex endpoint in the entire change -- it touches the OIDC client, the database, Redis (three different key patterns), and the session store. It should be at least two tasks:

- **3.3a:** Token exchange, ID token validation (signature, expiry, audience, issuer, nonce), and state/nonce verification and cleanup
- **3.3b:** Account resolution, session creation (with fixation prevention), pending join execution, and redirect

This split respects the boundary between "OIDC protocol work" and "application work" and makes each part independently testable.

### 3.2 Task 5.3 is too large

Task 5.3 (`GET /api/join/:token`) handles two entirely different flows depending on authentication state: the authenticated join flow and the unauthenticated redirect-to-auth flow. These should be separate tasks because they have different dependencies, different test scenarios, and different failure modes.

### 3.3 Tasks 1.2 + 1.3 + 1.4 could be merged

Defining types, re-exporting them, and verifying the build is one unit of work. Three separate tasks for this creates tracking overhead without adding clarity.

**Action:** Merge 1.2, 1.3, and 1.4 into a single task.

---

## 4. Testability

### 4.1 Task 2.3 (session store) -- needs test criteria

The session store is a critical piece of infrastructure. The task describes the functions but not how to verify them. Add: test that session creation returns a valid session ID, test that TTL refresh works, test that `destroySession` makes subsequent `getSession` return null, test that expired sessions are not retrievable.

### 4.2 Task 2.4 (auth middleware) -- needs test criteria

The middleware has branching logic (skip public routes, check session validity, trigger token refresh). Each branch should be testable. Add: test that public routes bypass validation, test that missing cookie returns 401, test that expired session returns 401, test that valid session passes through, test that near-expiry token triggers refresh.

### 4.3 Tasks 8.1-8.2 -- not independently testable as written

Task 8.1 (update OIDC config) and 8.2 (verify test accounts) are configuration and manual verification, not independently testable units. They should be merged into a single task with a clear done condition: all four test accounts complete sign-in including token refresh.

---

## 5. Structural Recommendation

The current task grouping works but needs a new group to accommodate the missing infrastructure tasks. I recommend:

- **New Group 2.5 (or new Group between 2 and 3):** Cross-cutting infrastructure -- CORS, security headers, request log redaction, production isolation guard, audit logging setup. These are Fastify plugins and hooks that should be registered before the auth routes are built, because the routes depend on them (CORS especially -- without it, nothing works from the frontend dev server).

- **Move Vite proxy update** to group 7 (Frontend Auth Integration) since it is a frontend build concern.

- **Add refresh token encryption** as a sub-task of the token refresh implementation, which currently lives partly in 2.2 (OIDC client `refreshToken` function) and partly in 2.4 (middleware refresh trigger). The encryption utility should be built before either consumer.

---

## 6. Risks if Tasks Are Implemented As-Is

1. **Wrong session library installed.** The implementer installs `@fastify/secure-session`, builds the session store against it, and discovers it cannot do server-side session storage. Rework cost: half a day minimum.

2. **No CORS configuration.** The frontend dev server cannot send authenticated requests to the backend. The implementer discovers this when testing the auth context provider in group 7 and has to backtrack to add CORS. This is a dependency that should be resolved before any frontend auth work begins.

3. **Join link tokens in logs.** Without the redaction task, bearer credentials accumulate in server logs from day one of testing. The longer this goes unaddressed, the more logs need to be rotated.

4. **No audit events.** SEC-13 compliance requires audit logging. If it is not in the task list, it will not be built until a security review flags it again, at which point it must be retrofitted across all routes -- significantly more expensive than building it in.

5. **Role mismatch.** Using `'engineer'` instead of `'participant'` will cause a PostgreSQL enum violation at runtime. This is a hard failure, not a warning.
