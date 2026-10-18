## ADDED Requirements

### Requirement: The bulk restore endpoint shares the existing topic-write budget and adds no limit values

`POST /api/v1/teams/:teamId/topics/restore-defaults` SHALL be admitted through `enforceTopicWriteRateLimit` with the same per-actor burst and daily budget as the other topic-write routes, evaluated after the role check and before the team lookup. Every admitted request, including one that returns the empty `200` or a later `404` or `409`, SHALL consume one unit; a `429` SHALL NOT be counted; an unavailable limiter store SHALL fail closed with `503`. The values in `TOPIC_WRITE_LIMITS` SHALL be unchanged by this capability. Charging one unit however many topics are restored is a recorded security decision: the bound on topics mutated by bulk restore is the set of archived defaults with distinct names (a second request restores nothing), not the limiter. The handler SHALL call `enforceTopicWriteRateLimit` itself, not a copy; the limiter's denial context SHALL carry ids only and no topic text, asserted by the extended identifier-hygiene test.

#### Scenario: One request is one unit regardless of how many topics it restores
- **WHEN** a bulk request restores twelve topics
- **THEN** exactly one unit of the actor's budget is consumed

#### Scenario: An empty restore consumes a unit
- **WHEN** a bulk request returns `200 OK` with nothing restored
- **THEN** one unit is consumed

#### Scenario: Shared budget
- **WHEN** an actor exhausts the budget through other topic-write routes
- **THEN** a bulk request receives the same `429` those routes return: same status, body and headers (including `Retry-After`)

#### Scenario: Role refusal spends no budget
- **WHEN** a caller who fails the role check posts to the endpoint
- **THEN** the response is `403` and no unit is consumed
