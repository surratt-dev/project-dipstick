## ADDED Requirements

### Requirement: A team default records which template default it was copied from

`topics` SHALL have a nullable column `template_topic_id`, a foreign key to `topics(id)` with `ON DELETE RESTRICT`. A team topic is **linked** when `template_topic_id` equals the id of a template default row. The link means identity ("this row was copied from that template default"); it SHALL NOT be used to propagate template edits to any team, session or snapshot (BRD 6.4). The copy performed at team creation and by zero-topic `assign-defaults` SHALL set `template_topic_id` to the source template row's id in the same single `INSERT ... SELECT` statement as the rest of the row; no second statement or UPDATE pass SHALL set it. A custom topic (`is_default = false`) SHALL never have a link. A template-team row SHALL never have a link. The link carries no uniqueness guarantee: a team MAY hold more than one row linked to one template default (for example an archived row and a fresh row inserted by a later zero-topic assign-defaults); a database uniqueness guarantee is deferred to #310. Template defaults are archived, never deleted; a delete of a referenced template row SHALL be refused by the database (SQLSTATE 23503; the admin API archives and cannot reach this). `template_topic_id` SHALL NOT appear in any API response.

#### Scenario: Team creation links every copied default
- **WHEN** a new team is created
- **THEN** each copied row's `template_topic_id` equals the id of the template row it was copied from, and no other topic of the team has a link

#### Scenario: Zero-topic assign-defaults links every copied default
- **GIVEN** a zero-topic team
- **WHEN** an administrator assigns the default topics
- **THEN** each inserted row's `template_topic_id` equals its source template row id

#### Scenario: assign-defaults on a team whose topics are all archived
- **GIVEN** a team whose topics are all archived and which holds linked rows for some template defaults
- **WHEN** an administrator assigns the default topics
- **THEN** the response is 200, fresh linked active rows are inserted for every active template default, the archived rows stay archived with their own text, and `topicCount` and the audit `topic_count` equal the number of rows inserted
- **AND** only canonical template text enters the team (no archived team-authored text is revived)
- **AND** the team's `defaultTopicsNotActive` afterwards omits those defaults

#### Scenario: The copy remains one statement
- **WHEN** the copy function's SQL is inspected by the existing E8 structural test
- **THEN** it is exactly one `INSERT INTO topics ... SELECT` whose column list includes `template_topic_id`, with no following UPDATE and no `ON CONFLICT` clause (matched by regex on the SQL text)

#### Scenario: Only the copy writes the link
- **WHEN** the structural test scans the SQL in `packages/backend/src`
- **THEN** the only statement writing `template_topic_id` is the one in `copyCanonicalDefaults`; any other writer fails the test

#### Scenario: Custom topics are never linked
- **WHEN** a facilitator adds a custom topic whose name equals a template default's name
- **THEN** its `template_topic_id` is NULL
- **AND** an attempt to give a custom row or a template-team row a link is refused by the database

#### Scenario: A referenced template row cannot be deleted
- **GIVEN** a team row linked to template default D
- **WHEN** a delete of D is attempted
- **THEN** it is refused and the link and the team row are unchanged

#### Scenario: Rename and archive keep the link
- **GIVEN** team T holds a linked "Pulse"
- **WHEN** the team renames its copy, the team archives and restores it, or an administrator renames the template default
- **THEN** the link is unchanged and restore reactivates the same row

#### Scenario: Archived and active rows for one default are read as held
- **GIVEN** a team holding an archived linked row and an active linked row for one template default
- **THEN** `defaultTopicsNotActive` does not list that default (the active linked row wins)

#### Scenario: Two teams link independently
- **GIVEN** two teams created from the same template
- **THEN** each holds its own row linked to the same template default id, and neither affects the other

### Requirement: defaultTopicsNotActive matches a team's defaults by link, not by name

TOPIC-002 `defaultTopicsNotActive` SHALL list, for each ACTIVE template default, at most one entry. A template default is matched to the team's row through `template_topic_id`; a custom topic SHALL never match. A default whose linked row is active is not listed. When a team holds several linked rows for one template default, an active one is preferred, then the lowest id. For a linked, non-active best row the entry SHALL carry the team row's `id` as `topicId`, the team row's own `name`, and `isArchived` true. For a default with no linked row the entry SHALL carry the template default's id and name and `isArchived` false, as before. An entry SHALL NOT be listed when an active team row other than the entry's own linked row (custom, or a default linked to a different template default) has a name that, under `normalizeTopicNameForMatch`, equals the entry's name (the team row's name for a linked entry, the template name for an unlinked one), because restoring it would be rejected by the active-name rule. The response shape is unchanged. Archived template defaults are not listed.

#### Scenario: Rename is invisible for defaults the team holds
- **GIVEN** team T holds a linked "Pulse" (active, or archived by the team, or renamed by the team to "Our pulse") and an administrator renames the template default to "Heartbeat"
- **WHEN** T's `defaultTopicsNotActive` is read
- **THEN** the entry for that default (or its absence) is identical to what it was before the rename, and T's topic keeps its name
- **AND** only defaults T never held are offered under a changed name

#### Scenario: An archived linked default is offered under the team's own name
- **GIVEN** T archived its linked "Pulse" and the template default has since been renamed "Heartbeat"
- **THEN** the entry has T's row id, name "Pulse" and `isArchived` true

#### Scenario: A custom topic no longer hides a default
- **GIVEN** T has an archived custom topic named like a template default, or an active custom topic with a different name
- **THEN** the default is still listed if T does not hold its linked row actively

#### Scenario: An active same-name topic suppresses the offer
- **GIVEN** T lacks a default's linked row and holds an ACTIVE custom topic with the default's name (differing only in case or surrounding spaces)
- **THEN** that default is not listed
- **AND** the same holds when the active same-name row is a default linked to a different template default
- **AND** if restore is attempted anyway it answers `409 TOPIC_NAME_ACTIVE` and changes nothing (never a 500)

#### Scenario: An archived template default is not listed
- **GIVEN** the template archived a default D that T holds neither actively nor archived
- **THEN** D is not listed

#### Scenario: Another team's linked rows do not affect the read
- **GIVEN** team B holds a differently named linked row for the same template default as team A
- **THEN** team A's `defaultTopicsNotActive` is identical with and without team B's row

#### Scenario: Unlinked legacy default
- **GIVEN** T holds an unlinked `is_default` row (NULL link) whose name differs from every template default
- **THEN** every active template default for which T has no linked row is listed with the template id and name, and the response shape is unchanged
- **AND** TOPIC-005 called with that template id answers the existing team-scoped 404 and creates no row

## MODIFIED Requirements

### Requirement: The copy and the restore list share one definition of the canonical default set

The set of topic names copied at team creation and the set of default topic names that TOPIC-002 `defaultTopicsNotActive` reports for a team with no topics SHALL be the same set, defined once by the predicate `team_id = <template> AND is_default = true AND status = 'active'`. For a team that holds some defaults, the list SHALL be the active template defaults the team does not hold as an active linked row, less any suppressed by an active same-name topic (see "defaultTopicsNotActive matches a team's defaults by link, not by name").

#### Scenario: Copied names equal the restore list for an empty team
- **GIVEN** a template state with an archived default (and, separately, a healthy template)
- **WHEN** a team is created and the names it received are compared with the names `defaultTopicsNotActive` reports for a team with no topics
- **THEN** the two sets are equal

#### Scenario: The restore list is the set difference for a team that holds some defaults
- **GIVEN** a team holding some, but not all, of the active template defaults through links
- **WHEN** the team's `defaultTopicsNotActive` is read
- **THEN** it contains exactly the active template defaults the team does not hold as an active linked row, less any suppressed by an active same-name topic
