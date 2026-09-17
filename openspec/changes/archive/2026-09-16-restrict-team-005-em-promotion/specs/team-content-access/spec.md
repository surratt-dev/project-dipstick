## MODIFIED Requirements

### Requirement: Authorization helper evaluates three access paths and returns a role-qualified grant

The application SHALL provide a reusable server-side authorization helper that evaluates whether an authenticated user is authorized to access a specific team's content. The helper MUST return a typed role-qualified access grant or deny access. It MUST NOT return a single boolean. It MUST execute a live database read on every call; the result MUST NOT be cached at any layer (see Requirement: Authorization results are not cached).

The helper MUST evaluate the following three paths in order:

**Path 1 — Team member:** The user has an active `team_memberships` row (`removed_at IS NULL`) for the requested team. Sub-case:
- `membership_role = 'participant'`: grant type `{ path: 'member', role: 'participant', teamId }`

A `team_memberships` row with `role = 'engineering_manager'` does NOT, by itself, grant `role: 'engineering_manager'` access through Path 1. `membership_role = 'engineering_manager'` alone is insufficient — this exact sub-case (granting EM access from `membership_role` alone, without confirming `global_role`) was the read-side half of the TEAM-005 EM-promotion gap (issue #109) and MUST NOT be reintroduced. A user whose `team_memberships.role = 'engineering_manager'` but whose `users.global_role != 'engineering_manager'` is evaluated under the mismatched-state handling defined below, not granted access via Path 1.

**Path 2 — Engineering Manager by explicit association:** The user has `users.global_role = 'engineering_manager'` AND an active `team_memberships` row with `role = 'engineering_manager'` for the requested team. Grant type: `{ path: 'member', role: 'engineering_manager', teamId }`. This is the TEAM-006 path; the dual-check on both `users.global_role` and `team_memberships.role` MUST be performed, and — as of this change — is the ONLY path by which the helper may return a grant with `role: 'engineering_manager'`. Both fields MUST be read live from the database on every call, from the same query used to evaluate Path 1; the helper MUST NOT perform two separate database reads for what is structurally one authorization question.

**Path 3 — Active session facilitator:** The user has an active session row for the requested team:
```sql
sessions.facilitator_id = $current_user
AND sessions.team_id = $requested_team
AND (
  sessions.status IN ('draft', 'lobby', 'pre_session', 'active', 'wrap_up')
  OR (
    sessions.status = 'complete'
    AND sessions.facilitator_access_expires_at > NOW()
  )
)
```
Grant type: `{ path: 'facilitator', sessionId, teamId, sessionStatus }`.

**Application Admin path:** A user with `users.global_role = 'application_admin'` who has no `team_memberships` row for the requested team MUST NOT be granted access to session content endpoints. They SHALL be granted access only to administrative data endpoints (see Requirement: Application Admin access is limited to administrative data).

**Mismatched-state handling:** A user with `team_memberships.role = 'engineering_manager'` for the requested team but `users.global_role != 'engineering_manager'` matches neither Path 1's participant sub-case nor Path 2's dual-check. This state is expected to be unreachable through normal operation once TEAM-005 no longer originates `participant → engineering_manager` transitions (see the role-assignment capability) and TEAM-006 continues to enforce its `global_role` precondition — but the helper MUST NOT assume it cannot occur, since a future write path could reintroduce it. Per design.md Decision E, the helper MUST degrade gracefully: it returns a grant of `role: 'participant'` (not `null`, not a 403, and never a bare grant of `role: 'engineering_manager'`), and MUST emit a structured, log-only `team.access_grant_mismatch` event carrying `userId`, `teamId`, the mismatched `global_role`, and `membership_role`. This event MUST NOT be written as a synchronous `audit_log` row, since this helper executes on essentially every content request.

If none of the three paths matches, the helper denies access. A user in the mismatched state above is not denied outright — see Decision E's graceful-degrade resolution.

#### Scenario: Team member with participant role is granted access

- **WHEN** the authorization helper is called for a user with an active `team_memberships` row with `role = 'participant'` for the requested team
- **THEN** the helper returns a grant with `path = 'member'` and `role = 'participant'`

#### Scenario: EM with team_memberships.role = engineering_manager AND matching global_role is granted access via Path 2

- **WHEN** the authorization helper is called for a user with `users.global_role = 'engineering_manager'` AND an active `team_memberships` row with `role = 'engineering_manager'` for the requested team
- **THEN** the helper returns a grant with `path = 'member'` and `role = 'engineering_manager'`
- **AND** the helper has checked both `users.global_role` and `team_memberships.role` from the database in the same query

#### Scenario: team_memberships.role = engineering_manager alone, without a matching global_role, does not grant EM access

- **WHEN** the authorization helper is called for a user with an active `team_memberships` row with `role = 'engineering_manager'` for the requested team
- **AND** that user's `users.global_role != 'engineering_manager'`
- **THEN** the helper does NOT return a grant with `role: 'engineering_manager'`
- **AND** this holds regardless of how the mismatched `team_memberships` row came to exist

#### Scenario: Active session facilitator is granted scoped access

- **WHEN** the authorization helper is called for a user with a `sessions` row where `facilitator_id = $user`, `team_id = $team`, and `status IN ('lobby', 'pre_session', 'active', 'wrap_up')`
- **THEN** the helper returns a grant with `path = 'facilitator'` and the active session's `sessionId` and `sessionStatus`

#### Scenario: Facilitator with only a completed session row is denied access after grace window expiry

- **WHEN** the authorization helper is called for a facilitator whose only session row for the requested team has `status = 'complete'` and `facilitator_access_expires_at < NOW()`
- **THEN** the helper denies access
- **AND** access is not granted on the basis of `global_role = 'facilitator'` alone

#### Scenario: Facilitator with completed session within grace window is granted access

- **WHEN** the authorization helper is called for a facilitator whose session for the requested team has `status = 'complete'` and `facilitator_access_expires_at > NOW()`
- **THEN** the helper returns a grant with `path = 'facilitator'` and `sessionStatus = 'complete'`
- **AND** the grant is marked read-only (no write operations are permitted during the grace window)

#### Scenario: User with no team relationship is denied

- **WHEN** the authorization helper is called for an authenticated user who has no `team_memberships` row for the requested team and no active session as facilitator
- **THEN** the helper denies access
- **AND** no grant object is returned

#### Scenario: Application Admin with no team membership is denied session content

- **WHEN** the authorization helper is called for a user with `global_role = 'application_admin'` and no `team_memberships` row for the requested team
- **AND** the requested resource is a session content endpoint (session history, trend data, votes, action items)
- **THEN** the helper denies access
