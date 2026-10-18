## ADDED Requirements

### Requirement: Single restore is unchanged by the existence of bulk restore

`POST /api/v1/teams/:teamId/topics/:topicId/restore` SHALL behave exactly as before: its cascade, its `topic.restored` audit row, its append position, and its absence of a name-uniqueness check are unchanged. Bulk restore (`bulk-restore-default-topics`) is a separate endpoint that applies the same role, lock, ordering and provenance rules, plus a duplicate-name skip that single restore does not enforce. Single restore remains the path for restoring a selected subset of topics and any archived topic that is not a default.

#### Scenario: Single restore ignores the duplicate rule
- **WHEN** a facilitator restores one archived default whose name matches an active topic, through single restore
- **THEN** the restore succeeds as it does today
