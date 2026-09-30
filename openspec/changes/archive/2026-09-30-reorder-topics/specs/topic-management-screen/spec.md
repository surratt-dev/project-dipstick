## ADDED Requirements

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
