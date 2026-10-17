## ADDED Requirements

### Requirement: TOPIC-002 `defaultTopicsNotActive` is driven by the canonical default set

The `defaultTopicsNotActive` list on `GET /api/v1/teams/:teamId/topics/all` SHALL contain, for each active template default (`team_id = <template> AND is_default = true AND status = 'active'`), an entry when the requested team has no active topic of that name. The status filter SHALL apply to the template row only, never to the team's row. An entry SHALL carry `isArchived: true` when the team holds an archived topic of that name. Response shape is otherwise unchanged. This requirement changes only the contents of the field. It changes no authorization or audit rule for the endpoint. It supersedes the non-normative "Implementation note — `defaultTopicsNotActive`" at the end of the requirement "The all-topics endpoint's response carries the team's display name, each active topic's description, and each archived topic's provenance — extensions beyond the originally-drafted contract" (which says the field is computed from "the team's canonical default topics") wherever the two differ; the definition here governs. The topic management screen does not currently read this field, so this requirement protects an API contract with no current UI consumer.

#### Scenario: An archived template default is not offered for restore
- **GIVEN** the template default Y is archived and the team has no topic named Y
- **WHEN** an authorized caller reads the team's all-topics list
- **THEN** `defaultTopicsNotActive` does not contain Y

#### Scenario: A team's own archived copy of an active default is restorable
- **GIVEN** the template default X is active and the team holds X archived
- **WHEN** an authorized caller reads the team's all-topics list
- **THEN** `defaultTopicsNotActive` contains X with `isArchived: true`

#### Scenario: Template default active and team's copy active
- **GIVEN** the template default X is active and the team holds X active
- **WHEN** an authorized caller reads the team's all-topics list
- **THEN** `defaultTopicsNotActive` does not contain X

#### Scenario: Template default archived and team's copy archived
- **GIVEN** the template default X is archived and the team holds X archived
- **WHEN** an authorized caller reads the team's all-topics list
- **THEN** `defaultTopicsNotActive` does not contain X
