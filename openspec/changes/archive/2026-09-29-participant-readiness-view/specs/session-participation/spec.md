## ADDED Requirements

### Requirement: A session participant can be registered while the session is in `lobby` or `pre_session` status, not only `active`

The application SHALL support recording a user as a `session_participants` row for a session that is in `lobby` or `pre_session` status, not only `active`. This closes the registration gap named in `session-lobby-routing-gap` Decision D7: without it, a first-time-joining Engineer following a join link into a `lobby`-status session has no `session_participants` row, so `evaluateSessionSubscriberAccess` denies their session-scoped WebSocket connection and the `action-items-review` endpoint returns `404`. The Engineering Manager exclusion enforcement defined above (Requirement: Engineering Manager non-participation enforcement) SHALL be applied identically at this registration point — the dual-check pattern (`users.global_role` AND `team_memberships.role`, read from the database) is not skipped or weakened for `lobby`/`pre_session` registration.

The specific mechanism (auto-creating/upserting a row at WebSocket-connect or join-link-redemption time, versus relaxing the existing REST endpoint's status gate and adding a frontend caller) is an implementation decision made and security-reviewed during this capability's implementation, per `participant-readiness-view`'s design.md Decision D2. Either mechanism SHALL satisfy this requirement and the scenarios below.

#### Scenario: A first-time joiner is registered during `lobby` status
- **WHEN** an Engineer with no pre-existing `session_participants` row follows a valid join link into a session in `lobby` status
- **THEN** a `session_participants` row is created for that user and session
- **AND** the Engineering Manager exclusion check (dual-check: `users.global_role` and `team_memberships.role`) is evaluated before the row is created

#### Scenario: An Engineering Manager is rejected during `lobby`/`pre_session` registration
- **WHEN** a user with `users.global_role = 'engineering_manager'`, or with `team_memberships.role = 'engineering_manager'` for the relevant team, attempts to be registered as a session participant while the session is in `lobby` or `pre_session` status
- **THEN** the registration is rejected
- **AND** no `session_participants` row is created for that user

#### Scenario: A returning participant reconnecting during `lobby` does not create a duplicate row
- **WHEN** a user who already has a `session_participants` row for this session reconnects (e.g., via their own page refresh) while the session is in `lobby` status
- **THEN** no duplicate `session_participants` row is created

#### Scenario: Registration is still rejected for a session in `draft` status
- **WHEN** a user attempts to be registered as a session participant while the session is in `draft` status
- **THEN** the registration is rejected
- **AND** no `session_participants` row is created
