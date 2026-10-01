# topic-management-screen

## Purpose

Defines the frontend Topic Management screen: the per-team route facilitators use to view a team's active and archived topics, to remove (archive) an active topic, to restore an archived topic, and to reorder the active topics (TOPIC-006). This spec covers: the active-topic list and its per-row configuration display; the remove-confirmation flow, including its in-place escalation for topics with open action items; the last-active-topic hard-block message; the archived-topics view and its provenance display; the restore action and its single-step confirmation; the archived-topics empty state; the screen's nav entry point from the team page; the team's definition ("Our team's definition", the TOPIC-007 team annotation) shown on active and archived rows, with inline add/edit/clear for an eligible facilitator, its save and failure handling, and its interlocks with the reorder draft and the Remove/Restore dialogs (added by `topic-annotation`); and the reorder controls (position numbers, move buttons, local draft with Save order / Discard, interaction locking with Remove/Restore, the `beforeunload`-only unsaved-draft guard, stale-save and other save-failure handling, and move announcements).

This spec does NOT cover: the server-side authorization model or response contracts for the endpoints this screen calls (`GET /api/v1/teams/:teamId/topics/all`, `DELETE /api/v1/teams/:teamId/topics/:topicId`, `POST /api/v1/teams/:teamId/topics/:topicId/restore`, `PUT /api/v1/teams/:teamId/topics/order`, and `PUT /api/v1/teams/:teamId/topics/:topicId/annotation` — see `topic-customization-lock`, `remove-topic`, `restore-topic`, `reorder-topics`, and `topic-annotation` respectively). Access control is enforced server-side by those endpoints; this screen's own gating is a UX convenience, not the authorization boundary.

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

The screen SHALL display, near the active-topic list whenever reorder controls are shown, the fixed text: "Order changes apply to sessions created after you save. Sessions already created keep their order." When a save succeeds and the response's `openSessionCreatedAt` is non-null, the save confirmation SHALL read "Order saved. The session created on {date} keeps its original order." in place of "Order saved.", where `{date}` is `openSessionCreatedAt` rendered as a local date in the form "Sep 30, 2026". Only one confirmation message SHALL be shown.

#### Scenario: The pinned copy is shown with the reorder controls
- **WHEN** a facilitator views the screen for an unlocked team with at least two active topics
- **THEN** the text "Order changes apply to sessions created after you save. Sessions already created keep their order." is displayed

#### Scenario: Saving while a session already exists names that session
- **WHEN** a save succeeds and the response's `openSessionCreatedAt` is a timestamp on September 30, 2026 in the viewer's local time zone
- **THEN** the confirmation reads "Order saved. The session created on Sep 30, 2026 keeps its original order."
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
