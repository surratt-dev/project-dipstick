## MODIFIED Requirements

### Requirement: Session-aware join link landing
If a session exists for the team whose status is `lobby`, `pre_session`, or `active` at the time a join link flow completes, the user SHALL be directed to `/session/:sessionId`. If the team's most recent session (if any) is in `draft`, `wrap_up`, `complete`, or `abandoned` status, or no session exists at all for the team, the user SHALL land on `/team/:teamId`. These two buckets are exhaustive over `SessionStatus`'s seven values — a future addition to `SessionStatus` MUST be deliberately assigned to one of the two buckets in this requirement's text, not left to an implicit default.

#### Scenario: Lobby session exists at join time
- **WHEN** a user completes the join flow and a session with status `lobby` exists for the team
- **THEN** the user is redirected to `/session/:sessionId`

#### Scenario: Pre-session review is in progress at join time
- **WHEN** a user completes the join flow and a session with status `pre_session` exists for the team
- **THEN** the user is redirected to `/session/:sessionId`

#### Scenario: Active session exists at join time
- **WHEN** a user completes the join flow and a session with status `active` exists for the team
- **THEN** the user is redirected to `/session/:sessionId`

#### Scenario: Only a draft session exists at join time
- **WHEN** a user completes the join flow and the team's most recent session has status `draft`
- **THEN** the user lands on `/team/:teamId`

#### Scenario: Only a wrap-up session exists at join time
- **WHEN** a user completes the join flow and the team's most recent session has status `wrap_up`
- **THEN** the user lands on `/team/:teamId`

#### Scenario: Only a completed or abandoned session exists at join time
- **WHEN** a user completes the join flow and the team's most recent session has status `complete` or `abandoned`
- **THEN** the user lands on `/team/:teamId`

#### Scenario: No session exists at join time
- **WHEN** a user completes the join flow and no session exists for the team
- **THEN** the user lands on `/team/:teamId`
