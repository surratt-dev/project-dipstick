# session-participation

## Purpose

Defines requirements for recording users as active participants in a session, including enforcement of Engineering Manager non-participation and facilitator-from-another-team constraints. This spec is a first-entry stub: the EM enforcement and facilitator constraints are hard requirements surfaced during the join-team-invite-link change and documented here so they cannot be missed when the session participation feature is designed.

## Requirements

### Requirement: Engineering Manager non-participation enforcement

Engineering Managers MUST NOT be recorded as session participants. This check MUST be performed server-side at the session participation endpoint — the endpoint that records a user as an active participant in a session. It MUST NOT be enforced at join time.

**Enforcement point:** The session participation endpoint MUST query BOTH `users.global_role` AND `team_memberships.role` for the requesting user directly from the database before recording them as a participant. If `global_role = 'engineering_manager'` OR if `team_memberships.role = 'engineering_manager'` for the team whose session they are attempting to join, the request SHALL be rejected. The check is not skippable and not configurable; it must be structural (server-enforced), not preferential (a UI toggle or admin override).

**Why both fields must be checked:** The `assign-role-to-team-member` change creates a working path to set `team_memberships.role = 'engineering_manager'` without modifying `users.global_role`. A user may have `global_role = 'engineer'` and `team_memberships.role = 'engineering_manager'` for their team. Checking only `global_role` would allow this user to participate in the session, violating the no-manager rule. The access control use case defines an Engineering Manager as "a user with an active `engineering_manager` team membership for the relevant team." The enforcement check must match this definition.

**Mid-session role change — post-change lock-in:** If a user's `team_memberships.role` is changed to `engineering_manager` during an active session, any lock-in request submitted by that user after the change takes effect MUST be rejected at the session participation endpoint. The server MUST read `team_memberships.role` directly from the database on each lock-in request, not from a cached value established at connection time.

**Mid-session role change — pre-change locked-in votes:** A role change does not retroactively invalidate votes that have already been locked in before the change took effect. Locked-in votes are preserved and counted at reveal regardless of subsequent role changes.

**Why not at join time:** The join link flow correctly admits EMs to team membership with `role = 'participant'`. Filtering EMs at join time would create a state where an EM is associated with a team but not listed as a member, which is inconsistent. The enforcement point is session participation, not team membership.

#### Scenario: Engineering Manager attempts to join a session as a participant — global_role check
- **WHEN** a user with `global_role = 'engineering_manager'` calls the session participation endpoint
- **THEN** the endpoint rejects the request
- **AND** the user is not recorded as a session participant

#### Scenario: Engineering Manager attempts to join a session as a participant — team membership role check
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

#### Scenario: User with only participant membership role can join a session
- **WHEN** a user with `users.global_role = 'engineer'` and `team_memberships.role = 'participant'` for the relevant team calls the session participation endpoint
- **THEN** the endpoint permits the request
- **AND** the user is recorded as a session participant

---

### Requirement: Facilitator-from-another-team enforcement at session setup

A user who is a member of a team (has a row in `team_memberships` for that team) SHALL NOT be permitted to facilitate a session for that team. This constraint MUST be enforced by the session setup layer via a check against `team_memberships`.

**Enforcement point:** The session setup endpoint MUST check whether the user attempting to act as facilitator has a `team_memberships` row for the team whose session they are setting up. If such a row exists, the request SHALL be rejected (hard block, not a soft warning).

**Why both `global_role` and `team_memberships` checks are required:** A user's `global_role` may be `facilitator` while they also hold a `participant` membership on the team they want to facilitate. Global role confirms they are a facilitator; team membership confirms which team they belong to. A facilitator who joined Team A via a join link is a member of Team A and must not facilitate Team A's sessions, regardless of their global role.

#### Scenario: Facilitator who is a member of a team attempts to facilitate that team's session
- **WHEN** a user with `global_role = 'facilitator'` who has a row in `team_memberships` for Team A attempts to set up a session for Team A
- **THEN** the session setup endpoint rejects the request

#### Scenario: Facilitator from a different team can facilitate a session
- **WHEN** a user with `global_role = 'facilitator'` who has NO row in `team_memberships` for Team A attempts to set up a session for Team A
- **THEN** the session setup endpoint permits the request

---

### Requirement: Mid-session arrival behavior must be defined before implementation

The session participation feature MUST include an explicit decision on how users who join a session after a vote has opened interact with the current vote state. This decision is a hard prerequisite — it must be in the spec before any session participation implementation begins.

**Options the spec MUST choose between (non-exhaustive):**
1. Mid-session arrivals observe the current topic without voting; they vote from the next topic onward.
2. Mid-session arrivals are held in a waiting state until the current topic's reveal is complete, then join from the next topic.
3. Mid-session arrivals can vote on the current topic if the vote has not yet been revealed; they are added to the readiness grid as a new row.

The spec MUST also specify whether the facilitator's readiness grid updates in real time when a new participant joins during an active vote, and what the new participant's state in the grid looks like before they have voted.

#### Scenario: Mid-session arrival behavior is defined before implementation begins
- **WHEN** the session participation feature is being designed
- **THEN** the session participation spec includes an explicit decision on how mid-session arrivals interact with the vote state for the current topic
- **AND** the spec includes a decision on whether the facilitator's readiness grid updates in real time when a new participant joins
