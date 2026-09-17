## MODIFIED Requirements

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
