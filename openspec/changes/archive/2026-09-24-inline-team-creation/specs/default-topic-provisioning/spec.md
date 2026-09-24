## ADDED Requirements

### Requirement: Default topic set is copied into a newly created team's own topics rows

When a new team is created, the application SHALL copy the canonical default topic set — the `topics` rows belonging to the sentinel `__default_topics__` system team (`team_id = '00000000-0000-0000-0000-000000000001'`) where `is_default = true` — into new `topics` rows owned by the new team. Each copied row SHALL carry the new team's own `team_id`, its own generated `id`, and the source row's `name`, `prompt`, `vote_type`, `display_order`, `is_default`, and `first_session_description`, unmodified. This copy SHALL occur in the same database transaction as the team's creation. The copy SHALL be a real, independent row per topic — not a reference to the sentinel rows — so that a later edit to either the canonical defaults or the new team's own topic configuration never affects the other.

#### Scenario: New team receives its own copy of every default topic
- **WHEN** a new team is created
- **THEN** for every `topics` row where `team_id = '00000000-0000-0000-0000-000000000001'` and `is_default = true`, a corresponding new `topics` row is created with the new team's `team_id`, a new `id`, and the same `name`, `prompt`, `vote_type`, `display_order`, `is_default = true`, and `first_session_description`

#### Scenario: Copied topics preserve canonical ordering
- **WHEN** the default topic set is copied to a new team
- **THEN** the copied topics' `display_order` values match the source rows' `display_order` values, so the copied set renders in the same canonical order

#### Scenario: Editing a team's copied topics does not affect the canonical defaults or any other team
- **WHEN** a team's copied topic configuration is later modified (e.g., a topic is removed or annotated, once customization is unlocked)
- **THEN** the sentinel `__default_topics__` team's source rows are unchanged
- **AND** no other team's copied topic configuration is affected

#### Scenario: A later change to the canonical defaults does not retroactively affect an already-created team
- **WHEN** the sentinel `__default_topics__` team's source rows change in a future application version
- **THEN** teams that were created before that change retain the topic configuration they were originally assigned

#### Scenario: Topic-copy failure prevents team creation from completing
- **WHEN** the default-topic copy step fails during team creation
- **THEN** the team-creation transaction rolls back
- **AND** no team record exists without a topic configuration

---

### Requirement: A new team's topic configuration carries no separate "locked" column

The topic-provisioning mechanism SHALL NOT write or maintain a dedicated "locked" flag on the `topics` table or elsewhere. Whether a team's topic configuration is customizable is determined entirely by whether the team has a completed session on record — an evaluation owned by topic-customization enforcement, not by this provisioning step.

#### Scenario: No lock column is written at provisioning time
- **WHEN** a new team's default topics are provisioned
- **THEN** no column or record anywhere in the schema is set to represent "this team's topics are locked" as a stored value
- **AND** the team's copied topics are otherwise complete and correctly ordered
