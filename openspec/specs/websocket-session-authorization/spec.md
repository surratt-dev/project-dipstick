# websocket-session-authorization

## Purpose

Defines delivery-time authorization requirements for the four WebSocket content-access events pushed to clients during live sessions and team event streams. This spec establishes which events require authorization, what the required check is for each, and that delivery-time checks are mandatory — connection-time and subscription-time checks are additive but not substitutes.

This spec covers: the four content-access WebSocket events, the three authorization check points and their relationship, the delivery-time enforcement requirement, and the zero-latency revocation criterion for membership changes mid-connection.

This spec does NOT cover: privileged facilitator action events (`reveal.trigger`, `topic.advance`, `session.close`) — those are action authorization checks, not content access checks. HTTP content endpoint authorization is covered by the team-content-access spec.

**Production trigger status (updated by `session-lifecycle-transitions`):** WebSocket infrastructure exists, and delivery-time authorization is implemented and tested for all four content-access events. All four now fire from real, committed production code paths. `vote_revealed` fires from `POST /api/v1/teams/:teamId/sessions/:sessionId/reveal`'s `voting → revealed` write, published after that transaction commits. `topic_history_update` fires from `SESSION-012` (`POST /api/v1/teams/:teamId/sessions/:sessionId/topics/advance`)'s topic-to-topic advance and wrap-up-entry branches, published after each transaction commits. `vote_readiness_update` and `session_state_change` continue to fire from vote lock-in and lobby-advance/session-close/session-phase-entry, respectively. GitHub issue #26, which tracked this gap, has a comment from this change documenting the resolution described above; the issue itself remains open on GitHub pending final confirmation rather than closed by this change. All four events' audit-log writes (vote submission; state-changed; reveal-triggered; topic-advanced) are live in production.

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
| `topic_history_update` | Pushed to team event stream subscribers when historical session data is updated (e.g., action items finalized during wrap-up) | The subscriber MUST pass the same team membership check as the corresponding HTTP endpoint (`evaluateTeamAccess` returns `grant.path === 'member'` or `grant.path === 'facilitator'`), **and an `admin`-path grant MUST be rejected** |

**Delivery-time enforcement means:** The server evaluates the subscriber's current authorization status from the database at the moment it is about to push the event. If the check fails, the event is not delivered to that subscriber. The server MUST NOT rely on the subscriber's authorization status as evaluated at connection time or subscription time.

**Admin-grant rejection for `topic_history_update`:** The shared authorization helper returns an `admin`-path grant uniformly for Application Admin callers, independent of which endpoint or transport invoked it (see the team-content-access spec). `topic_history_update` fires for session content — historical session data and finalized action items — which Application Admins are not authorized to receive, per the same boundary that HTTP session-content endpoints enforce. A WebSocket handler that treats "the helper returned a grant" as sufficient to push the event, without checking which grant path it received, reopens the surveillance path the HTTP layer already closed, one layer up and without the admin needing to issue any request beyond an initial subscription. The server MUST inspect the grant path returned by the authorization helper and MUST NOT deliver `topic_history_update` to a subscriber whose grant path is `admin`.

#### Scenario: vote_readiness_update is delivered only to the active facilitator

- **WHEN** a participant locks in their vote for a topic in session S for Team A
- **AND** a `vote_readiness_update` event would be pushed
- **THEN** the server evaluates whether each connected subscriber is the active facilitator for session S
- **AND** the event is delivered only to the subscriber whose `users.id` matches `sessions.facilitator_id` for session S and whose session status is `pre_session` or `active`
- **AND** the event is not delivered to participants, EMs, or facilitators of other sessions

#### Scenario: session_state_change is delivered only to active participants and the active facilitator

- **WHEN** a facilitator action transitions session S's status (e.g., advancing the lobby, closing the session)
- **AND** a `session_state_change` event would be pushed
- **THEN** the server evaluates whether each connected subscriber is an active participant or the active facilitator for session S, via `evaluateSessionSubscriberAccess`
- **AND** the event is delivered only to subscribers who pass that check
- **AND** the event is not delivered to a subscriber whose team membership was removed, or who is no longer the active facilitator, before this check runs

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

#### Scenario: Application Admin subscriber does not receive topic_history_update events

- **WHEN** an Application Admin has subscribed to Team A's event stream (having passed connection-time authentication)
- **AND** an action item is finalized during wrap-up for Team A, triggering a `topic_history_update` event
- **THEN** the server evaluates the Application Admin's authorization via the shared helper and receives an `admin`-path grant
- **AND** the event is NOT delivered to the Application Admin's connection
- **AND** this holds regardless of whether the Application Admin is also, separately, a team member or facilitator (the admin grant path is evaluated and rejected before any other path is considered for this subscriber)

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
- A user's global `users.global_role` is changed to `engineering_manager` mid-session, independent of any change to their team-scoped `team_memberships.role`.

**EM status MUST be evaluated from both signals, independently, on every check:** a user can be an EM by either a global `users.global_role` of `engineering_manager` or a team-scoped `team_memberships.role` of `engineering_manager`, and either signal alone is sufficient to revoke live-session event access — checking only one field is not sufficient. A participant's `session_participants` row is not deleted when they are promoted to EM mid-session (votes already locked in before the promotion are preserved), so the row's mere existence is also not sufficient on its own; the role check on both fields is what does the actual revocation work.

**The revocation requirement does NOT require closing the WebSocket connection.** The server stops delivering content-access events for the affected team while the connection may remain open for other purposes (e.g., the user is simultaneously in a session for another team).

#### Scenario: Removed team member stops receiving session_state_change events

- **WHEN** a user with an active WebSocket connection subscribed to Team A's event stream has their `team_memberships.removed_at` set
- **AND** the server subsequently pushes a `session_state_change` event for Team A
- **THEN** the delivery-time check evaluates `team_memberships.removed_at IS NULL` for this subscriber
- **AND** the event is NOT delivered to the subscriber
- **AND** no reconnect is required for the revocation to take effect

#### Scenario: Role change from participant to engineering_manager revokes live session event access

- **WHEN** a user's `team_memberships.role`, or independently their global `users.global_role`, is changed to `engineering_manager` while connected as a `participant`
- **AND** the server subsequently pushes a `vote_readiness_update` event (facilitator-only) or a `session_state_change` event (participant-or-facilitator)
- **THEN** the delivery-time check evaluates both the user's current `team_memberships.role` and their current `users.global_role`
- **AND** `session_state_change` is NOT delivered (EMs are not live session participants)
- **AND** `vote_readiness_update` is NOT delivered (the user is not the facilitator)
- **AND** this holds whichever of the two role fields triggered the promotion, and holds even though the user's underlying `session_participants` row still exists

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

---

### Requirement: Cross-recipient delivery skew is bounded for simultaneous fan-out events

For any single content-access event fanned out to multiple subscribers (in particular `vote_revealed`, which enforces the simultaneous-reveal ritual mechanic), the application SHALL keep the delivery-time skew across all recipient connections — local and cross-pod — within a documented budget measured under realistic concurrent-session load. Single-connection authorization-check-plus-send latency is necessary but not sufficient to demonstrate this property; a system in which every individual check-plus-send is fast can still fail this requirement if cross-pod pub/sub propagation or per-pod queuing introduces material variance between recipients.

**Measurement:** the delta between the first-delivered and last-delivered timestamps for the same fan-out event, across all recipient connections, under a realistic concurrent-session/connection load. The specific numeric budget is set at the Design stage, informed by a UX-sourced figure where available; this requirement establishes that the measurement MUST be taken and MUST be checked against a stated budget before this capability ships to production — an unmeasured assumption of simultaneity does not satisfy this requirement.

**Concurrency model as a direct input:** the per-pod strategy for evaluating delivery-time checks across multiple local recipient candidates for the same event (serial vs. concurrent) is a direct input to this measurement and MUST be an explicit, documented choice with a stated worst-case local fan-out width, not an incidental consequence of how the pub/sub message handler happens to be written.

#### Scenario: vote_revealed skew is measured and within budget

- **WHEN** the facilitator triggers the reveal for topic T in session S with multiple connected participants distributed across more than one backend pod
- **THEN** the delivery-time authorization check and payload push is evaluated independently for each recipient connection
- **AND** the delta between the earliest and latest recipient's delivery timestamp for this reveal event is measured
- **AND** the measured delta does not exceed the documented skew budget set at Design time

#### Scenario: Per-pod concurrency model is explicit and documented

- **WHEN** a single pod holds more than one local candidate connection for the same fan-out event
- **THEN** the implementation's choice of serial or concurrent per-recipient authorization checks is a named, documented decision
- **AND** the worst-case local fan-out width used to reason about that decision is stated in the design documentation

---

### Requirement: WebSocket-triggered actions are audit-logged with delivery context

Actions that trigger `vote_readiness_update`, `vote_revealed`, and `session_state_change` events SHALL be recorded in the `audit_log` table with the same fidelity as equivalent HTTP-only actions, per BRD SEC-13 and SEC-14. BRD SEC-13 names vote submission alongside vote reveal as required audit categories; SEC-14 restates this for the WebSocket path specifically — submission and reveal are named together, not offered as alternatives, and vote submission is in scope on the same terms as reveal. Where the triggering action (e.g., a facilitator's reveal action, or a participant's vote lock-in) is authorized and executed via an HTTP request that fans out to WebSocket subscribers afterward, a single audit log entry per triggering action is sufficient — this requirement does not mandate one audit row per delivered WebSocket push per recipient. The audit entry MUST identify the WebSocket-relevant context (at minimum, the session identifier) so the entry is traceable to the live session in which delivery occurred. Audit metadata for vote submission MUST NOT include the submitted vote value, per SEC-16/SEC-22's prohibition on writing sensitive data values into audit log entries.

#### Scenario: Vote submission is audit-logged

- **WHEN** a participant locks in their vote for topic T in session S via `POST /api/v1/sessions/:sessionId/topics/:sessionTopicId/lock-in`
- **THEN** an `audit_log` row is written recording the vote-submission action, including `actor_user_id`, `actor_global_role`, and the session identifier
- **AND** the row's `metadata` does not include the submitted vote value or vote type
- **AND** this occurs once per lock-in attempt (including a resubmission that updates the same vote), independent of the number of WebSocket subscribers who receive the resulting `vote_readiness_update` event

#### Scenario: Reveal action is audit-logged

- **WHEN** a facilitator triggers a reveal for topic T in session S via `POST /api/v1/teams/:teamId/sessions/:sessionId/reveal`
- **THEN** an `audit_log` row is written recording the reveal action, including `actor_user_id`, `actor_global_role`, the session identifier, and the outcome
- **AND** this occurs once per reveal action, independent of the number of WebSocket subscribers who receive the resulting `vote_revealed` event

#### Scenario: Session state change is audit-logged

- **WHEN** a facilitator action transitions session S's status (e.g., advancing the lobby, closing the session)
- **AND** a `session_state_change` event is fanned out to session subscribers
- **THEN** an `audit_log` row is written recording the state transition, including `actor_user_id`, `actor_global_role`, the session identifier, the prior status, and the new status
- **AND** this occurs once per triggering action, independent of the number of subscribers who receive the resulting event

---

### Requirement: Idle-connection re-authorization (SEC-25) is tracked, not satisfied, by delivery-time checks alone

Delivery-time authorization checks, as defined in this spec, evaluate a subscriber's authorization only at the moment an event is about to be pushed. A connection that receives no content-access event for an entire token-expiry window is not re-evaluated by any mechanism this spec defines. This is a real, named gap distinct from the revocation guarantee this spec establishes (which governs connections actively receiving events) — it is not satisfied by this spec's delivery-time mechanism and MUST NOT be treated as closed by it.

The application SHALL track this gap, together with SEC-26 (token expiry / silent refresh mid-connection), to a single named companion effort with an assigned owner. This spec does not define the idle-connection heartbeat mechanism, its interval, or its owner — those are the companion effort's responsibility.

**Tracking destination:** filed as GitHub issue [#27](https://github.com/surratt-dev/project-dipstick/issues/27), with a proposed owner and target quarter recorded there pending repository-owner confirmation.

**Compensating bound:** although periodic re-authorization is out of scope for this spec, a connection is not left with a fully unbounded window. The application SHALL apply the existing absolute session-lifetime cap (BRD SEC-26, 90 minutes, already enforced for HTTP requests) to WebSocket connections as well: a connection open longer than the cap MUST be rejected at its next delivery-time check and MUST be independently closed by the server at the cap regardless of activity. This bounds the *outer edge* of the idle-connection window to 90 minutes; it does not substitute for periodic re-authorization against a membership or role change occurring within that window, which remains the companion effort's responsibility.

#### Scenario: An idle connection is not re-authorized by delivery-time checks

- **WHEN** a facilitator's connection to session S receives no `vote_readiness_update`, `session_state_change`, or `vote_revealed` event for an entire token-expiry window (e.g., a quiet pre-session lobby)
- **THEN** no delivery-time authorization check runs against that connection during that window, because no event is pushed
- **AND** this is not a violation of this spec's delivery-time requirements, which apply only when an event is pushed
- **AND** the gap is addressed by the tracked companion effort, not by this spec's delivery-time mechanism

#### Scenario: An idle connection is closed at the absolute session lifetime cap

- **WHEN** a connection to session S has been open for longer than the 90-minute absolute session lifetime (BRD SEC-26), whether or not it has received any content-access event during that time
- **THEN** the connection is closed by the server, independent of whether an event was ever pushed to it
- **AND** this bound does not re-evaluate the subscriber's team membership or role at any point before the 90-minute mark — only total connection age is checked — so it is not a substitute for the periodic re-authorization SEC-25 requires, which remains the companion effort's responsibility

#### Scenario: Companion tracking effort exists before this capability is considered complete

- **WHEN** this change (websocket-delivery-time-authorization) is evaluated for completeness
- **THEN** a companion issue or change covering SEC-25 idle-connection re-authorization and SEC-26 token-expiry handling exists, with a named owner
- **AND** the absence of a designed heartbeat mechanism in this change is not treated as an oversight, because the tracking destination itself is the acceptance criterion for this requirement

---

### Requirement: Server-initiated close codes do not disclose the cause of connection termination

When the server terminates a WebSocket connection for a reason it must not disclose to the client — an unauthorized subscription attempt (rejected at subscription time, after the WebSocket upgrade has completed) or the scheduled absolute-lifetime force-close (the 90-minute cap defined in the Idle-connection re-authorization requirement, above) — it SHALL use the same close code for every such case. (A connection-time authentication or origin failure is rejected before the WebSocket upgrade completes — via an ordinary HTTP error response, not a WebSocket close code — so it is outside this requirement's scope; there is no established connection for such a rejection to "terminate.") A client MUST NOT be able to distinguish "your access was revoked or was never granted" from "your connection aged out at the absolute lifetime cap" from "an ordinary network failure occurred" by inspecting the close code alone.

This requirement covers the connection-close layer specifically. It is the counterpart, at that layer, to the silent mid-connection event withholding the Membership revocation requirement establishes at the event-delivery layer: both exist to prevent a subscriber from learning the reason their access changed, and neither may leak that reason through the other's mechanism (a delivery-time rejection never closes the socket — it silently withholds the event — and a close never carries a distinguishable reason code).

This requirement does not require or preclude a client-visible signal, banner, or message; any such user-facing indicator is separate, non-blocking UX work. This requirement governs only the wire-level close code the server emits.

#### Scenario: Rejected subscription and absolute-lifetime force-close use the same close code

- **WHEN** the server rejects a WebSocket subscription attempt because the connecting user is not authorized
- **AND**, separately, the server force-closes a different connection because it exceeded the 90-minute absolute session lifetime
- **THEN** both closes use the identical WebSocket close code
- **AND** a client cannot determine which of the two reasons applies by inspecting the close code alone

#### Scenario: A disclosed-cause close is indistinguishable from an ordinary network failure
- **WHEN** a WebSocket connection closes unexpectedly, whether due to a server-initiated rejection, a server-initiated force-close, or an ordinary network interruption
- **THEN** the client receives no application-level signal that distinguishes a deliberate, cause-bearing close from an ordinary network failure
