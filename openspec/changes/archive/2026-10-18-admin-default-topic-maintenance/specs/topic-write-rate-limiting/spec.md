## ADDED Requirements

### Requirement: The default-topic maintenance write endpoints share the existing topic-write budget and add no limit values

`POST /api/v1/admin/default-topics`, `PATCH .../:topicId`, `POST .../:topicId/archive`, `POST .../:topicId/restore` and `PUT .../order` SHALL be admitted through `enforceTopicWriteRateLimit` with the same per-actor burst and daily budget as the other topic-write routes, evaluated after the role check and before any database work. Every admitted request, including a later validation failure or no-op, SHALL consume one unit; a `429` SHALL NOT be counted; an unavailable limiter store SHALL fail closed with `503`. The values in `TOPIC_WRITE_LIMITS` SHALL be unchanged. The two `GET` routes SHALL NOT be rate limited. The limiter's denial context `teamId` for these routes SHALL be the sentinel id (its breach row keeps `team_verified: false`). The limiter import-graph allow-list test SHALL be extended by exactly the new route module and the new denial seam module, each with a written reason, and SHALL NOT otherwise be loosened.

#### Scenario: Shared budget
- **WHEN** an actor exhausts the budget through TOPIC-003
- **THEN** a maintenance write receives the same `429` body and `Retry-After`

#### Scenario: The import-graph allow-list names the new importers
- **WHEN** the topic-write limiter structural test runs
- **THEN** it passes, and its allow-lists contain the admin route module and the denial seam module and nothing else new

#### Scenario: Role refusal spends nothing
- **WHEN** a non-admin posts to a maintenance route
- **THEN** the `403` is returned and no unit is consumed

#### Scenario: Redis outage
- **WHEN** the limiter store is unavailable
- **THEN** a maintenance write receives the fail-closed `503` and changes nothing
