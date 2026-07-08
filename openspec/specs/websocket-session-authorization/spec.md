# websocket-session-authorization

## Purpose

Defines delivery-time authorization requirements for the four WebSocket content-access events pushed to clients during live sessions and team event streams. This spec establishes which events require authorization, what the required check is for each, and that delivery-time checks are mandatory — connection-time and subscription-time checks are additive but not substitutes.

This spec covers: the four content-access WebSocket events, the three authorization check points and their relationship, the delivery-time enforcement requirement, and the zero-latency revocation criterion for membership changes mid-connection.

This spec does NOT cover: privileged facilitator action events (`reveal.trigger`, `topic.advance`, `session.close`) — those are action authorization checks, not content access checks. HTTP content endpoint authorization is covered by the team-content-access spec.

**Implementation status:** As of the `enforce-access-control-on-team-content` change, WebSocket infrastructure does not yet exist in this codebase. These requirements are gate-blocked pending a gate decision from the engineering lead on WebSocket latency bounds and infrastructure approach. When the real-time layer is built, the requirements in this spec apply in full and MUST NOT be weakened by citing implementation complexity after the fact. The timer-based fallback for delivery-time checks requires a specific, documented latency bound; "meaningful intervals" is not an acceptable specification.

---

## Requirements

### Requirement: Content-access WebSocket events are authorized at delivery time

The application SHALL enforce authorization on each of the following WebSocket content-access events at the moment the event is delivered to each subscriber. Delivery-time checks MUST occur independently for each event pushed to each subscriber.

**The four content-access events in scope:**

| Event | Description | Subscriber requirement |
|---|---|---|
| `vote_readiness_update` | Pushed to the facilitator's connection when a participant locks in their vote (readiness signal only; vote value is not included) | The subscriber MUST be the active facilitator for this session: `sessions.facilitator_id = $subscriber AND sessions.status IN ('pre_session', 'active')` |
| `session_state_change` | Pushed to session participants and the facilitator when session status transitions | The subscriber MUST be an active participant or the active facilitator for this session |
| `vote_revealed` | Pushed to all session participants and the facilitator when a topic's votes are revealed | The subscriber MUST hold a valid participant or facilitator authorization for this session |
| `topic_history_update` | Pushed to team event stream subscribers when historical session data is updated (e.g., action items finalized during wrap-up) | The subscriber MUST pass the same team membership check as the corresponding HTTP endpoint |

**Delivery-time enforcement means:** The server evaluates the subscriber's current authorization status from the database at the moment it is about to push the event. If the check fails, the event is not delivered to that subscriber. The server MUST NOT rely on the subscriber's authorization status as evaluated at connection time or subscription time.

#### Scenario: vote_readiness_update is delivered only to the active facilitator

- **WHEN** a participant locks in their vote for a topic in session S for Team A
- **AND** a `vote_readiness_update` event would be pushed
- **THEN** the server evaluates whether each connected subscriber is the active facilitator for session S
- **AND** the event is delivered only to the subscriber whose `users.id` matches `sessions.facilitator_id` for session S and whose session status is `pre_session` or `active`
- **AND** the event is not delivered to participants, EMs, or facilitators of other sessions

#### Scenario: vote_revealed is delivered to all authorized session subscribers

- **WHEN** the facilitator triggers the reveal for topic T in session S
- **AND** a `vote_revealed` event is pushed with the full revealed vote distribution
- **THEN** the server evaluates whether each connected subscriber is an active participant or the active facilitator for session S
- **AND** the event (including vote values) is delivered only to authorized subscribers
- **AND** the event is not delivered to subscribers who are not participants or the facilitator of session S

#### Scenario: topic_history_update is delivered only to team members

- **WHEN** an action item is finalized during wrap-up for Team A
- **AND** a `topic_history_update` event would be pushed to Team A's event stream
- **THEN** the server evaluates each subscriber's team membership for Team A at delivery time
- **AND** the event is delivered only to subscribers who pass the team membership check

---

### Requirement: Three authorization check points are distinct — delivery-time is mandatory

The application SHALL implement authorization checks at up to three points in a WebSocket connection lifecycle. Delivery-time checks MUST be implemented for the content-access events listed above. Connection-time and subscription-time checks MAY be implemented in addition but MUST NOT substitute for delivery-time checks.

**Connection time:** Validates that the user is authenticated and has a valid application session. Necessary but not sufficient. Does not catch role changes or membership removals that occur after the connection is established.

**Subscription time:** Validates that the user is authorized to subscribe to a specific team or session event stream at the moment of subscription. Catches unauthorized subscription attempts but does not re-validate as the connection proceeds. A user who subscribed legitimately but whose membership was subsequently revoked continues to receive events until the connection is dropped or a delivery-time check fails.

**Delivery time:** Validates authorization on each event before it is pushed to the subscriber. This is the only check that satisfies the revocation requirement (see Requirement: Membership revocation takes effect without reconnection). Connection-time and subscription-time checks are additional safeguards; they cannot replace delivery-time checks.

#### Scenario: Connection-time check alone does not satisfy authorization requirement

- **WHEN** a WebSocket connection is established after successful authentication
- **AND** the server checks the user's authorization only at connection time
- **THEN** this check alone does NOT satisfy the delivery-time authorization requirement
- **AND** the server MUST additionally check authorization at delivery time for each content-access event

#### Scenario: Subscription-time check alone does not satisfy authorization requirement

- **WHEN** a user subscribes to a team event stream
- **AND** the server checks the user's team membership only at subscription time
- **THEN** this check alone does NOT satisfy the delivery-time authorization requirement
- **AND** the server MUST additionally check authorization at delivery time for each delivered event

---

### Requirement: Membership revocation takes effect without reconnection

When a user's `team_memberships.removed_at` is set while the user is connected via WebSocket to that team's session event stream, the server MUST stop delivering content-access events to that subscriber. No further content-access events for that team SHALL be delivered after the membership change is committed to the database.

**Mechanism:** Delivery-time authorization checks evaluate `team_memberships.removed_at IS NULL` on each event push. A subscriber whose `removed_at` is set receives at most one more event — the event that was in-flight at the moment the membership row was committed. This is the zero-latency revocation model: no timer, no polling, no reconnect required from the subscriber side.

**This requirement applies to the following scenarios:**
- A team member's `removed_at` is set by an Application Admin mid-session.
- A team member's `team_memberships.role` is changed to `engineering_manager` mid-session (they lose participant event access; they do not gain EM event access through WebSocket, as EMs do not receive live session events).

**The revocation requirement does NOT require closing the WebSocket connection.** The server stops delivering content-access events for the affected team while the connection may remain open for other purposes (e.g., the user is simultaneously in a session for another team).

#### Scenario: Removed team member stops receiving session_state_change events

- **WHEN** a user with an active WebSocket connection subscribed to Team A's event stream has their `team_memberships.removed_at` set
- **AND** the server subsequently pushes a `session_state_change` event for Team A
- **THEN** the delivery-time check evaluates `team_memberships.removed_at IS NULL` for this subscriber
- **AND** the event is NOT delivered to the subscriber
- **AND** no reconnect is required for the revocation to take effect

#### Scenario: Role change from participant to engineering_manager revokes live session event access

- **WHEN** a user's `team_memberships.role` is changed from `participant` to `engineering_manager` while connected
- **AND** the server subsequently pushes a `vote_readiness_update` event (facilitator-only) or a `session_state_change` event (participant-or-facilitator)
- **THEN** the delivery-time check evaluates the user's current role
- **AND** `session_state_change` is NOT delivered (EMs are not live session participants)
- **AND** `vote_readiness_update` is NOT delivered (the user is not the facilitator)

#### Scenario: Revocation affects the specific team's events, not all connections

- **WHEN** a user is connected to event streams for Team A and Team B
- **AND** the user's `team_memberships.removed_at` is set for Team A only
- **THEN** Team A content-access events are no longer delivered to the user
- **AND** Team B content-access events continue to be delivered (membership for Team B is unaffected)

---

### Requirement: WebSocket content-access events do not include vote values before reveal

The `vote_readiness_update` event MUST NOT include vote values. It MUST include only the participant's identity and their readiness status (locked in or not). The vote value is never included in this event regardless of the recipient's access level.

The `vote_revealed` event includes vote values only for topics whose `reveal_status = 'revealed'` in the session state. The serializer MUST check topic reveal status before including vote data in the event payload, the same as the HTTP endpoint serializer.

This constraint enforces the simultaneous reveal mechanic at the WebSocket layer. The facilitator's elevated access grant does not override the pre-reveal restriction. Both the authorization check and the event serializer enforce this — the serializer independently excludes vote values for unrevealed topics.

#### Scenario: vote_readiness_update does not include the participant's vote value

- **WHEN** a participant locks in their vote for topic T
- **AND** a `vote_readiness_update` event is pushed to the facilitator
- **THEN** the event payload includes the participant's ID and readiness status (locked in)
- **AND** the event payload does NOT include the participant's vote value

#### Scenario: vote_revealed includes vote values only for the revealed topic

- **WHEN** the facilitator triggers the reveal for topic T
- **THEN** the `vote_revealed` event includes vote values for topic T
- **AND** the event does NOT include vote values for topics that have not yet been revealed in this session
