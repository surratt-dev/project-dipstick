## ADDED Requirements

### Requirement: New-team creation via `POST /api/v1/teams`

The application SHALL provide `POST /api/v1/teams`, callable only by a caller whose `users.global_role` is `facilitator`, which creates a new team, assigns it the canonical default topic set (see `default-topic-provisioning`), and creates that team's first session — all in a single database transaction. The session created by this endpoint SHALL be recorded with `is_first_session = true`, computed explicitly for this flow rather than inherited from any other session-creation code path. On success, the new session SHALL land directly in `lobby` status (see the draft-skip requirement below), not `draft`. A failure at any step of the transaction SHALL leave no team, topic, or session record behind.

#### Scenario: Facilitator creates a new team and its first session
- **WHEN** an authenticated caller with `users.global_role = 'facilitator'` submits `POST /api/v1/teams` with a unique, non-empty team name
- **THEN** a new `teams` row is created with that name
- **AND** the new team's `topics` rows are populated from the canonical default topic set
- **AND** a new `sessions` row is created for the new team and the caller, with `status = 'lobby'` and `is_first_session = true`
- **AND** a join link is generated for the session
- **AND** all of the above commit in a single transaction

#### Scenario: Non-facilitator caller is rejected
- **WHEN** a caller whose `users.global_role` is not `facilitator` submits `POST /api/v1/teams`
- **THEN** the request is rejected with `403`
- **AND** no team, topic, or session record is created
- **AND** an `audit_log` row is written identifying the actor, the actor's global role, and the actor's IP

#### Scenario: Empty team name is rejected
- **WHEN** a caller submits `POST /api/v1/teams` with an empty or whitespace-only team name
- **THEN** the request is rejected with a validation error
- **AND** no team, topic, or session record is created

#### Scenario: Transaction failure leaves no partial state
- **WHEN** `POST /api/v1/teams` fails at any point after the team insert has been attempted (topic copy, session insert, or audit write)
- **THEN** the entire transaction rolls back
- **AND** no team, topic, or session record from this request exists afterward

#### Scenario: A successful team-and-session creation is audited
- **WHEN** a caller successfully creates a new team and its first session via `POST /api/v1/teams`
- **THEN** an `audit_log` row is written in the same transaction as the `INSERT INTO teams` and `INSERT INTO sessions` rows, identifying the actor, the actor's global role, the actor's IP, the new team's id, and the new session's id

---

### Requirement: `POST /api/v1/teams` evaluates checks in a fixed order — authenticate, then authorize, then validate, then check uniqueness

The handler SHALL perform its checks in this order: caller authentication (session required), caller role authorization (`facilitator`), team-name non-emptiness validation, then team-name uniqueness. Authorization SHALL be evaluated before any name-dependent check, so that a caller who is not an authenticated `facilitator` cannot learn whether any given team name is already taken.

#### Scenario: A non-facilitator caller cannot probe name existence
- **WHEN** a caller who is authenticated but whose `users.global_role` is not `facilitator` submits `POST /api/v1/teams` with the name of a team that already exists
- **THEN** the request is rejected with `403`, the same response as if the name did not collide
- **AND** the response does not indicate whether the submitted name collides with an existing team

---

### Requirement: Team-name uniqueness is enforced case-insensitively and after trimming

Team-name collisions SHALL be evaluated on the normalized form of the name — lowercased and trimmed of leading/trailing whitespace — not on raw string equality. This normalized uniqueness SHALL be enforced at the database level (not solely by an application-level pre-check), so that two concurrent requests for normalized-duplicate names cannot both succeed. A rejected submission SHALL return a typed collision response (`TeamNameCollisionResponse { errorState: "team_name_collision"; providedName: string }`), distinguishable from other validation failures (e.g., empty name) by its `errorState` discriminant, not by message text. This response SHALL be returned for a uniqueness violation on either the exact-match constraint or the normalized constraint — the caller-visible outcome does not depend on which underlying constraint the database reports.

#### Scenario: Exact duplicate name is rejected
- **WHEN** a caller submits `POST /api/v1/teams` with a name identical to an existing team's name
- **THEN** the request is rejected with a validation error identifying the name collision
- **AND** no team record is created

#### Scenario: Case- and whitespace-variant duplicate is rejected
- **WHEN** a team named "Platform Team" already exists and a caller submits `POST /api/v1/teams` with the name "platform team" (different case) or " Platform Team " (leading/trailing whitespace)
- **THEN** the request is rejected with a validation error identifying the name collision
- **AND** no team record is created

#### Scenario: Concurrent submissions for normalized-duplicate names — only one succeeds
- **WHEN** two callers simultaneously submit `POST /api/v1/teams` with names that normalize to the same value (e.g., "Platform Team" and "platform team"), and no team by that normalized name yet exists
- **THEN** exactly one request succeeds and creates the team
- **AND** the other request is rejected with the name-collision validation error, not a generic server error

#### Scenario: Distinct names are both accepted
- **WHEN** a caller submits `POST /api/v1/teams` with a name that does not normalize to match any existing team's name
- **THEN** the team is created successfully

---

### Requirement: New-team session lands directly in `lobby`, skipping `draft`

Unlike session creation for an existing team (which lands the Facilitator in a `draft`-status control view per `session-creation`'s draft-status landing requirement), a session created via `POST /api/v1/teams` SHALL be created directly in `lobby` status. The submit action that creates the team SHALL echo the submitted team name back to the Facilitator as part of the control's own label (e.g., "Create team '<name>' and open session room") before the request is sent, since there is no subsequent confirmation screen and no rename path once the team is created. Upon landing, the application SHALL display an explicit acknowledgment that the team was created and its default topics were assigned.

#### Scenario: Facilitator lands in an open, joinable lobby immediately after creating a new team
- **WHEN** a Facilitator successfully creates a new team and its session via `POST /api/v1/teams`
- **THEN** the resulting session has `status = 'lobby'`, not `draft`
- **AND** the Facilitator is navigated directly to the session's live participant-readiness view
- **AND** the join link is immediately usable

#### Scenario: Submit control echoes the typed team name before firing
- **WHEN** a Facilitator has typed a team name into the new-team form and is about to submit
- **THEN** the submit control's label includes the exact typed name (e.g., "Create team 'Platform Team' and open session room"), not a generic "Submit" or "Create"

#### Scenario: Landing view acknowledges team creation and topic assignment
- **WHEN** a Facilitator lands on the session view immediately after creating a new team
- **THEN** the view displays an explicit acknowledgment that the team was created and that its default topics were assigned, distinct from the existing-team flow's landing copy

---

### Requirement: New-team form extends the existing session-creation screen state machine

The new-team creation form SHALL be implemented as an additional screen within the same component that implements the existing-team picker and confirm screens, not as a separate page or route. Navigating from the new-team form back to the picker, at any point before the form is submitted, SHALL create no team, topic, or session record and SHALL always be available.

#### Scenario: Facilitator navigates to the new-team form from the picker
- **WHEN** a Facilitator on the eligible-teams picker selects the option to create a new team
- **THEN** the same component transitions to the new-team form screen without a full page navigation

#### Scenario: Backing out of the new-team form before submission is always safe
- **WHEN** a Facilitator on the new-team form navigates back to the picker without having submitted the form
- **THEN** no team, topic, or session record is created
- **AND** the picker screen is shown, available for immediate reselection

---

### Requirement: Empty eligible-teams state invites new-team creation

When the eligible-teams picker has no existing teams to display, its message SHALL direct the Facilitator to the new-team creation option rather than stating only that no teams are available.

#### Scenario: Picker with zero eligible existing teams still offers a path forward
- **WHEN** a Facilitator opens the session-creation picker and `eligibleTeams` is empty
- **THEN** the picker displays a message that invites creating a new team (e.g., "Don't see your team? Create one to get started"), not a message stating only that no teams are available
- **AND** the option to create a new team remains reachable from this state

---

### Requirement: Team creation does not establish membership for the creating Facilitator

`POST /api/v1/teams` SHALL NOT insert a `team_memberships` row for the caller who creates the team, regardless of the `teams.created_by_user_id` value recorded on the new team.

#### Scenario: Creating Facilitator has no membership in the team they just created
- **WHEN** a Facilitator successfully creates a new team via `POST /api/v1/teams`
- **THEN** `teams.created_by_user_id` for the new team is the creating Facilitator's user id
- **AND** no `team_memberships` row exists for the creating Facilitator and the new team
- **AND** the creating Facilitator remains eligible to facilitate a future session for this team under the ordinary facilitator-from-another-team enforcement, exactly as any other non-member would be
