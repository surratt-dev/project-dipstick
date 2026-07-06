## ADDED Requirements

### Requirement: Engineering Manager non-participation enforcement
Engineering Managers (users with `global_role = 'engineering_manager'` on the `users` table) MUST NOT be recorded as session participants. This check MUST be performed server-side at the session participation endpoint — the endpoint that records a user as an active participant in a session. It MUST NOT be enforced at join time (the join link flow correctly admits EMs to team membership).

**Enforcement point:** The session participation endpoint (to be implemented) MUST query `users.global_role` for the requesting user before recording them as a participant. If `global_role = 'engineering_manager'`, the request SHALL be rejected with an appropriate error. This check is not skippable and not configurable.

**Why this layer:** The join link flow correctly adds EMs to `team_memberships` with `role = 'participant'`. Their global role does not change. The distinction between team membership and session participation is structural: being a member of a team does not grant the right to participate in that team's sessions. Engineering Managers have read-only access to session history but do not sit in the session room.

**Why this is a hard requirement:** The no-manager-participation rule is load-bearing for the ritual. A single exception changes what engineers are willing to say. The check must be structural (enforced at the server) not preferential (a UI toggle or admin override). There is no valid configuration that permits EM participation.

#### Scenario: Engineering Manager attempts to join a session as a participant
- **WHEN** a user with `global_role = 'engineering_manager'` calls the session participation endpoint
- **THEN** the endpoint rejects the request with an error
- **AND** the user is not recorded as a session participant

#### Scenario: Engineer joins a session as a participant
- **WHEN** a user with `global_role` of `engineer`, `senior_engineer`, or `facilitator` calls the session participation endpoint and is a member of the team running the session
- **THEN** the user is recorded as a session participant

#### Scenario: EM enforcement is server-side and cannot be bypassed
- **WHEN** a client sends a malformed or forged request to the session participation endpoint on behalf of a user with `global_role = 'engineering_manager'`
- **THEN** the server checks `global_role` directly from the database, not from any client-supplied value, and rejects the request

---

### Requirement: Facilitator-from-another-team enforcement at session setup
A user who is a member of a team (has a row in `team_memberships` for that team) SHALL NOT be permitted to facilitate a session for that team. The facilitator-from-another-team constraint MUST be enforced by the session setup layer via a check against `team_memberships`, not only against `global_role`.

**Enforcement point:** The session setup endpoint (to be implemented) MUST check whether the user attempting to act as facilitator has a `team_memberships` row for the team whose session they are setting up. If such a row exists, the request SHALL be rejected (hard block, not a soft warning). Devon's position is that this must be structural — a warning that can be dismissed defeats the purpose.

**Why `team_memberships` and not just `global_role`:** A user's `global_role` may be `facilitator` while they also hold a `participant` membership on the team they want to facilitate. Global role confirms they are a facilitator; team membership confirms which team they belong to. Both checks are required. A facilitator who joined Team A via a join link is a member of Team A and must not facilitate Team A's sessions, regardless of their global role.

#### Scenario: Facilitator who is a member of a team attempts to facilitate that team's session
- **WHEN** a user with `global_role = 'facilitator'` who has a row in `team_memberships` for Team A attempts to set up a session for Team A
- **THEN** the session setup endpoint rejects the request
- **AND** the user is told they cannot facilitate a session for a team they belong to

#### Scenario: Facilitator from a different team can facilitate a session
- **WHEN** a user with `global_role = 'facilitator'` who has NO row in `team_memberships` for Team A attempts to set up a session for Team A
- **THEN** the session setup endpoint permits the request

---

### Requirement: Mid-session arrival handling relative to the reveal mechanic
The session participation feature MUST define and enforce the behavior for users who join a session after a vote has opened for the current topic. This is a hard requirement on the session participation feature; it MUST be answered before any session participation implementation begins.

**Why this is load-bearing:** The simultaneous reveal mechanic is structural. All participants vote before any votes are revealed. A user who arrives mid-vote and is immediately presented with the vote UI for the current topic — alongside users who voted before the topic opened — creates an asymmetry: their vote is cast after the topic opened, under different conditions. Whether this is acceptable depends on a deliberate design decision, not a default.

**Options the session participation feature MUST choose between (non-exhaustive):**
1. Mid-session arrivals observe the current topic without voting; they vote from the next topic onward.
2. Mid-session arrivals are held in a waiting state until the current topic's reveal is complete, then join from the next topic.
3. Mid-session arrivals can vote on the current topic if the vote has not yet been revealed; they are added to the readiness grid as a new row and the facilitator must wait for them.

**Facilitator readiness grid dependency:** Whichever option is chosen, the session participation spec MUST also specify whether the facilitator's readiness grid updates in real time when a new participant joins during an active vote, and what the new participant's state in the grid looks like before they have voted. If the grid does not update in real time, the facilitator may trigger a reveal before all participants have voted.

This capability is **out of scope** for the join-team-invite-link change. The join link flow's responsibility ends when it routes the user to the session URL. What happens after that is session participation territory.

#### Scenario: Mid-session arrival behavior is defined before implementation begins
- **WHEN** the session participation feature is being designed
- **THEN** the session participation spec includes an explicit decision on how mid-session arrivals interact with the vote state for the current topic
- **AND** the spec includes a decision on whether the facilitator's readiness grid updates in real time when a new participant joins

#### Scenario: Mid-session arrival does not compromise the reveal mechanic
- **WHEN** a user joins a session during an active vote (vote has opened, no reveal has occurred)
- **THEN** the system enforces the chosen mid-session arrival policy consistently
- **AND** the reveal mechanic is not compromised by the arrival
