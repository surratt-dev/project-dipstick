# Spec Delta

## MODIFIED Requirements

### Requirement: First Access and role-claim-mapping events are durably recorded

Every `auth.first_access_created` emission, and every `auth.role_claim_mapped` emission, SHALL also produce an `INSERT INTO audit_log` row, written in the same database transaction as the account-resolving write (`resolveOrCreateAccount`'s UPSERT into `users`) that immediately precedes it. If the audit `INSERT` fails, it SHALL be rethrown as an `AuditWriteError` (`packages/backend/src/auth/errors.ts`) before the transaction rolls back — never as the raw underlying database error — so that the failure is classified by `mapAuthError`/`sanitizeOidcError` as `internal_error` rather than folded into their generic OIDC-error handling (see "OIDC library error sanitization" below); `resolveOrCreateAccount`'s own UPSERT failure, by contrast, is unaffected by this requirement and propagates as today. If acquiring the database connection for this transaction fails before the transaction begins (e.g. connection pool exhaustion), it SHALL likewise be rethrown as `AuditWriteError` — there is no transaction to roll back in that case, since none was opened. The transaction SHALL roll back, and the account-resolving write SHALL NOT be committed, when the audit `INSERT` itself fails — this coupling is deliberate, not an oversight. The audit `INSERT` SHALL run with a shorter statement-level timeout than the fail-open group's write-level timeout, so that a hung `INSERT` is cancelled by the database itself rather than left outstanding on the connection the subsequent `ROLLBACK` needs. The existing structured `emitAuditEvent` call for `auth.first_access_created`/`auth.role_claim_mapped` SHALL fire only after this transaction commits successfully — never before, and never when the transaction rolls back — so that a rolled-back transaction cannot produce a structured log entry claiming the event happened for a write that was undone. `actor_user_id` SHALL be the resolved user's id; `actor_global_role` SHALL be the resolved user's `globalRole`; `actor_ip` SHALL be populated from the live request; `team_id` SHALL be `NULL` — account resolution and role-claim mapping are account-level, not team-scoped. `auth.role_claim_mapped`'s row's `metadata` SHALL include `previousRole` — the account's `global_role` value immediately before this authentication's UPSERT applied, captured in the same statement as the UPSERT — in addition to the existing `globalRole`, `oidcSubject`, and `correlationId` fields. `auth.role_claim_mapped` SHALL fire for a returning user whenever the resolved `global_role` is not `engineer` **or** differs from `previousRole`; a change back to `engineer` is therefore recorded. The firing condition SHALL be evaluated once per sign-in and the same result SHALL gate both the `audit_log` row and the post-commit structured event, and the structured `auth.role_claim_mapped` event SHALL also carry `previousRole`. A `facilitator` or `engineering_manager` mapping discarded by precedence is recorded by a structured log line only (see `oidc-role-mapping`), not in the metadata of either event; a durable record of that conflict is deferred to #241. The metadata SHALL never include claim values or role-map keys. `auth.first_access_created`'s row's `metadata` SHALL include `oidcSubject`, `oidcIssuer`, and `globalRole`.

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

#### Scenario: Reversion to the default role is recorded
- **WHEN** a returning user whose stored `global_role` is `facilitator` authenticates and the role map resolves no value for them
- **THEN** `users.global_role` becomes `engineer`
- **AND** `auth.role_claim_mapped` fires with an `audit_log` row whose `metadata` has `previousRole = 'facilitator'` and `globalRole = 'engineer'`
- **AND** the post-commit structured `auth.role_claim_mapped` event also carries `previousRole = 'facilitator'`

#### Scenario: Returning default-role user with no change produces no row
- **WHEN** a returning user whose stored `global_role` is `engineer` authenticates and still resolves to `engineer`
- **THEN** `auth.role_claim_mapped` does not fire and no `audit_log` row is written for role mapping

#### Scenario: Facilitator mapping discarded by precedence adds nothing to audit metadata
- **WHEN** a returning user's claim values map to both `application_admin` and `facilitator`
- **THEN** `auth.role_claim_mapped` fires with `globalRole = 'application_admin'`
- **AND** the `metadata` contains no discard flag, no claim values and no role-map keys
