## MODIFIED Requirements

### Requirement: Authorized actor can change a team member's membership role

An authorized actor SHALL be able to change a team member's `team_memberships.role` via the member management view, submitted through `PATCH /api/v1/teams/:teamId/members/:userId/role` (TEAM-005) — **subject to the restriction below.** `TEAM-005` supports demotion (`engineering_manager` → `participant`) for any currently-authorized actor exactly as before. `TEAM-005` does NOT support promotion (`participant` → `engineering_manager`) under any circumstance; establishing a new Engineering Manager relationship for a team is exclusively `TEAM-006`'s (`POST /api/v1/teams/:teamId/managers`) function per Decision 1.

**Unconditional promotion block:** `TEAM-005` SHALL reject any request that would change a team member's `membership_role` from `participant` to `engineering_manager`. This restriction:
- Applies regardless of actor — an Application Admin or an EM otherwise authorized to call `TEAM-005` for this team is rejected identically for this specific transition, with no actor-role branch in the check (design.md Decision B, resolving the former Open Question 1: block all actors, including Application Admin, unconditionally).
- Applies regardless of identity — actor and target being the same person is not a special case; the block fires the same way it does for any two-account case.
- Applies regardless of the target's existing `global_role` — a target who already legitimately holds `users.global_role = 'engineering_manager'` (e.g., from EM status on a different team) is still rejected; only `TEAM-006`, with its own `global_role` precondition and audit trail, may establish that specific team relationship.
- MUST NOT be bypassable through any feature flag, environment variable, configuration value, or admin-only override. The restriction is unconditional in code.

**Authorized actors (Q1 Option A) — unchanged for the demotion direction:**
- `users.global_role = 'application_admin'` — authorized to demote an Engineering Manager on any team
- `users.global_role = 'engineering_manager'` with an active (`removed_at IS NULL`) `team_memberships` row with `role = 'engineering_manager'` for the specific `teamId` in the request URL — authorized to demote an Engineering Manager on their own team only

The authorization check MUST query the `team_memberships` table directly at request time using the `teamId` from the request path. It MUST NOT use role information from session state, in-memory state, or token claims. An EM on Team A calling the endpoint for Team B MUST receive 403.

Facilitators are not authorized actors. `TEAM-006` is not called by `TEAM-005`'s demotion path. `users.global_role` is never written by this change.

The role selector MUST display human-readable labels, not database enum values:
- `participant` displays as **Engineer**
- `engineering_manager` displays as **Engineering Manager**

Each option in the role selector MUST include an inline description:
- **Engineer** — participates in session voting
- **Engineering Manager** — can view session history; will not vote

The assignable roles are Engineer and Engineering Manager only. Facilitator is NOT assignable through this change. Selecting "Engineering Manager" for a member currently designated Engineer in the UI submits a request that the server rejects per the restriction above; the UI's redirect/error handling for this case is out of scope for this delta and is a frontend follow-on (see this change's tasks.md).

#### Scenario: TEAM-005 rejects a promotion attempt and does not change the member's role

- **WHEN** an otherwise-authorized actor submits a PATCH to TEAM-005 requesting `role = 'engineering_manager'` for a team member whose current `membership_role = 'participant'`
- **THEN** the server rejects the request
- **AND** the member's `team_memberships.role` remains `participant`
- **AND** the response identifies TEAM-006 as the correct endpoint for establishing a new Engineering Manager relationship

#### Scenario: TEAM-005 rejects a promotion attempt even when the target already holds engineering_manager global_role from a different team

- **WHEN** an EM with legitimate standing on Team A submits a PATCH to TEAM-005 requesting `role = 'engineering_manager'` for a Team-A participant who already holds `users.global_role = 'engineering_manager'` from an established EM relationship on Team B
- **THEN** the server rejects the request
- **AND** the target's `team_memberships.role` for Team A remains `participant`
- **AND** no EM read-access grant to Team A results for the target

#### Scenario: TEAM-005 rejects a self-targeted promotion attempt

- **WHEN** a user with EM standing on Team A submits a PATCH to TEAM-005 requesting `role = 'engineering_manager'` for their own `participant`-role membership on a different team
- **THEN** the server rejects the request the same way it rejects a two-account promotion attempt
- **AND** actor-equals-target is not treated as an implicit exception

#### Scenario: Authorized actor demotes Engineering Manager to Engineer

- **WHEN** an authorized actor selects "Engineer" for a team member currently designated as Engineering Manager
- **THEN** the application submits a PATCH to TEAM-005 with `role = 'participant'`
- **AND** on success, the member management view reflects "Engineer" for that member
- **AND** a plain-language confirmation is displayed: "[Member name] is now an Engineer for this team"

#### Scenario: Unauthorized actor cannot change roles

- **WHEN** a user who is not an Application Admin or an active EM for the specific team attempts to change a team member's role
- **THEN** the request is rejected by the server with 403
- **AND** the member management view does not display an actionable role selector for that user

#### Scenario: Role selector shows only valid assignable roles

- **WHEN** an authorized actor views the role selector for a team member
- **THEN** the selector contains exactly two options: "Engineer" and "Engineering Manager"
- **AND** "Facilitator" is not present as an option

### Requirement: Role change is audited

Every change to `team_memberships.role` MUST produce an audit log entry in the `audit_log` table (`operation = 'team.role_changed'`), with `from_role` and `to_role` recorded in the `metadata` JSONB column. (`role_change_audit` was a dedicated table dropped in migration 8 and replaced by the shared `audit_log` table — this requirement is written against the current schema.) The audit write MUST execute in the same database transaction as the role change. If the audit write fails, the transaction MUST roll back and the role change MUST NOT commit.

The audit record MUST include:
- `actor_user_id` — the actor's user ID
- `actor_global_role` — the actor's `users.global_role` at the time of the change, stored as `text` (not a foreign key or enum) for audit durability against future schema changes
- `actor_ip` — the actor's IP address, populated from `request.ip` (resolves to real client IP given `trustProxy: 1`)
- `subject_user_id` — the affected user's ID
- `team_id` — the team ID
- `from_role` — the previous `team_memberships.role` value
- `to_role` — the new `team_memberships.role` value
- `changed_at` — timestamp of the change

**Demotion (`engineering_manager` → `participant`) MUST be logged in `audit_log` with `operation = 'team.role_changed'`.** This is now the only `team_memberships.role` transition `TEAM-005` can produce. Promotion (`participant` → `engineering_manager`) no longer occurs through `TEAM-005` — that event, and its audit record (`operation = 'team.manager_established'` in `audit_log`), comes exclusively from `TEAM-006` per the `manager-team-association` capability. An `audit_log` row with `operation = 'team.role_changed'`, `metadata->>'from_role' = 'participant'`, and `metadata->>'to_role' = 'engineering_manager'` MUST NOT occur going forward; if the underlying data model still permits recording such a row, its presence indicates the write-side restriction above did not hold and MUST be treated as a defect, not a valid audit outcome.

A *blocked* promotion attempt itself produces a distinguishable audit event, separate from the rejected request's error response: a synchronous `audit_log` row with `operation = 'team.role_change_denied'`, plus a matching `emitAuditEvent` call, written before the error response is sent, for actors who pass the base `TEAM-005` authorization check (design.md Decision F, resolving the former Open Question 3).

The audit log is append-only. Audit records are not deletable through any application UI or API — deletion requires direct database access by a designated DBA under change control.

**Retention:** Minimum 12 months from the date of each role change event.

**Access:** Accessible to Application Admins only through the application. Engineering Managers do not have read access to the audit trail in the initial implementation.

#### Scenario: Demotion to Engineer is logged

- **WHEN** a user's `team_memberships.role` is changed from `engineering_manager` to `participant`
- **THEN** an audit log entry is created with all required fields including `actor_global_role` and `actor_ip`

#### Scenario: Audit write failure rolls back the role change

- **WHEN** the audit INSERT fails within the transaction
- **THEN** the transaction is rolled back and the role change is not committed
- **AND** a role change with no audit record is not a possible outcome through normal application paths

#### Scenario: A blocked promotion attempt does not produce a team.role_changed audit entry for the attempted transition, but does produce a distinguishable denial event

- **WHEN** TEAM-005 rejects a `participant → engineering_manager` promotion attempt from an actor who is otherwise authorized to call TEAM-005
- **THEN** no `audit_log` row with `operation = 'team.role_changed'`, `metadata->>'from_role' = 'participant'`, and `metadata->>'to_role' = 'engineering_manager'` is created
- **AND** the team member's `team_memberships.role` is unchanged
- **AND** an `audit_log` row with `operation = 'team.role_change_denied'` is created before the error response is sent, carrying the actor, target, team, and requested transition
