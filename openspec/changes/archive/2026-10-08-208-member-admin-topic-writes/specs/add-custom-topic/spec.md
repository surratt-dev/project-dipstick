## MODIFIED Requirements

### Requirement: A standing facilitator or application administrator can add a custom topic to an unlocked team

`POST /api/v1/teams/:teamId/topics` SHALL allow an authenticated user to create a new custom topic for the target team when the user either has `global_role = 'facilitator'` and is not an active member of that team, or has `global_role = 'application_admin'` (on any team, whether or not they are a member of it, per BRD FR-8.2), provided the team's customization lock (per the `topic-customization-lock` capability) is not active. The request body SHALL require `name` (non-empty after trim, ≤100 characters), `prompt` (non-empty after trim, ≤500 characters), and `voteType` (one of `finger`, `roman`, `modified_roman`), and MAY include `firstSessionDescription` (≤500 characters). The created topic SHALL be marked `isDefault: false` and SHALL be assigned `displayOrder` equal to one greater than the current maximum `displayOrder` among the team's active topics. An administrator's request SHALL be subject to the same body rules, lock, and check order as a facilitator's; the role grants no exemption from either. **Administrators and team membership (#208).** An `application_admin` SHALL be admitted whatever their membership on the target team: none, or any value of `team_memberships.role` (today `participant` or `engineering_manager`). This is a decided rule (BRD FR-8.2; decision record `08b - Member Admin Topic Writes - Decision`). The product owner decided (#208) that administrators are a trusted role and are not barred from topic configuration by team membership. This decision covers TOPIC-002..006 only; it does not change any other administrator restriction. The non-member condition applies to facilitators only. The in-transaction `topic.*` audit row with `actor_global_role = 'application_admin'` and `team_id` is the permanent record of every administrator topic addition; it is not an interim control.

#### Scenario: A valid request creates a custom topic
- **WHEN** a standing facilitator who is not a member of the team submits a request with a valid `name`, `prompt`, and `voteType` against an unlocked team
- **THEN** the response is `201 Created`
- **AND** the response body includes the new topic's `topicId`, `name`, `prompt`, `voteType`, `displayOrder`, `isDefault: false`, and `createdAt`

#### Scenario: An application administrator who is not a team member creates a custom topic
- **WHEN** a user with `global_role = 'application_admin'` who has no active membership on the team submits a request with a valid `name`, `prompt`, and `voteType` against an unlocked team whose active topics have display orders `0` through `n`
- **THEN** the response is `201 Created` with `isDefault: false`
- **AND** the new topic is assigned `displayOrder = n + 1`

#### Scenario: An application administrator who is a team member creates a custom topic
- **WHEN** a user with `global_role = 'application_admin'` who has an active (`removed_at IS NULL`) membership on the team submits a valid request against that unlocked team
- **THEN** the response is `201 Created`
- **AND** the new topic is appended at the end of the team's display order
- **AND** exactly one `audit_log` row with `operation = 'topic.custom_added'` and `actor_global_role = 'application_admin'` is written in the same transaction as the topic `INSERT`

#### Scenario: A new topic is appended to the end of the display order
- **WHEN** a custom topic is successfully created for a team whose active topics currently have display orders `0` through `n`
- **THEN** the new topic is assigned `displayOrder = n + 1`

#### Scenario: An optional firstSessionDescription is stored when provided
- **WHEN** a valid request includes a `firstSessionDescription`
- **THEN** the created topic's `firstSessionDescription` is persisted with the submitted value

#### Scenario: A valid request omitting firstSessionDescription succeeds
- **WHEN** a valid request omits `firstSessionDescription`
- **THEN** the topic is created successfully with `firstSessionDescription` set to null

#### Scenario: An administrator's add does not change a session whose room is already open
- **WHEN** a team has a session whose room is open (its `session_topics` snapshot already taken), and an `application_admin` successfully adds a custom topic to that team
- **THEN** the open session's `session_topics` rows, their topics, and their order are unchanged
- **AND** the new topic is part of the team's active topic configuration for the next room opened

#### Scenario: An application administrator who is the team's engineering manager can add a custom topic to that team
- **WHEN** a user with `global_role = 'application_admin'` who holds an active `engineering_manager` membership on the target team submits a valid add request against that unlocked team
- **THEN** the response is `201 Created` and the new topic is appended at the end of the team's display order
- **AND** exactly one `audit_log` row with `operation = 'topic.custom_added'` is written in the same transaction, with `actor_global_role = 'application_admin'`, `actor_user_id` set to the administrator, and `team_id` set to the team
