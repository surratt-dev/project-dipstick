# session-participation (delta)

## Purpose

This delta extends the dual-check pattern established in the session-participation spec (checking both `users.global_role` AND `team_memberships.role`) from a session-join constraint to a system-wide authorization principle. The pattern must be used by the team-content-access authorization helper for all content access checks — not only at session participation time.

---

## MODIFIED Requirements

### Requirement: Engineering Manager non-participation enforcement

Engineering Managers MUST NOT be recorded as session participants. This check MUST be performed server-side at the session participation endpoint — the endpoint that records a user as an active participant in a session. It MUST NOT be enforced at join time.

**Enforcement point:** The session participation endpoint MUST query BOTH `users.global_role` AND `team_memberships.role` for the requesting user directly from the database before recording them as a participant. If `users.global_role = 'engineering_manager'` OR if `team_memberships.role = 'engineering_manager'` for the team whose session they are attempting to join, the request SHALL be rejected. The check is not skippable and not configurable; it must be structural (server-enforced), not preferential (a UI toggle or admin override).

**Why both fields must be checked:** The `role-assignment` change creates a working path to set `team_memberships.role = 'engineering_manager'` without modifying `users.global_role`. A user may have `users.global_role = 'engineer'` and `team_memberships.role = 'engineering_manager'` for their team. Checking only `users.global_role` would allow this user to participate in the session, violating the no-manager rule. The access control use case defines an Engineering Manager as "a user with an active `engineering_manager` team membership for the relevant team." The enforcement check must match this definition.

**Why not at join time:** The join link flow correctly admits EMs to team membership with `team_memberships.role = 'participant'`. Filtering EMs at join time would create a state where an EM is associated with a team but not listed as a member, which is inconsistent. The enforcement point is session participation, not team membership.

**Mid-session role change — post-change lock-in:** If a user's `team_memberships.role` is changed to `engineering_manager` during an active session, any lock-in request submitted by that user after the change takes effect MUST be rejected at the session participation endpoint. The server MUST read `team_memberships.role` directly from the database on each lock-in request, not from a cached value established at connection time.

**Mid-session role change — pre-change locked-in votes:** A role change does not retroactively invalidate votes that have already been locked in before the change took effect. Locked-in votes are preserved and counted at reveal regardless of subsequent role changes.

**Extended application of the dual-check pattern:** The same dual-check pattern (querying BOTH `users.global_role` AND `team_memberships.role` directly from the database on every request, not from a cached value) SHALL be used by the team-content-access authorization helper for all team content access decisions. The pattern is not specific to session join checks — it is the correct authorization pattern for any decision that depends on a user's role relative to a team. Any authorization check that queries only one of the two fields creates a bypass path:
- Checking only `users.global_role` misses users whose team role differs from their global role (e.g., a user with `global_role = 'engineer'` who has been assigned `team_memberships.role = 'engineering_manager'` by an admin).
- Checking only `team_memberships.role` misses the EM identity check that the TEAM-006 path requires.

Both fields must be read from the database (not from cache) on every authorization check.

#### Scenario: Engineering Manager attempts to join a session as a participant — global_role check

- **WHEN** a user with `users.global_role = 'engineering_manager'` calls the session participation endpoint
- **THEN** the endpoint rejects the request
- **AND** the user is not recorded as a session participant

#### Scenario: Engineering Manager attempts to join a session as a participant — membership_role check

- **WHEN** a user with `team_memberships.role = 'engineering_manager'` for the relevant team calls the session participation endpoint
- **AND** that user's `users.global_role` is not `engineering_manager`
- **THEN** the endpoint rejects the request
- **AND** the user is not recorded as a session participant

#### Scenario: EM enforcement is server-side and cannot be bypassed

- **WHEN** a client sends a request to the session participation endpoint on behalf of a user who is an Engineering Manager (by either `users.global_role` or `team_memberships.role`)
- **THEN** the server checks both fields directly from the database (not from any client-supplied value) and rejects the request

#### Scenario: Mid-session role change — lock-in attempt after change is rejected

- **WHEN** a user's `team_memberships.role` is changed to `engineering_manager` during an active session
- **AND** the user subsequently sends a lock-in request to the session participation endpoint
- **THEN** the endpoint rejects the lock-in request
- **AND** the vote is not recorded

#### Scenario: Mid-session role change — previously locked-in votes are preserved

- **WHEN** a user locks in a vote on a topic
- **AND** the user's `team_memberships.role` is subsequently changed to `engineering_manager` before the topic reveal
- **THEN** the already-locked-in vote is not invalidated
- **AND** the vote is included in the reveal count

#### Scenario: User with only participant membership_role can join a session

- **WHEN** a user with `users.global_role = 'engineer'` and `team_memberships.role = 'participant'` for the relevant team calls the session participation endpoint
- **THEN** the endpoint permits the request
- **AND** the user is recorded as a session participant

#### Scenario: Dual-check pattern is used by the team-content-access authorization helper

- **WHEN** the team-content-access authorization helper evaluates a request from a user to access a team's content
- **THEN** the helper queries both `users.global_role` AND `team_memberships.role` directly from the database
- **AND** the helper does not resolve either field from a cached value or client-supplied claim
- **AND** a user with `users.global_role = 'engineer'` and `team_memberships.role = 'engineering_manager'` receives the EM content access profile (aggregate vote distributions only), not the engineer content access profile
