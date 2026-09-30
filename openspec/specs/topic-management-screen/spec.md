# topic-management-screen

## Purpose

Defines the frontend Topic Management screen: the per-team route facilitators use to view a team's active and archived topics, to remove (archive) an active topic, and to restore an archived topic. This spec covers: the active-topic list and its per-row configuration display; the remove-confirmation flow, including its in-place escalation for topics with open action items; the last-active-topic hard-block message; the archived-topics view and its provenance display; the restore action and its single-step confirmation; the archived-topics empty state; and the screen's nav entry point from the team page.

This spec does NOT cover: the server-side authorization model or response contracts for the endpoints this screen calls (`GET /api/v1/teams/:teamId/topics/all`, `DELETE /api/v1/teams/:teamId/topics/:topicId`, and `POST /api/v1/teams/:teamId/topics/:topicId/restore` — see `topic-customization-lock`, `remove-topic`, and `restore-topic` respectively). Access control is enforced server-side by those endpoints; this screen's own gating is a UX convenience, not the authorization boundary.

**Implementation note — files:** The screen is implemented in `packages/frontend/src/pages/TopicManagementPage.tsx`, registered as a protected route in `App.tsx` alongside the project's existing `ProtectedRoute` pattern (no new client-side authorization primitive). It calls `GET /api/v1/teams/:teamId/topics/all` (`teamName`, `active[]` with `firstSessionDescription`, `archived[]` with `archivedBy`/`restoredAt`/`restoredBy` — see `topic-customization-lock`) to render its lists, `DELETE /api/v1/teams/:teamId/topics/:topicId` to remove a topic, and `POST /api/v1/teams/:teamId/topics/:topicId/restore` to restore one. The remove-confirmation dialog's content is swapped in place via a `RemoveTopicState` discriminated union, mirroring `MemberManagement.tsx`'s established inline-state pattern rather than introducing a new shared `Modal`/`ConfirmDialog` component. The restore-confirmation dialog follows the same pattern via a separate `RestoreTopicState` union, a single-step `idle → confirming → submitting → error` state with no escalation branch. The nav entry point is a plain link added to `TeamPage.tsx`.

---

## Requirements

### Requirement: The Topic Management screen displays a team's active topics with their configuration and a remove action

The application SHALL provide a Topic Management screen, reachable at a per-team route, that displays the team's active topics in their current display order. Each row SHALL show the topic's prompt, vote type, and description (matching the existing View Active Topic Configuration acceptance criteria), and SHALL provide a "Remove" action. The screen SHALL be accessible only to an authenticated facilitator eligible under the standing, org-wide facilitator model; an ineligible caller SHALL see a clear access-denied state rather than the topic list.

#### Scenario: An eligible facilitator sees the active topic list with full configuration per row
- **WHEN** a standing facilitator who is not a member of the team navigates to the Topic Management screen for an unlocked team
- **THEN** each active topic is displayed with its prompt, vote type, and description
- **AND** each row has a "Remove" action

#### Scenario: An ineligible caller sees an access-denied state, not the topic list
- **WHEN** a caller who is not eligible under the standing facilitator model navigates directly to the Topic Management screen's route
- **THEN** the screen displays an access-denied state
- **AND** no topic data is shown

#### Scenario: A locked team's screen shows topics read-only, without a Remove action
- **WHEN** a facilitator navigates to the Topic Management screen for a team that has not yet completed its first session
- **THEN** the active topics are displayed
- **AND** no "Remove" action is shown, consistent with the topic-customization lock

### Requirement: Removing a topic always shows a confirmation naming both the team and the topic before any write occurs

Selecting "Remove" on a topic SHALL always display a confirmation step, before any request is sent to the server, that names both the specific topic and the specific team, and states that the topic's historical data will be retained and remains visible in trend views. No archive request SHALL be sent until the facilitator explicitly confirms.

#### Scenario: The confirmation names both the topic and the team
- **WHEN** a facilitator selects "Remove" on a topic named "Pairing Effectiveness" for a team named "Platform Squad"
- **THEN** the confirmation dialog's text identifies both "Pairing Effectiveness" and "Platform Squad"

#### Scenario: The confirmation states that historical data is retained
- **WHEN** a facilitator selects "Remove" on any topic
- **THEN** the confirmation dialog states that the topic's historical data will be retained and remains visible in trend views

#### Scenario: Cancelling the confirmation makes no change
- **WHEN** a facilitator selects "Remove" on a topic and then cancels the confirmation dialog
- **THEN** no archive request is sent
- **AND** the topic remains active and visible in the active topic list

### Requirement: A topic with open action items escalates the confirmation in place, with a drill-down list, rather than opening a second dialog

When the server responds to the initial archive request with `requiresConfirmation: true`, the same confirmation dialog SHALL replace its content in place with a specific warning identifying the number of open action items, plain-language wording describing the consequence (that the items will stay open but nothing will remind anyone about them going forward), and an inline, view-only list of the open action items' descriptions — without navigating away from the dialog. The facilitator SHALL be able to confirm a second time to proceed with the archive, sending the request with `confirm=true`.

#### Scenario: A topic with open action items shows the specific warning in the same dialog
- **WHEN** a facilitator confirms removal of a topic that has open action items
- **THEN** the same dialog's content is replaced with a warning naming the open action item count and listing each item's description inline
- **AND** no second, separate dialog is opened

#### Scenario: A second confirmation proceeds with the archive
- **WHEN** a facilitator confirms a second time from the escalated warning
- **THEN** the archive request is sent with `confirm=true`
- **AND** on success, the topic no longer appears in the active topic list

#### Scenario: A topic with no open action items does not show the escalated warning
- **WHEN** a facilitator confirms removal of a topic that has zero open action items
- **THEN** the topic is archived immediately after the first confirmation
- **AND** the escalated warning is never shown

### Requirement: A hard block on removing a team's last active topic is surfaced as a clear, specific message

When the server rejects an archive request because it would leave the team with zero active topics, the screen SHALL display a clear, specific explanation — not a generic error — and SHALL NOT archive the topic.

#### Scenario: Attempting to remove the last active topic shows a specific explanation
- **WHEN** a facilitator attempts to remove a team's sole remaining active topic
- **THEN** the screen displays a message explaining that at least one active topic must remain
- **AND** the topic remains in the active topic list

### Requirement: The archived-topics view shows who archived each topic and when

The Topic Management screen SHALL provide access to a list of the team's archived topics, and SHALL show, for each, when it was archived and by whom.

#### Scenario: An archived topic's entry shows who archived it and when
- **WHEN** a facilitator views the archived-topics list for a team with at least one archived topic
- **THEN** each entry shows the timestamp it was archived
- **AND** shows the display name of the facilitator who archived it

#### Scenario: A facilitator inheriting a team can see provenance without asking anyone
- **WHEN** a facilitator who has never previously worked with a team views that team's archived-topics list
- **THEN** the facilitator can determine who archived each topic and when directly from the screen, without consulting any other system or person

### Requirement: The archived-topics view provides a restore action per topic, with a confirmation naming both the team and the topic

Each entry in the Topic Management screen's archived-topics view SHALL provide a "Restore" action. Selecting it SHALL always display a confirmation step, before any request is sent to the server, that names both the specific topic and the specific team, and states that the topic's historical data will be restored. No restore request SHALL be sent until the facilitator explicitly confirms. Unlike the remove-confirmation flow, this confirmation is a single step — there is no escalation branch, since restoring a topic never requires the additional warning the last-active-topic or open-action-item conditions produce for removal.

This confirmation copy does not state that a gap will become visible in trend views — that signal is scoped to a separate, deferred change and is not shipped by this capability. The copy is expected to be revisited when that follow-up change ships.

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

### Requirement: The Topic Management screen has a discoverable nav entry point from the team page

The team page SHALL provide a visible, discoverable link or tab to the Topic Management screen for any facilitator eligible to view it, alongside the existing team-management navigation.

#### Scenario: A facilitator can navigate to Topic Management from the team page
- **WHEN** an eligible facilitator views a team's team page
- **THEN** a link or tab to the Topic Management screen is visible and selectable without prior knowledge of its URL
