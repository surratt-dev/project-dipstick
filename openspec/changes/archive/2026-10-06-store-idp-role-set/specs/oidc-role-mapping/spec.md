# Spec Delta: oidc-role-mapping

## MODIFIED Requirements

### Requirement: Fixed precedence across several mapped values
When one or more normalized values map to a role, the resolved `global_role` SHALL be the highest of those roles in the fixed order `application_admin` > `engineering_manager` > `facilitator` > `senior_engineer` > `engineer`. The order SHALL NOT be configurable. `users.global_role` SHALL hold exactly one value. `users.roles` SHALL hold every mapped role once, highest first, and `users.global_role` SHALL equal its first element. Audit data SHALL record the role set in the same order.

#### Scenario: Admin and facilitator resolve to admin
- **WHEN** a user's claim values map to `application_admin` and `facilitator`
- **THEN** the user's `global_role` is `application_admin`
- **AND** the user's `roles` is exactly `[application_admin, facilitator]`

#### Scenario: Manager and facilitator resolve to manager (known behaviour)
- **WHEN** a user's claim values map to `engineering_manager` and `facilitator`
- **THEN** the user's `global_role` is `engineering_manager`
- **AND** the user's `roles` is exactly `[engineering_manager, facilitator]`
- **AND** no user-facing notice is shown by this capability (the notice belongs to #241)

#### Scenario: Admin and manager resolve to admin
- **WHEN** a user's claim values map to `application_admin` and `engineering_manager`
- **THEN** the user's `global_role` is `application_admin`
- **AND** the user's `roles` is exactly `[application_admin, engineering_manager]`, so the manager role is recorded even though it does not win precedence
- **AND** the user cannot take part in or receive live events of any session (see `session-participation` and `websocket-session-authorization`)

#### Scenario: Facilitator and senior engineer resolve to facilitator
- **WHEN** a user's claim values map to `facilitator` and `senior_engineer`
- **THEN** the user's `global_role` is `facilitator`
- **AND** the user's `roles` is exactly `[facilitator, senior_engineer]`

#### Scenario: Duplicate and out-of-order mapped values are stored once, highest first
- **WHEN** a user's claim is `["Facilitators", "Eng-Mgrs", "Dipstick-Admins", "Eng-Mgrs"]` and those keys map to `facilitator`, `engineering_manager` and `application_admin`
- **THEN** the user's `roles` is exactly `[application_admin, engineering_manager, facilitator]`
- **AND** the user's `global_role` is `application_admin`

#### Scenario: Single-string claim stores a one-element set
- **WHEN** a user's claim is the single string `"facilitator"` (not an array) and that value maps to `facilitator`
- **THEN** the user's `roles` is exactly `[facilitator]` and `global_role` is `facilitator`

#### Scenario: Admin and senior engineer store the full set
- **WHEN** a user's claim values map to `application_admin` and `senior_engineer`
- **THEN** the user's `roles` is exactly `[application_admin, senior_engineer]` and `global_role` is `application_admin`
- **AND** no precedence-discard line is logged, because `senior_engineer` is outside the discard scope

---

### Requirement: Fixed engineer fallback
When no normalized value maps to a role, including when the claim is missing, the resolved `global_role` SHALL be `engineer`. The fallback SHALL NOT be configurable. In that case `users.roles` SHALL be exactly `{engineer}`. `engineer` SHALL appear in `users.roles` only as its sole element; it is the absence of a mapped role, not a role held alongside others.

#### Scenario: Nothing mapped
- **WHEN** a user's claim is `["All-Staff", "Building-3"]` and neither value is a map key
- **THEN** the user's `global_role` is `engineer`, the user's `roles` is exactly `[engineer]`, and sign-in succeeds

#### Scenario: Missing claim stores the engineer set
- **WHEN** a user signs in without the configured role claim
- **THEN** the user's `roles` is exactly `[engineer]`

#### Scenario: Senior engineer alone does not include engineer
- **WHEN** a user's claim values map only to `senior_engineer`
- **THEN** the user's `roles` is exactly `[senior_engineer]`

#### Scenario: Inherited property names produce the engineer set
- **WHEN** the role claim is `["toString", "__proto__", "constructor"]` and none of these is a key the operator wrote
- **THEN** the user's `roles` is exactly `[engineer]`

---

### Requirement: Precedence-discard signal
When the resolved role outranks `facilitator` or `engineering_manager` and a claim value also mapped to that role, the application SHALL log one warn-level line carrying the claim name, the resolved internal role, the discarded internal roles and the `correlationId`, and nothing else derived from the token. A discarded `senior_engineer` SHALL NOT be reported. The line SHALL be emitted on every such sign-in, new or returning, without de-duplication. Discarded roles stay in `users.roles`.

#### Scenario: Admin who is also in the facilitator group
- **WHEN** a returning user's claim values map to `application_admin` and `facilitator`
- **THEN** the user's `global_role` is `application_admin`
- **AND** one warn-level discard line is logged with the claim name, `resolvedRole = application_admin`, `discardedRoles = [facilitator]` and the `correlationId`, and no claim values
- **AND** the user's `roles` still contains `facilitator`

#### Scenario: Manager who is also in the facilitator group
- **WHEN** a returning user's claim values map to `engineering_manager` and `facilitator`
- **THEN** the user's `global_role` is `engineering_manager`
- **AND** one warn-level discard line is logged with `resolvedRole = engineering_manager`, `discardedRoles = [facilitator]` and no claim values

#### Scenario: Manager who is also in the admin group
- **WHEN** a user's claim values map to `application_admin` and `engineering_manager`
- **THEN** the user's `global_role` is `application_admin`
- **AND** one warn-level discard line is logged with `resolvedRole = application_admin`, `discardedRoles = [engineering_manager]` and the `correlationId`, and no claim values

#### Scenario: Admin who is also in the manager and facilitator groups
- **WHEN** a user's claim values map to `application_admin`, `engineering_manager` and `facilitator`
- **THEN** exactly one warn-level discard line is logged with `discardedRoles` listing both `engineering_manager` and `facilitator`

#### Scenario: Facilitator-only user produces no discard signal
- **WHEN** a user's claim values map only to `facilitator`
- **THEN** no discard line is logged

#### Scenario: Senior engineer discard is not reported
- **WHEN** a user's claim values map to `facilitator` and `senior_engineer`
- **THEN** no discard line is logged
- **AND** the user's `roles` still contains `senior_engineer`

---

### Requirement: Outranked roles are recorded in the audit role set
A role outranked by precedence SHALL be recorded durably only through the role set carried by the sign-in audit rows (see `auth-error-handling`), in addition to the precedence-discard log line. Neither `auth.first_access_created` nor `auth.role_claim_mapped` metadata SHALL carry a discard flag, and no separate conflict operation SHALL be written. A user-visible record or notice of this conflict belongs to #241.

#### Scenario: Discard on a returning sign-in adds no audit flag
- **WHEN** a returning user's claim values map to `application_admin` and `facilitator`
- **THEN** the `auth.role_claim_mapped` metadata carries `roles = [application_admin, facilitator]`
- **AND** it carries no discard flag

#### Scenario: Discard on a first sign-in is logged, not audited
- **WHEN** a user with no prior account signs in and their claim values map to `application_admin` and `facilitator`
- **THEN** one warn-level discard line is logged
- **AND** the `auth.first_access_created` metadata carries `roles = [application_admin, facilitator]` and no discard flag

## RENAMED Requirements

- FROM: `### Requirement: Precedence discard is logged, not audited`
- TO: `### Requirement: Outranked roles are recorded in the audit role set`

## ADDED Requirements

### Requirement: Stored role set is consistent with the single role by construction
The database SHALL reject any `users` row whose `roles` is malformed (not one-dimensional, not starting at index 1, or containing NULL), is empty, has a first element other than `global_role`, contains `engineer` alongside another role, or is not strictly descending in precedence. An unknown check result SHALL count as a rejection.

#### Scenario: Role set disagreeing with the single role is rejected
- **WHEN** any writer stores a `users` row with `global_role = 'facilitator'` and `roles = {application_admin, facilitator}`
- **THEN** the write fails with a check-constraint violation and no row changes

#### Scenario: Empty role set is rejected
- **WHEN** any writer stores a `users` row with `roles = {}`
- **THEN** the write fails with a check-constraint violation

#### Scenario: Engineer alongside another role is rejected
- **WHEN** any writer stores a `users` row with `roles = {senior_engineer, engineer}`
- **THEN** the write fails with a check-constraint violation

#### Scenario: Duplicate or ascending order is rejected
- **WHEN** any writer stores a `users` row with `roles = {facilitator, facilitator}` or `roles = {facilitator, application_admin}`
- **THEN** the write fails with a check-constraint violation

#### Scenario: Malformed role arrays are rejected
- **WHEN** any writer stores a `users` row with `roles = {NULL}`, `roles = {application_admin, NULL}`, a two-dimensional `roles = {{facilitator}}`, or `global_role = 'facilitator'` with `roles = [0:1]={application_admin, facilitator}`
- **THEN** each write fails with a check-constraint violation and no row changes

#### Scenario: A non-role value cannot be stored
- **WHEN** any writer stores `roles = {toString}`
- **THEN** the write fails because `toString` is not a valid internal role

---

### Requirement: The role set has no column default
`users.roles` SHALL be NOT NULL with no column default. The application's writer SHALL always state the set; only the legacy-writer shim (see "The previous build keeps working through the upgrade window") supplies one, and always `{global_role}`.

#### Scenario: Omitting the role set never stores a default other than the single role
- **WHEN** any writer inserts a `users` row with `global_role = 'facilitator'` and no `roles` value
- **THEN** the stored `roles` is exactly `[facilitator]`, never `[engineer]` or any other set

---

### Requirement: Existing accounts are backfilled without changing any role
On upgrade, every existing `users` row SHALL receive `roles = {global_role}`, and no row's `global_role` SHALL change. Until a user's next interactive sign-in, the backfilled set can under-record roles they hold; the backfill SHALL never record a role other than the user's current `global_role`.

#### Scenario: Existing admin is backfilled with a single-element set
- **WHEN** the upgrade runs against a user with `global_role = 'application_admin'`
- **THEN** the user's `roles` is exactly `[application_admin]` and `global_role` is still `application_admin`

#### Scenario: Next sign-in replaces the backfilled set
- **WHEN** a backfilled user whose claim maps to `application_admin` and `engineering_manager` next signs in
- **THEN** the user's `roles` becomes `[application_admin, engineering_manager]`

#### Scenario: Fresh install passes the consistency rule
- **WHEN** all migrations run against an empty database, including the seed data that precedes the migration adding `roles`
- **THEN** every seeded `users` row has `roles = {global_role}` and satisfies the consistency rule

---

### Requirement: The previous build keeps working through the upgrade window
After the migration adding `users.roles` has applied, while the previous build still serves, a `users` write that sets `global_role` without stating `roles` SHALL succeed, storing `roles = {global_role}` when the row is new or its `global_role` changed and leaving `roles` unchanged otherwise. An UPDATE restating the stored `roles` counts as omitting it. Any other stated `roles` SHALL NOT be altered and stays subject to the consistency rule. This is transitional and removed in contract step 1.

#### Scenario: First sign-in through the previous build after the migration
- **WHEN** the migration has applied, the previous build is still serving, and a user with no account signs in and resolves to `facilitator`
- **THEN** the sign-in succeeds and the new row has `global_role = 'facilitator'` and `roles = [facilitator]`

#### Scenario: Role-changing sign-in through the previous build after the migration
- **WHEN** the migration has applied, the previous build is still serving, and a returning user stored as `global_role = 'facilitator'`, `roles = [facilitator]` signs in and resolves to `engineer`
- **THEN** the sign-in succeeds and the row has `global_role = 'engineer'` and `roles = [engineer]`

#### Scenario: Unchanged-role sign-in through the previous build keeps the stored set
- **WHEN** the previous build signs in a returning user stored as `roles = [application_admin, engineering_manager]` who still resolves to `application_admin`
- **THEN** the sign-in succeeds and `roles` is still `[application_admin, engineering_manager]`

#### Scenario: A stated inconsistent role set is not swallowed by the shim
- **WHEN** any writer UPDATEs a `users` row stored as `global_role = 'facilitator'`, `roles = [facilitator]`, setting `global_role = 'engineering_manager'` and `roles = {facilitator, senior_engineer}`
- **THEN** the write fails with a check-constraint violation and the row still has `global_role = 'facilitator'` and `roles = [facilitator]`

#### Scenario: The new build's writes are never altered
- **WHEN** the new build signs in a user whose claim maps to `engineering_manager` and `facilitator`
- **THEN** the stored `roles` is exactly `[engineering_manager, facilitator]`

---

### Requirement: Rollback redeploys the previous build before any down migration
The documented rollback SHALL redeploy the previous build, and confirm that no instance of the new build is serving, before any down migration of `users.roles` is run. The down migration SHALL be optional, because the previous build works on the migrated schema.

#### Scenario: Rollback keeps sign-in working
- **WHEN** an operator rolls back by following the upgrade notes
- **THEN** sign-in succeeds at every step, both before and after the optional down migration

---

### Requirement: The migration's effect on live sessions is bounded
The migration adding `users.roles` SHALL hold its lock on `users` for at most 1 second on a 10,000-user table and wait at most 5 seconds to acquire it; failing that, it SHALL roll back with no schema change and exit non-zero so it can be re-run. It SHALL NOT end any open lobby or live session, cause a re-authorization refusal, or require anyone to sign in again. A request reading `users` is delayed at most once, by about 6 seconds.

#### Scenario: Migration fails cleanly when it cannot get the lock
- **WHEN** a long-running transaction holds a conflicting lock on `users` and the migration runs
- **THEN** the migration fails within about 5 seconds and exits non-zero
- **AND** `users` has no `roles` column and no row's `global_role` has changed
- **AND** re-running the migration after the transaction ends succeeds

#### Scenario: Live lobby survives the migration
- **WHEN** the migration runs while a lobby is open over WebSocket
- **THEN** no participant or facilitator is disconnected, refused at re-authorization or asked to sign in again because of the migration

---

### Requirement: The audit role-set column is added without failing audit writes
The migration adding `audit_log.actor_roles` SHALL be separate from the migration adding `users.roles` and SHALL run in its own transaction. It SHALL wait at most 200 milliseconds to acquire its lock on `audit_log`, so that no audit write fails because of it; failing that, it SHALL roll back with no schema change so it can be re-run.

#### Scenario: Audit column migration fails cleanly when it cannot get the lock
- **WHEN** a transaction holds a conflicting lock on `audit_log` and the migration adding `actor_roles` runs
- **THEN** the migration fails within about 200 milliseconds, `audit_log` has no `actor_roles` column, and re-running it after the transaction ends succeeds

#### Scenario: Sign-in during the audit column migration succeeds
- **WHEN** a user signs in while the migration adding `actor_roles` is waiting for or holding its lock
- **THEN** the sign-in succeeds and its sign-in audit row is written

---

### Requirement: The role set does not drive authorization in this step
No authorization decision SHALL read `users.roles`, the audit role-set fields, or `audit_log.actor_roles`. Every check SHALL keep reading `global_role` and team membership exactly as before, so storing the set changes no user's access.

#### Scenario: Facilitator who is also an admin is still refused draft creation
- **WHEN** a user whose claim maps to `application_admin` and `facilitator` tries to create a draft session
- **THEN** the response is 403 with `error.category = "forbidden"` and message "Only a facilitator can create a draft session."
- **AND** no `audit_log` row is written by the request, as before

#### Scenario: Manager who is also an admin is still excluded from sessions
- **WHEN** a user whose claim maps to `application_admin` and `engineering_manager` tries to register as a participant
- **THEN** the response is 403 with `error.category = "invalid_request"` and message "You are not eligible to participate as a voter in this session.", the same response an Engineering Manager receives
- **AND** one `session.participant_registration_rejected` row is written with `actor_global_role = 'application_admin'` and `actor_roles` NULL (it is not a sign-in row; see `auth-error-handling`, "Other operations leave actor_roles empty")

#### Scenario: Manager who is also an admin still cannot be associated as a team's manager
- **WHEN** an authorized actor calls TEAM-006 for a user whose claim maps to `application_admin` and `engineering_manager`
- **THEN** TEAM-006 returns 409 with the `global_role` precondition error code, as before
