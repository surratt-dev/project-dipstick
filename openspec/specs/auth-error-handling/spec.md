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
All authentication events SHALL be logged as structured audit entries via the `emitAuditEvent` function. Each entry includes `event` name, ISO 8601 `timestamp`, and event-specific fields. The `audit: true` field distinguishes audit log entries. Logs SHALL NOT include user credentials, tokens, or sensitive values. OIDC state nonces are truncated to 8 characters in logs.

#### Scenario: Failed authentication logged
- **WHEN** an authentication attempt fails for any reason
- **THEN** a structured audit log entry is created with event `auth.failure`, source IP, failure category, and correlation ID

#### Scenario: Successful authentication logged
- **WHEN** a user successfully authenticates
- **THEN** structured audit log entries are created for `auth.callback_received`, `auth.session_created`, and `auth.success` with user ID, OIDC subject/issuer, and first-access flag

#### Scenario: First Access account creation logged
- **WHEN** a new user account is created during First Access
- **THEN** a structured audit log entry is created with event `auth.first_access_created`, user ID, OIDC subject, and OIDC issuer

#### Scenario: Session invalidation logged
- **WHEN** a session is destroyed (explicit logout, absolute timeout, or token revocation)
- **THEN** a structured audit log entry is created with event `auth.session_invalidated`, user ID, session ID, and reason

#### Scenario: Join link events logged
- **WHEN** a join link is created, redeemed, or rejected
- **THEN** a structured audit log entry is created with the appropriate event (`join.link_created`, `join.link_redeemed`, `join.link_rejected`) and relevant context (user ID, team ID, link ID, reason)
