## MODIFIED Requirements

### Requirement: The active-topics endpoint does not return the team annotation

`GET /api/v1/teams/:teamId/topics` (TOPIC-001) SHALL NOT include the team annotation or its provenance on any topic entry. TOPIC-001 has no consumer of the value, and in-session display reads only the session payload (see `session-topic-lifecycle`). TOPIC-001 now denies engineering managers, by membership role or global role (#187; see `team-content-access`, Requirement: The active-topics endpoint admits only non-manager participant members and eligible session facilitators). That denial is a precondition for ever adding the annotation, not a reason to add it now. The annotation SHALL stay off TOPIC-001 until a change introduces a real consumer of TOPIC-001. That change SHALL also convert TOPIC-001's topic entries to the contract's camelCase shape. The tripwire is the backend test "does not remap existing snake_case fields to camelCase". The consumer change has to flip that test on purpose, so it cannot add the annotation without noticing the remap.

A caller whose global role is `engineering_manager` does not receive the annotation from TOPIC-002 (`GET /api/v1/teams/:teamId/topics/all`) either: TOPIC-002 rejects that global role whatever the caller's membership. An `application_admin` receives the annotation and its provenance from TOPIC-002 read-only (`canEditAnnotations: false`), whatever their membership on the team, including an administrator who holds an active `engineering_manager` membership on it (#208, reversing #232's no-manager rule on TOPIC-002; see `topic-customization-lock`, Requirement: The all-topics endpoint uses the standing, org-wide facilitator authorization model). Every such administrator read is audited with the reader's membership role and without the annotation text (see `topic-customization-lock`, Requirement: The all-topics endpoint audits every administrator read). TOPIC-007 still rejects every administrator, so no administrator can author or change the team's words. The statement "engineering managers never see the team's definition" holds for engineering managers by global role on both topic reads, and for every caller on TOPIC-001. It does not cover an Application Administrator who also manages the team; the product owner accepted that, on the ground that administrators are a trusted role.

#### Scenario: TOPIC-001 carries no annotation fields
- **WHEN** an authorized caller requests TOPIC-001 for a team whose topic is annotated `"X"`
- **THEN** no topic entry contains `teamAnnotation`, `team_annotation`, `annotationUpdatedBy`, or `annotationUpdatedAt`

#### Scenario: An engineering manager never sees the annotation through TOPIC-001
- **WHEN** an engineering manager of a team whose topic is annotated `"X"` requests TOPIC-001 for that team
- **THEN** the response is `403`
- **AND** the response body does not contain `"X"`

#### Scenario: An administrator who manages the team reads the annotation through TOPIC-002, read-only and audited
- **WHEN** an `application_admin` with an active `engineering_manager` membership on a team whose active topic is annotated `"X"` and whose archived topic is annotated `"Y"` requests TOPIC-002 for that team
- **THEN** the response is `200` and includes `teamAnnotation: "X"` on the active entry and `teamAnnotation: "Y"` on the archived entry, with `canEditAnnotations: false`
- **AND** exactly one `admin.topic_config_accessed` row is written with `metadata.membership_role = "engineering_manager"` and `metadata.annotated_count = 2`
- **AND** neither the row's metadata nor the structured event contains `"X"` or `"Y"`

#### Scenario: An administrator who manages the team still cannot change the annotation
- **WHEN** an `application_admin` with an active `engineering_manager` membership on an unlocked team sends `PUT /api/v1/teams/:teamId/topics/:topicId/annotation` for one of its topics, and separately an `application_admin` with an active `participant` membership does the same
- **THEN** each response is `403`
- **AND** the topic's annotation and provenance (`team_annotation`, `annotation_updated_by`, `annotation_updated_at`) are unchanged

