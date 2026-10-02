## MODIFIED Requirements

### Requirement: The screen states that order changes apply only to sessions created after saving

A session's topic order is fixed at room open (see `session-topic-lifecycle`), so the screen's copy SHALL refer to sessions being opened, not created. (The requirement title keeps its original wording for continuity.) The screen SHALL display, near the active-topic list whenever reorder controls are shown, the fixed text: "Order changes apply to sessions opened after you save. Sessions already open keep their order." When a save succeeds and the response's `openSessionCreatedAt` (the open session's room-open time) is non-null, the save confirmation SHALL read "Order saved. The session opened on {date} keeps its original order." in place of "Order saved.", where `{date}` is `openSessionCreatedAt` rendered as a local date in the form "Sep 30, 2026". Only one confirmation message SHALL be shown.

#### Scenario: The pinned copy is shown with the reorder controls
- **WHEN** a facilitator views the screen for an unlocked team with at least two active topics
- **THEN** the text "Order changes apply to sessions opened after you save. Sessions already open keep their order." is displayed

#### Scenario: Saving while a session's room is open names that session
- **WHEN** a save succeeds and the response's `openSessionCreatedAt` is a timestamp on September 30, 2026 in the viewer's local time zone
- **THEN** the confirmation reads "Order saved. The session opened on Sep 30, 2026 keeps its original order."
- **AND** the plain "Order saved." message is not also shown
