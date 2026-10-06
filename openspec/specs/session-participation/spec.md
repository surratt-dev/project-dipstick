# session-participation

## Purpose

Defines requirements for recording users as active participants in a session, including enforcement of Engineering Manager non-participation. The mid-session-arrival requirement below is a first-entry stub: a hard requirement surfaced during the join-team-invite-link change and documented here so it cannot be missed when the session participation feature is designed. (The facilitator-from-another-team constraint, formerly a stub in this spec, now lives in full in the `session-creation` capability, at its actual enforcement point.)

## Requirements

### Requirement: Engineering Manager non-participation enforcement

Engineering Managers MUST NOT be recorded as session participants. This check MUST be performed server-side at the session participation endpoint — the endpoint that records a user as an active participant in a session. It MUST NOT be enforced at join time.

**Enforcement point:** The session participation endpoint MUST query BOTH `users.global_role` AND `team_memberships.role` for the requesting user directly from the database before recording them as a participant. If `users.global_role = 'engineering_manager'` OR if `team_memberships.role = 'engineering_manager'` for the team whose session they are attempting to join, the request SHALL be rejected. The check is not skippable and not configurable; it must be structural (server-enforced), not preferential (a UI toggle or admin override).

**A missing team membership is a rejection condition, not a pass-through:** the full condition set is `membership_exists && membership_removed_at IS NULL && global_role !== 'engineering_manager' && membership_role !== 'engineering_manager'`. A query that `LEFT JOIN`s `team_memberships` and rejects only on the two role checks is insufficient: a user with **no** `team_memberships` row for the team at all yields `membership_role = null`, which is not `'engineering_manager'`, and such a query would incorrectly admit a non-member. Every enforcement point implementing this requirement (the session participation endpoint recording a `session_participants` row, and the lock-in endpoint's identical role check) MUST include the membership-exists condition, not only the two role checks.

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

#### Scenario: A user with no `team_memberships` row for the session's team is rejected
- **WHEN** a user with no `team_memberships` row at all for the session's team calls the session participation endpoint
- **THEN** the endpoint rejects the request
- **AND** the user is not recorded as a session participant
- **AND** this holds even though such a user's `team_memberships.role` reads as `null` rather than `engineering_manager` — absence of an active membership is itself a rejection condition, not a pass-through

#### Scenario: User with only participant membership_role can join a session
- **WHEN** a user with `users.global_role = 'engineer'` and `team_memberships.role = 'participant'` for the relevant team calls the session participation endpoint
- **THEN** the endpoint permits the request
- **AND** the user is recorded as a session participant

#### Scenario: Dual-check pattern is used by the team-content-access authorization helper
- **WHEN** the team-content-access authorization helper evaluates a request from a user to access a team's content
- **THEN** the helper queries both `users.global_role` AND `team_memberships.role` directly from the database
- **AND** the helper does not resolve either field from a cached value or client-supplied claim
- **AND** a user with `users.global_role = 'engineer'` and `team_memberships.role = 'engineering_manager'` receives the EM content access profile (aggregate vote distributions only), not the engineer content access profile

---

### Requirement: A session participant can be registered while the session is in `lobby` or `pre_session` status, not only `active`

The application SHALL support recording a user as a `session_participants` row for a session that is in `lobby` or `pre_session` status, not only `active`. This closes the registration gap named in `session-lobby-routing-gap` Decision D7: without it, a first-time-joining Engineer following a join link into a `lobby`-status session has no `session_participants` row, so `evaluateSessionSubscriberAccess` denies their session-scoped WebSocket connection and the `action-items-review` endpoint returns `404`. The Engineering Manager exclusion enforcement defined above (Requirement: Engineering Manager non-participation enforcement), including the membership-exists condition, SHALL be applied identically at this registration point — not skipped or weakened for `lobby`/`pre_session` registration.

**Mechanism (`participant-readiness-view` design.md Decision D2):** this is implemented by relaxing `POST /api/v1/sessions/:sessionId/participants`'s status gate to also accept `lobby` and `pre_session` (in addition to `active`), rather than by auto-creating/upserting a row at WebSocket-connect or join-link-redemption time. The auto-upsert alternative was evaluated and rejected at design stage: the session-scoped WebSocket route evaluates authorization *before* registering the connection, and moving a row-creation side effect ahead of that check would let any authenticated user open the WebSocket endpoint for any session and be auto-registered, with no team-membership or join-link gate at that layer at all — a materially larger authorization-surface expansion than relaxing the existing, already-gated REST endpoint's status check. `POST .../lock-in`'s identical role check (`sessions.ts`) received the same corrected condition-set fix in the same pass, since it shared the pre-existing membership-exists gap.

The frontend caller for this relaxed endpoint is `SessionLobbyPage`'s review fetch: see the `pre-session-action-item-review` capability's "SessionLobbyPage registers a first-time joiner via retry-on-404" requirement for the caller-side behavior. `DraftSessionHost` has no equivalent caller — a facilitator always already has standing via the `facilitator` grant path, so no registration call is needed there.

A successful registration and an Engineering-Manager-rejected registration attempt at this point each write an `audit_log` row (`session.participant_registration_rejected` on rejection), following the existing transactional pattern (INSERT + audit row in one transaction, event emitted only after commit).

#### Scenario: A first-time joiner is registered during `lobby` status
- **WHEN** an Engineer with no pre-existing `session_participants` row follows a valid join link into a session in `lobby` status, and the frontend's registration caller fires
- **THEN** a `session_participants` row is created for that user and session
- **AND** the Engineering Manager exclusion check (dual-check plus membership-exists) is evaluated before the row is created
- **AND** an `audit_log` row records the successful registration

#### Scenario: An Engineering Manager is rejected during `lobby`/`pre_session` registration
- **WHEN** a user with `users.global_role = 'engineering_manager'`, or with `team_memberships.role = 'engineering_manager'` for the relevant team, attempts to be registered as a session participant while the session is in `lobby` or `pre_session` status
- **THEN** the registration is rejected
- **AND** no `session_participants` row is created for that user
- **AND** an `audit_log` row records the rejection (`session.participant_registration_rejected`)

#### Scenario: A returning participant reconnecting during `lobby` does not create a duplicate row
- **WHEN** a user who already has a `session_participants` row for this session reconnects (e.g., via their own page refresh) while the session is in `lobby` status
- **THEN** no duplicate `session_participants` row is created

#### Scenario: Registration is still rejected for a session in `draft` status
- **WHEN** a user attempts to be registered as a session participant while the session is in `draft` status
- **THEN** the registration is rejected
- **AND** no `session_participants` row is created

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

---

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
