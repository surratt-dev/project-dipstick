# Implementation Review: Sign-In Change -- Security Analysis

| | |
|---|---|
| **Reviewer** | Tomas Ferreira, Senior Application Security Analyst |
| **Review Date** | 2026-06-26 |
| **Scope** | Pre-deployment security review of the sign-in implementation |
| **Files Reviewed** | `oidc-client.ts`, `token-encryption.ts`, `session-store.ts`, `middleware.ts`, `account-resolver.ts`, `audit-logger.ts`, `error-handler.ts`, `routes/auth.ts`, `routes/join-links.ts`, `app.ts`, `config.ts`, `docker/oidc/server.js` |
| **Verdict** | **Conditional Approval** -- two new findings must be addressed before production deployment |

---

## Design Finding Verification

### F-01: OIDC State Parameter -- CSRF Protection [ADDRESSED]

The implementation is correct. In `routes/auth.ts`:

- State is generated using `randomBytes(32).toString("base64url")` -- CSPRNG, sufficient entropy (line 27)
- State is stored in Redis with `STATE_PREFIX` and a 10-minute TTL (line 43)
- On callback, state is retrieved from Redis and immediately deleted (`redis.del(stateKey)` at line 83) -- single-use enforcement
- State is passed to `handleCallback` as `expectedState`, and `openid-client`'s `authorizationCodeGrant` validates it (line 110-115)

All four requirements from the design review are met: CSPRNG generation, server-side storage with TTL, verification on callback, and single-use deletion.

### F-02: Nonce Validation [ADDRESSED]

The implementation is correct. In `routes/auth.ts`:

- Nonce is generated via `oidcClient.randomNonce()` (line 28)
- Stored in Redis alongside the state (line 33)
- Passed to `handleCallback` as `expectedNonce` (line 111)
- `openid-client`'s `authorizationCodeGrant` is called with `expectedNonce` and `idTokenExpected: true`, which enforces nonce validation against the ID token's `nonce` claim

### F-03: Session Fixation Prevention [ADDRESSED]

In `routes/auth.ts` lines 139-144, the callback handler explicitly destroys the pre-authentication session and calls `request.session.regenerate()` before populating session data. This is the correct pattern -- new session ID is issued on authentication transition.

### F-04: Refresh Token Encryption at Rest [ADDRESSED]

`token-encryption.ts` implements AES-256-GCM encryption with:

- Key derived via `scryptSync` from a configurable `TOKEN_ENCRYPTION_KEY` (with fallback to `SESSION_SECRET`)
- Random 12-byte IV per encryption operation
- Authentication tag verification on decryption

`session-store.ts` encrypts all tokens (access, refresh, ID) before storing via `buildSessionData`. The `getDecryptedTokens` function decrypts on retrieval. Tokens are never stored in plaintext in Redis.

**One concern noted below as NEW-01:** the static salt in `scryptSync` weakens key derivation.

### F-05: Absolute Session Lifetime Enforcement [ADDRESSED]

`middleware.ts` implements a 90-minute absolute lifetime:

- `ABSOLUTE_LIFETIME_MS = 90 * 60 * 1000` (line 11)
- `sessionCreatedAt` timestamp is stored in the session at creation (via `buildSessionData`)
- The `onRequest` hook checks `Date.now() - sessionCreated > ABSOLUTE_LIFETIME_MS` on every request (line 33)
- On expiry, session is destroyed and an audit event is emitted

The Redis TTL of 2 hours (in `session-store.ts`) serves as idle timeout, separate from the absolute lifetime. The two-mechanism approach I recommended is correctly implemented.

### F-07: IdP Session Termination on Sign-Out [ADDRESSED]

`routes/auth.ts` logout handler (lines 254-293):

- Retrieves the ID token before destroying the session
- Calls `getEndSessionUrl` with `id_token_hint` and `post_logout_redirect_uri`
- If the IdP supports `end_session_endpoint`, returns the URL for client-side redirect
- If not supported, logs a warning and proceeds -- fails open as recommended

`oidc-client.ts` `getEndSessionUrl` correctly checks `metadata.end_session_endpoint` before building the URL.

The simulated OIDC provider has `rpInitiatedLogout: { enabled: true }`, so this is testable in development.

### F-08: Production Isolation Guard [ADDRESSED]

`config.ts` implements the guard at lines 74-79:

- `isPrivateAddress` function checks for `localhost`, `127.0.0.1`, `0.0.0.0`, and RFC 1918 ranges (10.x, 172.16-31.x, 192.168.x)
- When `NODE_ENV === "production"` and the OIDC issuer resolves to a private address, the process exits with a clear error message
- This runs at module load time -- the application cannot start in this misconfiguration

This is the exact guard I specified. The simulated provider cannot reach production.

### F-12: CORS Configuration [ADDRESSED]

`app.ts` lines 38-45:

- Production: origin restricted to `config.APP_ORIGIN` (explicitly enumerated)
- Development: restricted to `localhost:5173` and `localhost:3000`
- `credentials: true` is set (required for cookie-based auth)
- No wildcard origins

SEC-23 prohibition on wildcard origins is satisfied.

### F-15: Audit Logging Coverage [ADDRESSED]

`audit-logger.ts` defines a typed union of all required event names. Cross-referencing against my original table:

| Required Event | Audit Event Name | Present |
|---|---|---|
| OIDC authorization initiated | `auth.authorization_initiated` | Yes -- `routes/auth.ts` line 49 |
| OIDC callback received | `auth.callback_received` | Yes -- `routes/auth.ts` line 103 |
| Authentication success | `auth.success` | Yes -- `routes/auth.ts` line 168 |
| Authentication failure | `auth.failure` | Yes -- `routes/auth.ts` lines 70, 88, 200 |
| First Access account created | `auth.first_access_created` | Yes -- `routes/auth.ts` line 131 |
| Session created | `auth.session_created` | Yes -- `routes/auth.ts` line 163 |
| Session invalidated | `auth.session_invalidated` | Yes -- `middleware.ts` line 37, `routes/auth.ts` line 269 |
| Token refresh success | `auth.token_refresh_success` | Yes -- `middleware.ts` line 64 |
| Token refresh failure | `auth.token_refresh_failure` | Yes -- `middleware.ts` lines 78, 103 |
| Join link created | `join.link_created` | Yes -- `join-links.ts` line 84 |
| Join link redeemed | `join.link_redeemed` | Yes -- `join-links.ts` line 175, `routes/auth.ts` line 418 |
| Join link rejected | `join.link_rejected` | Yes -- `join-links.ts` lines 116, 133, 145; `routes/auth.ts` line 387 |

All 12 event types from my original finding are implemented. Events are structured with the `audit: true` child logger tag, making them machine-parseable and filterable.

---

## Other Design Findings -- Status

| # | Finding | Status |
|---|---|---|
| F-06 | Join endpoint rate limiting | Not implemented. Acceptable per original classification (ACCEPTABLE WITH NOTE). Should be added before scaling beyond pilot. |
| F-09 | Refresh failure revocation vs. transient | **Addressed.** `middleware.ts` lines 69-96 distinguish `invalid_grant` (immediate invalidation) from transient errors (retry with backoff, max 2 retries). Distinct audit events logged for each. |
| F-10 | Error message information leakage | **Addressed.** `error-handler.ts` returns only generic categories and user-facing messages. The raw IdP error is logged server-side only (`request.log.error` in `routes/auth.ts` line 192). No stack traces, state values, or authorization codes in client responses. Correlation IDs link client-visible errors to server logs. |
| F-11 | Secure cookie flag in local dev | **Addressed.** `app.ts` line 69: `secure: isProduction`. Development uses HTTP without the Secure flag; production is the default secure path. |
| F-13 | Pending join Redis key cleanup | **Addressed.** State key is deleted immediately after retrieval (`redis.del(stateKey)` at line 83 of `routes/auth.ts`). Join context is stored within the state, so it is cleaned up with the same deletion. |
| F-16 | Sign-out confirmation bypass | The `confirmed=true` query parameter pattern is still present (`routes/auth.ts` line 232). Per my original assessment, this is acceptable if treated as a UX hint rather than a security control. The session is destroyed regardless -- the confirmation only gates whether active sessions are checked first. Acceptable. |
| F-17 | Security headers | **Addressed.** `app.ts` registers `@fastify/helmet` with: `referrerPolicy: strict-origin-when-cross-origin`, `frameguard: deny` (X-Frame-Options), `noSniff: true` (X-Content-Type-Options), HSTS in production. CSP is explicitly deferred (`contentSecurityPolicy: false`) with a comment -- this should be tracked as a follow-up item. |
| F-18 | Join link token in server logs | **Addressed.** `app.ts` lines 23-29 customize the request serializer to redact join tokens: `url.replace(/\/api\/join\/[^/?#]+/, "/api/join/[REDACTED]")`. |

---

## New Findings

### NEW-01: Static Salt in Token Encryption Key Derivation [SHOULD FIX]

**Severity: Medium**

`token-encryption.ts` line 8 uses a hardcoded static salt for `scryptSync`:

```typescript
const SALT = "dipstick-token-encryption";
```

The purpose of a salt in key derivation is to ensure that the same passphrase produces different keys in different contexts. A static salt means: (1) if two deployments use the same `TOKEN_ENCRYPTION_KEY` or `SESSION_SECRET`, they produce identical derived keys; (2) precomputation attacks against this specific salt are possible.

For a single-deployment internal application, the practical risk is low. But the fix is trivial -- use a random salt stored alongside the encrypted data or as a configuration value.

**Recommendation:** Generate a random salt at first startup and persist it (as an environment variable or in the database), or include the salt as a prefix in the encrypted output format. This is a defense-in-depth measure, not a blocking issue.

### NEW-02: `allowInsecureRequests` in OIDC Client Configuration [MUST FIX]

**Severity: High**

`oidc-client.ts` line 15:

```typescript
execute: [client.allowInsecureRequests],
```

This disables TLS verification for all OIDC provider communication. It is required for local development (the simulated provider runs on `http://localhost:4011`), but if this code runs in production, the application will communicate with the production IdP over unverified connections. An attacker in a network position between the application and the IdP can intercept token exchanges.

This is not caught by the production isolation guard (F-08), which only blocks private-address issuers. A production IdP at a public HTTPS URL would pass the guard but still have its TLS verification disabled.

**Recommendation:** Conditionally apply `allowInsecureRequests` based on `NODE_ENV`:

```typescript
const executeOptions = config.NODE_ENV === "production"
  ? []
  : [client.allowInsecureRequests];
```

This must be fixed before production deployment.

### NEW-03: CORS Origin Empty String Fallback in Production [SHOULD FIX]

**Severity: Medium**

`app.ts` line 40:

```typescript
origin: isProduction
  ? [config.APP_ORIGIN ?? ""]
  : ["http://localhost:5173", "http://localhost:3000"],
```

If `APP_ORIGIN` is not set in production, the CORS origin falls back to an empty string `""`. The behavior of `@fastify/cors` with an empty string origin is implementation-dependent and could either block all requests (desired) or behave unexpectedly.

`APP_ORIGIN` should be a required configuration variable in production, or the application should refuse to start without it -- similar to the OIDC issuer guard.

**Recommendation:** Add `APP_ORIGIN` to the required variables when `NODE_ENV === "production"`, or add an explicit startup check.

### NEW-04: Session Secret Minimum Length Not Enforced [SHOULD FIX]

**Severity: Medium**

`config.ts` validates that `SESSION_SECRET` is present but does not enforce a minimum length or entropy requirement. A single-character session secret would pass validation. `@fastify/session` uses this secret for cookie signing/encryption -- a weak secret compromises all session integrity.

**Recommendation:** Add a minimum length check (at least 32 characters) for `SESSION_SECRET` at startup.

---

## Summary of Findings

| # | Finding | Severity | Status |
|---|---|---|---|
| F-01 | OIDC state CSRF protection | High | Addressed |
| F-02 | Nonce validation | High | Addressed |
| F-03 | Session fixation prevention | High | Addressed |
| F-04 | Refresh token encryption at rest | Medium | Addressed |
| F-05 | Absolute session lifetime | High | Addressed |
| F-07 | IdP session termination | High | Addressed |
| F-08 | Production isolation guard | Critical | Addressed |
| F-12 | CORS configuration | High | Addressed |
| F-15 | Audit logging coverage | High | Addressed |
| F-09 | Refresh failure distinction | Medium | Addressed |
| F-10 | Error message leakage | Medium | Addressed |
| F-13 | Pending join key cleanup | Medium | Addressed |
| F-17 | Security headers | Medium | Addressed |
| F-18 | Join token log redaction | Medium | Addressed |
| NEW-01 | Static salt in key derivation | Medium | SHOULD FIX |
| NEW-02 | `allowInsecureRequests` unconditional | High | MUST FIX |
| NEW-03 | Empty CORS origin fallback | Medium | SHOULD FIX |
| NEW-04 | Session secret length not enforced | Medium | SHOULD FIX |

**MUST FIX count: 1** (NEW-02). This is a blocking finding for production deployment. The fix is a one-line conditional.

**SHOULD FIX count: 3** (NEW-01, NEW-03, NEW-04). These should be addressed before production or explicitly accepted as risks.

All 9 original MUST FIX and SHOULD FIX findings from the design review have been addressed in the implementation. The implementation team has done thorough work on the security controls. The new findings are edge cases introduced during implementation, not gaps in the original design.

---

*Review complete. NEW-02 is the only blocking item. I am available for a follow-up review once it is addressed.*

-- Tomas Ferreira
