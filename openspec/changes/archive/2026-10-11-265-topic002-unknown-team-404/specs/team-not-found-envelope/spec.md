## MODIFIED Requirements

### Requirement: Every team-not-found response uses one canonical envelope

Every backend response that means "the team does not exist" SHALL be `404 Not Found` with the body `buildErrorEnvelope("not_found", "Team not found.", "TEAM_NOT_FOUND")`, produced by one shared `teamNotFoundEnvelope()` function in `routes/error-envelope.ts`. This SHALL hold on topic routes, content routes (including `GET /api/v1/teams/:teamId/topics/all`, TOPIC-002, for a standing facilitator or an application admin whose team id names no team), `POST /api/v1/teams/:teamId/sessions/draft` (both the non-canonical and the existence checks), `GET /api/v1/teams/:teamId`, `GET /api/v1/teams/:teamId/members` and `POST /api/v1/teams/:teamId/managers`. The literal `"Team not found."` SHALL NOT appear in backend source outside `error-envelope.ts`. This requirement changes the envelope only. It SHALL NOT change which check runs first on any `teams.ts` route, and adding a canonical-UUID boundary to the `teams.ts` GET routes is out of scope.

#### Scenario: teams.ts GET routes use not_found
- **WHEN** a caller requests `GET /api/v1/teams/:teamId` or `GET /api/v1/teams/:teamId/members` for a canonical UUID that matches no team
- **THEN** the response is `404` with `error.category: "not_found"` and `error.code: "TEAM_NOT_FOUND"`

#### Scenario: Draft session creation uses the canonical code
- **WHEN** a facilitator posts a draft session for a non-existent or non-canonical `teamId`
- **THEN** the response is `404` with `error.code: "TEAM_NOT_FOUND"`

#### Scenario: Structural guard against drift
- **WHEN** the structural test greps the backend source
- **THEN** `"Team not found."` occurs only in `routes/error-envelope.ts`

#### Scenario: TOPIC-002 uses the canonical envelope for an unknown team
- **WHEN** an authorized standing facilitator or application admin requests `GET /api/v1/teams/:teamId/topics/all` for a canonical UUID that matches no team
- **THEN** the response is `404` with `error.category: "not_found"` and a body equal to `teamNotFoundEnvelope()`
