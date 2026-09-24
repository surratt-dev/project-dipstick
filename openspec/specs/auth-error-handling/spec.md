# auth-error-handling

## Purpose

Defines requirements for authentication error states, plain-language error messages, error categorization, and authentication event logging.

## Requirements

### Requirement: Distinct error messages for authentication failure modes
The application SHALL display distinct user-facing error messages for each authentication failure mode. Error messages SHALL use plain language and SHALL NOT include protocol names, error codes, or technical identifiers. Error messages SHALL suggest a next action. Error categorization is implemented in `packages/backend/src/auth/error-handler.ts` using the `AuthErrorCategory` union type: `provider_unavailable`, `authentication_failed`, `session_expired`, `invalid_request`, `internal_error`.

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

#### Scenario: An audit-log write failure is not misattributed to sign-in
- **WHEN** the `audit_log` INSERT accompanying `auth.first_access_created`, `auth.role_claim_mapped`, or `executeJoinFlow`'s `join.link_redeemed` fails inside its transaction, the transaction rolls back, and the resulting `AuditWriteError` reaches `GET /auth/callback`'s catch block
- **THEN** the error is categorized as `internal_error`, not `authentication_failed`
- **AND** the message tells the user the problem was internal and temporary and invites a retry, rather than implying their credentials, the identity provider, or their sign-in attempt itself were at fault

#### Scenario: A failed database connection acquisition is not misattributed to sign-in either
- **WHEN** acquiring the pooled database connection for `auth.first_access_created`/`auth.role_claim_mapped`'s transaction, or for `executeJoinFlow`'s `join.link_redeemed` transaction, fails (e.g. connection pool exhaustion) before the transaction ever begins, and the resulting `AuditWriteError` reaches `GET /auth/callback`'s catch block
- **THEN** the error is categorized as `internal_error`, the same as an in-transaction audit-write failure — this is a new failure mode this capability's transactional writes introduce (this code path did not previously acquire a pooled connection), and it is not left to fall into `authentication_failed`'s default handling

---

### Requirement: Error messages distinguish user-resolvable from IT-required issues
Error messages SHALL distinguish between transient errors (retry) and persistent errors (contact IT). All error messages include IT contact guidance as a fallback.

#### Scenario: Retriable error suggests retry
- **WHEN** a `provider_unavailable` error occurs
- **THEN** the error message suggests trying again in a few moments as the primary action

#### Scenario: Persistent error suggests IT contact
- **WHEN** an `authentication_failed` error occurs
- **THEN** the error message suggests contacting the IT administrator if the problem continues

#### Scenario: Internal-error category is also treated as retriable
- **WHEN** an `internal_error` occurs
- **THEN** the error message suggests trying again in a few moments as the primary action, the same treatment as `provider_unavailable`, and the frontend's retry affordance (`AuthErrorPage.tsx`'s `isRetryable` check) is shown for it

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
- **AND** `auth.session_created` and `auth.success` each also produce a corresponding `audit_log` database row (see "Login and session-creation events are durably recorded" below), which is the authoritative record; the structured log entry remains the operational alert path

#### Scenario: Correlation ID is identical across all events from one callback invocation
- **WHEN** a single `GET /auth/callback` invocation emits more than one audit event carrying a `correlationId` field
- **THEN** every one of those events carries the exact same `correlationId` value, whether the invocation ends in success (`auth.callback_received` → `auth.session_created`/`auth.success`, and `auth.first_access_created`/`auth.role_claim_mapped` when applicable) or failure (`auth.callback_received` → `auth.failure`)

#### Scenario: First Access account creation logged
- **WHEN** a new user account is created during First Access
- **THEN** a structured audit log entry is created with event `auth.first_access_created`, user ID, OIDC subject, and OIDC issuer
- **AND** a corresponding `audit_log` database row is also written in the same transaction as the account-creating write (see "First Access and role-claim-mapping events are durably recorded" below)

#### Scenario: Session invalidation logged
- **WHEN** a session is destroyed (explicit logout, absolute timeout, token revocation, or exhausted refresh retries)
- **THEN** a structured audit log entry is created with event `auth.session_invalidated`, user ID, session ID, reason, and source IP
- **AND** a corresponding `audit_log` database row is also written (see "HTTP-side session invalidation is durably recorded" below), which is the authoritative record; the structured log entry remains the operational alert path

#### Scenario: Join link events logged
- **WHEN** a join link is created, redeemed, or rejected
- **THEN** a structured audit log entry is created with the appropriate event (`join.link_created`, `join.link_redeemed`, `join.link_rejected`) and relevant context (user ID, team ID, link ID, reason)
- **AND** `join.link_created` and `join.link_redeemed` each also produce a corresponding `audit_log` database row (see the `join-link` capability's "Join link creation and redemption are durably recorded" requirement); `join.link_rejected` remains log-only

#### Scenario: Revoked refresh token classified and audited correctly
- **WHEN** a silent token refresh fails because the IdP has revoked the refresh token (the token endpoint responds with the OAuth error `invalid_grant`)
- **THEN** the failure is classified as revoked immediately, with no retry delay, and the resulting `auth.token_refresh_failure` audit entry records `failureType: "revoked"` — not `"transient"`, which a pre-existing classification bug produced for this same case prior to this change

---

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

---

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

---

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

---

### Requirement: Login and session-creation events are durably recorded

Every `auth.success` and `auth.session_created` emission SHALL also produce an `INSERT INTO audit_log` row. Both fire from `GET /auth/callback` after a completed IdP round trip, with no Postgres write in the same call path to join — they use the fail-open, bounded-timeout write path (see "Non-transactional audit writes fail open with a detectable, not necessarily monitored, signal" below), not a transaction. `actor_user_id` SHALL be populated from the resolved user. `actor_global_role` SHALL be populated from the value already returned by account resolution (`user.globalRole`) — no additional lookup — since both events fire after that resolution has already occurred in the same handler. `actor_ip` SHALL be populated from the live request. `team_id` SHALL be `NULL` at both events, deliberately: login and session creation are account-level events with no single team in scope. The row's `metadata` SHALL include `correlationId` (the same value threaded through every other event in the same callback invocation) and, for `auth.session_created`, `authSessionId`; for `auth.success`, `oidcSubject`, `oidcIssuer`, and `isFirstAccess`.

#### Scenario: Successful sign-in is recorded in the database
- **WHEN** a user completes authentication and `auth.success` is emitted
- **THEN** an `audit_log` row is written with `operation = 'auth.success'`, `actor_user_id`/`actor_global_role` from the resolved user (no additional database lookup), `actor_ip` from the request, `team_id` NULL, and `metadata` including `oidcSubject`, `oidcIssuer`, `isFirstAccess`, and `correlationId`

#### Scenario: Session creation is recorded in the database
- **WHEN** a user's session is established via `request.session.regenerate()` and `auth.session_created` is emitted
- **THEN** an `audit_log` row is written with `operation = 'auth.session_created'`, `team_id` NULL, and `metadata` including `authSessionId` and `correlationId`

#### Scenario: No additional database lookup for actor role
- **WHEN** the audit rows for `auth.success` or `auth.session_created` are written
- **THEN** `actor_global_role` is populated from the value already resolved earlier in the same request, and no separate `SELECT global_role FROM users` query is issued for either event

---

### Requirement: First Access and role-claim-mapping events are durably recorded

Every `auth.first_access_created` emission, and every `auth.role_claim_mapped` emission, SHALL also produce an `INSERT INTO audit_log` row, written in the same database transaction as the account-resolving write (`resolveOrCreateAccount`'s UPSERT into `users`) that immediately precedes it. If the audit `INSERT` fails, it SHALL be rethrown as an `AuditWriteError` (`packages/backend/src/auth/errors.ts`) before the transaction rolls back — never as the raw underlying database error — so that the failure is classified by `mapAuthError`/`sanitizeOidcError` as `internal_error` rather than folded into their generic OIDC-error handling (see "OIDC library error sanitization" below); `resolveOrCreateAccount`'s own UPSERT failure, by contrast, is unaffected by this requirement and propagates as today. If acquiring the database connection for this transaction fails before the transaction begins (e.g. connection pool exhaustion), it SHALL likewise be rethrown as `AuditWriteError` — there is no transaction to roll back in that case, since none was opened. The transaction SHALL roll back, and the account-resolving write SHALL NOT be committed, when the audit `INSERT` itself fails — this coupling is deliberate, not an oversight. The audit `INSERT` SHALL run with a shorter statement-level timeout than the fail-open group's write-level timeout, so that a hung `INSERT` is cancelled by the database itself rather than left outstanding on the connection the subsequent `ROLLBACK` needs. The existing structured `emitAuditEvent` call for `auth.first_access_created`/`auth.role_claim_mapped` SHALL fire only after this transaction commits successfully — never before, and never when the transaction rolls back — so that a rolled-back transaction cannot produce a structured log entry claiming the event happened for a write that was undone. `actor_user_id` SHALL be the resolved user's id; `actor_global_role` SHALL be the resolved user's `globalRole`; `actor_ip` SHALL be populated from the live request; `team_id` SHALL be `NULL` — account resolution and role-claim mapping are account-level, not team-scoped. `auth.role_claim_mapped`'s row's `metadata` SHALL include `previousRole` — the account's `global_role` value immediately before this authentication's UPSERT applied, captured in the same statement as the UPSERT — in addition to the existing `globalRole`, `oidcSubject`, and `correlationId` fields. `auth.first_access_created`'s row's `metadata` SHALL include `oidcSubject`, `oidcIssuer`, and `globalRole`.

#### Scenario: First Access account creation is recorded transactionally
- **WHEN** a new user account is created during First Access and `auth.first_access_created` is emitted
- **THEN** an `audit_log` row is written with `operation = 'auth.first_access_created'` in the same transaction as the `users` UPSERT, `team_id` NULL, and `metadata` including `oidcSubject`, `oidcIssuer`, `globalRole`, and `correlationId`

#### Scenario: A failed audit write rolls back First Access account creation
- **WHEN** the `audit_log` INSERT for `auth.first_access_created` fails inside the shared transaction
- **THEN** the `users` UPSERT is rolled back and no account is created
- **AND** the authentication attempt fails rather than succeeding with a silently missing audit row
- **AND** the error that reaches `GET /auth/callback`'s catch block is an `AuditWriteError`, categorized by `mapAuthError` as `internal_error` and logged by `sanitizeOidcError` with `message`/`stack`/`causeClass` unredacted, not folded into the generic "unrecognized error" branch that a raw database error would have hit

#### Scenario: Role claim mapping is recorded with the prior role value
- **WHEN** a returning user authenticates with a non-default `global_role` and `auth.role_claim_mapped` is emitted
- **THEN** an `audit_log` row is written with `operation = 'auth.role_claim_mapped'` in the same transaction as the `users` UPSERT, and `metadata` includes both `globalRole` (the newly mapped value) and `previousRole` (the value on record immediately before this UPSERT applied)

#### Scenario: A brand-new user has no previous role to record
- **WHEN** `auth.first_access_created` fires for a user with no prior `users` row
- **THEN** no `previousRole` field is expected or required on that row — the absence of a prior account, not an unrecorded value, is what `isNewUser`/the `auth.first_access_created` operation name already communicates

#### Scenario: The structured log entry never precedes the transaction it depends on
- **WHEN** `auth.first_access_created` or `auth.role_claim_mapped` is about to be emitted as a structured log entry
- **THEN** the emission happens only after the corresponding `audit_log` row's transaction has already committed successfully
- **AND** if that transaction instead rolls back, the structured log entry for that operation is never emitted at all — not emitted early, and not emitted after the fact with a different outcome noted

#### Scenario: A failed connection acquisition also rolls back cleanly
- **WHEN** the database connection for the `resolveOrCreateAccount`/audit-`INSERT` transaction cannot be acquired (e.g. the connection pool is exhausted)
- **THEN** no `users` row is created or updated, no `audit_log` row is written, and no structured log entry for `auth.first_access_created`/`auth.role_claim_mapped` is emitted
- **AND** the resulting `AuditWriteError` is categorized by `mapAuthError` as `internal_error`, consistent with the audit-`INSERT`-failure case

#### Scenario: Reversion to the default role is not represented by this requirement
- **WHEN** a returning user's `global_role` changes from a non-default value back to `engineer`
- **THEN** `auth.role_claim_mapped` does not fire (its existing firing condition is unchanged by this requirement) and no `audit_log` row is written for that authentication — this reversion remains visible only as an absence of subsequent `role_claim_mapped` rows for that `userId`, not as a row of its own

---

### Requirement: IdP logout failure is durably recorded

Every `auth.idp_logout_failed` emission SHALL also produce an `INSERT INTO audit_log` row, using the same fail-open, bounded-timeout write path as "Login and session-creation events are durably recorded" above. `actor_user_id` SHALL be the user who was logging out; `actor_global_role` SHALL be resolved via the shared `resolveActorGlobalRole` lookup (the local session carries no `globalRole` field, unlike `auth.success`/`session_created`, which already have it in scope). `actor_ip` SHALL be populated from the live request. `team_id` SHALL be `NULL`. `metadata` SHALL include `authSessionId`. The existing structured log entry for this event SHALL also gain a `sourceIp` field, matching its sibling `auth.session_invalidated` emission in the same handler.

#### Scenario: IdP-side logout failure is recorded in the database
- **WHEN** `getEndSessionUrl()` throws during `/auth/logout` after the local session has already been destroyed
- **THEN** an `audit_log` row is written with `operation = 'auth.idp_logout_failed'`, `actor_global_role` resolved via `resolveActorGlobalRole`, `team_id` NULL, and `metadata` including `authSessionId`
- **AND** the structured log entry for this event includes `sourceIp`

---

### Requirement: Non-transactional audit writes fail open with a detectable, not necessarily monitored, signal

The `audit_log` writes for `auth.success`, `auth.session_created`, and `auth.idp_logout_failed` SHALL fail open: a failure of either database round trip involved (the actor's global role lookup, when performed, or the `INSERT` itself) SHALL NOT prevent the triggering request's response from being sent, and SHALL NOT be treated as a fatal error. Both round trips, when both are performed, SHALL share a single bounded timeout, matching the mechanism and constant (`AUDIT_WRITE_TIMEOUT_MS`) already established for `auth.session_invalidated`. This timeout SHALL be distinguishable from an explicit thrown error. Every fail-open occurrence SHALL emit `auth.audit_write_failed`, identifying the failed operation, whether it failed via an explicit error or a timeout, and the request's source IP.

#### Scenario: A database error during a login-event audit write does not fail the request
- **WHEN** the `audit_log` INSERT for `auth.success`, `auth.session_created`, or `auth.idp_logout_failed` throws a database error
- **THEN** the triggering request's existing response proceeds unaffected
- **AND** a structured `auth.audit_write_failed` log entry is emitted identifying which operation failed and the request's `sourceIp`

#### Scenario: A hung login-event audit write does not indefinitely delay the response
- **WHEN** the write for `auth.success`, `auth.session_created`, or `auth.idp_logout_failed` does not complete within the shared timeout
- **THEN** the write is treated as failed after that bounded time, the triggering request's response proceeds, and `auth.audit_write_failed` identifies the failure as a timeout

---

### Requirement: Pre-authentication and failure events remain log-only

`auth.authorization_initiated`, `auth.callback_received`, and `auth.failure` (all three of its call sites, treated uniformly) SHALL NOT gain `audit_log` database rows as part of this capability. Each remains recorded only via its existing structured `emitAuditEvent` log entry. This deferral is tracked as GitHub issue #156, pending volume and latency data that does not exist today (`docs/deployment.md`'s Logging section confirms no log transport is configured anywhere in this codebase to obtain it from).

#### Scenario: Authorization initiation adds no database write
- **WHEN** `GET /auth/login` emits `auth.authorization_initiated`
- **THEN** only the existing structured log entry is produced; no `audit_log` INSERT is performed

#### Scenario: Callback receipt adds no database write
- **WHEN** `GET /auth/callback` emits `auth.callback_received`
- **THEN** only the existing structured log entry is produced; no `audit_log` INSERT is performed

#### Scenario: Authentication failure adds no database write, at any of its call sites
- **WHEN** `auth.failure` is emitted, whether from a missing/invalid `state` parameter or from the catch-all error handler
- **THEN** only the existing structured log entry is produced; no `audit_log` INSERT is performed

---

### Requirement: OIDC library error sanitization
The application SHALL sanitize any error thrown by the OIDC client library (`openid-client`/`oauth4webapi`), or by this application's own auth error classes reaching the same log call site (e.g. `MissingClaimError`, `AuditWriteError`; `packages/backend/src/auth/errors.ts`), before it reaches a logger, via a single shared sanitization function applied uniformly at every call site that can surface such an error to a logger. `AuditWriteError` covers both a failed audit `INSERT` within the transactional group's transaction and a failed acquisition of that transaction's database connection (`db.connect()`) — both are this application's own database infrastructure failing, not an identity-provider error, and both receive identical sanitization treatment. Sanitization SHALL dispatch on the error's class, not on provider-specific string content. This mechanism SHALL remain correct, with no change to the sanitization logic itself, for identity providers added after the application's initial provider that are integrated through the same OIDC client library (`openid-client`/`oauth4webapi`); a provider integrated through a different client library is outside this guarantee and requires the verification named in the corresponding design record before that provider's auth path is considered production-ready. The IdP-supplied `error_description` field and any raw `cause` content SHALL NOT appear in logs by default; the OAuth `error` code (e.g. `invalid_grant`) SHALL be preserved, since it is a fixed enum defined by the OAuth/OIDC specifications rather than free text. Any field withheld by sanitization SHALL appear in the logged output as an explicit redaction marker rather than being silently omitted, except where the underlying error class does not have that field at all (e.g. `WWWAuthenticateChallengeError` has no `error_description` field to withhold), in which case the field SHALL be absent rather than falsely marked as redacted. An error whose class the sanitization function does not recognize SHALL have its `message` and `stack` redacted and all provider- or library-supplied fields withheld, and SHALL produce a distinct log signal identifying it as unrecognized, rather than being logged unsanitized. `AuditWriteError` (a class this application throws when the `audit_log` INSERT inside the transactional group's transaction fails, or when acquiring that transaction's database connection fails before the transaction begins — see the `join-link` and account-resolution audit requirements below) is a recognized class, not an unrecognized one: its `message` is always a fixed, static string, and its `stack` and `causeClass` fields never carry identity-provider- or user-supplied content, so none of them are redacted.

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

#### Scenario: Application-level audit-write failure is sanitized without redacting diagnostic detail
- **WHEN** the application's own `AuditWriteError` is thrown — from the transactional group's rolled-back audit `INSERT` (`auth.first_access_created`/`role_claim_mapped`, or `executeJoinFlow`'s `join.link_redeemed`) — and reaches the same logging call site as OIDC client library errors
- **THEN** it is sanitized by the same shared function, preserving `errorClass`, `message`, `stack`, and `causeClass` unredacted — none of `sanitizeOidcError`'s redaction markers apply, since this error class never carries identity-provider- or user-supplied content, the same treatment `MissingClaimError` already receives

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
