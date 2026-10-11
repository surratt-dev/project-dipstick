## MODIFIED Requirements

### Requirement: A standing facilitator or an application administrator can restore an archived topic on an unlocked team

`POST /api/v1/teams/:teamId/topics/:topicId/restore` SHALL allow an authenticated user with `global_role = 'facilitator'` who is not an active member of the target team, OR `global_role = 'application_admin'`, to transition that team's topic from `archived` to `active`, provided the team's customization lock (per the `topic-customization-lock` capability) is not active. The topic SHALL be appended at the end of the team's current active display order — its prior `display_order` position is not restored. No `votes` or `session_topics` record is modified by this transition. **Administrators and team membership (#208).** An `application_admin` SHALL be admitted whatever their membership on the target team: none, or any value of `team_memberships.role` (today `participant` or `engineering_manager`). This is a decided rule (BRD FR-8.2; decision record `08b - Member Admin Topic Writes - Decision`). The product owner decided (#208) that administrators are a trusted role and are not barred from topic configuration by team membership. This decision covers TOPIC-002..006 only; it does not change any other administrator restriction. The non-member condition applies to facilitators only. The in-transaction `topic.*` audit row with `actor_global_role = 'application_admin'` and `team_id` is the permanent record of every administrator topic restore; it is not an interim control.

#### Scenario: A valid request restores an archived topic
- **WHEN** a standing facilitator who is not a member of the team submits a request to restore an archived topic on an unlocked team
- **THEN** the response is `200 OK` with `status: 'active'`, a `displayOrder` at the end of the team's current active order, and `restoredAt`
- **AND** the topic's `status` is `active` in the database

#### Scenario: An application administrator can restore a topic for any team
- **WHEN** an authenticated user with `global_role = 'application_admin'` submits a request to restore an archived topic on an unlocked team
- **THEN** the response is `200 OK` with `status: 'active'`
- **AND** this succeeds for each of: no membership on the target team, an active `participant` membership, and an active `engineering_manager` membership (#208)

#### Scenario: A restored topic is appended, not returned to its prior position
- **WHEN** a topic that was at `displayOrder` 2 before being archived is restored to a team that currently has three active topics at positions 1, 3, and 4
- **THEN** the restored topic's `displayOrder` is 5, not 2

#### Scenario: A restored topic's historical vote data remains accessible
- **WHEN** a topic with existing `votes` and `session_topics` records from before it was archived is restored
- **THEN** those `votes` and `session_topics` records are unchanged and remain accessible

#### Scenario: A restored topic is included in the next room-open snapshot
- **WHEN** a topic's `status` transitions to `active` via a successful restore, and the team's next session then reaches room open (see `session-topic-lifecycle`)
- **THEN** that session's `session_topics` rows include the restored topic, with no restore-specific flag, field, or exclusion distinguishing it from any other active topic

#### Scenario: A topic archived and restored during the draft lands at its appended position
- **WHEN** a team's session is in `draft`, the facilitator archives a topic and then restores it, and then opens the room
- **THEN** the restored topic is in the session's snapshot, positioned after every topic that was active when it was restored, because restore appended it to the end of the active order

#### Scenario: An application administrator who is the team's engineering manager can restore one of that team's topics
- **WHEN** a user with `global_role = 'application_admin'` who holds an active `engineering_manager` membership on the target team submits a request to restore an archived topic against that unlocked team
- **THEN** the response is `200 OK` with `status: 'active'`
- **AND** exactly one `audit_log` row with `operation = 'topic.restored'` is written in the same transaction, with `actor_global_role = 'application_admin'`, `actor_user_id` set to the administrator, and `team_id` set to the team
