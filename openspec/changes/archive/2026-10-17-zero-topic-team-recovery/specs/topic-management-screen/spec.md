## MODIFIED Requirements

### Requirement: An empty active-topics list shows a small, honest state derived from the lock, the archive, and the add flag

When the active list is empty, the screen SHALL show one of exactly four variants, determined by `isCustomizationLocked`, the number of archived topics, and (for a locked team only) `canAssignDefaults`:

| `isCustomizationLocked` | `canAssignDefaults` | archived count | Content |
|---|---|---|---|
| true | not `true` (false, absent) | any | "This team has no active topics, so its sessions can't run. Ask an application administrator to assign the default topics, then refresh this page." and no actions |
| true | `true` | any | "This team has no active topics, so its sessions can't run. Assign the default topics to restore the standard set." with the primary action "Assign default topics" and no sentence directing the viewer to ask an administrator |
| false | not applicable | > 0 | "This team has no active topics." with "Show archived topics (n)" and "Add custom topic" |
| false | not applicable | 0 | "This team has no active topics." with "Add custom topic" |

The variant is decided by the viewer's role (through the server flag) and not by team membership: an application administrator who is also a member of the team sees the administrator variant. The screen SHALL render "Assign default topics" only when `canAssignDefaults` is exactly `true` and `isCustomizationLocked` is `true`; a missing or `false` flag SHALL fail closed to the non-administrator locked variant, with no button anywhere on the page.

The "Add custom topic" action in the table above is conditional: like the heading trigger, it SHALL render only when `canAddTopics` is `true` and `isCustomizationLocked` is `false`, and the screen SHALL use one gate for both. The variant determines only the message and the "Show archived topics (n)" action; it SHALL NOT by itself cause the add action to render. Every caller TOPIC-002 admits receives `canAddTopics: true`, so no separate message variant exists for `canAddTopics: false` on an unlocked team. If the flag is nevertheless `false` or absent (for example, a frontend deployed ahead of its backend, or a backend rollback), the screen SHALL fail closed: it shows the unlocked variant's message and archive action, with no add action and no explanatory note.

**Copy rule.** The copy SHALL NOT name a support channel, or a control that does not exist. It SHALL NOT name an application role, except that the two locked zero-topic variants above name "an application administrator" (a role an engineer can find; the vaguer wording had become an escalation magnet). No other empty-state variant, and no other screen, is loosened by this exception. "Show archived topics (n)" SHALL expand the Archived section and move focus to the Archived section's show/hide control, and SHALL NOT add restore actions of its own. "Add custom topic" SHALL open the same add form as the heading trigger; while the empty state is shown the heading trigger SHALL NOT be shown. After a successful restore, add, or assign, the active list SHALL replace the empty state without a full-screen reload. The state SHALL contain no illustration. The Active Topics heading SHALL read "Active Topics (0)" while the empty state is shown.

**Assign default topics action.** Activating "Assign default topics" SHALL send `POST /api/v1/teams/:teamId/topics/assign-defaults` immediately, with no confirmation dialog (the action is additive and the server refuses it on a team that has topics). While the request is in flight the button SHALL be disabled and SHALL not fire a second request. Outcomes, shown in the screen message region under the Active Topics heading:

- `201`: the screen refetches TOPIC-002, shows the standard topic list, shows no stale empty state, and shows a status message "{n} default topic(s) assigned." with `{n}` taken from the response's `topicCount`, never a literal: "1 default topic assigned." when 1, otherwise "{n} default topics assigned." The team remains locked, so the screen shows its existing locked-team explanation and read-only controls.
- `409` with `error.code` `TEAM_HAS_ACTIVE_TOPICS`: the screen refetches TOPIC-002 and shows the current list. No separate message is shown; the list replacing the empty state is the message.
- `500` with `error.code` `DEFAULT_TOPICS_UNAVAILABLE`: an alert reading "The default topic template is empty or unavailable, so nothing was assigned. An operator needs to fix the default topic template (see "Zero-topic teams" in the deployment runbook, docs/deployment.md), then try again." The runbook cannot be linked from the app; naming its section is the accepted limit.
- Any other failure (`403`, `404`, `429`, `503`, other `5xx`, network failure or timeout): the screen's existing generic write-failure message in an alert region; the empty state remains, the button is enabled for retry, and no state is lost.

**Accessibility.** The success message is in a status (polite live) region and failure messages are in an alert region. After a `201` focus moves to the Active Topics heading (the activated button no longer exists). While the request is in flight the button is disabled and exposes that state (for example an accessible name or `aria-busy` indicating it is assigning).

The screen SHALL NOT poll or subscribe for changes made by another person, and SHALL NOT add refetch triggers beyond those it already has. A facilitator's copy says "refresh this page"; the next load of TOPIC-002 shows the assigned topics.

#### Scenario: Locked team with no topics
- **WHEN** a facilitator views a team with `isCustomizationLocked: true`, no active topics, and `canAssignDefaults` false or absent
- **THEN** the screen shows "This team has no active topics, so its sessions can't run. Ask an application administrator to assign the default topics, then refresh this page."
- **AND** no "Assign default topics", "Show archived topics" or "Add custom topic" action is shown

#### Scenario: Locked team with no topics, administrator
- **WHEN** an application administrator views a team with `isCustomizationLocked: true`, no active topics, and `canAssignDefaults: true`
- **THEN** the screen shows "This team has no active topics, so its sessions can't run. Assign the default topics to restore the standard set." with a primary "Assign default topics" button
- **AND** the screen does not tell the viewer to ask an administrator
- **AND** no "Show archived topics" or "Add custom topic" action is shown

#### Scenario: An administrator who is also a member of the team sees the administrator variant
- **WHEN** an application administrator who holds a membership on the team views the locked, zero-topic team with `canAssignDefaults: true`
- **THEN** the administrator variant with the button is shown

#### Scenario: A missing or false assign flag fails closed
- **WHEN** the screen renders a locked team with no active topics and the TOPIC-002 response has no `canAssignDefaults` field or has `canAssignDefaults: false`
- **THEN** the non-administrator locked message is shown
- **AND** no "Assign default topics" control is present anywhere on the page

#### Scenario: No button when the team has active topics, for an administrator
- **WHEN** an application administrator views a locked team that has active topics
- **THEN** the active list is shown, there is no empty state, and no "Assign default topics" control is present

#### Scenario: No button on the template team
- **WHEN** an application administrator opens Topic Management for the template team
- **THEN** no "Assign default topics" control is present

#### Scenario: Assigning succeeds and replaces the empty state
- **WHEN** an administrator activates "Assign default topics" and the request answers `201` with `topicCount: 5`
- **THEN** the screen refetches, the active list shows the topics and the empty state is no longer shown
- **AND** the status message reads "5 default topics assigned."
- **AND** the screen is not reloaded through the full-screen loading or error path
- **AND** focus is on the Active Topics heading

#### Scenario: The success message is singular for one topic
- **WHEN** the request answers `201` with `topicCount: 1`
- **THEN** the status message reads "1 default topic assigned."

#### Scenario: The button is disabled while the request is in flight
- **WHEN** an administrator activates "Assign default topics" and the request has not yet answered
- **THEN** the button is disabled and a second activation sends no second request

#### Scenario: Assign is blocked by the same busy states as Add
- **WHEN** an annotation or archived-view dialog is open, or another write is in flight, on a locked zero-topic team viewed by an administrator
- **THEN** "Assign default topics" is disabled for the same reasons the Add control would be

#### Scenario: A team that already has topics just shows its list
- **WHEN** an administrator activates "Assign default topics" and the request answers `409` with `TEAM_HAS_ACTIVE_TOPICS`
- **THEN** the screen refetches and shows the current list
- **AND** no error banner and no separate message is shown

#### Scenario: An empty template shows the configuration message and keeps the button
- **WHEN** an administrator activates "Assign default topics" and the request answers `500` with `DEFAULT_TOPICS_UNAVAILABLE`
- **THEN** the screen shows an alert "The default topic template is empty or unavailable, so nothing was assigned. An operator needs to fix the default topic template (see "Zero-topic teams" in the deployment runbook, docs/deployment.md), then try again."
- **AND** the empty state remains and "Assign default topics" is enabled for retry

#### Scenario: Any other failure shows the generic message and keeps the button
- **WHEN** the request answers `403`, `404`, `429`, `503`, or `500` with any code other than `DEFAULT_TOPICS_UNAVAILABLE` (such as `ASSIGN_DEFAULTS_FAILED`), or fails with a network error or timeout
- **THEN** the screen's existing generic write-failure message is shown in an alert region
- **AND** the empty state remains, "Assign default topics" is enabled, and nothing is lost

#### Scenario: Unlocked zero-topic team shows no Assign button
- **WHEN** an application administrator views an unlocked team with no active topics and `canAssignDefaults: true`
- **THEN** no "Assign default topics" control is present and the unlocked variant's controls are shown

#### Scenario: Unlocked team with archived topics, facilitator
- **WHEN** a standing facilitator views an unlocked team with no active topics, 3 archived topics, and `canAddTopics: true`
- **THEN** the screen shows "This team has no active topics." with "Show archived topics (3)" and "Add custom topic"
- **AND** the Active Topics heading reads "Active Topics (0)" and shows no add trigger

#### Scenario: Unlocked team with archived topics, administrator
- **WHEN** an application administrator views an unlocked team with no active topics, 3 archived topics, and `canAddTopics: true`
- **THEN** the screen shows "This team has no active topics." with "Show archived topics (3)" and "Add custom topic"
- **AND** no "Assign default topics" control is shown

#### Scenario: Unlocked team with nothing archived, facilitator
- **WHEN** a standing facilitator views an unlocked team with no active and no archived topics
- **THEN** the screen shows "This team has no active topics." with "Add custom topic" only

#### Scenario: Unlocked team with nothing archived, administrator
- **WHEN** an application administrator views an unlocked team with no active and no archived topics, and `canAddTopics: true`
- **THEN** the screen shows "This team has no active topics." with "Add custom topic" only

#### Scenario: A missing add flag fails closed in the empty state
- **WHEN** the screen renders an unlocked team with no active topics and 2 archived topics, and the TOPIC-002 response has no `canAddTopics` field or has `canAddTopics: false`
- **THEN** the screen shows "This team has no active topics." with "Show archived topics (2)"
- **AND** no "Add custom topic" control is present anywhere on the page

#### Scenario: Show archived topics expands and focuses the archive
- **WHEN** a facilitator selects "Show archived topics (3)"
- **THEN** the Archived section is expanded and focus is on the Archived section's show/hide control

#### Scenario: Restoring from the empty state replaces it without a reload
- **WHEN** a facilitator restores an archived topic while the empty state is shown
- **THEN** the restored topic appears in the active list and the empty state is no longer shown
- **AND** the screen is not reloaded through the full-screen loading or error path
