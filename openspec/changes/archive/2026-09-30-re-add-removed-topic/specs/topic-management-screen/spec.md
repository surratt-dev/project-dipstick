## ADDED Requirements

### Requirement: The archived-topics view provides a restore action per topic, with a confirmation naming both the team and the topic

Each entry in the Topic Management screen's archived-topics view SHALL provide a "Restore" action. Selecting it SHALL always display a confirmation step, before any request is sent to the server, that names both the specific topic and the specific team, and states that the topic's historical data will be restored. No restore request SHALL be sent until the facilitator explicitly confirms. Unlike the remove-confirmation flow, this confirmation is a single step — there is no escalation branch, since restoring a topic never requires the additional warning the last-active-topic or open-action-item conditions produce for removal.

This confirmation copy does not state that a gap will become visible in trend views — that signal is scoped to a separate, deferred change (see this change's `proposal.md` "Scope Decision" section) and is not shipped by this capability. The copy is expected to be revisited when that follow-up change ships.

#### Scenario: A restore action is available for each archived topic
- **WHEN** a facilitator views the archived-topics list for a team with at least one archived topic
- **THEN** each entry provides a "Restore" action

#### Scenario: The restore confirmation names both the topic and the team
- **WHEN** a facilitator selects "Restore" on a topic named "Pairing Effectiveness" for a team named "Platform Squad"
- **THEN** the confirmation dialog's text identifies both "Pairing Effectiveness" and "Platform Squad"

#### Scenario: The restore confirmation states that historical data will be restored
- **WHEN** a facilitator selects "Restore" on any archived topic
- **THEN** the confirmation dialog states that the topic's historical data will be restored

#### Scenario: Cancelling the restore confirmation makes no change
- **WHEN** a facilitator selects "Restore" on a topic and then cancels the confirmation dialog
- **THEN** no restore request is sent
- **AND** the topic remains archived and visible in the archived-topics list

#### Scenario: Confirming the restore updates both lists
- **WHEN** a facilitator confirms restoring an archived topic
- **THEN** the topic no longer appears in the archived-topics list
- **AND** the topic appears in the active topic list

### Requirement: No removed-topics list is empty-hidden, and re-adding is unavailable when none exist

When a team has zero archived topics, the archived-topics view SHALL communicate this clearly (an explicit empty-state message) rather than hiding the section or leaving it ambiguous, and no restore action SHALL be shown.

#### Scenario: A team with no archived topics shows a clear empty state
- **WHEN** a facilitator views the archived-topics list for a team with zero archived topics
- **THEN** the screen displays an explicit message indicating there are no archived topics
- **AND** no restore action is shown
