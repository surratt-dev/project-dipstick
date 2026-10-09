## MODIFIED Requirements

### Requirement: The active-topics endpoint does not return the team annotation

`GET /api/v1/teams/:teamId/topics` (TOPIC-001) SHALL NOT include the team annotation or its provenance on any topic entry. TOPIC-001 has no consumer of the value, and in-session display reads only the session payload (see `session-topic-lifecycle`). TOPIC-001 now denies engineering managers, by membership role or global role (#187; see `team-content-access`, Requirement: The active-topics endpoint admits only non-manager participant members and eligible session facilitators). That denial is a precondition for ever adding the annotation, not a reason to add it now. The annotation SHALL stay off TOPIC-001 until a change introduces a real consumer of TOPIC-001. That change SHALL also convert TOPIC-001's topic entries to the contract's camelCase shape. The tripwire is the backend test "does not remap existing snake_case fields to camelCase". The consumer change has to flip that test on purpose, so it cannot add the annotation without noticing the remap.

Engineering managers do not receive the annotation from TOPIC-002 (`GET /api/v1/teams/:teamId/topics/all`) either. TOPIC-002 rejects a caller whose global role is `engineering_manager`. It also rejects an `application_admin` who holds an active `engineering_manager` membership on the team, or any membership role other than `participant` (#232; see `topic-customization-lock`, Requirement: The all-topics endpoint uses the standing, org-wide facilitator authorization model). The statement "engineering managers never see the team's definition" therefore holds across both topic reads, including for an administrator who manages the team.

#### Scenario: TOPIC-001 carries no annotation fields
- **WHEN** an authorized caller requests TOPIC-001 for a team whose topic is annotated `"X"`
- **THEN** no topic entry contains `teamAnnotation`, `team_annotation`, `annotationUpdatedBy`, or `annotationUpdatedAt`

#### Scenario: An engineering manager never sees the annotation through TOPIC-001
- **WHEN** an engineering manager of a team whose topic is annotated `"X"` requests TOPIC-001 for that team
- **THEN** the response is `403`
- **AND** the response body does not contain `"X"`

#### Scenario: An administrator who manages the team never sees the annotation through TOPIC-002
- **WHEN** an `application_admin` with an active `engineering_manager` membership on a team whose active topic is annotated `"X"` and whose archived topic is annotated `"Y"` requests TOPIC-002 for that team
- **THEN** the response is `403` with the message "Topic configuration for this team isn't available to its engineering manager."
- **AND** the response body contains neither `"X"` nor `"Y"`
