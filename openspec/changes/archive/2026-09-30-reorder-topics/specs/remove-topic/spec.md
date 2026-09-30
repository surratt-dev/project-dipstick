## ADDED Requirements

### Requirement: Display-order uniqueness applies only among a team's active topics

The database SHALL enforce that no two **active** topics on the same team share a `display_order`. It SHALL NOT enforce uniqueness of `display_order` among archived topics, or between an archived and an active topic. An archived topic's `display_order` is not meaningful and is not maintained: the archived-topics list orders by `archived_at`, and restore re-appends at the end of the active order. This replaces the `topics_team_order UNIQUE (team_id, display_order, status)` constraint with a partial unique index on `(team_id, display_order) WHERE status = 'active'`.

#### Scenario: Archiving a topic whose position an archived topic already holds succeeds
- **WHEN** a team has an archived topic at `display_order = k` and an active topic at `display_order = k`, and a standing facilitator archives the active topic
- **THEN** the response is `200 OK` and the topic is archived
- **AND** no `500` or unique-violation error occurs

#### Scenario: The archive, add, archive sequence no longer fails
- **WHEN** on an unlocked team with active topics at positions `1..11`, the facilitator archives the topic at position 11, adds a custom topic (assigned position 11), and then archives that custom topic
- **THEN** every request succeeds

#### Scenario: Two active topics on the same team still cannot share a position
- **WHEN** a write attempts to give two active topics on the same team the same `display_order`
- **THEN** the database rejects the write with a unique violation
