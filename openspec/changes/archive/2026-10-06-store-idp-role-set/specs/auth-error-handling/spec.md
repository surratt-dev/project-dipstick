# Spec Delta: auth-error-handling

## MODIFIED Requirements

### Requirement: First Access and role-claim-mapping events are durably recorded

Every `auth.first_access_created` emission, and every `auth.role_claim_mapped` emission, SHALL also produce an `INSERT INTO audit_log` row, written in the same database transaction as the account-resolving write (`resolveOrCreateAccount`'s UPSERT into `users`) that immediately precedes it. If the audit `INSERT` fails, it SHALL be rethrown as an `AuditWriteError` (`packages/backend/src/auth/errors.ts`) before the transaction rolls back — never as the raw underlying database error — so that the failure is classified by `mapAuthError`/`sanitizeOidcError` as `internal_error` rather than folded into their generic OIDC-error handling (see "OIDC library error sanitization" below); `resolveOrCreateAccount`'s own UPSERT failure, by contrast, is unaffected by this requirement and propagates as today. If acquiring the database connection for this transaction fails before the transaction begins (e.g. connection pool exhaustion), it SHALL likewise be rethrown as `AuditWriteError` — there is no transaction to roll back in that case, since none was opened. The transaction SHALL roll back, and the account-resolving write SHALL NOT be committed, when the audit `INSERT` itself fails — this coupling is deliberate, not an oversight. The audit `INSERT` SHALL run with a shorter statement-level timeout than the fail-open group's write-level timeout, so that a hung `INSERT` is cancelled by the database itself rather than left outstanding on the connection the subsequent `ROLLBACK` needs. The existing structured `emitAuditEvent` call for `auth.first_access_created`/`auth.role_claim_mapped` SHALL fire only after this transaction commits successfully — never before, and never when the transaction rolls back — so that a rolled-back transaction cannot produce a structured log entry claiming the event happened for a write that was undone. `actor_user_id` SHALL be the resolved user's id; `actor_global_role` SHALL be the resolved user's `globalRole`; `actor_ip` SHALL be populated from the live request; `team_id` SHALL be `NULL` — account resolution and role-claim mapping are account-level, not team-scoped. `auth.role_claim_mapped`'s row's `metadata` SHALL include `previousRole` — the account's `global_role` value immediately before this authentication's UPSERT applied, captured in the same statement as the UPSERT — and `previousRoles` — the account's `roles` value captured the same way, always present, and null only when the UPSERT's statement observed no prior row for a returning account (two concurrent first sign-ins for the same subject, where the second resolves as returning), in which case `previousRole` is null too; it SHALL never be defaulted to an empty or `engineer` set, and a non-null `previousRole` with a null `previousRoles` SHALL fail the sign-in as an integrity error; likewise, a role set read back from `users` (`roles` or `previousRoles`) that is not a non-empty array of known internal roles SHALL fail the sign-in rather than be coerced — in addition to the existing `globalRole`, `oidcSubject`, and `correlationId` fields and the new `roles` field. The `roles` field on both operations SHALL be the account's stored role set after the UPSERT, in the same highest-first order as `users.roles` (see `oidc-role-mapping`). Both rows SHALL also populate `audit_log.actor_roles` with that same array; `actor_roles` is NULL on every other operation, meaning the actor's role set was not captured, not that the actor had no roles. The values and order of `actor_roles` are guaranteed by the application (identical to `roles` on the same row), not by a database constraint. `auth.role_claim_mapped` SHALL fire for a returning user whenever the resolved `global_role` is not `engineer`, **or** differs from `previousRole`, **or** `roles` differs from `previousRoles`; a change back to `engineer` is therefore recorded. The role-set clause adds no firing case that the first two clauses do not already cover; it is stated so the rule does not depend on `global_role`. The firing condition SHALL be evaluated once per sign-in and the same result SHALL gate both the `audit_log` row and the post-commit structured event, and the structured `auth.role_claim_mapped` event SHALL also carry `previousRole`, `roles` and `previousRoles`, and the structured `auth.first_access_created` event SHALL carry `roles`, each with exactly the same values as the corresponding `audit_log` row. A `facilitator` or `engineering_manager` mapping outranked by precedence is recorded by a structured log line (see `oidc-role-mapping`) and by its presence in `roles`; neither event carries a discard flag, and a conflict operation or user-visible notice is deferred to #241. The metadata SHALL never include claim values or role-map keys. `auth.first_access_created`'s row's `metadata` SHALL include `oidcSubject`, `oidcIssuer`, `globalRole`, and `roles`, and SHALL NOT include `previousRoles` or `previousRole`.

#### Scenario: First Access account creation is recorded transactionally
- **WHEN** a new user account is created during First Access and `auth.first_access_created` is emitted
- **THEN** an `audit_log` row is written with `operation = 'auth.first_access_created'` in the same transaction as the `users` UPSERT, `team_id` NULL, `actor_roles` equal to the new account's role set, and `metadata` including `oidcSubject`, `oidcIssuer`, `globalRole`, `roles`, and `correlationId`

#### Scenario: A failed audit write rolls back First Access account creation
- **WHEN** the `audit_log` INSERT for `auth.first_access_created` fails inside the shared transaction
- **THEN** the `users` UPSERT is rolled back and no account is created
- **AND** the authentication attempt fails rather than succeeding with a silently missing audit row
- **AND** the error that reaches `GET /auth/callback`'s catch block is an `AuditWriteError`, categorized by `mapAuthError` as `internal_error` and logged by `sanitizeOidcError` with `message`/`stack`/`causeClass` unredacted, not folded into the generic "unrecognized error" branch that a raw database error would have hit

#### Scenario: Role claim mapping is recorded with the prior role value
- **WHEN** a returning user authenticates with a non-default `global_role` and `auth.role_claim_mapped` is emitted
- **THEN** an `audit_log` row is written with `operation = 'auth.role_claim_mapped'` in the same transaction as the `users` UPSERT, `metadata` includes both `globalRole` (the newly mapped value) and `previousRole` (the value on record immediately before this UPSERT applied), and `roles` and `previousRoles` (the role set after and immediately before this UPSERT, captured in the same statement)
- **AND** `actor_roles` equals `roles`

#### Scenario: A brand-new user has no previous role to record
- **WHEN** `auth.first_access_created` fires for a user with no prior `users` row
- **THEN** no `previousRole` or `previousRoles` field is present on that row — the absence of a prior account, not an unrecorded value, is what `isNewUser`/the `auth.first_access_created` operation name already communicates

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
- **AND** the metadata has `previousRoles = ['facilitator']` and `roles = ['engineer']`
- **AND** the post-commit structured `auth.role_claim_mapped` event also carries `previousRole = 'facilitator'`, `previousRoles = ['facilitator']` and `roles = ['engineer']`

#### Scenario: Returning default-role user with no change produces no row
- **WHEN** a returning user whose stored `global_role` is `engineer` authenticates and still resolves to `engineer`
- **THEN** `auth.role_claim_mapped` does not fire and no `audit_log` row is written for role mapping

#### Scenario: Facilitator mapping discarded by precedence adds no discard flag to audit metadata
- **WHEN** a returning user's claim values map to both `application_admin` and `facilitator`
- **THEN** `auth.role_claim_mapped` fires with `globalRole = 'application_admin'` and `roles = ['application_admin', 'facilitator']`
- **AND** the `metadata` contains no discard flag, no claim values and no role-map keys

#### Scenario: Role set change without a single-role change is recorded
- **WHEN** a returning user's stored `roles` is `['application_admin', 'facilitator']` and their claim now maps only to `application_admin`
- **THEN** `users.global_role` stays `application_admin` and `users.roles` becomes `['application_admin']`
- **AND** `auth.role_claim_mapped` fires with `previousRoles = ['application_admin', 'facilitator']` and `roles = ['application_admin']`

#### Scenario: Concurrent first sign-in records no previous role set
- **WHEN** two sign-ins for the same new subject run concurrently and the second resolves as a returning account whose prior row its statement did not observe
- **THEN** its `auth.role_claim_mapped` row has `previousRole` null and `previousRoles` null, never `[]` or `['engineer']`
- **AND** `roles` is the set resolved for that sign-in

#### Scenario: Previous role set reflects the row before this sign-in
- **WHEN** the same subject signs in twice and their claim maps to `facilitator` the first time and to `engineering_manager` and `facilitator` the second time
- **THEN** the second sign-in's `auth.role_claim_mapped` metadata has `previousRoles = ['facilitator']` and `roles = ['engineering_manager', 'facilitator']`

#### Scenario: Audit row and structured event carry identical role sets
- **WHEN** `auth.first_access_created` or `auth.role_claim_mapped` fires and its transaction commits
- **THEN** the `roles` (and, for `auth.role_claim_mapped`, `previousRoles`) arrays on the `audit_log` row and on the post-commit structured event are identical in content and order

#### Scenario: First role-claim row after the upgrade shows the backfill as the previous set
- **GIVEN** a user backfilled by the upgrade with `global_role = 'application_admin'` and `roles = ['application_admin']`, whose claim maps to `application_admin` and `engineering_manager`
- **WHEN** they next sign in
- **THEN** the `auth.role_claim_mapped` row has `previousRole = 'application_admin'`, `previousRoles = ['application_admin']` and `roles = ['application_admin', 'engineering_manager']`, so this row's set difference comes from the backfill, not from an IdP change
- **AND WHEN** they sign in again with the same claim
- **THEN** that row has `previousRoles = ['application_admin', 'engineering_manager']` and `roles = ['application_admin', 'engineering_manager']`

#### Scenario: Other operations leave actor_roles empty
- **WHEN** any audit operation other than `auth.first_access_created` or `auth.role_claim_mapped` writes an `audit_log` row
- **THEN** `actor_roles` is NULL and `actor_global_role` is populated as before
