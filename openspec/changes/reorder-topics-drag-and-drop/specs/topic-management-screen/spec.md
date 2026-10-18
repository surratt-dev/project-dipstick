## MODIFIED Requirements

### Requirement: Active topic rows show their 1-based position and provide move controls on an unlocked team

On an unlocked team with at least two active topics, each active topic row SHALL display its 1-based position number, computed from the row's place in the displayed list and not from the stored `displayOrder` value (which may have gaps), and SHALL provide four reorder buttons: Move to top, Move up, Move down, and Move to bottom. Each button SHALL have an accessible name that includes the topic name. The first row's Move to top and Move up buttons, and the last row's Move down and Move to bottom buttons, SHALL be rendered disabled, not hidden. The reorder controls SHALL be hidden entirely when the team is locked, matching the locked treatment that already hides Remove, and when the team has fewer than two active topics. Reorder SHALL be offered only on this screen and never on the live-session facilitator surface. The screen SHALL NOT offer any automatic ordering (for example, by score or flag). These buttons are the non-pointer reorder control required by the Reorder Topics use case's tablet note and the single-pointer alternative to dragging required by WCAG 2.2 criterion 2.5.7. The four move controls SHALL remain rendered and operable on every active row whenever a drag handle is present, and drag-and-drop SHALL NOT replace them.

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

#### Scenario: R-BTN The move buttons are present on every row that has a handle
- **WHEN** any active row renders a drag handle
- **THEN** that row also renders Move to top, Move up, Move down, and Move to bottom buttons
- **AND** a test fails if any of the four is absent while a handle is present

## ADDED Requirements

### Requirement: Provisional values are named constants, not magic numbers

The drag mechanism SHALL take every tunable value from a named constant in the drag hook file, and this table is the record of those values. Each is provisional until confirmed at the laptop check in tasks 5.1 and 5.2; a confirmed or changed value SHALL be written back here.

| Constant | Value | Meaning | Confirm by |
|---|---|---|---|
| `DRAG_THRESHOLD_PX` | 5 CSS px | Pointer movement from pointerdown before a drag starts | Laptop check (mouse and trackpad) |
| `DRAG_HANDLE_MIN_PX` | 24 CSS px | Minimum width and height of the handle hit area (WCAG 2.2 criterion 2.5.8 minimum) | Laptop check |
| `DRAG_DIM_OPACITY` | 0.5 | Opacity of the dragged row while it stays in place | Laptop check |

Lists of about 25 active topics are the design assumption. Above that the drag SHALL still function; no performance guarantee is made.

#### Scenario: R-CONST The values come from one place
- **WHEN** the drag hook is read
- **THEN** the threshold, minimum handle size and dim opacity are named constants matching this table

### Requirement: Each active row has exactly one drag handle, present only where reorder is offered

On an unlocked team with at least two active topics, each active topic row SHALL render exactly one drag handle at the row's leading edge. The Remove control is at the row's trailing edge, so the handle and Remove SHALL NOT be adjacent in the row's DOM order or layout. The handle SHALL have a hit area of at least `DRAG_HANDLE_MIN_PX` in both dimensions, show a grip icon and a grab cursor, and carry the tooltip "Drag to reorder". The handle SHALL be `aria-hidden` and not focusable, because it is a pointer-only enhancement and the adjacent move buttons are the keyboard, switch and screen-reader path. (This `aria-hidden` element with a pointer handler is intentional under WCAG 2.2 criterion 2.5.7; a code comment SHALL say so, so a lint or axe finding is not "fixed" later.) When the team is locked, or has fewer than two active topics (including zero), no handle, drag listener, or drag cursor SHALL be rendered, and no new explanatory copy SHALL be added; the locked screen shows whatever it shows today. Archived topic rows SHALL NOT have a handle. No handle, drag listener, or reorder text SHALL appear on any live-session view. The screen SHALL NOT add a tutorial or coach marks. The handle SHALL appear for exactly the actors who see the move buttons today: the screen's access rule is inherited and drag adds no actor rule.

#### Scenario: R-HANDLE-COUNT One handle per active row
- **WHEN** an unlocked team with N >= 2 active topics, and no blocker, is shown
- **THEN** exactly N handles are rendered, each `aria-hidden` and absent from the tab order
- **AND** each handle's hit area is at least `DRAG_HANDLE_MIN_PX` square
- **AND** no archived row has one

#### Scenario: R-LOCK A locked team has no handles or drag listeners
- **WHEN** a facilitator views the screen for a team that is customization-locked
- **THEN** no drag handle is rendered and no drag listeners are attached

#### Scenario: R-MIN Fewer than two active topics have no handle
- **WHEN** the team has zero or one active topic
- **THEN** no drag handle is rendered

#### Scenario: R-ARCHIVED Archived rows have no handle
- **WHEN** the archived section is expanded
- **THEN** no archived row has a drag handle

#### Scenario: The handle is not in the tab order
- **WHEN** a keyboard user tabs through an active row
- **THEN** focus moves through the four move buttons and never lands on the handle

#### Scenario: R-LIVESESSION The live-session surface is untouched
- **WHEN** a facilitator or participant views any live-session view
- **THEN** no drag handle, drag listener, or reorder text is present

#### Scenario: R-ACTOR-ADMIN An Application Administrator who is not a member gets the handle
- **WHEN** an Application Administrator with no membership in the team views an unlocked team with at least two active topics
- **THEN** the handles render exactly as they do for a facilitator from another team

#### Scenario: R-ACTOR-MEMBER Handle presence follows the move buttons' access rule
- **WHEN** an actor for whom the move buttons are absent under the screen's inherited access rule (for example a facilitator who is a member of the team, per FR-8.2) loads the screen, or the screen is denied
- **THEN** no handle is rendered, because the handle is gated by the same access rule as the buttons

### Requirement: Drag is available exactly when the move buttons are enabled

The drag handle SHALL be interactive if and only if reorder is offered and the move buttons are enabled (`reorderEnabled && !movesDisabled`: no save in flight, page not stale, no Remove or Restore dialog open, no dirty or saving definition editor, no add request in flight). Drag is a second way to produce the same draft and SHALL NOT introduce a gate of its own: an open but clean editor or an open, unsubmitted add form leaves the buttons enabled, so it SHALL leave the handle interactive. When reorder is offered but the buttons are disabled, the handle SHALL still be rendered, dimmed, with a not-allowed cursor and no pointer handlers, so it is inert in the same way and for the same cause as the buttons. This change adds no new reason copy: each blocked cause already has its own on-screen treatment (dialog, stale alert, saving state, the open editor), and a drag-specific message would be a second voice on a transient state.

#### Scenario: R-GATE-PARITY Handle interactive implies buttons enabled
- **WHEN** any combination of save, stale, dialog, editor and add-form state is set
- **THEN** a drag can start if and only if the move buttons on that row are enabled

#### Scenario: R-BLOCKED Each blocker renders an inert handle
- **WHEN** a save is in flight, or the page is stale, or a Remove dialog is open, or a Restore dialog is open, or a definition editor is dirty or saving, or an add request is in flight
- **THEN** the handles are rendered and inert, pointerdown plus movement starts no drag, and the move buttons are disabled for the same cause
- **AND** this is asserted once per cause

#### Scenario: R-CLEAN-EDITOR A clean open editor or add form does not block drag
- **WHEN** a definition editor is open and clean, or the add form is open and unsubmitted
- **THEN** the move buttons are enabled and the handle is interactive
- **AND** a drop closes a clean editor exactly as a button move does

#### Scenario: R-DISABLE-MID A mid-drag transition cancels the drag
- **WHEN** a drag is in progress and the page becomes stale, a save begins, a Remove or Restore dialog opens, or an editor becomes dirty
- **THEN** the drag is cancelled and the draft is unchanged
- **AND** focus is left to the opened dialog's own focus handling, or otherwise placed on a move control of the dragged row, never `document.body`
- **AND** an Escape pressed while a dialog is open reaches the dialog only

### Requirement: Dropping a topic commits once to the same draft the buttons produce

A drag SHALL start only from the handle, only by the primary pointer button (or a pen or touch contact), and only after the pointer has moved at least `DRAG_THRESHOLD_PX` from pointerdown; a smaller movement SHALL NOT start a drag. Other buttons, and additional pointers while a drag is active, SHALL be ignored. During the drag the screen SHALL show a single drop line between rows and SHALL keep the dragged row in its original place at `DRAG_DIM_OPACITY`, keeping its position number. The drop line sits in the gap above a row when the pointer is above that row's vertical midpoint and below it otherwise; a pointer below the last row's midpoint targets the gap after the last row (position N) and above the first row's midpoint targets the gap before the first (position 1). `draftOrder` and the displayed position numbers SHALL NOT change until drop, and nothing SHALL be announced at drag start or while dragging. The drop line's gap is identified by a slot from 0 to N counted with the dragged row still in the list; the drop position is that slot converted to a final index (slot minus one when the slot is after the dragged row). On drop in a gap other than the dragged row's own two adjacent gaps, the result SHALL equal the dragged topic placed at the target position with all other topics in their prior relative order, and the screen SHALL apply it through the same code path as the move buttons. For any sequence of moves, reordering by drag and by buttons SHALL yield the same `draftOrder`, dirty state, cleared confirmation and error, announcement text, and Save payload. The draft is client-only: a stale order is discovered at Save, as today. The screen SHALL NOT snap, auto-reorder, suggest, or sort. The pinned text "Order changes apply to sessions opened after you save. Sessions already open keep their order." SHALL remain rendered and unchanged from drag start through drop, and after a successful Save. No toast, count, or celebration SHALL appear on drop. The use case's "visually reflected immediately" criterion is met at drop, not during the gesture.

#### Scenario: R-THRESHOLD The drag threshold
- **WHEN** a pointer moves less than `DRAG_THRESHOLD_PX` after pointerdown on a handle and is released
- **THEN** no drag starts and nothing changes
- **AND** a movement of `DRAG_THRESHOLD_PX` or more starts a drag

#### Scenario: R-COMMIT A drop at a different position dirties the draft
- **WHEN** the draft is clean and a facilitator drops the topic at position 9 into the gap before position 2
- **THEN** `draftOrder` is the new order, the Save/Discard bar appears, and the leave-page prompt is armed
- **AND** any prior confirmation and save error are cleared
- **AND** exactly one announcement is made

#### Scenario: R-NOOP A drop in the row's own slot changes nothing
- **WHEN** a facilitator drops a topic in the gap directly above it, the gap directly below it, or over itself
- **THEN** `draftOrder` stays null, no Save/Discard bar appears, the leave-page prompt is not armed, and nothing is announced

#### Scenario: R-ENDS Drops at the ends
- **WHEN** a facilitator drops a topic in the gap after the last row, or the gap before the first row
- **THEN** the topic is at position N, or position 1, respectively

#### Scenario: R-REVERT Returning to the saved order collapses the draft
- **WHEN** a drag returns the order to the saved order
- **THEN** `draftOrder` becomes null, as it does for buttons

#### Scenario: R-NOMUT Nothing changes or is announced during the drag
- **WHEN** a drag is in progress
- **THEN** `draftOrder` and every displayed position number are unchanged
- **AND** the dragged row is dimmed in place and exactly one drop line is shown
- **AND** nothing is announced at drag start or during movement

#### Scenario: R-BUTTON-ONLY Other pointers are ignored
- **WHEN** a secondary mouse button presses the handle, or a second pointer contacts while a drag is active
- **THEN** no drag starts, or the active drag is unaffected

#### Scenario: Drag and buttons are equivalent
- **WHEN** the same sequence of moves is performed once by drag and once by buttons, over every from/to pair with from != to in a 5-item list
- **THEN** the resulting `draftOrder`, dirty state, announcement text, and Save payload are identical

#### Scenario: R-MIXED Drag and buttons compose
- **WHEN** a draft already contains button moves and a facilitator then drags, or drags twice in a row without saving
- **THEN** each drop updates the same draft, equal to applying the moves in order, with one announcement per drop

#### Scenario: R-DISCARD A drag-produced draft is discarded like any other
- **WHEN** a facilitator drops a topic and then selects Discard
- **THEN** the draft is cleared exactly as for a button-produced draft

#### Scenario: R-SAVE Save sends the same list the buttons would
- **WHEN** a facilitator saves a drag-produced draft
- **THEN** the PUT body is `{ orderedTopicIds }` with the active topic IDs in the drag-produced order
- **AND** a 409 TOPIC_ORDER_STALE is handled exactly as today

#### Scenario: R-ARCHIVED-ORDER Archived topics do not affect the dropped order
- **WHEN** the team has archived topics and a facilitator drops an active topic at a new position
- **THEN** the resulting order and the Save payload contain active topics only, in the dropped order
- **AND** no topic changes between active and archived

#### Scenario: R-AUDIT Exactly one existing audit row per saved order
- **WHEN** a drag-produced order is saved
- **THEN** the screen calls the same endpoint as the buttons exactly once, and the backend writes exactly one existing `topic.reordered` row attributed to the session user (verified by the existing backend integration tests and a manual check, not by frontend tests)
- **AND** a cancelled drag, a no-op drop and a Discard make no request and so write no row

### Requirement: A drag can be cancelled, and cancel leaves the draft as it was

Escape, `pointercancel` (including loss of pointer capture, such as the dragged element being removed), window blur, or release outside the active-topic list container's bounding box SHALL cancel a drag; the bounds are evaluated at pointerup and a release outside the window also cancels. A release over the archived section, the Save/Discard bar, the page header, or any other non-list target SHALL cancel and SHALL NOT drop at the nearest end. Cancel SHALL leave the draft exactly as before, SHALL NOT announce, and SHALL return focus to the dragged row's first enabled move control in the order Move up, Move to top, Move down, Move to bottom (the page's existing fallback order), never `document.body`. A refetch that replaces the topic list during a drag SHALL cancel the drag, and a drop whose dragged topic is no longer in the displayed order, or whose drop slot is outside 0 to N, SHALL be treated as a cancel and never applied. Unmounting the screen mid-drag SHALL remove every drag listener and release pointer capture. Text selection SHALL NOT occur across rows during a drag.

#### Scenario: R-REFETCH A list change under a drag cancels it
- **WHEN** a drag is in progress and the topic list is refetched, or the dragged topic is no longer in the displayed order at drop
- **THEN** the drag is cancelled, the draft is unchanged, and nothing is announced

#### Scenario: R-UNMOUNT Unmount mid-drag leaves nothing behind
- **WHEN** the screen unmounts while a drag is in progress
- **THEN** no drag listener remains attached, pointer capture is released, and no drop or cancel callback runs

#### Scenario: R-CANCEL Escape, pointercancel, window blur and outside release cancel
- **WHEN** a drag is in progress and the facilitator presses Escape, the browser fires `pointercancel`, a context menu opens, pointer capture cannot be acquired, the window loses focus, or the pointer is released outside the list or over the archived section
- **THEN** the draft is unchanged and nothing is announced
- **AND** focus is on the dragged row's first enabled move control in the stated order

### Requirement: After a committed drop focus lands on a move control and one announcement is made

After a committed drop, `document.activeElement` SHALL be the moved row's first enabled control in the page's existing Move up fallback order (Move up, Move to top, Move down, Move to bottom), so Move up in general and Move down if the row is now first, found by topic id after the list re-renders, and SHALL NOT be `document.body`. Exactly one announcement SHALL be made through the screen's single existing `aria-live` region (`reorder-announcement`), with the identical text the buttons produce, `${name} moved to position ${n} of ${N}`, for example "Psychological safety moved to position 2 of 11". The test SHALL compare against the button path's output rather than a copy of the string. The screen SHALL contain exactly one such region before, during, and after a drag, and drag SHALL NOT add a second or take focus from the page's focus handling.

#### Scenario: R-FOCUS Focus after a drop
- **WHEN** a drop commits a new order
- **THEN** focus is on the moved row's Move up control, or Move down if it is now first

#### Scenario: R-LIVE One live region
- **WHEN** before, during, and after a drag
- **THEN** the reorder announcement region count is exactly one

### Requirement: Pointer scope, scrolling and reduced motion

This release's verified scope is mouse, trackpad and pen on a laptop or desktop browser. The handle SHALL be built on Pointer Events and carry `touch-action: none` on the handle only, so that swiping a row body still scrolls the page and never moves a topic; but touch drag is not verified, not claimed as supported, and not an acceptance criterion in this release. On touch devices the four move buttons are the supported reorder control, as the Reorder Topics use case's tablet note already requires. There SHALL be no edge-driven auto-scroll during a drag. Wheel and trackpad scrolling during a drag work natively and the drop line follows the live row positions; a facilitator may also use the buttons or drop, scroll and drag again. Under `prefers-reduced-motion: reduce` the drop line and rows SHALL have no transition and the drop line SHALL snap between slots; the dim and the drop line themselves are not animation. A manual check on a laptop browser SHALL be recorded in the PR as a short checklist: browser and version, date, and pass or fail for each of: handle drag reorders; threshold click does nothing; Escape cancels; release outside the list cancels; the long move from 9 to 2 in one drag including a wheel or trackpad scroll mid-drag.

#### Scenario: R-RM Reduced motion
- **WHEN** `prefers-reduced-motion: reduce` is set
- **THEN** neither the drop line nor any row has a transition, and the drop line snaps between slots

#### Scenario: R-ROW-SWIPE Only the handle suppresses touch panning
- **WHEN** the rendered styles are inspected
- **THEN** `touch-action: none` is set on the handle and on no row body or list container

#### Scenario: R-NOSCROLL No auto-scroll
- **WHEN** a drag is held near the viewport edge
- **THEN** the page does not scroll as a result of the drag itself (wheel or trackpad scrolling by the user is unaffected)

#### Scenario: R-LAPTOP-CHECK The laptop checklist is recorded
- **WHEN** the change is ready for merge
- **THEN** the PR records the checklist above with browser, version, date and result per item

#### Scenario: R-NOBACKEND No backend or dependency change
- **WHEN** this change is implemented
- **THEN** no migration, API, or schema change is part of it
- **AND** the frontend `package.json` has no new runtime dependency
