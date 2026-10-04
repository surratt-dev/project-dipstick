## MODIFIED Requirements

### Requirement: First Access and role-claim-mapping events are durably recorded

Every `auth.first_access_created` emission, and every `auth.role_claim_mapped` emission, SHALL also produce an `INSERT INTO audit_log` row, written in the same database transaction as the account-resolving write (`resolveOrCreateAccount`'s UPSERT into `users`) that immediately precedes it. If the audit `INSERT` fails, it SHALL be rethrown as an `AuditWriteError` (`packages/backend/src/auth/errors.ts`) before the transaction rolls back — never as the raw underlying database error — so that the failure is classified by `mapAuthError`/`sanitizeOidcError` as `internal_error` rather than folded into their generic OIDC-error handling (see "OIDC library error sanitization" below); `resolveOrCreateAccount`'s own UPSERT failure, by contrast, is unaffected by this requirement and propagates as today. If acquiring the database connection for this transaction fails before the transaction begins (e.g. connection pool exhaustion), it SHALL likewise be rethrown as `AuditWriteError` — there is no transaction to roll back in that case, since none was opened. The transaction SHALL roll back, and the account-resolving write SHALL NOT be committed, when the audit `INSERT` itself fails — this coupling is deliberate, not an oversight. The audit `INSERT` SHALL run with a shorter statement-level timeout than the fail-open group's write-level timeout, so that a hung `INSERT` is cancelled by the database itself rather than left outstanding on the connection the subsequent `ROLLBACK` needs. The existing structured `emitAuditEvent` call for `auth.first_access_created`/`auth.role_claim_mapped` SHALL fire only after this transaction commits successfully — never before, and never when the transaction rolls back — so that a rolled-back transaction cannot produce a structured log entry claiming the event happened for a write that was undone. `actor_user_id` SHALL be the resolved user's id; `actor_global_role` SHALL be the resolved user's `globalRole`; `actor_ip` SHALL be populated from the live request; `team_id` SHALL be `NULL` — account resolution and role-claim mapping are account-level, not team-scoped. `auth.role_claim_mapped`'s row's `metadata` SHALL include `previousRole` — the account's `global_role` value immediately before this authentication's UPSERT applied, captured in the same statement as the UPSERT — in addition to the existing `globalRole`, `oidcSubject`, and `correlationId` fields. `auth.first_access_created`'s row's `metadata` SHALL include `oidcSubject`, `oidcIssuer`, and `globalRole`.

**Firing condition for `auth.role_claim_mapped`.** `auth.first_access_created` fires when, and only when, the authentication created the account (`isNewUser`). For a returning user (`isNewUser` false), `auth.role_claim_mapped` SHALL fire when, and only when, the newly mapped `globalRole` is not `engineer` **or** differs from `previousRole`. It therefore fires on every sign-in of a user holding a non-default role, and on every change of role, including a demotion to `engineer` from `facilitator`, `senior_engineer`, `engineering_manager`, or `application_admin`. It does not fire when a user whose previous role was `engineer` signs in and is mapped to `engineer` — whether the claim was absent, `engineer`, or contained only non-allowlisted values. In that last case the allowlist warning (see `first-access`) is the only output: no `audit_log` row and no structured `auth.role_claim_mapped` entry. This requirement is the single home for the demotion audit assertions; `first-access` scenarios refer here rather than restating them. The `audit_log` row and the structured log entry SHALL be gated by one shared predicate, so they cannot disagree about whether the event happened. For a demotion row, `actor_global_role` is the new role (`engineer`); `metadata.previousRole` carries the role that was removed.

**Structured log fields.** The structured `auth.role_claim_mapped` log entry SHALL carry `previousRole` (the same value written to the row's `metadata`) in addition to `userId`, `oidcSubject`, `globalRole`, `sourceIp`, and `correlationId`. Neither the row nor the log entry SHALL carry the raw role-claim value.

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
- **AND** the structured `auth.role_claim_mapped` log entry, emitted after commit, carries the same `previousRole` value

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


#### Scenario: Demotion from facilitator is recorded
- **WHEN** a returning user with `users.global_role = 'facilitator'` authenticates with no role claim
- **THEN** `users.global_role` becomes `'engineer'`
- **AND** exactly one `audit_log` row with `operation = 'auth.role_claim_mapped'` is written in the same transaction as the `users` UPSERT, with `actor_global_role = 'engineer'`, `metadata.previousRole = 'facilitator'`, and `metadata.globalRole = 'engineer'`
- **AND** after commit, exactly one structured `auth.role_claim_mapped` log entry is emitted with `previousRole: 'facilitator'` and `globalRole: 'engineer'`

#### Scenario: Demotion from engineering manager or application admin is recorded
- **WHEN** a returning user with `users.global_role = 'engineering_manager'` (or `'application_admin'`) authenticates with no role claim
- **THEN** `users.global_role` becomes `'engineer'`
- **AND** exactly one `auth.role_claim_mapped` row and one structured log entry record `previousRole = 'engineering_manager'` (or `'application_admin'`) and `globalRole = 'engineer'`

#### Scenario: Demotion from senior engineer is recorded
- **WHEN** a returning user with `users.global_role = 'senior_engineer'` authenticates with no role claim
- **THEN** `users.global_role` becomes `'engineer'`
- **AND** exactly one `audit_log` row with `operation = 'auth.role_claim_mapped'` is written in the same transaction as the `users` UPSERT, with `actor_global_role = 'engineer'`, `metadata.previousRole = 'senior_engineer'`, and `metadata.globalRole = 'engineer'`
- **AND** after commit, exactly one structured `auth.role_claim_mapped` log entry is emitted with `previousRole: 'senior_engineer'` and `globalRole: 'engineer'`

#### Scenario: Demotion by a non-allowlisted claim value is recorded without the value
- **WHEN** a returning user with `users.global_role = 'facilitator'` authenticates with the role claim set to `'superuser'`
- **THEN** `users.global_role` becomes `'engineer'`
- **AND** exactly one `auth.role_claim_mapped` row records `previousRole = 'facilitator'` and `globalRole = 'engineer'`
- **AND** the string `superuser` appears in neither that row nor any structured log entry

#### Scenario: A lateral change between non-default roles is recorded
- **WHEN** a returning user with `users.global_role = 'engineering_manager'` authenticates with the role claim `'facilitator'`
- **THEN** exactly one `auth.role_claim_mapped` row records `previousRole = 'engineering_manager'` and `globalRole = 'facilitator'`

#### Scenario: An unchanged default role is not recorded
- **WHEN** a returning user with `users.global_role = 'engineer'` authenticates with no role claim (or with `'engineer'`)
- **THEN** `auth.role_claim_mapped` does not fire: no `audit_log` row is written for it and no structured log entry is emitted for it

#### Scenario: A non-allowlisted value for a returning engineer produces a warning only
- **WHEN** a returning user with `users.global_role = 'engineer'` authenticates with the role claim set to `'superuser'`
- **THEN** `users.global_role` remains `'engineer'`
- **AND** exactly one allowlist warning is logged (per `first-access`), without the value
- **AND** no `auth.role_claim_mapped` `audit_log` row is written and no structured `auth.role_claim_mapped` log entry is emitted

#### Scenario: An unchanged non-default role is still recorded on every sign-in
- **WHEN** a returning user with `users.global_role = 'senior_engineer'` (or any other non-default role) authenticates with the same role claim
- **THEN** exactly one `auth.role_claim_mapped` row is written with `previousRole` equal to `globalRole`
