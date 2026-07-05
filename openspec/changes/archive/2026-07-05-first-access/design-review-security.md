# Security Review: First Access
**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Change:** first-access
**Date:** 2026-07-05
**Files Reviewed:** `account-resolver.ts`, `routes/auth.ts`, `audit-logger.ts`, `middleware.ts`, `session-store.ts`, `oidc-client.ts`, `app.ts`, `error-handler.ts`

---

## Summary

The implementation is structurally sound in its broad strokes: parameterized queries, session-side token encryption, PKCE with nonce validation, and a defense-in-depth session middleware that handles token refresh and absolute lifetime enforcement. These are not incidental choices — they reflect deliberate attention to the threat model.

That said, I have seven findings that require action before this change closes, one deferred item from the broader application configuration that I am formally flagging, and several informational notes. The findings are ordered by risk. Nothing here is a blocking production incident today, but findings 1, 2, 4, and 5 will become active vulnerabilities under specific conditions.

I reviewed each of the six questions posed in the review scope. My answers are integrated into the findings below, with the section heading calling out the relevant question number.

---

## Finding 1 — Missing Claims Validation: Empty Sub/Iss Reaches Account Resolution (High) [Question 2]

**Location:** `routes/auth.ts`, lines 117–128

**Observation:** The callback handler checks `if (!claims)` — guarding against a null claims object — but does not validate that `claims.sub` and `claims.iss` are non-empty strings before passing them to `resolveOrCreateAccount`. The `openid-client` library enforces the structural presence of `sub` (it is required by the OIDC spec), but the library's behavior on an empty-string `sub` is not guaranteed to produce a rejection. An empty-string `sub` is syntactically valid JSON; it may pass library validation while failing the application's identity requirement.

**Attack scenario:** A misconfigured or adversarial identity provider that returns `sub: ""` or `iss: ""` would cause the upsert to create or resolve a user record keyed on `("", "")`. Any authentication that produces the same empty pair would then resolve to that account, regardless of which identity provider issued it. This is an identity confusion vulnerability: two unrelated principals can collide into a single account record if both their IDPs produce empty required claims.

**Validation gaps beyond empty sub/iss:**
- The `name` and `email` claims are cast with `as string | undefined` type assertions. If an IDP returns a non-string value for either claim (e.g., an array or numeric), the TypeScript cast hides the mismatch and the raw value is written to the database.
- No maximum length validation is applied to any claim before the database write. An IDP returning a pathologically long `sub` string would cause the INSERT to fail with a database-level error rather than an application-level one, and that error would propagate through the generic catch block without identifying the cause.
- There is no application-layer validation of the `aud` claim or `azp` (authorized party) claim. Both are validated by `openid-client` during `authorizationCodeGrant`, but this relies entirely on the library configuration being correct and complete. This is acceptable as a current posture, but must be explicitly verified when a new identity provider configuration is activated.

**Required action:** Add an explicit application-level guard before calling `resolveOrCreateAccount`:

```typescript
if (!claims.sub || typeof claims.sub !== "string" || claims.sub.trim() === "") {
  // log missing_claim: sub, no PII, then redirect to error
}
if (!claims.iss || typeof claims.iss !== "string" || claims.iss.trim() === "") {
  // log missing_claim: iss, no PII, then redirect to error
}
```

This is the Capability 5 gap already acknowledged in the design. I am elevating its severity: the consequence of skipping this check is not just "a failed authentication" — it is a potential identity collision.

---

## Finding 2 — Session Destroy Error Is Silently Swallowed (Medium) [Question 6]

**Location:** `routes/auth.ts`, lines 139–144

**Observation:** The session fixation prevention sequence is:

```typescript
await new Promise<void>((resolve) => {
  request.session.destroy(() => resolve());
});
await request.session.regenerate();
```

The callback passed to `destroy()` always calls `resolve()` regardless of whether the destruction succeeded. If the Redis `DEL` operation fails (e.g., transient Redis unavailability), the old session is not removed from the store, but the code proceeds to `regenerate()` and creates a new session. At that point, two sessions exist simultaneously in Redis: the pre-authentication session with the old ID, and the new post-authentication session. The pre-auth session would eventually expire via TTL, but during the window between its creation and expiry, it is still valid in the store.

A secondary issue: the `destroy()` → `regenerate()` sequence is redundant. `session.regenerate()` in `@fastify/session` is sufficient for session fixation prevention on its own — it atomically invalidates the old session in the store and issues a new session ID. Calling `destroy()` first attempts to delete the session from Redis, then `regenerate()` attempts to delete it again (finding nothing) and creates the new one. The redundancy is harmless in the happy path but masks the error handling gap described above.

**Required action:**

Replace the two-step pattern with a single `regenerate()` call and handle its failure explicitly:

```typescript
try {
  await request.session.regenerate();
} catch (err) {
  // log the failure, do not proceed to populate session
  throw err;
}
```

If a separate `destroy()` call is retained for belt-and-suspenders reasons, the error must be handled rather than discarded:

```typescript
await new Promise<void>((resolve, reject) => {
  request.session.destroy((err) => (err ? reject(err) : resolve()));
});
```

**On correctness:** Setting the question aside about error handling, the session fixation prevention goal is correctly achieved in the happy path. The pre-auth session is removed, a new session ID is issued, and the new session is populated only after account resolution succeeds. The ordering satisfies the "no account, no session" constraint. The implementation is conceptually correct; the error handling is not.

---

## Finding 3 — Content Security Policy Is Explicitly Disabled (High, Deferred) [Informational]

**Location:** `app.ts`, line 49

**Observation:** The application registers `@fastify/helmet` with `contentSecurityPolicy: false`. A comment reads "Deferred to a separate change." This is a deliberate choice, not an oversight, and I respect that it is documented. I am flagging it here because a design review that does not surface it would be incomplete.

Without a Content Security Policy, any cross-site scripting vulnerability — in the application's own code, in a dependency, or introduced by a future contributor — has no mitigation layer. The session cookie is `httpOnly: true`, which protects the session identifier from direct script access. But CSP is the control that limits what a script can do if it executes at all. Its absence means that XSS = full session and data access.

This is not a first-access concern specifically. It is an application-wide posture that the "separate change" must close before production. I will track this at the application level.

---

## Finding 4 — `auth.first_access_created` Is Missing Source IP and Correlation ID (Medium) [Question 3]

**Location:** `routes/auth.ts`, lines 131–135; `audit-logger.ts`

**Observation:** The `first_access_created` event emits:

```typescript
{
  userId: user.id,
  oidcSubject: user.oidcSubject,
  oidcIssuer: user.oidcIssuer,
}
```

Every other security-relevant event in the callback handler includes `sourceIp`. `auth.authorization_initiated`, `auth.callback_received`, `auth.failure`, `auth.success`, and `auth.session_created` all carry it. `first_access_created` does not.

It also lacks a `correlationId`. When an incident requires reconstructing the sequence of events around an account creation — was the creation preceded by anomalous callback activity? what IP triggered it? is there a cluster of new accounts from an unusual subnet? — the absence of source IP and correlation ID makes those queries impossible without joining across multiple events on timing alone. Timing joins are imprecise and error-prone.

**Required fields for `auth.first_access_created`:**

| Field | Rationale |
|---|---|
| `userId` | Present. Correct. |
| `oidcSubject` | Present. Correct. |
| `oidcIssuer` | Present. Correct. |
| `sourceIp` | Missing. Required for incident investigation and anomaly detection. |
| `correlationId` | Missing. Required to tie this event to the specific callback invocation. |

The `correlationId` already exists at the top of the callback handler. `request.ip` is already used by surrounding events. Both are available; neither is being passed to this event.

**No display name, email, or other PII should be added.** The current exclusion of PII is correct.

**Secondary observation on the audit logger itself:** `emitAuditEvent` writes at `info` level via a child logger. If the application's log level is ever raised above `info` in production (to `warn` or `error`) — a common response to log volume concerns — all audit events would be silently suppressed. There is no separate audit channel, no guaranteed minimum log level for audit events, and no delivery confirmation. For an application where auditability is treated as a security control, audit events should be routed to a channel that cannot be silenced by an operational log-level change. This is a structural issue with the audit logger architecture, not limited to this event.

---

## Finding 5 — `executeJoinFlow` Audit Events Use Hardcoded Source IP (Medium) [Question 3]

**Location:** `routes/auth.ts`, lines 384–390

**Observation:** The `join.link_rejected` events emitted inside `executeJoinFlow` use the literal string `"callback"` as the `sourceIp` value:

```typescript
emitAuditEvent(logger, "join.link_rejected", {
  sourceIp: "callback",
  linkId: null,
  reason: "not_found",
});
```

The actual client IP (`request.ip`) is available in the callback handler but is not passed down to `executeJoinFlow`. The result is that any join link abuse that occurs during the authentication callback — invalid tokens, expired links, revoked links — produces audit events that cannot be attributed to a source address. If join links are being systematically probed or if a specific IP is responsible for a pattern of rejected attempts, this data is unrecoverable.

`join.link_redeemed` has the same gap — it correctly logs `userId` and `teamId` and `linkId`, but also lacks source IP.

**Required action:** Thread `sourceIp` (or the full `request.ip` value) from the callback handler into `executeJoinFlow` as a parameter. The function signature should be updated to `executeJoinFlow(userId, token, logger, sourceIp)`.

---

## Finding 6 — Correlation ID Exposed in Redirect URL (Low) [Question 4]

**Location:** `routes/auth.ts`, lines 206–208

**Observation:** On authentication failure, the callback handler redirects to:

```
/auth/error?category=...&message=...&correlationId=<uuid>
```

The `correlationId` is a UUID with no semantic meaning — it maps to a server-side log entry, nothing more. However, its presence in the URL means it will appear in:
- Browser navigation history
- The `Referer` header if the user clicks a link from the error page to an external resource
- Frontend server access logs, if the frontend is served separately
- Any monitoring tool that captures full request URLs

The correlation ID is not PII and not a secret. Its exposure does not enable an attacker to do anything directly. But it is unnecessary URL-level information that could assist someone trying to determine whether a specific authentication attempt succeeded or failed from indirect signals. The lower-risk pattern is to store the correlation ID server-side and expose only the session (for lookup) — but for an internal application at this stage, this is an informational finding, not a requirement.

**Account enumeration assessment (direct answer to Question 4):** The error path does not distinguish between new users, returning users, or users whose account creation failed at the database level. All failures route through `mapAuthError` to one of three generic categories. The user-visible message does not vary based on account existence. There is no timing-based enumeration risk that would be practically exploitable for an internal application behind a corporate identity provider. Account enumeration is not a current risk.

---

## Finding 7 — Session TTL in Redis Outlives Application Enforcement by 30 Minutes (Low)

**Location:** `session-store.ts` line 5; `middleware.ts` line 12

**Observation:** The Redis session store sets a TTL of `SESSION_TTL_SECONDS = 7200` (2 hours). The application enforces an absolute session lifetime of `ABSOLUTE_LIFETIME_MS = 5400000` (90 minutes). The 30-minute gap means that a session the application has logically expired — and attempted to destroy via `request.session.destroy()` — may remain in Redis if the destroy call fails silently.

In `middleware.ts`, when an absolute timeout is detected:

```typescript
request.session.destroy();  // no callback, no await, no error handling
```

This is fire-and-forget. A Redis connectivity blip at this moment leaves an expired session in the store for up to 30 additional minutes. If an attacker has captured the session cookie (a higher-order threat), they would find a session the application considers invalid but the store considers live.

This is a defense-in-depth gap, not a direct vulnerability: the middleware would reject requests using this session on the next attempt. But the session data remains in Redis for longer than the policy intends, which is a data minimization concern and a potential incident scope widener.

**Required action:** Either align the Redis TTL with the application lifetime (90 minutes), or handle the destroy error and log a warning when it fails so the gap is observable.

---

## Deferred Decisions That Must Not Stay Deferred

The design explicitly defers two items with security implications. I am recording them here so they have a security reviewer's fingerprint on them.

**`isNewUser` race condition:** The SELECT-before-upsert pattern can emit `auth.first_access_created` twice for the same new user under concurrent load. The proposal correctly documents this as a hard constraint on future work. Any feature that consumes `isNewUser` — downstream provisioning, onboarding triggers, notification dispatch — must not be built until the race is resolved. The code comment requirement in tasks.md is the minimum; I want to see a design review gate on any consumer of this flag before it ships.

**No-team redirect is client-side (Capability 4 gap):** The proposal documents this as a confirmed gap. Until the server-side redirect is implemented, the team membership routing decision is made by `AuthenticatedLanding` after a round-trip to `/auth/session`. This means a user always lands at `/` and then gets redirected — the intermediate landing is brief and produces no user-visible artifact, but it is a deviation from the specified behavior. More relevant to my scope: the client-side routing relies on `/auth/session` returning team memberships, which it does correctly. The gap is behavioral, not a security regression. When the server-side redirect is implemented, confirm that the membership query uses live database state (not session cache) — the proposal's implementation notes are explicit on this, and AC-4c is the acceptance criterion that verifies it.

---

## Items That Are Implemented Correctly

I want to be explicit about what I reviewed and found sound, so these assessments are on record.

**SQL injection (Question 1):** Both queries in `account-resolver.ts` use node-postgres parameterized query syntax (`$1`, `$2`, ...) with values passed as the array argument to `db.query()`. There is no string interpolation of claim values into query text at any point in the reviewed files. The upsert is safe from SQL injection.

**PKCE + nonce + state:** The OIDC flow correctly generates a PKCE code verifier, stores it with the state in Redis (single-use, 10-minute TTL), and passes `expectedNonce`, `expectedState`, and `pkceCodeVerifier` to `authorizationCodeGrant` with `idTokenExpected: true`. The library handles signature, expiry, audience, issuer, and nonce validation on the ID token. State is consumed on first use and deleted from Redis before tokens are exchanged.

**Session cookie hardening:** `httpOnly: true`, `secure: isProduction`, `sameSite: "strict"`. The `sameSite: "strict"` setting is the correct choice for a first-party application. Token storage in session is encrypted via `token-encryption.ts` before being written to Redis. Tokens are not logged.

**Session fixation intent (Question 6):** The intent is correct — destroy the pre-auth session, issue a new session ID after account resolution — and achieves session fixation prevention in the happy path. The error handling gap is documented in Finding 2.

**Error response uniformity:** `mapAuthError` produces generic messages across all failure categories. The user-visible error does not distinguish between "account does not exist," "account creation failed," "database error," or "IDP error." No information useful for account enumeration or reconnaissance is present in error responses (subject to the correlationId URL note in Finding 6).

**Token refresh and revocation handling:** The middleware correctly detects token expiry, attempts refresh with retry, and invalidates the session on `invalid_grant` (token revocation signal). The session lifetime is enforced server-side against the `sessionCreatedAt` timestamp, not against the client-sent cookie. The `rolling: true` session configuration extends the sliding TTL on each request, and `session.touch()` in the middleware appears to be a belt-and-suspenders call. It is redundant but harmless.

**Redirect URI is fixed:** The OIDC redirect URI is configured via `config.OIDC_REDIRECT_URI`, which comes from the application configuration — not derived from the incoming request. There is no open redirect vulnerability in the OIDC flow itself.

**`allowInsecureRequests` scope:** The non-production OIDC client configuration includes `client.allowInsecureRequests`, permitting HTTP connections to the IDP. This is conditional on `config.NODE_ENV !== "production"` and is acceptable for local development. The production path does not include this option. Verify that the production deployment's `NODE_ENV` is correctly set.

---

## Required Actions Before This Change Closes

| # | Finding | Severity | Action |
|---|---|---|---|
| 1 | Empty `sub`/`iss` reaches `resolveOrCreateAccount` | High | Add explicit non-empty string validation before calling `resolveOrCreateAccount`; reject with no-PII log entry naming the missing claim |
| 2 | Destroy error silently swallowed in session fixation sequence | Medium | Replace `destroy()` → `regenerate()` with `regenerate()` alone, or propagate destroy errors |
| 4 | `auth.first_access_created` missing `sourceIp` and `correlationId` | Medium | Add both fields to the event; pass `correlationId` from the top of the callback handler |
| 5 | `executeJoinFlow` audit events hardcode `sourceIp: "callback"` | Medium | Thread actual client IP into `executeJoinFlow` and use it in all emitted events |
| 7 | Redis TTL outlives application session enforcement | Low | Align Redis TTL to 90 minutes, or handle and log destroy failures in absolute-timeout enforcement |

Findings 3 and 6 are informational and do not block this change. Finding 3 (CSP) must close before production regardless of change scope.

---

*Review conducted by Tomás Ferreira, Information Security. Questions on specific findings can be directed to me directly. I am available during implementation of the missing-claims validation (Capability 5) if the team wants a review of the exact guard expression before it is merged.*
