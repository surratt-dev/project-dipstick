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
- **WHEN** a session is destroyed (explicit logout, absolute timeout, token revocation, or exhausted refresh retries)
- **THEN** a structured audit log entry is created with event `auth.session_invalidated`, user ID, session ID, reason, and source IP
- **AND** a corresponding `audit_log` database row is also written (see "HTTP-side session invalidation is durably recorded" below), which is the authoritative record; the structured log entry remains the operational alert path

#### Scenario: Join link events logged
- **WHEN** a join link is created, redeemed, or rejected
- **THEN** a structured audit log entry is created with the appropriate event (`join.link_created`, `join.link_redeemed`, `join.link_rejected`) and relevant context (user ID, team ID, link ID, reason)

#### Scenario: Revoked refresh token classified and audited correctly
- **WHEN** a silent token refresh fails because the IdP has revoked the refresh token (the token endpoint responds with the OAuth error `invalid_grant`)
- **THEN** the failure is classified as revoked immediately, with no retry delay, and the resulting `auth.token_refresh_failure` audit entry records `failureType: "revoked"` — not `"transient"`, which a pre-existing classification bug produced for this same case prior to this change

## ADDED Requirements

### Requirement: HTTP-side session invalidation is durably recorded

Every `auth.session_invalidated` emission SHALL also produce an `INSERT INTO audit_log` row, at all four of its call sites: the three in `authMiddleware`'s `onRequest` hook (`reason: "absolute_timeout"`, `"token_revoked"`, `"refresh_failure"`) and the `/auth/logout` handler (`reason: "explicit_logout"`). This applies uniformly regardless of which call site fires — no `reason` value is exempt. `actor_user_id` and `actor_global_role` (resolved via the shared `resolveActorGlobalRole` lookup, not a duplicated query) SHALL be populated; `actor_ip` SHALL be populated from the live request's IP address, since all four call sites run inside an in-flight HTTP request; `team_id` SHALL be `NULL` at every call site, deliberately and uniformly, including at the `/auth/logout` call site where session-participation data exists nearby but does not resolve to a single well-defined team when a user holds more than one active session (an investigator needing team context for such a row should join `session_participants` on `actor_user_id` with timestamp proximity, then resolve `team_id` from that session — a manual reconstruction path, not something the row itself carries). The row's `metadata` SHALL unconditionally include `reason` and `authSessionId` — the identifier of the Fastify/HTTP session being invalidated, satisfying SEC-13's requirement that every audit entry name a target resource identifier. This field is deliberately named `authSessionId`, not `sessionId`: this same `metadata` JSONB column already carries a snake_case `session_id` convention elsewhere in this table (`em-views.ts`, `facilitator-sessions.ts`) for an unrelated concept — the Health Check ritual's domain session — and a bare `sessionId` would collide with that convention by casing alone, the same hazard `connection-registry.ts`'s `fastifySessionId` field was named to avoid one layer down. When `reason` is `"token_revoked"` or `"refresh_failure"`, the row's `metadata` SHALL additionally include `failureType` and `retryCount`, carrying forward the detail that `auth.token_refresh_failure` would otherwise have recorded on its own (see "Token refresh events remain log-only" below).

#### Scenario: Absolute-timeout session invalidation is recorded in the database
- **WHEN** `authMiddleware` destroys a session because the absolute session lifetime has elapsed
- **THEN** an `audit_log` row is written with `operation = 'auth.session_invalidated'`, the user's `actor_user_id`/`actor_global_role`, `actor_ip` from the request, `team_id` NULL, and `metadata` including `reason: "absolute_timeout"` and `authSessionId`

#### Scenario: Revoked-token session invalidation is recorded with failure detail
- **WHEN** `authMiddleware` destroys a session because token refresh failed with a revoked refresh token
- **THEN** an `audit_log` row is written with `operation = 'auth.session_invalidated'` and `metadata` including `reason: "token_revoked"`, `authSessionId`, `failureType: "revoked"`, and `retryCount`

#### Scenario: Exhausted-retry session invalidation is recorded with failure detail
- **WHEN** `authMiddleware` destroys a session because token refresh exhausted its retry budget on a transient error
- **THEN** an `audit_log` row is written with `operation = 'auth.session_invalidated'` and `metadata` including `reason: "refresh_failure"`, `authSessionId`, `failureType: "transient"`, and `retryCount`

#### Scenario: Explicit logout is recorded in the database
- **WHEN** a user logs out via `/auth/logout` and their session is destroyed
- **THEN** an `audit_log` row is written with `operation = 'auth.session_invalidated'` and `metadata` including `reason: "explicit_logout"` and `authSessionId`, with `team_id` NULL regardless of whether the user held an active session at logout time

#### Scenario: Team id is never resolved for these rows, even when session-participation data is available
- **WHEN** a user with an active session participation logs out via `/auth/logout`
- **THEN** the resulting `audit_log` row's `team_id` is NULL — the handler does not attempt to resolve a team id from the user's active session, deliberately and consistently with the other three call sites

### Requirement: Token refresh events remain log-only

`auth.token_refresh_success` and `auth.token_refresh_failure` SHALL NOT gain their own `audit_log` database rows as part of this capability. `auth.token_refresh_success` SHALL continue to be recorded only via the structured `emitAuditEvent` log entry, with no additional database round trips added to that code path. `auth.token_refresh_failure`'s detail (`failureType`, `retryCount`) SHALL be preserved via the corresponding `auth.session_invalidated` database row's `metadata` instead (see "HTTP-side session invalidation is durably recorded" above), not by giving `auth.token_refresh_failure` a row of its own.

#### Scenario: Successful token refresh adds no database round trip
- **WHEN** a token refresh succeeds inside `authMiddleware`'s `onRequest` hook
- **THEN** only the existing structured `auth.token_refresh_success` log entry is emitted
- **AND** no `audit_log` INSERT or additional SELECT is performed as part of handling this event

#### Scenario: Token refresh failure does not produce a duplicate database row
- **WHEN** a token refresh fails (revoked or exhausted retries) and is immediately followed by session invalidation in the same request
- **THEN** exactly one `audit_log` row is written for that request's failure, under `operation = 'auth.session_invalidated'`, carrying `failureType` and `retryCount` in its metadata
- **AND** no separate `audit_log` row is written under `operation = 'auth.token_refresh_failure'`

### Requirement: Audit log write failures fail open with a detectable, not necessarily monitored, signal

The `audit_log` write added by this capability SHALL fail open: a failure of either database round trip it depends on (the actor's global role lookup, or the `INSERT` itself) SHALL NOT prevent the triggering request's response from being sent, and SHALL NOT be treated as a fatal error by the request handler. Both round trips SHALL share a single bounded timeout (not one independent timeout per round trip), so the worst-case added latency is the stated timeout value once, not a multiple of it. This timeout SHALL be distinguishable from an explicit thrown error, so that a hang (e.g. connection-pool exhaustion) cannot indefinitely delay the response the way an uncaught error would not. Every fail-open occurrence SHALL emit a distinct, structured log signal (`auth.audit_write_failed`) identifying that the write failed, whether it failed via an explicit error or a timeout, and the request's source IP — so that a sustained failure of this write path is *detectable* by anything reading the log stream. This requirement establishes detectability of the signal, not that the signal is actively monitored: no alert rule, anomaly-detection job, or dashboard in this codebase consumes `auth.audit_write_failed` or any other `AuditEventName` today, and this capability does not add one. `auth.audit_write_failed` does not carry a `correlationId`, since none of this capability's four call sites mints or has access to one today.

#### Scenario: A database error during the audit write does not fail the request
- **WHEN** the `audit_log` INSERT (or the actor global role lookup preceding it) throws a database error
- **THEN** the triggering request's existing response (a 401 or a logout response) is still sent
- **AND** a structured `auth.audit_write_failed` log entry is emitted recording the failure, the affected `userId`/`authSessionId`/`reason`, and the request's `sourceIp`

#### Scenario: A hung audit write does not indefinitely delay the response
- **WHEN** the actor global role lookup or the `audit_log` INSERT does not return within the write path's single stated timeout
- **THEN** the write is treated as failed after that bounded time, the triggering request's response proceeds, and a structured `auth.audit_write_failed` log entry is emitted identifying the failure as a timeout rather than an explicit error

#### Scenario: A successful audit write emits no failure signal
- **WHEN** both the actor global role lookup and the `audit_log` INSERT complete successfully within the timeout
- **THEN** no `auth.audit_write_failed` entry is emitted
