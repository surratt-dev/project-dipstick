# Spec Delta

## ADDED Requirements

### Requirement: Application Admin non-participation enforcement
Application Admins (`users.global_role = 'application_admin'`) SHALL NOT be recorded as session participants and SHALL NOT lock in votes, on the same terms as Engineering Managers. The server SHALL read `users.global_role` from the database on every registration and lock-in request, in `lobby`, `pre_session` and `active` status, and the check SHALL NOT be configurable or overridable.

#### Scenario: Application Admin is rejected at participant registration
- **WHEN** a user with `users.global_role = 'application_admin'` and an active `participant` membership in the session's team calls the session participation endpoint while the session is in `lobby`, `pre_session` or `active` status
- **THEN** the endpoint returns 403 with category `invalid_request`, the same response an Engineering Manager receives
- **AND** no `session_participants` row is created
- **AND** an `audit_log` row `session.participant_registration_rejected` is written with `actor_global_role = 'application_admin'`

#### Scenario: Manager who resolves to Application Admin is rejected
- **WHEN** a user whose claim values map to both `engineering_manager` and `application_admin` signs in, resolves to `application_admin`, joins the team through a join link as a `participant`, and calls the session participation endpoint
- **THEN** the endpoint rejects the request and the user is not recorded as a session participant

#### Scenario: Application Admin cannot lock in a vote
- **WHEN** a user whose `users.global_role` is `application_admin` sends a lock-in request for a topic in a session of a team where they hold an active `participant` membership, including when a `session_participants` row for them already exists
- **THEN** the endpoint returns 403 with category `invalid_request` and a message that does not name a role
- **AND** no vote is recorded

#### Scenario: Votes locked in before becoming an Application Admin are preserved
- **WHEN** a participant locks in a vote and their `users.global_role` later becomes `application_admin` at a re-sign-in before the topic reveal
- **THEN** the already-locked-in vote is not invalidated and is included in the reveal count
- **AND** any further lock-in request from that user is rejected

---

### Requirement: Application Admin rejection reuses the manager rejection
A rejected Application Admin SHALL receive the same response the Engineering Manager rejection uses at each endpoint (HTTP 403, category `invalid_request`). A participant-registration rejection SHALL write the same `session.participant_registration_rejected` audit row and structured event, with `actor_global_role = 'application_admin'`. The lock-in rejection message SHALL NOT name a specific role.

#### Scenario: Registration rejection is audited with the admin role
- **WHEN** an Application Admin's participant registration is rejected
- **THEN** the `session.participant_registration_rejected` audit row and structured event record `actor_global_role = 'application_admin'`

---

### Requirement: Application Admin exclusion scope
The exclusion SHALL apply at session participation, not at team join: an Application Admin may still hold a team membership and redeem a join link. A `session_participants` row and votes locked in before the user became an Application Admin SHALL NOT be deleted, and those votes SHALL be counted at reveal, as for an Engineering Manager. The participant roster SHALL NOT list Application Admins.

#### Scenario: Roster excludes Application Admins
- **WHEN** a user with a `session_participants` row for a session has `users.global_role = 'application_admin'`
- **THEN** the facilitator's participant roster for that session does not list them

#### Scenario: Application Admin may still join the team
- **WHEN** a user with `users.global_role = 'application_admin'` redeems a valid join link for a team
- **THEN** their team membership is created as today; only session participation is refused
