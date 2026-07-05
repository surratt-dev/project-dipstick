# Design Review: Sign-In Change -- Security Analysis

| | |
|---|---|
| **Reviewer** | Tomas Ferreira, Senior Application Security Analyst |
| **Review Date** | 2026-06-25 |
| **Documents Reviewed** | `sign-in/design.md`, `sign-in/proposal.md`, `High-Level Architecture.md`, `BRD.md` |
| **Verdict** | **Conditional Approval** -- implementation may proceed, but the findings marked MUST FIX are blocking for any deployment beyond local development |

---

## Summary

The design is structurally sound. The decision to use `openid-client` (a certified RP implementation), server-side session storage in Redis, and encrypted cookies via `@fastify/secure-session` reflects a security-conscious approach. The join link token design, the `INSERT ... ON CONFLICT` concurrency strategy, and the decision to store join context in Redis rather than passing it through the IdP are all correct choices.

That said, I have findings. Several are gaps where the design is silent on controls that are required by the security requirements (SEC-1 through SEC-33) and that cannot be deferred to "implementation detail." A control that is not specified in the design is a control that will be implemented inconsistently or not at all.

---

## Findings

### F-01: OIDC State Parameter -- CSRF Protection [MUST FIX]

**Severity: High**

The design states that the OIDC `state` parameter carries a nonce referencing the pending join context in Redis. This is good -- but the design does not explicitly state that the `state` parameter is also used as a CSRF token for the authorization callback.

The OIDC specification requires that the `state` parameter be an opaque, unguessable value that the client verifies on callback to prevent cross-site request forgery against the `/auth/callback` endpoint. If the `state` value is predictable or if the callback handler does not verify it against the value sent in the authorization request, an attacker can craft a callback URL that forces a victim's browser to complete authentication with the attacker's authorization code.

The design must explicitly state:
1. The `state` parameter is generated using a CSPRNG and is unique per authorization request
2. The `state` value is stored server-side (Redis, with a short TTL) before the redirect to the IdP
3. On callback, the `state` parameter returned by the IdP is compared to the stored value; a mismatch aborts the flow
4. The `state` value is single-use -- it is deleted from Redis after successful verification

`openid-client` handles this if configured correctly, but "the library does it" is not a design specification. The behavior must be stated so it can be verified in code review.

**Recommendation:** Add an explicit CSRF-via-state section to the design. Document the `state` lifecycle: generation, storage, verification, deletion.

---

### F-02: Nonce Validation in ID Token [MUST FIX]

**Severity: High**

The architecture document (Section 6.1, Review Note) requires nonce verification "to prevent replay attacks in the authorization code flow." The design document does not mention the OIDC `nonce` parameter at all.

The `nonce` is sent in the authorization request and embedded in the ID token by the IdP. On callback, the backend must verify that the `nonce` in the ID token matches the value it sent. Without this, an attacker who obtains an ID token (from logs, from a compromised IdP response, from a previous session) can replay it.

`openid-client` supports nonce validation, but it must be explicitly enabled -- it is not automatic in all code paths.

**Recommendation:** Add nonce handling to the design. State that a nonce is generated per authorization request, stored alongside the state in Redis, and verified against the `nonce` claim in the returned ID token.

---

### F-03: Session Fixation Prevention [MUST FIX]

**Severity: High**

The design does not address session fixation. When a user completes the OIDC callback and transitions from unauthenticated to authenticated, the session ID must change. If the same session ID that was assigned before authentication is carried forward into the authenticated session, an attacker who can set a session cookie (via a subdomain, via an XSS on a related application, via a network-level attack) can fixate the session and then wait for the victim to authenticate.

`@fastify/secure-session` uses encrypted cookies, which makes fixation harder than with server-side-only session IDs, but the design should explicitly require that a new session is created on authentication success and any pre-authentication session data is migrated to the new session ID.

**Recommendation:** State that the OIDC callback handler creates a fresh session after successful authentication. The pre-auth session (if any) is destroyed.

---

### F-04: Token Storage in Redis -- Encryption at Rest [SHOULD FIX]

**Severity: Medium**

The design stores refresh tokens in the Redis session. Refresh tokens are credentials (SEC-5: "they must be treated as credentials"). Redis, as configured in this architecture, does not encrypt data at rest. If Redis is compromised -- through a misconfigured network policy, a container escape, or lateral movement within the Kubernetes cluster -- all refresh tokens are exposed in plaintext.

This is the "internal tool" threat model at work. An attacker who has reached Redis has not just broken one session -- they have every active user's refresh token, which can be used to obtain new access tokens independently of the application.

**Recommendation:** Either encrypt refresh tokens before storing them in Redis (using a key from the application's secrets), or document this as an accepted risk with a named risk owner. I would prefer encryption. The implementation cost is low -- a symmetric encrypt/decrypt wrapper around the refresh token value before it goes into Redis.

---

### F-05: Absolute Session Lifetime Enforcement [MUST FIX]

**Severity: High**

The design specifies two different session lifetimes: a 2-hour TTL on the Redis session key (from the design, under session management) and a 90-minute absolute maximum (from the token refresh section, referencing SEC-4). These are contradictory.

The architecture document says 2 hours. SEC-4 says 90 minutes. The design references both without reconciling them.

More critically, the sliding-window TTL refresh on the Redis key means the 2-hour TTL resets on every request. This is correct for idle timeout but does not enforce an absolute maximum. A user who makes a request every minute will never hit the TTL. The 90-minute absolute maximum from SEC-4 requires a separate mechanism: a `session_created_at` timestamp checked on every request, independent of the TTL.

**Recommendation:** Reconcile the two lifetime values. Implement the absolute session lifetime as a timestamp check in the `onRequest` hook, separate from the Redis TTL. The Redis TTL handles idle timeout (2 hours or whatever value is chosen). The `session_created_at` check enforces the 90-minute hard limit regardless of activity.

---

### F-06: Join Link Enumeration Resistance [ACCEPTABLE WITH NOTE]

**Severity: Low**

The design uses 32 bytes of cryptographic randomness (base64url-encoded, 43 characters) for join link tokens. This is sufficient entropy to prevent brute-force enumeration. At 256 bits of entropy, an attacker making 1 billion requests per second would need approximately 10^59 years to have a 50% chance of guessing a valid token.

However, the design does not specify rate limiting on the `POST /api/join/:token` endpoint. Without rate limiting, an attacker who knows the token format could attempt automated enumeration at whatever rate the backend can handle. While the entropy makes success astronomically unlikely, rate limiting is a defense-in-depth measure that also protects against denial-of-service on the join flow.

**Recommendation:** Add rate limiting on the join endpoint. IP-based rate limiting with a reasonable threshold (e.g., 10 attempts per minute per IP) is sufficient. This also protects against accidental load from misconfigured clients.

---

### F-07: Sign-Out -- IdP Session Termination [MUST FIX]

**Severity: High**

The design specifies that sign-out invalidates the application session (Redis) and clears the session cookie. It does not mention terminating the session at the identity provider.

If the application session is destroyed but the IdP session remains active, the user can immediately re-authenticate by visiting the application -- the IdP will issue a new token without prompting for credentials, because the IdP session cookie is still valid. This undermines the sign-out action: the user believes they have signed out, but anyone who accesses their browser can re-enter the application with a single click.

The architecture document (Section 8.2) states: "Session invalidated on explicit logout; logout propagated to identity provider." The design must implement this.

For OIDC, this means redirecting the user to the IdP's `end_session_endpoint` (discovered via `.well-known/openid-configuration`) with the `id_token_hint` and `post_logout_redirect_uri` parameters. The simulated OIDC provider (`node-oidc-provider`) supports this endpoint.

**Recommendation:** Add IdP logout to the sign-out flow. After invalidating the application session, redirect the user to the IdP's end_session_endpoint. Handle the case where the IdP does not support this endpoint (fail open with a log warning -- the application session is already destroyed, so the user is signed out of the application regardless).

---

### F-08: Simulated OIDC Provider -- Production Isolation [MUST FIX]

**Severity: Critical**

The design specifies that the simulated OIDC provider runs on port 4011 in Docker Compose. The design does not specify any mechanism to prevent this provider from being used in production.

The simulated provider has pre-seeded test accounts with known credentials. If it is accidentally deployed to production -- or if the production application is misconfigured to point to a development instance running the simulated provider -- any person who knows the test account credentials can authenticate as any test user.

This is not a theoretical risk. I have seen it happen. A Docker Compose file that works in development gets deployed to a staging environment with minimal modifications, and the simulated provider comes along for the ride.

**Recommendation:** The design must specify:
1. The application validates the `OIDC_ISSUER` environment variable at startup and refuses to start if it points to `localhost`, `127.0.0.1`, or any address in the `node-oidc-provider`'s known configuration when `NODE_ENV=production`
2. The simulated provider's Docker service is excluded from any production-targeted Docker Compose file or Kubernetes manifest
3. The simulated provider configuration is documented as development-only, with a clear warning in the Docker Compose file

---

### F-09: Refresh Token Revocation Handling [SHOULD FIX]

**Severity: Medium**

The design correctly states that if the refresh token exchange fails, the session is invalidated and the user is redirected to re-authenticate. This is the right behavior.

What is not addressed: how does the application know the difference between "the refresh token was revoked because the user's access was revoked at the IdP" versus "the IdP is temporarily unreachable"? Both result in a failed refresh, but they have very different security implications.

If the user's access has been revoked at the IdP (e.g., the user has been terminated), the application should invalidate the session immediately and not retry. If the IdP is temporarily unreachable, a brief retry window before session invalidation is reasonable.

**Recommendation:** Distinguish between revocation (HTTP 400 with `invalid_grant`) and transient failure (HTTP 5xx, network timeout). On revocation, invalidate immediately. On transient failure, retry with a short backoff (2-3 attempts over 30 seconds) before invalidating. Log both cases with distinct event types for incident response.

---

### F-10: Error Message Information Leakage [SHOULD FIX]

**Severity: Medium**

The design specifies plain-language error messages that distinguish between "IdP unreachable," "IdP error," and "user cancelled." This is appropriate for user-facing messages.

The design does not specify what the error responses contain in their response bodies. API error responses (particularly on `/auth/callback`) must not include:
- The raw error from the IdP (which may contain internal configuration details)
- The state or nonce values
- The authorization code
- Stack traces

The proposal mentions logging "error codes returned by the identity provider" -- this is correct for server-side logs. The concern is that these details must not appear in the HTTP response body sent to the client.

**Recommendation:** Add a specification that authentication error responses return only: a user-facing message, a generic error category (e.g., `provider_unavailable`, `authentication_failed`, `session_expired`), and a correlation ID that maps to the detailed server-side log entry. No IdP-specific error details in the response body.

---

### F-11: Cookie Security Attributes -- Local Development [ACCEPTABLE WITH NOTE]

**Severity: Low**

The design correctly specifies HttpOnly, Secure, and SameSite=Strict for session cookies. However, the `Secure` attribute prevents the cookie from being sent over non-HTTPS connections. In local development (`http://localhost:3000`), this means the cookie will not be set.

This is a known issue with every OIDC development setup. The design should document the local development exception: when `NODE_ENV !== 'production'`, the `Secure` attribute may be omitted. This must be a configuration-driven exception, not a code path that can be accidentally left in production.

**Recommendation:** Document the local development cookie configuration. Explicitly state that the `Secure` flag is conditionally applied based on environment, and that the production configuration is the default -- development is the exception that must be explicitly enabled.

---

### F-12: CORS Configuration [MUST FIX]

**Severity: High**

The design does not mention CORS at all. The architecture document (Section 8.2) requires explicitly enumerated origins. SEC-23 prohibits wildcard origins.

The sign-in flow involves cross-origin redirects (application to IdP and back). The `/auth/callback` endpoint receives a redirect from the IdP's domain. The frontend SPA makes API requests to the backend. All of these interactions have CORS implications.

If CORS is not configured, browsers will block cross-origin requests from the frontend. If CORS is configured with a wildcard (`*`), any page on the internet can make authenticated requests to the API using the user's session cookie.

**Recommendation:** Add CORS configuration to the design. Specify the allowed origins (the application's own origin), allowed methods, allowed headers, and that `credentials: true` is set (required for cookie-based authentication). In development, the Vite dev server origin must be explicitly listed. In production, only the deployed application origin.

---

### F-13: Pending Join Redis Key -- Cleanup and Abuse [SHOULD FIX]

**Severity: Medium**

The design stores pending join context in Redis with a `pending-join:{randomNonce}` key and a 10-minute TTL. This is correct, but the design does not address:

1. **Cleanup after use:** The pending join key should be deleted after successful retrieval on callback, not left to expire. A key that persists after use is a key that can be replayed if the nonce is leaked.
2. **Abuse via repeated authorization requests:** An attacker can flood the application with authorization initiation requests, each creating a `pending-join:*` key in Redis. With a 10-minute TTL, sustained traffic could consume meaningful Redis memory. Rate limiting on the authorization initiation endpoint (`GET /auth/login` or whatever triggers the redirect) mitigates this.

**Recommendation:** Delete the `pending-join:*` key immediately after successful retrieval. Add rate limiting on the authorization initiation endpoint.

---

### F-14: First Access Race Condition -- Profile Data Integrity [ACCEPTABLE]

**Severity: Low**

The `INSERT ... ON CONFLICT DO UPDATE` pattern for First Access is well-chosen. It handles the race condition where two concurrent callbacks for the same IdP subject both attempt account creation. One inserts, the other updates display name and email.

There is a minor data integrity consideration: if two concurrent requests carry different display names (unlikely but possible if the IdP claims change between the two token issuances), the final display name is whichever UPDATE executed last. This is acceptable because the design already states that display name and email are updated on every sign-in. The "last write wins" behavior is correct for profile data that is always refreshed from the IdP.

No action required.

---

### F-15: Audit Logging Coverage [MUST FIX]

**Severity: High**

The architecture document (Section 8.3) and SEC-13 require audit logging for authentication success, authentication failure, session creation, session invalidation, and access control denials. The design does not specify audit log events for the sign-in change.

The following events must be logged as structured audit entries (not debug logs -- audit logs per SEC-12):

| Event | Required Fields |
|---|---|
| OIDC authorization initiated | timestamp, source IP, join context (if any), state nonce |
| OIDC callback received | timestamp, source IP, state nonce, success/failure |
| Authentication success | timestamp, user ID, IdP subject, new/returning user |
| Authentication failure | timestamp, source IP, failure reason category, IdP error code (server-side only) |
| First Access account created | timestamp, user ID, IdP subject |
| Session created | timestamp, user ID, session ID |
| Session invalidated (sign-out) | timestamp, user ID, session ID, reason (explicit logout vs. expiry) |
| Token refresh success | timestamp, user ID, session ID |
| Token refresh failure | timestamp, user ID, session ID, failure reason |
| Join link created | timestamp, user ID, team ID, link expiry |
| Join link redeemed | timestamp, user ID, team ID, link ID |
| Join link rejected (expired/revoked) | timestamp, source IP, link ID, rejection reason |

**Recommendation:** Add the audit event table to the design. Implementation must treat these as structured, machine-parseable log entries with the fields specified, not ad hoc `console.log` calls.

---

### F-16: The `confirmed=true` Query Parameter on Sign-Out [SHOULD FIX]

**Severity: Medium**

The design specifies that the sign-out confirmation flow uses `POST /auth/logout?confirmed=true` to proceed after confirmation. This query parameter is trivially forgeable. An attacker (or a malicious script) can call `POST /auth/logout?confirmed=true` directly, bypassing the confirmation prompt entirely.

If the confirmation prompt is a UX convenience (not a security control), this is acceptable. But the design frames it as protecting users from accidentally leaving active sessions. If that protection is meaningful, it should not be bypassable with a query parameter.

**Recommendation:** Either accept that the confirmation is purely a UX hint (document this explicitly) or implement the confirmation as a two-step flow with a server-generated confirmation token that must be presented with the second request.

---

### F-17: Missing `Referrer-Policy` and Security Headers [SHOULD FIX]

**Severity: Medium**

The design does not mention HTTP security headers beyond the cookie attributes. The following headers are standard for any web application handling authentication:

- `Strict-Transport-Security` (HSTS) -- ensures the browser always uses HTTPS after the first visit
- `X-Content-Type-Options: nosniff` -- prevents MIME type sniffing
- `X-Frame-Options: DENY` -- prevents the application from being embedded in iframes (clickjacking protection)
- `Referrer-Policy: strict-origin-when-cross-origin` -- prevents the full URL (including join link tokens) from being sent as a referrer to external sites
- `Content-Security-Policy` -- restricts script sources, preventing XSS

The `Referrer-Policy` header is particularly important here: join link tokens appear in URLs, and without a restrictive referrer policy, those tokens may be leaked to external sites via the `Referer` header if any page that handles join links contains external resources (analytics scripts, CDN-hosted fonts, etc.).

**Recommendation:** Add a security headers section to the design. At minimum, specify `Referrer-Policy` and `X-Frame-Options`. A full CSP can be deferred to a later change but should be noted as a gap.

---

### F-18: Join Link Token in Server Logs [SHOULD FIX]

**Severity: Medium**

The join link token appears in the URL path (`/api/join/:token`). Fastify's default request logging logs the full request URL, which means join link tokens will appear in server logs. SEC-20 requires that secrets not appear in logs. While join link tokens are not secrets in the traditional sense (they are distributed to team members), they are bearer credentials -- anyone who possesses the token can use it to join the team.

If server logs are stored in a centralized logging system accessible to operations staff, those staff can extract valid join link tokens from the logs and use them to join arbitrary teams.

**Recommendation:** Either redact the token from request logs (log the path as `/api/join/[REDACTED]`) or accept this as a known risk, noting that join links are reusable by design and expire after 7 days. I lean toward redaction -- it is low-effort and eliminates the exposure.

---

## Controls Confirmed Present

The following security controls are present in the design and are consistent with the security requirements:

- **Token validation via `openid-client`:** The library performs full claim validation (signature, expiry, audience, issuer) by default. SEC-1, SEC-2 satisfied.
- **Server-side session storage:** Session data in Redis, not in the cookie. Cookie contains only the encrypted session ID. Correct.
- **Encrypted session cookies:** `@fastify/secure-session` uses libsodium encryption. Stronger than signing alone.
- **HttpOnly / SameSite=Strict cookies:** Specified in the design. SEC cookie requirements met (pending the `Secure` flag local dev exception noted in F-11).
- **Refresh tokens server-side only:** Stored in Redis session, never in browser-accessible storage. SEC-5 satisfied.
- **Join link cryptographic tokens:** 32 bytes of randomness. Sufficient entropy. Stored in database with expiry and revocation support. FR-2.3 satisfied.
- **No credential storage:** The application never handles user passwords. Authentication fully delegated. FR-1.1 satisfied.
- **Idempotent concurrency handling:** `ON CONFLICT` patterns for user creation and team membership. No application-level locks. Correct approach for batch arrival.
- **Refresh token in Redis, not browser:** Correctly specified.
- **Join context in Redis, not in state parameter:** Prevents leaking join tokens to the IdP. Good decision.

---

## Summary of Findings

| # | Finding | Severity | Classification |
|---|---|---|---|
| F-01 | OIDC state parameter CSRF protection not specified | High | MUST FIX |
| F-02 | Nonce validation not mentioned | High | MUST FIX |
| F-03 | Session fixation prevention not addressed | High | MUST FIX |
| F-04 | Refresh tokens stored unencrypted in Redis | Medium | SHOULD FIX |
| F-05 | Contradictory session lifetimes; no absolute maximum enforcement | High | MUST FIX |
| F-06 | No rate limiting on join endpoint | Low | ACCEPTABLE WITH NOTE |
| F-07 | Sign-out does not terminate IdP session | High | MUST FIX |
| F-08 | No mechanism to prevent simulated OIDC provider in production | Critical | MUST FIX |
| F-09 | Refresh failure does not distinguish revocation from transient error | Medium | SHOULD FIX |
| F-10 | Error responses may leak IdP internals | Medium | SHOULD FIX |
| F-11 | Secure cookie flag incompatible with local dev HTTP | Low | ACCEPTABLE WITH NOTE |
| F-12 | CORS configuration absent | High | MUST FIX |
| F-13 | Pending join Redis keys not cleaned up after use | Medium | SHOULD FIX |
| F-14 | Last-write-wins on concurrent profile updates | Low | ACCEPTABLE |
| F-15 | Audit logging events not specified | High | MUST FIX |
| F-16 | Sign-out confirmation bypassable via query parameter | Medium | SHOULD FIX |
| F-17 | Security headers not specified | Medium | SHOULD FIX |
| F-18 | Join link tokens in server request logs | Medium | SHOULD FIX |

**MUST FIX count: 8** -- These must be addressed in the design before implementation begins. They are not implementation details that can be left to developer judgment; they are security controls that must be specified so they can be verified.

**SHOULD FIX count: 7** -- These should be addressed in the design or explicitly accepted as risks with a named owner. I will verify their implementation in the pre-production security review regardless.

**ACCEPTABLE count: 3** -- Noted for completeness. No action required.

---

## Note on the Simulated OIDC Provider

F-08 is the only finding I have classified as Critical. The rest of the design reflects careful thought about the authentication flow. But a simulated identity provider with known credentials that has no guardrail preventing production deployment is the kind of finding that ends up in a breach post-mortem. The mitigation is simple and should be non-negotiable.

---

*Review complete. I am available for consultation during implementation, particularly on F-01 through F-03 (OIDC protocol controls) and F-08 (provider isolation). I will verify all findings during the pre-production security review.*

-- Tomas Ferreira
