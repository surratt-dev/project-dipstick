## MODIFIED Requirements

### Requirement: The Topic Management screen displays a team's active topics with their configuration and a remove action

The application SHALL provide a Topic Management screen, reachable at a per-team route, that displays the team's active topics in their current display order. Each row SHALL show the topic's prompt, vote type, and description (matching the existing View Active Topic Configuration acceptance criteria), and SHALL provide a "Remove" action. The screen SHALL be accessible only to a caller whom TOPIC-002 admits: an authenticated facilitator eligible under the standing, org-wide facilitator model, or any application administrator, whatever their membership on the team (#208). An ineligible caller SHALL see a clear access-denied state rather than the topic list.

When the screen's initial load of TOPIC-002 answers `403`, the access-denied state SHALL show the response's `error.message` when the body is a standard error envelope that carries one. Otherwise, including when the body is not JSON or is empty, it SHALL show "You do not have access to this team's topic management." A `403` SHALL NOT be reported as a network error. In either case the screen SHALL show no topic list, no "Our team's definition" block, and no write control. A facilitator who is a member of the team therefore reads "A facilitator cannot view topic management for a team they are a member of." and not a generic denial that looks like a fault.

#### Scenario: An eligible facilitator sees the active topic list with full configuration per row
- **WHEN** a standing facilitator who is not a member of the team navigates to the Topic Management screen for an unlocked team
- **THEN** each active topic is displayed with its prompt, vote type, and description
- **AND** each row has a "Remove" action

#### Scenario: An ineligible caller sees an access-denied state, not the topic list
- **WHEN** a caller whom TOPIC-002 rejects (a facilitator who is a member of the team, an engineer, or an engineering manager by global role) navigates directly to the Topic Management screen's route
- **THEN** the screen displays an access-denied state
- **AND** no topic data is shown

#### Scenario: The access-denied state shows the server's reason when one is given
- **WHEN** a facilitator who is an active member of the team navigates to the Topic Management screen and TOPIC-002 answers `403` with the message "A facilitator cannot view topic management for a team they are a member of."
- **THEN** the access-denied state shows that message
- **AND** no topic list, "Our team's definition" block, or write control is shown

#### Scenario: The access-denied state falls back to the generic message
- **WHEN** TOPIC-002 answers the screen's initial load with `403` and a body that is not a standard error envelope with a message
- **THEN** the access-denied state shows "You do not have access to this team's topic management."
- **AND** no topic list, "Our team's definition" block, or write control is shown

#### Scenario: A 403 with a non-JSON body is not shown as a network error
- **WHEN** TOPIC-002 answers the screen's initial load with `403` and a body that is not JSON (for example, an HTML page from a proxy, or an empty body)
- **THEN** the access-denied state shows "You do not have access to this team's topic management."
- **AND** the screen does not show "Network error loading topics."
- **AND** no topic list, "Our team's definition" block, or write control is shown

#### Scenario: A locked team's screen shows topics read-only, without a Remove action
- **WHEN** a facilitator navigates to the Topic Management screen for a team that has not yet completed its first session
- **THEN** the active topics are displayed
- **AND** no "Remove" action is shown, consistent with the topic-customization lock

#### Scenario: An administrator who manages the team sees the screen
- **WHEN** an application administrator with an active `engineering_manager` membership on the team navigates to that team's Topic Management screen
- **THEN** the screen shows the team's active and archived topics, not an access-denied state

#### Scenario: An administrator who manages the team has the topic write controls
- **WHEN** an application administrator with an active `engineering_manager` membership on the team views that unlocked team's Topic Management screen
- **THEN** each active row has a "Remove" action, the add-topic control is shown (`canAddTopics: true`), reorder controls are shown, and the removed-topics list offers "Restore"
- **AND** no definition add, edit, or clear control is shown

### Requirement: The Topic Management screen has a discoverable nav entry point from the team page

The team page SHALL provide a visible, discoverable link or tab to the Topic Management screen for any facilitator eligible to view it, alongside the existing team-management navigation. The server is the only gate for the screen. The team page SHALL NOT hide the link based on a client-side guess about the caller's role or membership. Every application administrator, including one who is the team's engineering manager, sees the link, and following it lands on the screen.

#### Scenario: A facilitator can navigate to Topic Management from the team page
- **WHEN** an eligible facilitator views a team's team page
- **THEN** a link or tab to the Topic Management screen is visible and selectable without prior knowledge of its URL

#### Scenario: An administrator who manages the team sees the link and the screen
- **WHEN** an application administrator with an active `engineering_manager` membership on the team views that team's page and follows the Topic Management link
- **THEN** the link was visible
- **AND** the Topic Management screen shows the team's topics

### Requirement: Definition editing is unavailable on a locked team and to administrators

On a team whose `isCustomizationLocked` is true, the screen SHALL show no definition editing control. When `lockReason` is `"first_session"`, the existing lock notice SHALL read exactly: "Topics cannot be customized until this team completes its first session. Topics are shown read-only below. Team definitions can be added after the team's first session." When `lockReason` is `"canonical_defaults"`, the screen SHALL instead show the canonical-defaults notice (see "The canonical default topics are shown as a read-only reference"). When `canEditAnnotations` is false, the screen SHALL show existing definitions and provenance read-only and SHALL offer no add, edit, or clear control. TOPIC-002 already rejects every other caller (a facilitator who is a member of the team, an engineer, an engineering manager by global role), who never reaches this screen's topic list. So the complete truth table is:

| Caller reaching TOPIC-002 | `canEditAnnotations` |
|---|---|
| Standing facilitator, not a member of the team | `true` |
| Application administrator, with any membership on the team or none (including the team's engineering manager) | `false` |

#### Scenario: A locked team shows no definition controls
- **WHEN** a facilitator views a non-template team that has not completed its first session (`lockReason: "first_session"`)
- **THEN** no "Add team definition" or "Edit" control is shown
- **AND** the lock notice reads exactly "Topics cannot be customized until this team completes its first session. Topics are shown read-only below. Team definitions can be added after the team's first session."

#### Scenario: An administrator sees definitions read-only
- **WHEN** an application administrator with no membership on the team views an unlocked team whose topic is annotated `"X"`
- **THEN** the row shows "Our team's definition" with `"X"` and its provenance
- **AND** no "Add team definition" or "Edit" control is shown

#### Scenario: An administrator who manages the team sees definitions read-only
- **WHEN** an application administrator with an active `engineering_manager` membership on the team views an unlocked team whose topic is annotated `"X"`
- **THEN** the row shows "Our team's definition" with `"X"` and its provenance
- **AND** no "Add team definition" or "Edit" control is shown
