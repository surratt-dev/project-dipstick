## MODIFIED Requirements

### Requirement: A standing facilitator or an application administrator can archive an active topic on an unlocked team

`DELETE /api/v1/teams/:teamId/topics/:topicId` SHALL allow an authenticated user with `global_role = 'facilitator'` who is not an active member of the target team, OR `global_role = 'application_admin'`, to transition that team's topic from `active` to `archived`, provided the team's customization lock (per the `topic-customization-lock` capability) is not active. This is a soft-delete: `topics.status` transitions to `archived` and `topics.archived_at`/`topics.archived_by` are set; no row is deleted, and no `votes` or `session_topics` record is modified. **Administrators and team membership (#208).** An `application_admin` SHALL be admitted whatever their membership on the target team: none, or any value of `team_memberships.role` (today `participant` or `engineering_manager`). This is a decided rule (BRD FR-8.2; decision record `08b - Member Admin Topic Writes - Decision`). The product owner decided (#208) that administrators are a trusted role and are not barred from topic configuration by team membership. This decision covers TOPIC-002..006 only; it does not change any other administrator restriction. The non-member condition applies to facilitators only. The in-transaction `topic.*` audit row with `actor_global_role = 'application_admin'` and `team_id` is the permanent record of every administrator topic archive; it is not an interim control.

#### Scenario: A valid request archives an active topic
- **WHEN** a standing facilitator who is not a member of the team submits a request to archive one of two or more active topics on an unlocked team
- **THEN** the response is `200 OK` with `status: 'archived'` and `archivedAt`
- **AND** the topic's `status` is `archived` in the database
- **AND** the topic no longer appears in future session snapshots

#### Scenario: An application administrator can archive a topic for any team
- **WHEN** an authenticated user with `global_role = 'application_admin'` submits a request to archive an active topic on an unlocked team
- **THEN** the response is `200 OK` with `status: 'archived'` and `archivedAt`
- **AND** this succeeds for each of: no membership on the target team, an active `participant` membership, and an active `engineering_manager` membership (#208)

#### Scenario: Historical vote data is preserved after archiving
- **WHEN** a topic with existing `votes` and `session_topics` records from past sessions is archived
- **THEN** those `votes` and `session_topics` records are unchanged
- **AND** the topic's historical data remains accessible in trend views

#### Scenario: An in-progress session is unaffected by a concurrent archive
- **WHEN** a topic is archived while a session that already includes it in its `session_topics` snapshot is in progress
- **THEN** the in-progress session's topic sequence is unchanged
- **AND** the archived topic still appears normally for the remainder of that session

#### Scenario: An application administrator who is the team's engineering manager can archive one of that team's topics
- **WHEN** a user with `global_role = 'application_admin'` who holds an active `engineering_manager` membership on the target team submits a request to archive one of two or more active topics, which has no open action items, against that unlocked team
- **THEN** the response is `200 OK` with `status: 'archived'`
- **AND** exactly one `audit_log` row with `operation = 'topic.archived'` is written in the same transaction, with `actor_global_role = 'application_admin'`, `actor_user_id` set to the administrator, and `team_id` set to the team
