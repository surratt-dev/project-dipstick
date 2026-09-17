# auth-error-handling

## Purpose

Defines requirements for authentication error states, plain-language error messages, error categorization, and authentication event logging.

## Requirements

### Requirement: Distinct error messages for authentication failure modes
The application SHALL display distinct user-facing error messages for each authentication failure mode. Error messages SHALL use plain language and SHALL NOT include protocol names, error codes, or technical identifiers. Error messages SHALL suggest a next action. Error categorization is implemented in `packages/backend/src/auth/error-handler.ts` using the `AuthErrorCategory` union type: `provider_unavailable`, `authentication_failed`, `session_expired`, `invalid_request`.

#### Scenario: Identity provider unreachable
- **WHEN** the connection to the identity provider fails (ECONNREFUSED, ENOTFOUND, ETIMEDOUT, network errors)
- **THEN** the error is categorized as `provider_unavailable` and the message directs the user to try again in a few moments, with guidance to contact IT if the problem persists

#### Scenario: Identity provider returned an error
- **WHEN** the identity provider returns an error response (`invalid_grant`, `invalid_client`, `unauthorized_client`, `invalid_scope`)
- **THEN** the error is categorized as `authentication_failed` and the message directs the user to try signing in again, with guidance to contact IT if this continues

#### Scenario: User cancelled authentication
- **WHEN** the user abandons the identity provider flow and the IdP returns `access_denied`, `consent_required`, or `login_required`
- **THEN** the error is categorized as `authentication_failed` and the message indicates sign-in was cancelled or denied

#### Scenario: State/nonce validation failure
- **WHEN** the callback state or nonce does not match (potential CSRF or replay)
- **THEN** the error is categorized as `invalid_request` and the message directs the user to try signing in again from the beginning

---

### Requirement: Error messages distinguish user-resolvable from IT-required issues
Error messages SHALL distinguish between transient errors (retry) and persistent errors (contact IT). All error messages include IT contact guidance as a fallback.

#### Scenario: Retriable error suggests retry
- **WHEN** a `provider_unavailable` error occurs
- **THEN** the error message suggests trying again in a few moments as the primary action

#### Scenario: Persistent error suggests IT contact
- **WHEN** an `authentication_failed` error occurs
- **THEN** the error message suggests contacting the IT administrator if the problem continues

---

### Requirement: Error response format
Authentication errors SHALL be redirected to `/auth/error` with query parameters `category`, `message`, and `correlationId`. The `correlationId` is a UUID generated per error occurrence, enabling correlation between user-visible errors and server-side logs.

#### Scenario: Error redirect with correlation ID
- **WHEN** an authentication error occurs during callback processing
- **THEN** the user is redirected to `/auth/error?category=<category>&message=<encoded message>&correlationId=<uuid>`

---

### Requirement: Authentication event logging
All authentication events SHALL be logged as structured audit entries via the `emitAuditEvent` function. Each entry includes `event` name, ISO 8601 `timestamp`, and event-specific fields. The `audit: true` field distinguishes audit log entries. Logs SHALL NOT include user credentials, tokens, or sensitive values. OIDC state nonces are truncated to 8 characters in logs. This prohibition applies to every log entry produced during authentication, not only entries emitted via `emitAuditEvent` — including error objects logged directly (e.g. `request.log.error({ err, ... })`) where `err` originates from the OIDC identity-provider client library. The "OIDC library error sanitization" requirement below defines the specific mechanism that enforces this for those errors.

Every audit entry emitted during a single `GET /auth/callback` invocation that carries a `correlationId` SHALL carry the same `correlationId` value — the one instance generated once at handler entry — never a freshly generated value per emit site. This applies across both the success path (`auth.callback_received`, `auth.session_created`, `auth.success`, and whichever of `auth.first_access_created`/`auth.role_claim_mapped` fires) and the failure path (`auth.callback_received` followed by `auth.failure`).

#### Scenario: Failed authentication logged
- **WHEN** an authentication attempt fails for any reason
- **THEN** a structured audit log entry is created with event `auth.failure`, source IP, failure category, and correlation ID

#### Scenario: Successful authentication logged
- **WHEN** a user successfully authenticates
- **THEN** structured audit log entries are created for `auth.callback_received`, `auth.session_created`, and `auth.success`, each including source IP and correlation ID in addition to their existing event-specific fields (user ID, OIDC subject/issuer, and first-access flag)

#### Scenario: Correlation ID is identical across all events from one callback invocation
- **WHEN** a single `GET /auth/callback` invocation emits more than one audit event carrying a `correlationId` field
- **THEN** every one of those events carries the exact same `correlationId` value, whether the invocation ends in success (`auth.callback_received` → `auth.session_created`/`auth.success`, and `auth.first_access_created`/`auth.role_claim_mapped` when applicable) or failure (`auth.callback_received` → `auth.failure`)

#### Scenario: First Access account creation logged
- **WHEN** a new user account is created during First Access
- **THEN** a structured audit log entry is created with event `auth.first_access_created`, user ID, OIDC subject, and OIDC issuer

#### Scenario: Session invalidation logged
- **WHEN** a session is destroyed (explicit logout, absolute timeout, or token revocation)
- **THEN** a structured audit log entry is created with event `auth.session_invalidated`, user ID, session ID, and reason

#### Scenario: Join link events logged
- **WHEN** a join link is created, redeemed, or rejected
- **THEN** a structured audit log entry is created with the appropriate event (`join.link_created`, `join.link_redeemed`, `join.link_rejected`) and relevant context (user ID, team ID, link ID, reason)

#### Scenario: Revoked refresh token classified and audited correctly
- **WHEN** a silent token refresh fails because the IdP has revoked the refresh token (the token endpoint responds with the OAuth error `invalid_grant`)
- **THEN** the failure is classified as revoked immediately, with no retry delay, and the resulting `auth.token_refresh_failure` audit entry records `failureType: "revoked"` — not `"transient"`, which a pre-existing classification bug produced for this same case prior to this change

---

### Requirement: OIDC library error sanitization
The application SHALL sanitize any error thrown by the OIDC client library (`openid-client`/`oauth4webapi`), or by this application's own auth error classes reaching the same log call site (e.g. `MissingClaimError`, `packages/backend/src/auth/errors.ts`), before it reaches a logger, via a single shared sanitization function applied uniformly at every call site that can surface such an error to a logger. Sanitization SHALL dispatch on the error's class, not on provider-specific string content. This mechanism SHALL remain correct, with no change to the sanitization logic itself, for identity providers added after the application's initial provider that are integrated through the same OIDC client library (`openid-client`/`oauth4webapi`); a provider integrated through a different client library is outside this guarantee and requires the verification named in the corresponding design record before that provider's auth path is considered production-ready. The IdP-supplied `error_description` field and any raw `cause` content SHALL NOT appear in logs by default; the OAuth `error` code (e.g. `invalid_grant`) SHALL be preserved, since it is a fixed enum defined by the OAuth/OIDC specifications rather than free text. Any field withheld by sanitization SHALL appear in the logged output as an explicit redaction marker rather than being silently omitted, except where the underlying error class does not have that field at all (e.g. `WWWAuthenticateChallengeError` has no `error_description` field to withhold), in which case the field SHALL be absent rather than falsely marked as redacted. An error whose class the sanitization function does not recognize SHALL have its `message` and `stack` redacted and all provider- or library-supplied fields withheld, and SHALL produce a distinct log signal identifying it as unrecognized, rather than being logged unsanitized.

#### Scenario: IdP token-exchange error is sanitized
- **WHEN** the OIDC client library throws `ResponseBodyError` or `AuthorizationResponseError` carrying an IdP-supplied `error_description`
- **THEN** the error is logged with `error_description` replaced by an explicit redaction marker, while the fixed OAuth `error` code (e.g. `invalid_grant`) and oauth4webapi's internal `code` field (e.g. `RESPONSE_BODY_ERROR`, a separate enum-valued diagnostic field) are both preserved

#### Scenario: WWW-Authenticate challenge error is sanitized without a nonexistent field
- **WHEN** the OIDC client library throws `WWWAuthenticateChallengeError`, a class with no `error` or `error_description` field
- **THEN** the error is logged with its `cause` content withheld via an explicit redaction marker, and no `error`/`error_description` field is present in the logged output — the sanitization mechanism does not fabricate a redaction marker for a field the underlying error class never had

#### Scenario: Token/claim validation failure is sanitized structurally
- **WHEN** the OIDC client library throws `OperationProcessingError` or `ClientError` during ID token validation (nonce mismatch, claim mismatch, signature failure, or timestamp check)
- **THEN** the logged output does not include the error's `cause` content, regardless of whether that content would otherwise be enumerable on the thrown error object

#### Scenario: Application-level claim validation error is sanitized consistently
- **WHEN** the application's own `MissingClaimError` is thrown during ID token claim validation and reaches the same logging call site as OIDC client library errors
- **THEN** it is sanitized by the same shared function, allowlisting `errorClass`, `message`, `stack`, and `claim` (claim name only), consistent with its existing claim-name-only discipline in `error-handler.ts`

#### Scenario: Sanitization applies uniformly across all OIDC client library call sites
- **WHEN** an error from the OIDC client library is thrown during the authentication callback, a silent token refresh, or IdP end-session URL construction
- **THEN** the same sanitization function is applied to the error before it reaches a logger in every case

#### Scenario: Redacted fields are marked, not omitted
- **WHEN** sanitization withholds a field's original value, and that field exists on the thrown error's class
- **THEN** the logged output includes that field with an explicit redaction marker rather than the field being absent from the logged object

#### Scenario: Unrecognized error class fails closed
- **WHEN** an error reaches the sanitization function whose class is not one the function explicitly recognizes
- **THEN** the logged output redacts the message and all provider- or library-supplied fields, and a distinct log event identifies the error's class as unrecognized

#### Scenario: User-facing error page is unaffected by log sanitization
- **WHEN** an authentication error occurs and the user is redirected to the error page
- **THEN** the content of the user-facing error page is unchanged by the sanitization function and does not depend on it

#### Scenario: IdP end-session URL construction failure degrades gracefully
- **WHEN** `getEndSessionUrl()` throws during `/auth/logout` after the local session has already been destroyed
- **THEN** the error is sanitized and logged via the shared wrapper, a structured audit log entry is created with event `auth.idp_logout_failed` (user ID, session ID), and the response falls back to `{ redirectUrl: "/" }` rather than propagating an uncaught error; IdP-side (single) logout is not completed in this case, consistent with the requirement that only the application's own session invalidation is guaranteed

#### Scenario: Regression coverage against installed library versions
- **WHEN** a representative instance of each recognized OIDC client library error class is constructed with a canary value in its sensitive fields and logged through the application's sanitization function and logger configuration
- **THEN** the canary value does not appear anywhere in the resulting log output
