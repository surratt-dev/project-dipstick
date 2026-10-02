# topic-management-screen

## Purpose

Defines the frontend Topic Management screen: the per-team route facilitators use to view a team's active and archived topics, to remove (archive) an active topic, to restore an archived topic, and to reorder the active topics (TOPIC-006). This spec covers: the active-topic list and its per-row configuration display; the remove-confirmation flow, including its in-place escalation for topics with open action items; the last-active-topic hard-block message; the archived-topics view and its provenance display; the restore action and its single-step confirmation; the archived-topics empty state; the screen's nav entry point from the team page; the team's definition ("Our team's definition", the TOPIC-007 team annotation) shown on active and archived rows, with inline add/edit/clear for an eligible facilitator, its save and failure handling, and its interlocks with the reorder draft and the Remove/Restore dialogs (added by `topic-annotation`); the reorder controls (position numbers, move buttons, local draft with Save order / Discard, interaction locking with Remove/Restore, the `beforeunload`-only unsaved-draft guard, stale-save and other save-failure handling, and move announcements); and (added by `topic-add-form-and-empty-state`) the inline "Add custom topic" form and its gating, validation, duplicate hint, submit outcomes, and interlocks, the shared screen-message region, the non-replacing refetch after Remove/Restore, the "Custom" row tag, and the empty active-topics state.

This spec does NOT cover: the server-side authorization model or response contracts for the endpoints this screen calls (`GET /api/v1/teams/:teamId/topics/all`, `DELETE /api/v1/teams/:teamId/topics/:topicId`, `POST /api/v1/teams/:teamId/topics/:topicId/restore`, `PUT /api/v1/teams/:teamId/topics/order`, `PUT /api/v1/teams/:teamId/topics/:topicId/annotation`, and `POST /api/v1/teams/:teamId/topics` — see `topic-customization-lock`, `remove-topic`, `restore-topic`, `reorder-topics`, `topic-annotation`, and `add-custom-topic` respectively). Access control is enforced server-side by those endpoints; this screen's own gating is a UX convenience, not the authorization boundary.

**Implementation note — files:** The screen is implemented in `packages/frontend/src/pages/TopicManagementPage.tsx`, registered as a protected route in `App.tsx` alongside the project's existing `ProtectedRoute` pattern (no new client-side authorization primitive). It calls `GET /api/v1/teams/:teamId/topics/all` (`teamName`, `active[]` with `firstSessionDescription`, `archived[]` with `archivedBy`/`restoredAt`/`restoredBy` — see `topic-customization-lock`) to render its lists, `DELETE /api/v1/teams/:teamId/topics/:topicId` to remove a topic, and `POST /api/v1/teams/:teamId/topics/:topicId/restore` to restore one. The remove-confirmation dialog's content is swapped in place via a `RemoveTopicState` discriminated union, mirroring `MemberManagement.tsx`'s established inline-state pattern rather than introducing a new shared `Modal`/`ConfirmDialog` component. The restore-confirmation dialog follows the same pattern via a separate `RestoreTopicState` union, a single-step `idle → confirming → submitting → error` state with no escalation branch. The nav entry point is a plain link added to `TeamPage.tsx`.

**Implementation note — add form and empty state (`topic-add-form-and-empty-state`):** The add form calls `POST /api/v1/teams/:teamId/topics` and is gated on TOPIC-002's `canAddTopics` and `isCustomizationLocked`. The form is `packages/frontend/src/components/AddCustomTopicForm.tsx`; the empty active-topics state is `packages/frontend/src/components/ActiveTopicsEmptyState.tsx`; pure, React-free rules (required-field validation, the duplicate hint `findDuplicate`, request building, the server-`422` field map, the empty-state variant table `activeEmptyStateVariant`, the 80% counter threshold, and `VOTE_TYPE_LABELS`, now shared by row labels and the form's radios) are in `packages/frontend/src/pages/addCustomTopic.ts`, following the `topicOrder.ts` precedent. The form's state is an `editing | confirmingDiscard | submitting` phase plus a nullable `duplicate` and a `duplicateOverride` flag; vote-type radios are `disabled` (not read-only) while a request is in flight, and text fields are `readOnly`. Quiet refetches go through a counter that classifies each as ok, failed, or superseded; the counter covers TOPIC-002 refetches only, not order or annotation saves. After a successful Remove or Restore the dialog closes only if it is still `submitting` for the same `topicId`, so a second confirmation opened during the first refetch keeps its own dialog until its own write settles; the error branches settle without that guard. `TopicManagementRoute`, exported from `TopicManagementPage.tsx` and rendered by `App.tsx`, keys the page by `teamId` so a team change remounts it and discards any open form; the page must not be mounted unkeyed.

**Implementation note — untested scenarios:** "A refetch failure after Remove stays inline and keeps the add form" is tested only for the add-form variant; no reorder-draft variant exists to test, because Remove is disabled while the order draft is dirty or saving. The superseded post-`201` add refetch (the form closes, the general "Added '<name>' to the end of the list. …" message, focus to the Active Topics heading) is implemented but has no page test, since it is not reachable in practice; the superseded mechanism is tested through Remove and Restore. Remove and Restore are not fully serialized against each other: disabling both while any dialog is submitting would change the interlock matrix and is out of scope.

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

### Requirement: Active topic rows show their 1-based position and provide move controls on an unlocked team

On an unlocked team with at least two active topics, each active topic row SHALL display its 1-based position number, computed from the row's place in the displayed list and not from the stored `displayOrder` value (which may have gaps), and SHALL provide four reorder buttons: Move to top, Move up, Move down, and Move to bottom. Each button SHALL have an accessible name that includes the topic name. The first row's Move to top and Move up buttons, and the last row's Move down and Move to bottom buttons, SHALL be rendered disabled, not hidden. The reorder controls SHALL be hidden entirely when the team is locked, matching the locked treatment that already hides Remove, and when the team has fewer than two active topics. Reorder SHALL be offered only on this screen and never on the live-session facilitator surface. The screen SHALL NOT offer any automatic ordering (for example, by score or flag). These buttons are the non-pointer reorder control required by the Reorder Topics use case's tablet note. Drag-and-drop is not provided in this change.

#### Scenario: Each active row shows its position and four move buttons
- **WHEN** a facilitator views the screen for an unlocked team with 11 active topics
- **THEN** each active row shows its position number from 1 to 11
- **AND** each row shows Move to top, Move up, Move down, and Move to bottom buttons

#### Scenario: Boundary buttons are disabled, not hidden
- **WHEN** a facilitator views the screen for an unlocked team with at least two active topics
- **THEN** the first row's Move to top and Move up buttons are present and disabled
- **AND** the last row's Move down and Move to bottom buttons are present and disabled

#### Scenario: A long move takes one action
- **WHEN** a facilitator selects Move to bottom on the topic at position 1 of 11
- **THEN** that topic is displayed at position 11 and the topics formerly at positions 2 to 11 are displayed at positions 1 to 10

#### Scenario: A locked team's screen shows no reorder controls
- **WHEN** a facilitator views the screen for a team that has not completed its first session
- **THEN** no reorder buttons and no Save order control are shown

#### Scenario: A team with one active topic shows no reorder controls
- **WHEN** a facilitator views the screen for an unlocked team with exactly one active topic
- **THEN** no reorder buttons are shown

### Requirement: Moves update a local draft immediately, and nothing is persisted until the facilitator saves

Each move SHALL immediately update the displayed order and position numbers without contacting the server. The draft SHALL be considered unsaved ("dirty") if and only if it differs from the last saved order. Whenever reorder controls are shown, the screen SHALL show a Save order / Discard bar below the active list. While the draft is clean, the bar SHALL sit in normal flow below the list with Save order and Discard both disabled. While the draft is dirty, the bar SHALL remain within the viewport (sticky to the bottom edge) when the active list is scrolled to its last row, at viewport widths down to 768px. Discard SHALL revert the displayed order to the last saved order immediately, with no confirmation. A successful save SHALL send the full ordered list of active topic IDs in a single `PUT /api/v1/teams/:teamId/topics/order` request and SHALL show a non-modal confirmation in a `role="status"` region. The confirmation SHALL remain until the facilitator's next move, next save, or departure from the screen, and SHALL NOT be dismissed on a timer.

#### Scenario: A move is shown immediately and sends no request
- **WHEN** a facilitator selects Move to top on the topic at position 7
- **THEN** that topic is displayed at position 1 and the topics formerly at positions 1 to 6 are displayed at positions 2 to 7
- **AND** no request is sent to the server

#### Scenario: Moving a topic and moving it back leaves the draft clean
- **WHEN** a facilitator moves a topic down one position and then up one position
- **THEN** the draft is not marked unsaved and Save order is disabled

#### Scenario: Discard reverts to the saved order
- **WHEN** a facilitator makes several moves and selects Discard
- **THEN** the displayed order equals the last saved order
- **AND** no request is sent

#### Scenario: A clean draft shows the Save bar with both buttons disabled
- **WHEN** a facilitator views the screen for an unlocked team with at least two active topics and has made no moves
- **THEN** the Save order / Discard bar is shown below the active list, not pinned to the viewport
- **AND** Save order and Discard are both disabled

#### Scenario: The Save bar stays in view on a long list at tablet width
- **WHEN** at a viewport width of 768px, a facilitator with 11 active topics moves the last topic up and scrolls the active list to its last row
- **THEN** the Save order and Discard buttons are within the viewport

#### Scenario: Save persists the full list and confirms
- **WHEN** a facilitator makes moves and selects Save order, and the server responds `200` with `openSessionCreatedAt: null`
- **THEN** exactly one reorder request is sent, containing every active topic ID in the displayed order
- **AND** the text "Order saved." is shown in a `role="status"` region and the draft is clean
- **AND** the text remains until the facilitator's next move

### Requirement: The screen states that order changes apply only to sessions created after saving

A session's topic order is fixed at room open (see `session-topic-lifecycle`), so the screen's copy SHALL refer to sessions being opened, not created. (The requirement title keeps its original wording for continuity.) The screen SHALL display, near the active-topic list whenever reorder controls are shown, the fixed text: "Order changes apply to sessions opened after you save. Sessions already open keep their order." When a save succeeds and the response's `openSessionCreatedAt` (the open session's room-open time) is non-null, the save confirmation SHALL read "Order saved. The session opened on {date} keeps its original order." in place of "Order saved.", where `{date}` is `openSessionCreatedAt` rendered as a local date in the form "Sep 30, 2026". Only one confirmation message SHALL be shown.

#### Scenario: The pinned copy is shown with the reorder controls
- **WHEN** a facilitator views the screen for an unlocked team with at least two active topics
- **THEN** the text "Order changes apply to sessions opened after you save. Sessions already open keep their order." is displayed

#### Scenario: Saving while a session's room is open names that session
- **WHEN** a save succeeds and the response's `openSessionCreatedAt` is a timestamp on September 30, 2026 in the viewer's local time zone
- **THEN** the confirmation reads "Order saved. The session opened on Sep 30, 2026 keeps its original order."
- **AND** the plain "Order saved." message is not also shown

### Requirement: Remove and Restore are disabled while the order draft has unsaved changes

While the order draft is dirty, or while a save is in flight, every active row's Remove action and every archived row's Restore action SHALL be disabled, and the screen SHALL show the reason "Save or discard your order changes first." Both actions SHALL be re-enabled after a successful Save, a Discard, or a Reload. This rule is what prevents the page's own post-Remove/Restore refetch from overwriting an unsaved draft.

#### Scenario: Unsaved order changes disable Remove and Restore with a reason
- **WHEN** a facilitator has an unsaved order draft
- **THEN** Remove and Restore are disabled
- **AND** the text "Save or discard your order changes first." is shown

#### Scenario: Discarding re-enables Remove and Restore
- **WHEN** a facilitator with an unsaved draft selects Discard
- **THEN** Remove and Restore are enabled

### Requirement: Reorder controls are disabled while a Remove or Restore dialog is open and while a save is in flight

While a Remove or Restore confirmation dialog is open or its request is in flight, every move button, Save order, and Discard SHALL be disabled, so that no draft can be started against a list that is about to change. While a save request is in flight, every move button, Save order, and Discard SHALL be disabled, so that no move made during the request can be overwritten by its response.

#### Scenario: An open Remove dialog disables reordering
- **WHEN** a facilitator with a clean draft opens the Remove confirmation for a topic
- **THEN** every move button is disabled until the dialog is confirmed or cancelled

#### Scenario: Reordering is disabled while a save is in flight
- **WHEN** a facilitator selects Save order and the request has not yet completed
- **THEN** every move button, Save order, and Discard are disabled

### Requirement: Closing or refreshing the tab with an unsaved order draft triggers the browser's leave-page prompt; in-app navigation discards the draft

While the draft is dirty, closing or refreshing the browser tab SHALL trigger the browser's native `beforeunload` prompt. No `beforeunload` prompt SHALL be requested when the draft is clean. Navigation away from the screen within the application, whether by activating a link or control or by browser Back/Forward, SHALL NOT be intercepted in this change. It SHALL discard the unsaved draft, as the Reorder Topics use case's "reorders but does not save before navigating away" alternate flow describes, and returning to the screen SHALL show the last saved order.

#### Scenario: A dirty draft registers a beforeunload prompt
- **WHEN** the draft is dirty
- **THEN** a `beforeunload` handler is registered that requests the browser's leave-page confirmation
- **AND** when the draft becomes clean, the handler no longer requests confirmation

#### Scenario: In-app navigation with a dirty draft discards it without a prompt
- **WHEN** a facilitator with an unsaved draft activates an in-app link that leaves the screen, and later returns to the screen
- **THEN** no confirmation prompt is shown when leaving
- **AND** on return, the displayed order equals the last saved order

### Requirement: A stale save is explained and resolved by reloading; every other save failure keeps the draft for retry

If the save fails with `409 TOPIC_ORDER_STALE`, the screen SHALL show "The topic list was changed elsewhere since you opened this page." with a Reload button, and SHALL keep the draft displayed until the facilitator selects Reload or Discard. While that message is displayed, Save order and every move button SHALL be disabled. Reload and Discard SHALL each refetch the team's topics and replace both the draft and the saved order with the server's current order, leaving the draft clean. If that refetch fails, the screen SHALL remain in the stale state with the draft displayed, SHALL show "Unable to reload topics." in the save-error alert, and SHALL keep Reload enabled; it SHALL NOT replace the screen with the page-level load error.

If the save fails for any other reason (any other non-2xx status, including `409 TOPIC_CUSTOMIZATION_LOCKED`, `403`, `404`, `422`, and `5xx`, or a network error), the screen SHALL show, in a `role="alert"` save-error region beside the Save order bar (never the page-level error that replaces the whole screen), the response's `error.message` when one is present and otherwise "Unable to save the topic order." It SHALL keep the draft displayed and marked unsaved, SHALL leave Save order enabled, and SHALL NOT retry automatically. The facilitator's next move SHALL clear the save-error message, because it no longer describes a pending attempt.

#### Scenario: A stale save explains itself and waits for Reload
- **WHEN** a save fails with `409 TOPIC_ORDER_STALE`
- **THEN** the message "The topic list was changed elsewhere since you opened this page." is shown
- **AND** the draft remains displayed, and Save order and every move button are disabled
- **AND** after Reload, the displayed order equals the server's current order and the draft is clean

#### Scenario: Discard after a stale save goes to the server's order, not the stale one
- **WHEN** a save fails with `409 TOPIC_ORDER_STALE` and the facilitator selects Discard
- **THEN** the displayed order equals the server's current order, not the order loaded when the page opened

#### Scenario: A failed reload after a stale save keeps the screen and the draft
- **WHEN** a save fails with `409 TOPIC_ORDER_STALE` and the facilitator selects Reload, and the reload request fails
- **THEN** "Unable to reload topics." is shown, the draft remains displayed, and Reload is enabled
- **AND** the topic list and its controls are still shown

#### Scenario: A transient failure keeps the draft for retry
- **WHEN** a save fails with a `500` response or a network error
- **THEN** "Unable to save the topic order." (or the response's `error.message` when present) is shown
- **AND** the draft remains displayed and marked unsaved, and Save order is enabled
- **AND** the topic list and its controls are still shown
- **AND** no second request is sent until the facilitator selects Save order again

#### Scenario: The next move clears a save error
- **WHEN** a save fails with a `500` response and the facilitator then makes a move
- **THEN** the save-error message is no longer shown

#### Scenario: Any other rejection shows the server's message and keeps the draft
- **WHEN** a save fails with `403 FACILITATOR_IS_TEAM_MEMBER`
- **THEN** the response's `error.message` is shown
- **AND** the draft remains displayed and marked unsaved

### Requirement: Reorder moves keep keyboard focus and are announced to assistive technology

After a move, keyboard focus SHALL stay on the corresponding control of the moved topic's row at its new position. If that control is now disabled because the row reached a boundary, focus SHALL move to the nearest enabled move control in the same row. Each move SHALL be announced through an `aria-live` region in the form "<topic name> moved to position <n> of <N>".

#### Scenario: A move is announced and focus follows the moved row
- **WHEN** a keyboard user activates Move down on "Deployment" at position 2 of 11
- **THEN** the `aria-live` region announces "Deployment moved to position 3 of 11"
- **AND** keyboard focus is on the Move down button of the "Deployment" row

#### Scenario: Focus falls back when a move reaches a boundary
- **WHEN** a keyboard user activates Move to top on the topic at position 5
- **THEN** keyboard focus is on an enabled move button in that topic's row, now at position 1

### Requirement: Each topic row shows the team's definition, labelled "Our team's definition", above the description

On the Topic Management screen, an active **or archived** topic row whose `teamAnnotation` is non-null SHALL display it under the label "Our team's definition", positioned above the topic's description, with one muted provenance line in the same visual style as the archived/restored metadata. Archived rows SHALL display the definition read-only, with no add, edit, or clear control, so the facilitator can see what will return on restore. The user-facing label SHALL be "Our team's definition" everywhere on the screen; the word "annotation" SHALL NOT appear in user-facing copy. Text SHALL render as plain text with line breaks preserved.

The provenance line SHALL be rendered as follows, with `{date}` formatted from `annotationUpdatedAt` by the screen's existing `en-US` month-short/day/year formatter (for example, "Sep 30, 2026"):

| `teamAnnotation` | `annotationUpdatedAt` | `annotationUpdatedBy` | Provenance line |
|---|---|---|---|
| non-null | non-null | non-null | "Last edited {date} by {displayName}" |
| non-null | non-null | null | "Last edited {date}" |
| non-null | null | any | no line |
| null | any | any | no line, and no definition text |

After a clear, no definition and no provenance line are shown; who cleared the definition and when is retained in the TOPIC-002 response and the audit log only. This is intentional.

#### Scenario: An annotated row shows the definition and who last edited it
- **WHEN** a facilitator views an unlocked team whose topic is annotated `"X"`, last edited by "Dana Ruiz" on 2026-09-30
- **THEN** the row shows "Our team's definition" with `"X"` above the description
- **AND** a muted line reads "Last edited Sep 30, 2026 by Dana Ruiz"

#### Scenario: An unannotated or cleared row shows no definition or provenance
- **WHEN** a facilitator views a topic whose `teamAnnotation` is null, including one whose `annotationUpdatedBy` records a clear
- **THEN** the row shows no definition text and no "Last edited" line

#### Scenario: A definition whose editor is unknown omits the name
- **WHEN** a topic's `teamAnnotation` is `"X"`, `annotationUpdatedAt` is 2026-09-30, and `annotationUpdatedBy` is null
- **THEN** the provenance line reads exactly "Last edited Sep 30, 2026"

#### Scenario: A definition with no edit time shows no provenance line
- **WHEN** a topic's `teamAnnotation` is `"X"` and `annotationUpdatedAt` is null
- **THEN** the row shows the definition and no "Last edited" line

#### Scenario: An archived row shows its definition read-only
- **WHEN** a facilitator views an unlocked team with an archived topic annotated `"X"`
- **THEN** the archived row shows "Our team's definition" with `"X"` and its provenance line
- **AND** the archived row shows no "Add team definition" or "Edit" control

#### Scenario: Line breaks display, markup does not render
- **WHEN** a topic's definition is `"Line one\nLine two <b>bold</b>"`
- **THEN** the row shows two lines, and the second line contains the literal text `<b>bold</b>`

### Requirement: An eligible facilitator can add, edit, or clear the team's definition inline

When the team is unlocked and `canEditAnnotations` is true, each active row SHALL offer "Add team definition" (when null) or "Edit" (when non-null). The editor SHALL open inline in the row, and only one editor SHALL be open at a time. Selecting "Add team definition" or "Edit" on another row SHALL close the open editor if it has no unsaved changes and open the new one; if the open editor has unsaved changes, the new editor SHALL NOT open, the open editor SHALL keep its text, focus SHALL move to the open editor's text field, and the open editor SHALL show "Save or cancel this definition first."

The editor SHALL be a multi-line text field with `maxlength=500`, programmatically labelled "Our team's definition" (so it is findable by its accessible label), with the helper text associated to it by `aria-describedby`. The helper text SHALL read exactly: "What this topic means for this team, in the team's words. Not for notes about people or how to vote." The editor SHALL show the currently saved text and its provenance while editing and a live `n / 500` counter measured in UTF-16 code units of the normalized value. When the field's raw value holds 500 units (the limit `maxlength` enforces, which can be reached while the normalized counter still shows fewer because of trailing whitespace), the counter SHALL be visually distinguished and accompanied by the text "500 character limit reached.", announced through an `aria-live="polite"` region, so a paste that the field truncates is never silent. Esc or Cancel SHALL restore the saved text and close the editor without a prompt.

"Unsaved changes", the counter, and every client-side comparison on this screen SHALL use the server's normalization, by importing the shared `normalizeAnnotation` and `MAX_ANNOTATION_LENGTH` that TOPIC-007 itself uses (not a local copy): convert every `\r\n` to `\n`, then trim leading and trailing whitespace, then compare, treating an empty normalized value as equal to a null saved value. The screen does not pre-validate characters; a disallowed character is reported through the server's `422` message.

#### Scenario: Adding a definition to an unannotated topic
- **WHEN** a facilitator selects "Add team definition", types text, and saves
- **THEN** a TOPIC-007 request is sent with that text
- **AND** on success the row shows the new definition and updated provenance without a full page reload

#### Scenario: The counter uses the server's unit
- **WHEN** a facilitator types 10 emoji outside the Basic Multilingual Plane
- **THEN** the counter shows `20 / 500`

#### Scenario: Reaching the limit is announced
- **WHEN** a facilitator pastes 520 characters into an empty editor
- **THEN** the field holds exactly the first 500 units of the pasted text, the counter shows `500 / 500` in its distinguished style
- **AND** "500 character limit reached." is shown and announced through the `aria-live="polite"` region

#### Scenario: The limit is announced even when trailing whitespace hides it from the counter
- **WHEN** the field's raw value is 500 units, the last three of which are trailing spaces
- **THEN** the counter shows `497 / 500` in its distinguished style
- **AND** "500 character limit reached." is shown

#### Scenario: Cancel restores the saved text
- **WHEN** a facilitator edits a definition and presses Esc
- **THEN** the editor closes, no request is sent, and the row shows the saved definition

#### Scenario: A second editor does not discard unsaved work
- **WHEN** a facilitator has unsaved changes in one row's editor and selects "Edit" on another row
- **THEN** the first editor remains open with its text intact and the second does not open
- **AND** focus moves to the first editor's text field, which shows "Save or cancel this definition first."

#### Scenario: A clean editor yields to another row
- **WHEN** a facilitator has opened one row's editor without changing it and selects "Edit" on another row
- **THEN** the first editor closes and the second opens

#### Scenario: The editor is labelled and described
- **WHEN** a facilitator opens the editor
- **THEN** the text field's accessible name is "Our team's definition"
- **AND** its accessible description is "What this topic means for this team, in the team's words. Not for notes about people or how to vote."

### Requirement: Saving confirms its effective scope; clearing asks first, overwriting does not, unchanged text sends nothing

A save whose normalized text equals the saved value (an empty value equals null) SHALL close the editor without sending a request and without showing any confirmation. A save that would change a non-null definition to an empty normalized value (including text that is only whitespace) SHALL first show an inline (non-modal) confirmation reading "Remove this team's definition? This can't be undone." with "Remove" and "Cancel" actions; no request SHALL be sent until "Remove" is chosen. Choosing "Cancel" on that confirmation SHALL return to the editor with its current text, and no request SHALL be sent. A save that replaces one non-empty definition with different non-empty text SHALL NOT ask for confirmation.

A successful save that sent a request SHALL show "Saved. Sessions that already exist keep the previous definition." in a `role="status"` element within that row. The message SHALL remain until the next action on that row (opening its editor, removing it) or until another definition save on the screen succeeds, whichever comes first. It has no timeout, matching the reorder "Order saved." confirmation.

#### Scenario: Saving unchanged text sends nothing
- **WHEN** a facilitator opens the editor on a definition `"X"`, changes it to `"  X  "`, and saves
- **THEN** the editor closes, no request is sent, and no "Saved." message is shown

#### Scenario: Saving an empty editor over no definition sends nothing
- **WHEN** a facilitator opens "Add team definition" and saves without typing
- **THEN** the editor closes, no request is sent, and no confirmation is shown

#### Scenario: Clearing a definition asks for confirmation
- **WHEN** a facilitator replaces an existing definition with only spaces and saves
- **THEN** an inline confirmation reading "Remove this team's definition? This can't be undone." appears
- **AND** no request is sent until the facilitator chooses "Remove"

#### Scenario: Cancelling the clear confirmation returns to the editor
- **WHEN** the clear confirmation is showing and the facilitator chooses "Cancel"
- **THEN** the confirmation closes, the editor remains open with its current (empty) text, and no request is sent

#### Scenario: Overwriting a definition saves without a confirmation
- **WHEN** a facilitator changes an existing definition to different non-empty text and saves
- **THEN** the request is sent without a confirmation step
- **AND** on success "Saved. Sessions that already exist keep the previous definition." is shown in a `role="status"` element in that row

### Requirement: A failed save keeps the facilitator's text

When a TOPIC-007 request fails for any reason (including `403`, `404`, `409`, `422`, `5xx`, or network failure), the editor SHALL remain open with the facilitator's text intact and SHALL display the server's `error.message`, or "Unable to save the team's definition." when none is available. The row's displayed saved definition SHALL be unchanged. When the failure is `404 TOPIC_NOT_FOUND` or `422 TOPIC_ALREADY_ARCHIVED` (the topic was removed by someone else), the screen SHALL re-fetch TOPIC-002 when that editor is closed, so the facilitator can copy their text before the row leaves the active list. That re-fetch SHALL run however the editor closes (Cancel, Esc, opening another row's editor, or closing automatically when a Remove/Restore confirmation opens or a move begins), and SHALL still run after a retried save from that editor fails for any reason.

#### Scenario: A server error leaves the text in the editor
- **WHEN** a save returns `500`
- **THEN** the editor stays open with the typed text and shows an error message
- **AND** the row's saved definition is unchanged

#### Scenario: A topic archived by someone else refreshes after the editor closes
- **WHEN** a save returns `422 TOPIC_ALREADY_ARCHIVED`
- **THEN** the editor stays open with the typed text and the server's message
- **AND WHEN** the facilitator then cancels the editor
- **THEN** the screen re-fetches TOPIC-002 and the topic appears in the archived list

#### Scenario: A failed retry keeps the pending re-fetch
- **WHEN** a save returned `422 TOPIC_ALREADY_ARCHIVED`, the facilitator retries the save, and the retry fails with a network error
- **AND WHEN** the facilitator then cancels the editor
- **THEN** the screen re-fetches TOPIC-002

#### Scenario: An editor closed by opening a Remove confirmation still re-fetches
- **WHEN** a save returned `422 TOPIC_ALREADY_ARCHIVED`, the facilitator restores the editor text to the saved definition, and then selects Remove on another row
- **THEN** the editor closes, the remove confirmation opens, and the screen re-fetches TOPIC-002

### Requirement: Unsaved definition text arms the existing leave-page prompt

While any definition editor holds unsaved changes, closing or refreshing the tab SHALL trigger the browser's `beforeunload` prompt, using the screen's existing guard. In-app navigation is not intercepted, consistent with the screen's existing reorder-draft behavior.

#### Scenario: Refreshing with an unsaved definition prompts
- **WHEN** a facilitator has typed unsaved text into a definition editor and refreshes the tab
- **THEN** the browser's leave-page prompt is triggered

### Requirement: Definition drafts and reorder drafts cannot destroy each other; Remove and Restore cannot destroy a definition draft

While the reorder draft is dirty or saving, definition editing SHALL be disabled with the screen's existing "Save or discard your order changes first." reason. While any definition editor holds unsaved changes or is saving, the reorder (move) controls and **every** row's Remove and Restore controls SHALL be disabled with the reason "Save or cancel your definition changes first.", matching the reorder draft's own rule for Remove and Restore. An open editor with no unsaved changes SHALL close when a reorder move begins and when a Remove or Restore confirmation opens. While a Remove or Restore confirmation is open or submitting, the "Add team definition" and "Edit" controls on every row SHALL be disabled with the reason "Finish or cancel the open remove or restore first.", so that no editor can be opened behind the confirmation (whose post-success refetch could otherwise replace the screen and lose that editor's text). When the reorder draft is also dirty, the reorder reason takes precedence; when neither applies, the controls carry no disabled reason. If the row an editor belongs to leaves the active list (for example after a refetch), that editor SHALL close and SHALL NOT count as holding unsaved changes. A refetch the screen performs on its own behalf after a definition save failure SHALL report a failure inline and SHALL NOT replace the screen with a full-page error. Neither an unsaved reorder draft nor unsaved definition text SHALL be lost because of an action taken in the other.

#### Scenario: Editing is disabled while the order draft is dirty
- **WHEN** a facilitator has moved a topic but not saved the order
- **THEN** the "Add team definition" and "Edit" controls are disabled with the reason "Save or discard your order changes first."
- **AND** the unsaved order is unchanged

#### Scenario: Reordering is disabled while a definition is dirty
- **WHEN** a facilitator has unsaved text in a definition editor
- **THEN** the move controls are disabled with the reason "Save or cancel your definition changes first."
- **AND** the editor text is unchanged

#### Scenario: Remove and Restore are disabled on every row while a definition is dirty
- **WHEN** a facilitator has unsaved text in one row's definition editor
- **THEN** every active row's Remove control and every archived row's Restore control is disabled with the reason "Save or cancel your definition changes first."

#### Scenario: A clean editor closes when a Remove confirmation opens
- **WHEN** a facilitator has opened a row's definition editor without changing it and selects Remove on that row
- **THEN** the editor closes and the remove confirmation opens

#### Scenario: Editing is disabled while a Remove or Restore confirmation is open
- **WHEN** a Remove or a Restore confirmation is open
- **THEN** every row's "Add team definition" and "Edit" control is disabled with the reason "Finish or cancel the open remove or restore first."
- **AND WHEN** that confirmation is cancelled
- **THEN** the controls are enabled again with no disabled reason

#### Scenario: An editor whose row leaves the active list does not stay dirty
- **WHEN** the row a definition editor belongs to is no longer in the active list after the screen re-fetches topics
- **THEN** the editor is closed, the leave-page prompt is not armed by it, and no control is disabled with "Save or cancel your definition changes first."

#### Scenario: A failed refetch after an archived-topic save error stays inline
- **WHEN** a save returned `422 TOPIC_ALREADY_ARCHIVED`, the facilitator closes the editor, and the resulting TOPIC-002 refetch fails
- **THEN** an inline error is shown and the rest of the screen remains rendered

#### Scenario: A clean editor closes when a move begins
- **WHEN** a facilitator has opened a definition editor without changing it and moves a topic
- **THEN** the editor closes and the move is applied to the reorder draft

### Requirement: Definition editing is unavailable on a locked team and to administrators

On a team whose `isCustomizationLocked` is true, the screen SHALL show no definition editing control, and the existing lock notice SHALL read exactly: "Topics cannot be customized until this team completes its first session. Topics are shown read-only below. Team definitions can be added after the team's first session." When `canEditAnnotations` is false, the screen SHALL show existing definitions and provenance read-only and SHALL offer no add, edit, or clear control. Because TOPIC-002 already rejects every other caller, the complete truth table is:

| Caller reaching TOPIC-002 | `canEditAnnotations` |
|---|---|
| Standing facilitator, not a member of the team | `true` |
| Application administrator | `false` |

#### Scenario: A locked team shows no definition controls
- **WHEN** a facilitator views a team that has not completed its first session
- **THEN** no "Add team definition" or "Edit" control is shown
- **AND** the lock notice reads exactly "Topics cannot be customized until this team completes its first session. Topics are shown read-only below. Team definitions can be added after the team's first session."

#### Scenario: An administrator sees definitions read-only
- **WHEN** an application administrator views an unlocked team whose topic is annotated `"X"`
- **THEN** the row shows "Our team's definition" with `"X"` and its provenance
- **AND** no "Add team definition" or "Edit" control is shown

### Requirement: The add-custom-topic control appears only on an unlocked team for a caller who can add, with no disabled or teaser variant

The screen SHALL render an "Add custom topic" control if and only if `isCustomizationLocked` is `false` **and** `canAddTopics` is `true` in the TOPIC-002 response. In every other case the screen SHALL render no add control at all: no disabled button, no placeholder, and no explanatory note. On a locked team the existing lock notice is the explanation. An application administrator (for whom `canAddTopics` is temporarily `false`, pending #176) SHALL see nothing in place of the control. This gating is a UX convenience; `POST /api/v1/teams/:teamId/topics` enforces authorization and the lock independently.

Engineers and engineering managers never reach this screen (TOPIC-002 rejects them before it renders), so the use case's "Engineers cannot add topics" criterion is met by the existing access-denied state and its existing scenario "An ineligible caller sees an access-denied state, not the topic list".

#### Scenario: An eligible facilitator on an unlocked team sees the add control
- **WHEN** a standing facilitator views an unlocked team and the response has `canAddTopics: true`
- **THEN** an "Add custom topic" control is shown

#### Scenario: A locked team shows no add control of any kind
- **WHEN** a facilitator views a team whose `isCustomizationLocked` is `true`
- **THEN** no "Add custom topic" control is present in the page, enabled or disabled
- **AND** the existing lock notice is shown

#### Scenario: An administrator sees no add control and no explanation
- **WHEN** an application administrator views an unlocked team and the response has `canAddTopics: false`
- **THEN** no "Add custom topic" control is present, enabled or disabled
- **AND** no message about adding topics is shown outside the empty state

### Requirement: The add trigger sits in the Active Topics heading, which shows the active count, and the form opens inline

The Active Topics heading SHALL read "Active Topics (n)", where n is the number of active topics, matching the existing "Archived Topics (n)". When the add control is rendered and the active list is not empty, the trigger SHALL sit in the Active Topics heading row, beside the heading rather than inside it, so it is visible without scrolling past the list and the heading's accessible name remains "Active Topics (n)". Activating it SHALL open the add form inline directly under the heading, with no modal and no route change, and SHALL move focus to the Name field. Only one add form SHALL exist at a time, and the trigger SHALL be hidden while the form is open. When the form is opened from the empty state's "Add custom topic" action, the form SHALL take the place of the empty state's actions, and the empty-state message SHALL remain shown above it. Closing the form by Cancel or Discard SHALL return focus to the control that opened it: the heading trigger, or the empty state's "Add custom topic" action, which is shown again when the form closes. An open add form and its values SHALL NOT survive a change of team in the route; the screen for the new team starts with no add form open.

#### Scenario: The heading shows the active count
- **WHEN** a facilitator views a team with 12 active topics
- **THEN** the active-topics heading reads "Active Topics (12)"

#### Scenario: Opening from the empty state keeps the message and returns focus there
- **WHEN** a standing facilitator views an unlocked team with no active topics, opens the form with the empty state's "Add custom topic", enters nothing, and selects Cancel
- **THEN** while the form was open, "This team has no active topics." was shown above it and the empty state's actions were not shown
- **AND** after Cancel the empty state's actions are shown again and focus is on its "Add custom topic" action

#### Scenario: The heading's accessible name excludes the trigger
- **WHEN** a facilitator views an unlocked team with 12 active topics and `canAddTopics: true`
- **THEN** the Active Topics heading's accessible name is exactly "Active Topics (12)"

#### Scenario: A team change discards the open add form
- **WHEN** a facilitator has typed a name into the add form for one team and the route changes to another team's Topic Management screen
- **THEN** no add form is open on the new team's screen
- **AND** no add request is sent for either team

#### Scenario: Opening the form focuses Name and hides the trigger
- **WHEN** a facilitator activates "Add custom topic" in the heading row
- **THEN** the add form is shown under the Active Topics heading
- **AND** focus is on the Name field
- **AND** the "Add custom topic" trigger is not shown

#### Scenario: Cancelling a clean form returns focus to the trigger
- **WHEN** a facilitator opens the add form, enters nothing, and selects Cancel
- **THEN** the form closes without asking for confirmation
- **AND** focus is on the "Add custom topic" trigger

### Requirement: The add form collects name, prompt, vote type, and an optional description with copy that promises no in-session display

The add form SHALL contain, in this order:

- **Name** (required), helper text exactly "A short label for this screen and trend views.", `maxLength` 100.
- **Prompt** (required), helper text exactly "The question you'll read aloud for people to vote on.", `maxLength` 500.
- **Vote type** (required): a radio group with **no option selected by default**, preceded by the group helper text exactly "You can't change the vote type after the topic is created. Changing it later means removing this topic and adding a new one, which starts a new trend." Each option SHALL show its label and explanation exactly:
  - "Finger Voting": "Everyone shows 1 to 4 fingers, where 1 is poor and 4 is good. There's no middle option, so people have to lean one way."
  - "Roman Voting": "Thumbs up or thumbs down. Use it for yes-or-no questions."
  - "Modified Roman Voting": "Thumbs up, sideways, or down. Use it for whether something is getting better, staying the same, or getting worse."
- **Description**, labelled exactly "Description (optional, shown on this screen only)", helper text exactly "Engineers won't see this during sessions. Use it as a note for whoever facilitates this team. A team definition is the place to explain what this topic means for your team.", `maxLength` 500.

Name, Prompt, and Vote type SHALL be marked required and Description marked optional. Each field SHALL show a character counter once its length reaches 80% of its limit. The counter SHALL read "<n> / <limit>" (for example "80 / 100"), SHALL NOT be a live region, and SHALL be referenced by the field's `aria-describedby` while it is shown. The form SHALL NOT require that the name and prompt differ (the use case's "distinct from the name" means a separate field). No copy in the form or its outcomes SHALL state or imply that the topic, its description, or a team definition will appear in a session. The form creates new topics only; it SHALL NOT edit an existing topic.

#### Scenario: No vote type is preselected
- **WHEN** a facilitator opens the add form
- **THEN** no vote-type option is selected
- **AND** the text "You can't change the vote type after the topic is created. Changing it later means removing this topic and adding a new one, which starts a new trend." is shown above the options

#### Scenario: The description is labelled as screen-only
- **WHEN** a facilitator opens the add form
- **THEN** the description field is labelled "Description (optional, shown on this screen only)"
- **AND** its helper text reads "Engineers won't see this during sessions. Use it as a note for whoever facilitates this team. A team definition is the place to explain what this topic means for your team."

#### Scenario: A counter appears at 80% of a limit
- **WHEN** a facilitator has typed 80 characters into Name
- **THEN** a character counter for Name reads "80 / 100"
- **AND** the counter is not a live region
- **AND WHEN** Name holds 79 characters
- **THEN** no counter is shown for Name

#### Scenario: Identical name and prompt are allowed
- **WHEN** a facilitator submits a valid form whose name and prompt are the same text and no duplicate exists
- **THEN** the request is sent

### Requirement: Submitting validates required fields on the client before any request

On Submit, if the name or prompt is blank after trimming, or no vote type is selected, the screen SHALL send no request, SHALL show an inline error on each failing field ("Enter a topic name.", "Enter a prompt.", "Choose a vote type."), SHALL move focus to the first failing field in form order, and SHALL keep every entered value. The request SHALL carry the trimmed name and prompt, and SHALL send `firstSessionDescription` as the trimmed description, or `null` when it is empty after trimming. If the server answers `422` with `error.field` equal to `name`, `prompt`, `voteType`, or `firstSessionDescription`, the screen SHALL show the screen's own message for that field and focus it: Name "Enter a topic name of up to 100 characters.", Prompt "Enter a prompt of up to 500 characters.", Vote type "Choose a vote type.", Description "Keep the description to 500 characters or fewer.". With no field or any other field it SHALL show exactly "The topic couldn't be added. Check each field and try again." at form level. The server's `422` `error.message` SHALL NOT be shown. Values SHALL be kept in every case.

#### Scenario: Blank required fields block submission
- **WHEN** a facilitator enters a name of only spaces, a prompt, and no vote type, and selects Submit
- **THEN** no request is sent
- **AND** "Enter a topic name." is shown on Name and "Choose a vote type." on Vote type
- **AND** focus is on Name and the prompt text is unchanged

#### Scenario: A whitespace-only description is sent as null
- **WHEN** a facilitator submits a valid form whose description contains only spaces
- **THEN** the request's `firstSessionDescription` is `null`

#### Scenario: A server field error lands on its field
- **WHEN** the server answers `422` with `error.field: "prompt"`
- **THEN** "Enter a prompt of up to 500 characters." is shown on the Prompt field and focus moves to Prompt
- **AND** the server's `error.message` is not shown
- **AND** every entered value is unchanged

### Requirement: A likely duplicate of an active or archived topic is flagged before the request, without blocking it

After required-field validation passes, the screen SHALL compare the trimmed, case-folded name against the trimmed, case-folded name of every active and archived topic, and the trimmed, case-folded prompt against the trimmed, case-folded prompt of every active and archived topic. "Case-folded" means `String.prototype.toLowerCase()` with no locale argument. No other normalisation and no fuzzy matching SHALL apply; in particular, internal whitespace is compared exactly as typed. The comparison uses the active and archived topics most recently loaded by the screen. It is a hint, not an authoritative check: the server does not enforce uniqueness, and a topic added elsewhere since the last load is not detected. If any comparison matches, the screen SHALL send no request and SHALL show an inline warning in the form:

- Archived match: "This team has an archived topic called '<existing name>'. Restoring it keeps its history in one trend." with a primary action "Show it in Archived topics" and a secondary action "Add as a new topic anyway".
- Active match (and no archived match): "This team already has an active topic called '<existing name>'. Two topics with the same name or question can confuse people during the vote." with an action "Add anyway".

When both an active and an archived topic match, the archived message SHALL be shown. When more than one topic of the winning kind matches (for example, the name matches one archived topic and the prompt another), the message SHALL name, and "Show it in Archived topics" SHALL focus, the first matching topic in that list's display order. "Show it in Archived topics" SHALL expand the Archived section and move focus to the matching archived row's heading (made programmatically focusable for this purpose), SHALL leave the form open with its values, and SHALL NOT restore anything. "Add anyway" and "Add as a new topic anyway" SHALL send the request unchanged. Editing Name or Prompt SHALL dismiss the warning, whichever field matched. The check runs on Submit only. Once the facilitator has chosen "Add anyway" or "Add as a new topic anyway", the check SHALL NOT run again on a later Submit of the same form (for example, a retry after a network failure) until Name or Prompt is edited.

#### Scenario: Retyping an archived default's question offers the archived topic first
- **WHEN** a team has an archived topic named "Codebase Health" with prompt "Is the codebase easy to work with?", and a facilitator submits a new topic with prompt "  is the codebase easy to work with?  "
- **THEN** no request is sent
- **AND** the form shows "This team has an archived topic called 'Codebase Health'. Restoring it keeps its history in one trend." with "Show it in Archived topics" and "Add as a new topic anyway"

#### Scenario: Show it in Archived topics keeps the form
- **WHEN** a facilitator selects "Show it in Archived topics"
- **THEN** the Archived section is expanded and focus is on the matching archived row's heading
- **AND** the add form is still open with its values
- **AND** no restore request is sent

#### Scenario: Several archived matches resolve to the first in display order
- **WHEN** the archived list holds, in display order, "Deployment" and then "Codebase Health", and a facilitator submits a name matching "Codebase Health" and a prompt matching "Deployment"
- **THEN** the archived-match warning names "Deployment"
- **AND WHEN** the facilitator selects "Show it in Archived topics"
- **THEN** focus is on the "Deployment" archived row's heading

#### Scenario: Internal whitespace differences are not a match
- **WHEN** the team has an active topic named "Codebase Health" and a facilitator submits a topic named "Codebase  Health" (two spaces) with a prompt that matches nothing
- **THEN** no duplicate warning is shown and the request is sent

#### Scenario: An override is not asked again on retry
- **WHEN** a facilitator selects "Add anyway" on an active-match warning, the request fails with a network error, and the facilitator selects Submit again without editing Name or Prompt
- **THEN** no duplicate warning is shown and the request is sent
- **AND WHEN** the facilitator then edits Name and selects Submit, and the new name still matches
- **THEN** the duplicate warning is shown again and no request is sent

#### Scenario: An active name match warns and can be overridden
- **WHEN** a facilitator submits a topic named "pairing" and the team has an active topic named "Pairing"
- **THEN** no request is sent and the active-match warning names "Pairing"
- **AND WHEN** the facilitator selects "Add anyway"
- **THEN** the request is sent with the entered values

#### Scenario: Archived message wins when both match
- **WHEN** a submitted name matches an active topic and the submitted prompt matches an archived topic
- **THEN** the archived-match warning is shown

#### Scenario: Editing Name or Prompt dismisses the warning
- **WHEN** a duplicate warning is shown for a name match and the facilitator edits Prompt
- **THEN** the warning is no longer shown

### Requirement: Submit outcomes keep typed text on failure and never invite a duplicate after success

For every rule on this screen, the add request is **in flight** from when it is sent until the screen has received its response and any refetch that the outcome below calls for has settled; only then does the form leave its submitting state. While the request is in flight, Submit SHALL read "Adding…" and be disabled, and every field SHALL be read-only. Once the server has answered `201`, every later step (reading the response, refetching, moving focus) SHALL end in one of the two "Added '<name>' …" messages below, using the trimmed name that was sent, and SHALL NOT show "The topic couldn't be added. Try again."; if the `201` body cannot be read, focus SHALL move to the Active Topics heading. The server's `error.message` SHALL be shown only when the response body parses as the JSON error envelope with a string `message`; any other non-`2xx` body SHALL be treated as a network error or `5xx`. Outcomes ("screen message" means the region defined in the requirement "Screen-level outcome messages share one region under the Active Topics heading"):

- `201`: the screen SHALL refetch TOPIC-002 without the full-screen error path; after it settles the form SHALL close and reset; a `role="status"` screen message SHALL read exactly "Added '<name>' to the end of the list. Use the move buttons to change where it falls.", or exactly "Added '<name>'." when the new topic is the only active topic; focus SHALL move to the new row's heading (found by the `topicId` in the `201` response), or, if that topic is not in the refreshed active list, to the Active Topics heading. If that refetch is superseded by a later-issued refetch (see the requirement "Refetches after a successful Remove or Restore never replace the screen"), it is not a failure: the form SHALL close and reset, the screen message SHALL read exactly "Added '<name>' to the end of the list. Use the move buttons to change where it falls.", and focus SHALL move to the Active Topics heading.
- `201` followed by a refetch failure: the form SHALL stay closed; the screen SHALL show exactly "Added '<name>', but the list couldn't be refreshed. Reload the page to see it." as a `role="alert"` screen message; focus SHALL move to the Active Topics heading; the lists SHALL be left as last loaded; and the rest of the screen SHALL remain rendered.
- `403 NOT_A_FACILITATOR`, `403 FACILITATOR_IS_TEAM_MEMBER`, or `404 TEAM_NOT_FOUND`: the form SHALL stay open with its values and show the server's `error.message` in a form-level `role="alert"`.
- `422 VALIDATION_FAILED`: handled as in the requirement "Submitting validates required fields on the client before any request".
- `409 TOPIC_CUSTOMIZATION_LOCKED`: the screen SHALL refetch TOPIC-002 without the full-screen error path; after it settles the form SHALL close and its values SHALL be discarded; the screen SHALL show exactly "Topics can't be added to this team right now." as a `role="alert"` screen message; focus SHALL move to the Active Topics heading; and the add control follows the gating rule against the refetched response, whether it reports the team locked or unlocked. If that refetch fails, the screen message SHALL instead read exactly "Topics can't be added to this team right now. Reload the page to see the current state.", the lists SHALL be left as last loaded, and the rest of the screen SHALL remain rendered.
- Network error, `5xx`, or an error body that is not the JSON error envelope: because the topic may have been created, the screen SHALL first refetch TOPIC-002 without the full-screen error path and apply the result if it succeeds (a refetch failure changes nothing); then the form SHALL stay open with its values and show exactly "The topic couldn't be added. Try again." in a form-level `role="alert"`. It SHALL NOT resend the add request automatically.

On every failure outcome in which the form stays open, Submit SHALL again read "Submit" and be enabled subject only to the interlock rule, and every field SHALL be editable. A form-level alert SHALL be cleared by the next Submit. No outcome message SHALL mention sessions.

#### Scenario: A successful add appends, announces, and focuses the new row
- **WHEN** a facilitator adds "Partner Integration" to a team with 12 active topics and the request succeeds
- **THEN** the form is closed
- **AND** "Partner Integration" appears as the last active row
- **AND** a status message reads "Added 'Partner Integration' to the end of the list. Use the move buttons to change where it falls."
- **AND** focus is on that row's heading

#### Scenario: The first topic added from the empty state uses the short message
- **WHEN** a standing facilitator on an unlocked team with no active and no archived topics opens the form from the empty state, adds "Partner Integration", and the request and refetch succeed
- **THEN** a status message reads "Added 'Partner Integration'."
- **AND** the empty state is no longer shown and the active list has one row, headed "Active Topics (1)"

#### Scenario: Focus falls back to the heading when the new topic is not in the refreshed list
- **WHEN** the add request returns `201` and the refetched active list does not contain the new `topicId`
- **THEN** focus is on the Active Topics heading

#### Scenario: A refetch failure after a successful add says the topic was added
- **WHEN** the add request returns `201` and the following TOPIC-002 refetch fails
- **THEN** the message "Added 'Partner Integration', but the list couldn't be refreshed. Reload the page to see it." is shown in a `role="alert"` region under the Active Topics heading
- **AND** the form is closed, focus is on the Active Topics heading, and the rest of the screen remains rendered

#### Scenario: An unreadable success body still says the topic was added
- **WHEN** the add request for "Partner Integration" returns `201` with a body that cannot be parsed, and the following refetch succeeds
- **THEN** a status message reads "Added 'Partner Integration' to the end of the list. Use the move buttons to change where it falls." (or "Added 'Partner Integration'." when it is the only active topic)
- **AND** "The topic couldn't be added. Try again." is not shown
- **AND** focus is on the Active Topics heading

#### Scenario: Other controls stay locked until the post-add refetch settles
- **WHEN** the add request has returned `201` and the following TOPIC-002 refetch has not completed
- **THEN** Submit still reads "Adding…" and every move control is disabled with "Wait for the new topic to finish saving."
- **AND WHEN** the refetch completes
- **THEN** the form is closed and the move controls are enabled

#### Scenario: A non-JSON error body uses the fixed retry message
- **WHEN** the add request returns `502` with an HTML body
- **THEN** the form stays open with its values and "The topic couldn't be added. Try again." is shown
- **AND** none of the HTML body is shown

#### Scenario: A network failure refreshes the lists before retry
- **WHEN** the add request fails with a network error after the server created the topic, and the following refetch succeeds and includes it
- **THEN** the new topic is shown in the active list and the form stays open with its values
- **AND WHEN** the facilitator selects Submit again without editing
- **THEN** the active-match duplicate warning names the new topic and no request is sent

#### Scenario: Topic text is shown as literal text
- **WHEN** a facilitator adds a topic named `<img src=x onerror=alert(1)>` and the request and refetch succeed
- **THEN** the status message and the new row's heading show that name as literal text
- **AND** no image element is created from it

#### Scenario: A 403 keeps the form and its values
- **WHEN** the add request returns `403 FACILITATOR_IS_TEAM_MEMBER`
- **THEN** the form stays open with every value unchanged
- **AND** the server's message is shown in a form-level alert
- **AND** Submit reads "Submit" and is enabled, and every field is editable

#### Scenario: A lock conflict closes the form and removes the control
- **WHEN** the add request returns `409 TOPIC_CUSTOMIZATION_LOCKED` and the refetch reports the team as locked
- **THEN** the form is closed and its values are discarded
- **AND** "Topics can't be added to this team right now." is shown in a `role="alert"` region under the Active Topics heading
- **AND** the lock notice is shown and no add control is present

#### Scenario: A lock conflict whose refetch fails keeps the screen
- **WHEN** the add request returns `409 TOPIC_CUSTOMIZATION_LOCKED` and the following TOPIC-002 refetch fails
- **THEN** the form is closed
- **AND** "Topics can't be added to this team right now. Reload the page to see the current state." is shown
- **AND** the screen is not replaced by a page-level error

#### Scenario: A network failure keeps values for retry
- **WHEN** the add request fails with a network error
- **THEN** the form stays open with its values, "The topic couldn't be added. Try again." is shown, Submit reads "Submit" and is enabled, and every field is editable

#### Scenario: Submit cannot double-post
- **WHEN** a facilitator selects Submit and the request has not completed
- **THEN** Submit reads "Adding…" and is disabled
- **AND** every form field is read-only

### Requirement: Screen-level outcome messages share one region under the Active Topics heading

The messages that report an outcome after the form has closed or outside any form — the add success messages, "Added '<name>', but the list couldn't be refreshed. Reload the page to see it.", both "Topics can't be added to this team right now." variants, and the Remove and Restore refetch-failure messages — SHALL be shown in one screen message region placed directly under the Active Topics heading (above the active list or the empty state). Success messages SHALL use `role="status"`; every other message in the region SHALL use `role="alert"`. The region SHALL show at most one message; a new message SHALL replace the previous one. A message SHALL remain, with no timer, until the add form is opened, a move is made, a Remove or Restore confirmation is opened, a definition editor is opened, another message replaces it, or the facilitator leaves the screen. Focusing or typing in a field SHALL NOT clear it. The Active Topics heading SHALL be programmatically focusable so that outcomes can move focus to it.

#### Scenario: A success message persists until a listed action
- **WHEN** "Added 'Partner Integration' to the end of the list. Use the move buttons to change where it falls." is shown and the facilitator tabs through the page without acting
- **THEN** the message is still shown
- **AND WHEN** the facilitator makes a move
- **THEN** the message is no longer shown

#### Scenario: A new message replaces the previous one
- **WHEN** an add success message is shown and a Remove then succeeds with a failed refetch
- **THEN** only the "Archived '<name>', but the list couldn't be refreshed. Reload the page to see it." message is shown in the region

### Requirement: Discarding a dirty add form asks first, and a dirty form arms the leave-page prompt

The add form is dirty when Name, Prompt, or Description is non-empty after trimming, or a vote type is selected. Cancel on a dirty form SHALL show, inside the form and without a modal, "Discard this topic?" with "Discard" and "Keep editing". "Discard" SHALL close and reset the form and return focus to the control that opened it; "Keep editing" SHALL return to the form with its values. While the form is dirty, closing or refreshing the tab SHALL trigger the browser's `beforeunload` prompt. In-app navigation SHALL NOT be intercepted, consistent with the screen's existing rule.

#### Scenario: Cancel on a dirty form asks before discarding
- **WHEN** a facilitator has typed a name and selects Cancel
- **THEN** "Discard this topic?" is shown in the form with "Discard" and "Keep editing"
- **AND WHEN** the facilitator selects "Keep editing"
- **THEN** the form is shown with the typed name unchanged

#### Scenario: A dirty add form arms the leave-page prompt
- **WHEN** a facilitator has selected a vote type in the add form and refreshes the tab
- **THEN** the browser's leave-page prompt is triggered

#### Scenario: A clean add form does not arm the leave-page prompt
- **WHEN** the add form is open with no values and no other draft is dirty
- **THEN** no `beforeunload` confirmation is requested

### Requirement: Adding a topic interlocks with the reorder draft, definition drafts, and Remove/Restore dialogs only at submit time

Submit SHALL be disabled, with the first applicable reason in this order, while:
1. the reorder draft is dirty or saving: "Save or discard your order changes first." (otherwise the new topic would be missing from the draft and the next order save would be stale);
2. a definition editor holds unsaved changes or is saving: "Save or cancel your definition changes first.";
3. a Remove or Restore confirmation is open or submitting: "Finish or cancel the open remove or restore first.".

The duplicate warning's "Add anyway" and "Add as a new topic anyway" actions each send the request, so they SHALL be disabled under the same conditions and with the same reasons as Submit.

When an add request is sent, any open definition editor with no unsaved changes SHALL close, matching the existing rule that a clean editor closes when a move begins or a Remove or Restore confirmation opens. (An editor with unsaved changes cannot be open at that moment, because rule 2 disables Submit.) While an add request is in flight, every move control, Save order, every Remove, every Restore, and every definition add/edit control SHALL be disabled with the reason exactly "Wait for the new topic to finish saving.", and that reason SHALL take precedence over every other disabled reason on those controls. While an add request is in flight the screen SHALL show that reason once as visible text near the Active Topics heading and SHALL NOT show any other visible disabled reason at the same time.

An open add form, clean or dirty but not submitting, SHALL NOT disable any other control. The add trigger and the form's fields SHALL remain usable during the busy states above; only Submit is gated. Existing reorder and definition interlocks are unchanged.

#### Scenario: Submit is disabled while the order draft is dirty
- **WHEN** a facilitator has moved a topic without saving and has a valid add form open
- **THEN** Submit is disabled with "Save or discard your order changes first."
- **AND** the add form's fields remain editable

#### Scenario: Submit is disabled while a definition is dirty
- **WHEN** a facilitator has unsaved text in a definition editor and a valid add form open
- **THEN** Submit is disabled with "Save or cancel your definition changes first."

#### Scenario: Submit is disabled while a Remove or Restore confirmation is open
- **WHEN** a Remove or Restore confirmation is open and the add form is valid
- **THEN** Submit is disabled with "Finish or cancel the open remove or restore first."

#### Scenario: An in-flight add disables moves
- **WHEN** an add request is in flight
- **THEN** every move control is disabled with "Wait for the new topic to finish saving."

#### Scenario: An in-flight add disables Save order
- **WHEN** an add request is in flight
- **THEN** Save order is disabled with "Wait for the new topic to finish saving."

#### Scenario: An in-flight add disables Remove
- **WHEN** an add request is in flight
- **THEN** every active row's Remove control is disabled with "Wait for the new topic to finish saving."

#### Scenario: An in-flight add disables Restore
- **WHEN** an add request is in flight
- **THEN** every archived row's Restore control is disabled with "Wait for the new topic to finish saving."

#### Scenario: An in-flight add disables definition editing
- **WHEN** an add request is in flight
- **THEN** every "Add team definition" and "Edit" control is disabled with "Wait for the new topic to finish saving."

#### Scenario: Submitting an add closes a clean open definition editor
- **WHEN** a definition editor is open with no unsaved changes and the facilitator submits a valid add form
- **THEN** the definition editor closes when the add request is sent
- **AND** no definition Save control is available while the add request is in flight

#### Scenario: A clean open add form locks nothing
- **WHEN** the add form is open with no values
- **THEN** move controls, Remove, Restore, and definition editing are enabled exactly as they would be with the form closed

#### Scenario: A dirty add form locks nothing
- **WHEN** the add form holds a typed name and prompt and is not submitting
- **THEN** move controls, Remove, Restore, and definition editing are enabled exactly as they would be with the form closed

### Requirement: Refetches after a successful Remove or Restore never replace the screen

After a successful Remove or Restore, the screen SHALL refetch TOPIC-002 without the full-screen error path, and the Remove or Restore confirmation SHALL remain in its submitting state (so the controls it already disables stay disabled) until that refetch settles. If that refetch fails, the screen SHALL keep everything else rendered (including any open add form and its values; a dirty reorder or definition draft cannot coexist with a Remove or Restore, because those controls are disabled while either draft is dirty, so an open add form is the only draft this protects in practice), SHALL leave the active and archived lists exactly as last loaded (it SHALL NOT move the row locally), and SHALL show as a `role="alert"` screen message exactly "Archived '<name>', but the list couldn't be refreshed. Reload the page to see it." or "Restored '<name>', but the list couldn't be refreshed. Reload the page to see it." respectively. A later action on a row whose state is now stale (for example, a second Remove of the topic just archived) SHALL be reported through that action's failure handling with the server's `error.message` when the response body parses as the JSON error envelope, and otherwise with that action's existing fixed failure message. A refetch whose response is discarded because a later TOPIC-002 refetch was issued after it is superseded, not failed: it SHALL NOT show a refetch-failure message, the later refetch determines the lists, and the confirmation SHALL close as it would on success. The full-screen error state SHALL be used only for the initial load and a change of team.

#### Scenario: A refetch failure after Remove stays inline and keeps the add form
- **WHEN** a facilitator has a dirty add form open, confirms Remove on "Pairing Effectiveness", the archive succeeds, and the following refetch fails
- **THEN** "Archived 'Pairing Effectiveness', but the list couldn't be refreshed. Reload the page to see it." is shown
- **AND** the add form is still open with its values

#### Scenario: A superseded refetch after Remove shows no failure message
- **WHEN** a Remove of "Pairing Effectiveness" succeeds and its refetch is superseded by a later-issued TOPIC-002 refetch that succeeds
- **THEN** no "couldn't be refreshed" message is shown
- **AND** the confirmation is closed and the lists match the later refetch

#### Scenario: Moves stay disabled until the post-Remove refetch settles
- **WHEN** a Remove succeeds and the following TOPIC-002 refetch has not completed
- **THEN** the confirmation is still in its submitting state and every move control is disabled
- **AND WHEN** the refetch completes
- **THEN** the confirmation is closed and the move controls are enabled

#### Scenario: A refetch failure after Restore stays inline
- **WHEN** a facilitator confirms Restore on "Pairing Effectiveness", the restore succeeds, and the following refetch fails
- **THEN** "Restored 'Pairing Effectiveness', but the list couldn't be refreshed. Reload the page to see it." is shown
- **AND** the screen is not replaced by a page-level error

#### Scenario: Lists stay as last loaded after a failed refetch, and a stale Remove reports the server's message
- **WHEN** a Remove of "Pairing Effectiveness" succeeds, the following refetch fails, and the facilitator selects Remove on "Pairing Effectiveness" again and confirms
- **THEN** before the second Remove, "Pairing Effectiveness" is still shown in the active list
- **AND** the second Remove's `422 TOPIC_ALREADY_ARCHIVED` is shown with the server's `error.message` through the existing Remove failure handling, and the screen is not replaced by a page-level error

### Requirement: Custom topics are marked "Custom" on active and archived rows

Every active and archived row's title SHALL be a level-3 heading that can receive focus programmatically. Every active and archived row whose topic has `isDefault: false` SHALL show a text tag reading exactly "Custom" within the row's heading, so that it is part of the row's accessible name and is not conveyed by colour or icon alone. Rows with `isDefault: true` SHALL show no tag. The rule applies regardless of the lock state. A stored description that is empty or whitespace-only SHALL NOT be rendered on any row.

#### Scenario: A custom active topic is tagged
- **WHEN** a facilitator views a team with an active custom topic "Partner Integration"
- **THEN** that row's heading includes the text "Custom"
- **AND** the row's accessible name includes "Custom"

#### Scenario: A custom archived topic is tagged
- **WHEN** a facilitator views an archived custom topic
- **THEN** that archived row includes the text "Custom"

#### Scenario: Default topics carry no tag
- **WHEN** a facilitator views a default topic row
- **THEN** the row shows no "Custom" tag

#### Scenario: A whitespace-only description is not rendered
- **WHEN** an active topic's stored description is "   "
- **THEN** no description element is rendered for that row

### Requirement: An empty active-topics list shows a small, honest state derived from the lock, the archive, and the add flag

When the active list is empty, the screen SHALL show content determined only by `isCustomizationLocked`, the number of archived topics, and `canAddTopics`:

| `isCustomizationLocked` | archived count | `canAddTopics` | Content |
|---|---|---|---|
| true | any | any | "This team has no active topics, so its sessions can't run. Topics can't be assigned from this screen. Ask the people who run this application for your organization to restore this team's default topics." and no actions |
| false | > 0 | true | "This team has no active topics." with "Show archived topics (n)" and "Add custom topic" |
| false | > 0 | false | "This team has no active topics." with "Show archived topics (n)" |
| false | 0 | true | "This team has no active topics." with "Add custom topic" |
| false | 0 | false | "This team has no active topics. Topics can't be added from this account yet." and no actions |

The copy SHALL NOT name an application role, a support channel, or a control that does not exist. "Show archived topics (n)" SHALL expand the Archived section and move focus to the Archived section's show/hide control, and SHALL NOT add restore actions of its own. "Add custom topic" SHALL open the same add form as the heading trigger; while the empty state is shown the heading trigger SHALL NOT be shown. After a successful restore or add, the active list SHALL replace the empty state without a full-screen reload. The state SHALL contain no illustration. The Active Topics heading SHALL read "Active Topics (0)" while the empty state is shown.

Rows 3 and 5 exist only because `canAddTopics` is temporarily `false` for application administrators (#176). When #176 is fixed, those rows become unreachable for every caller TOPIC-002 admits, and they SHALL be removed from this table in the same change.

#### Scenario: Locked team with no topics
- **WHEN** a facilitator views a team with `isCustomizationLocked: true` and no active topics
- **THEN** the screen shows "This team has no active topics, so its sessions can't run. Topics can't be assigned from this screen. Ask the people who run this application for your organization to restore this team's default topics."
- **AND** no "Show archived topics" or "Add custom topic" action is shown

#### Scenario: Unlocked team with archived topics, facilitator
- **WHEN** a standing facilitator views an unlocked team with no active topics, 3 archived topics, and `canAddTopics: true`
- **THEN** the screen shows "This team has no active topics." with "Show archived topics (3)" and "Add custom topic"
- **AND** the Active Topics heading reads "Active Topics (0)" and shows no add trigger

#### Scenario: Unlocked team with archived topics, administrator
- **WHEN** an application administrator views an unlocked team with no active topics, 3 archived topics, and `canAddTopics: false`
- **THEN** the screen shows "This team has no active topics." with "Show archived topics (3)" and no "Add custom topic"

#### Scenario: Unlocked team with nothing archived, facilitator
- **WHEN** a standing facilitator views an unlocked team with no active and no archived topics
- **THEN** the screen shows "This team has no active topics." with "Add custom topic" only

#### Scenario: Unlocked team with nothing archived, administrator
- **WHEN** an application administrator views an unlocked team with no active and no archived topics
- **THEN** the screen shows "This team has no active topics. Topics can't be added from this account yet." and no actions

#### Scenario: Show archived topics expands and focuses the archive
- **WHEN** a facilitator selects "Show archived topics (3)"
- **THEN** the Archived section is expanded and focus is on the Archived section's show/hide control

#### Scenario: Restoring from the empty state replaces it without a reload
- **WHEN** a facilitator restores an archived topic while the empty state is shown
- **THEN** the restored topic appears in the active list and the empty state is no longer shown
- **AND** the screen is not reloaded through the full-screen loading or error path

### Requirement: The screen does not read `defaultTopicsNotActive`

The Topic Management screen SHALL NOT read or render `defaultTopicsNotActive` from the TOPIC-002 response, including in the empty state. Its name-based join produces wrong rows when a custom topic shares a default topic's name, and its `topicId` can refer to the template team. Re-adding is offered only through the team's own archived topics.

#### Scenario: A team whose default topics are missing offers only its own archive
- **WHEN** an unlocked team has no active topics, two archived topics, and a TOPIC-002 response whose `defaultTopicsNotActive` lists twelve entries
- **THEN** the screen offers "Show archived topics (2)"
- **AND** no entry from `defaultTopicsNotActive` is displayed
