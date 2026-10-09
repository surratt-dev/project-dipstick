## MODIFIED Requirements

### Requirement: A standing facilitator or an application administrator can reorder an unlocked team's active topics

`PUT /api/v1/teams/:teamId/topics/order` SHALL accept a body `{ orderedTopicIds: string[] }` and SHALL allow an authenticated user with `global_role = 'facilitator'` who is not an active member of the target team, OR `global_role = 'application_admin'`, to replace the team's active-topic order with the submitted order, provided the team's customization lock (per `topic-customization-lock`) is not active. On a successful save that changes the order, the team's active topics SHALL have `display_order` exactly `1..N` (N = active topic count), assigned in the submitted order, and the response SHALL be `200 OK` with `{ topics: [{ topicId, name, displayOrder }], openSessionCreatedAt }`, with `topics` in the new order. **Administrators and team membership (#208).** An `application_admin` SHALL be admitted whatever their membership on the target team: none, or any value of `team_memberships.role` (today `participant` or `engineering_manager`). This is a decided rule (BRD FR-8.2; decision record `08b - Member Admin Topic Writes - Decision`). The product owner decided (#208) that administrators are a trusted role and are not barred from topic configuration by team membership. This decision covers TOPIC-002..006 only; it does not change any other administrator restriction. The non-member condition applies to facilitators only. The in-transaction `topic.*` audit row with `actor_global_role = 'application_admin'` and `team_id` is the permanent record of every administrator reorder; it is not an interim control.

#### Scenario: A valid full ordering is persisted densely and 1-based
- **WHEN** a standing facilitator who is not a member of the team submits `orderedTopicIds` equal to the team's current active topic IDs in a different order, for an unlocked team
- **THEN** the response is `200 OK`
- **AND** the team's active topics have `display_order` values exactly `1..N` in the submitted order
- **AND** the response's `topics` array lists them in that order with matching `displayOrder` values

#### Scenario: The read endpoints reflect the saved order
- **WHEN** a reorder succeeds
- **THEN** a subsequent `GET /api/v1/teams/:teamId/topics` and `GET /api/v1/teams/:teamId/topics/all` both return the team's active topics in the submitted order

#### Scenario: Reorder closes gaps left by earlier archives
- **WHEN** a team's active topics currently hold `display_order` values `1, 2, 4, 7` and a facilitator saves a different order of those four topics
- **THEN** after the save their `display_order` values are exactly `1, 2, 3, 4` in the submitted order

#### Scenario: An application administrator can reorder any team's topics
- **WHEN** a user with `global_role = 'application_admin'` submits a valid reorder for an unlocked team
- **THEN** the response is `200 OK`
- **AND** this succeeds for each of: no membership on the target team, an active `participant` membership, and an active `engineering_manager` membership (#208)

#### Scenario: Archived topics' display_order is untouched by reorder
- **WHEN** a team has archived topics and a facilitator saves a new active order
- **THEN** no archived topic's row is modified by the reorder

#### Scenario: An application administrator who is the team's engineering manager can reorder that team's topics
- **WHEN** a user with `global_role = 'application_admin'` who holds an active `engineering_manager` membership on the target team submits a valid full reorder against that unlocked team
- **THEN** the response is `200 OK` and the submitted order is persisted
- **AND** exactly one `audit_log` row with `operation = 'topic.reordered'` is written in the same transaction, with `actor_global_role = 'application_admin'`, `actor_user_id` set to the administrator, and `team_id` set to the team
