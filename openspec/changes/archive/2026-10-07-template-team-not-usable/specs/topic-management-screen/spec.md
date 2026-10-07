# Spec Delta: topic-management-screen

## ADDED Requirements

### Requirement: The canonical default topics are shown as a read-only reference

When TOPIC-002 returns `lockReason: "canonical_defaults"`, the screen SHALL show "Default topics" wherever it would otherwise show the team's stored name (heading, `document.title`, breadcrumbs, back links), the notice "These are the canonical default topics every new team starts from. They can't be edited here.", and no topic write or definition control. It SHALL NOT promise unlocking after a first session, and SHALL choose this treatment from `lockReason` only.

#### Scenario: A facilitator opens the template's Topic Management screen
- **WHEN** a standing facilitator opens Topic Management for `DEFAULT_TOPICS_TEAM_ID`
- **THEN** the heading reads "Default topics"
- **AND** the string `__default_topics__` does not appear anywhere in the rendered page or in `document.title`
- **AND** the notice reads "These are the canonical default topics every new team starts from. They can't be edited here."
- **AND** the active topics are listed read-only with no Remove, Restore, move, "Add custom topic", "Add team definition" or "Edit" control

#### Scenario: The first-session copy never appears for the canonical defaults
- **WHEN** the screen renders a response with `lockReason: "canonical_defaults"`
- **THEN** the text "until this team completes its first session" does not appear

#### Scenario: The treatment follows lockReason, not the id
- **WHEN** the screen renders a response for any team id with `lockReason: "canonical_defaults"`
- **THEN** it shows the canonical-defaults treatment
- **AND WHEN** it renders a response for any team id with `lockReason: "first_session"`
- **THEN** it shows the existing first-session lock notice

## MODIFIED Requirements

### Requirement: Definition editing is unavailable on a locked team and to administrators

On a team whose `isCustomizationLocked` is true, the screen SHALL show no definition editing control. When `lockReason` is `"first_session"`, the existing lock notice SHALL read exactly: "Topics cannot be customized until this team completes its first session. Topics are shown read-only below. Team definitions can be added after the team's first session." When `lockReason` is `"canonical_defaults"`, the screen SHALL instead show the canonical-defaults notice (see "The canonical default topics are shown as a read-only reference"). When `canEditAnnotations` is false, the screen SHALL show existing definitions and provenance read-only and SHALL offer no add, edit, or clear control. Because TOPIC-002 already rejects every other caller, the complete truth table is:

| Caller reaching TOPIC-002 | `canEditAnnotations` |
|---|---|
| Standing facilitator, not a member of the team | `true` |
| Application administrator | `false` |

#### Scenario: A locked team shows no definition controls
- **WHEN** a facilitator views a non-template team that has not completed its first session (`lockReason: "first_session"`)
- **THEN** no "Add team definition" or "Edit" control is shown
- **AND** the lock notice reads exactly "Topics cannot be customized until this team completes its first session. Topics are shown read-only below. Team definitions can be added after the team's first session."

#### Scenario: An administrator sees definitions read-only
- **WHEN** an application administrator views an unlocked team whose topic is annotated `"X"`
- **THEN** the row shows "Our team's definition" with `"X"` and its provenance
- **AND** no "Add team definition" or "Edit" control is shown

