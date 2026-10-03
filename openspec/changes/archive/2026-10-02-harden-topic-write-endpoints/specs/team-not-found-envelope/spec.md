## ADDED Requirements

### Requirement: Every team-not-found response uses one canonical envelope

Every backend response that means "the team does not exist" SHALL be `404 Not Found` with the body `buildErrorEnvelope("not_found", "Team not found.", "TEAM_NOT_FOUND")`, produced by one shared `teamNotFoundEnvelope()` function in `routes/error-envelope.ts`. This SHALL hold on topic routes, content routes, `POST /api/v1/teams/:teamId/sessions/draft` (both the non-canonical and the existence checks), `GET /api/v1/teams/:teamId`, `GET /api/v1/teams/:teamId/members` and `POST /api/v1/teams/:teamId/managers`. The literal `"Team not found."` SHALL NOT appear in backend source outside `error-envelope.ts`. This requirement changes the envelope only. It SHALL NOT change which check runs first on any `teams.ts` route, and adding a canonical-UUID boundary to the `teams.ts` GET routes is out of scope.

#### Scenario: teams.ts GET routes use not_found
- **WHEN** a caller requests `GET /api/v1/teams/:teamId` or `GET /api/v1/teams/:teamId/members` for a canonical UUID that matches no team
- **THEN** the response is `404` with `error.category: "not_found"` and `error.code: "TEAM_NOT_FOUND"`

#### Scenario: Draft session creation uses the canonical code
- **WHEN** a facilitator posts a draft session for a non-existent or non-canonical `teamId`
- **THEN** the response is `404` with `error.code: "TEAM_NOT_FOUND"`

#### Scenario: Structural guard against drift
- **WHEN** the structural test greps the backend source
- **THEN** `"Team not found."` occurs only in `routes/error-envelope.ts`

### Requirement: The shared error category set includes rate-limited and service-unavailable

The `ErrorCategory` union in `routes/error-envelope.ts` SHALL include `rate_limited` and `service_unavailable`. Routes that return those categories SHALL build their bodies with `buildErrorEnvelope` and SHALL NOT use inline literals.

#### Scenario: TEAM-006 bodies are unchanged after adopting the shared builder
- **WHEN** TEAM-006 returns its existing `429` or `503`
- **THEN** the body is byte-identical to the pre-change body apart from `correlationId`
