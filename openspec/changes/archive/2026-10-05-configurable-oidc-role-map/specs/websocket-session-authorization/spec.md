# Spec Delta

## ADDED Requirements

### Requirement: Application Admins do not receive live session events
The session-scoped subscriber authorization SHALL NOT grant participant access to a user whose `users.global_role` is `application_admin`, evaluated live from the database on every check, even when the user has an active `participant` membership and a `session_participants` row. This SHALL hold at subscription, at delivery time and at periodic re-authorization, the same treatment Engineering Managers receive. The session-facilitator grant is unchanged.

#### Scenario: Application Admin cannot open a session event stream as a participant
- **WHEN** a user with `users.global_role = 'application_admin'`, an active `participant` membership and a `session_participants` row opens the session WebSocket for that session
- **THEN** the subscriber authorization returns no grant and the connection is closed with the existing unauthorized close code

#### Scenario: Application Admin receives no live session events
- **WHEN** a connected participant's `users.global_role` becomes `application_admin` (at a re-sign-in) and the server then pushes a `session_state_change` event for the session
- **THEN** the delivery-time check evaluates the user's current `users.global_role`
- **AND** the event is NOT delivered to that subscriber
- **AND** no reconnect is required for the revocation to take effect

#### Scenario: Re-authorization sweep drops an Application Admin's participant grant
- **WHEN** the periodic re-authorization sweep evaluates an open session connection whose user's `users.global_role` is `application_admin`
- **THEN** the subscriber authorization returns no grant, and the connection is handled as any other revoked connection

---

### Requirement: Application Admin denials reuse existing behaviour
HTTP endpoints that reuse the session-scoped subscriber authorization (the action-items review, the participant roster fetch and the reveal-latency report) SHALL deny an Application Admin's participant access exactly as they deny a caller with no grant. WebSocket denials SHALL use the existing undisclosed close codes and non-delivery behaviour, not a new error shape.

#### Scenario: Grant-reusing HTTP endpoints deny Application Admins
- **WHEN** a user with `users.global_role = 'application_admin'` and a `session_participants` row calls the action-items review endpoint for that session
- **THEN** the endpoint responds as it does today for a caller with no session grant
