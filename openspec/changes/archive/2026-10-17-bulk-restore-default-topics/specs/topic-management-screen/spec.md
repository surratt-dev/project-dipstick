## ADDED Requirements

### Requirement: Facilitators and administrators can restore all restorable default topics from the topic management screen in one confirmation

The screen SHALL render a "Restore default topics" control only when all three hold: (a) the named predicate `canShowRestoreControls` holds, the exact predicate that also gates single Restore (the view is not the read-only canonical default topics, #214; the implementation SHALL reuse it, not restate it). The caller's role is not re-derived on the client: the screen is reachable only by callers the server admits (standing facilitator or admin), and the server re-checks on every request, so a caller whose standing changed after load receives `403` and the screen refetches (see the result requirement); (b) the team is not locked, per the same lock indicator that hides single Restore; (c) the loaded data contains at least one archived default (`isDefault`) that the shared planner would restore. In an empty team the control is not rendered in the header actions; it appears as the primary action of the empty state instead. When (a) to (c) hold but an unsaved reorder exists or the open definition (annotation) editor is dirty, the control SHALL be disabled with the reason "Save or discard your edit first."; these two are the only disabling conditions (a modal dialog's focus trap makes "another dialog open" unreachable). The control SHALL NOT render a disabled "nothing to restore" state.

Activating it SHALL open a confirmation dialog titled "Restore default topics" with exactly this content: a count line, "N topics will be added" (singular "1 topic will be added"; zero cannot occur because the control is hidden); the restorable topic names in restore order, each rendered in full (wrapped, never ellipsized), in a list region with a maximum height that is keyboard-focusable and whose every entry is reachable by keyboard; the sentence "They will be added to the end of your list, in the order shown." (singular: "It will be added to the end of your list."; neither claims any prior order); the sentence "Your custom topics, the current order, and annotations are not changed."; for each default that will not return, listed in restore order under "Not restored", the literal line "<name>: a topic with this name is already in your list"; and the sentence "To bring back only some topics, restore them one at a time from the archived list." (no link). The dialog and result text SHALL NOT contain the words "reset", "canonical", "trend" or "history lost", and SHALL NOT claim the original wording returns. A topic skipped by the dialog remains reachable by single restore from the archived list.

#### Scenario: Control visible only when something is restorable
- **WHEN** a facilitator opens the screen for a team whose archived defaults are all matched by active names
- **THEN** no "Restore default topics" control is rendered

#### Scenario: Hidden on the read-only canonical defaults
- **WHEN** the screen shows the read-only canonical default topics
- **THEN** no "Restore default topics" control is rendered

#### Scenario: Caller standing is enforced by the server
- **WHEN** a facilitator who is (or has become) a member of the team posts from a stale screen
- **THEN** the server answers `403 FACILITATOR_IS_TEAM_MEMBER` (the screen does not model role per caller; see the result requirement)

#### Scenario: Hidden on a locked team
- **WHEN** a non-member facilitator views a locked team that holds a restorable archived default (legacy data)
- **THEN** no "Restore default topics" control is rendered

#### Scenario: Stale view meets the lock
- **WHEN** the control posts and the response is `409 TOPIC_CUSTOMIZATION_LOCKED`
- **THEN** the screen shows the same locked notice single restore shows, leaves the lists unchanged, and refetches

#### Scenario: Control disabled by unsaved work
- **WHEN** the open definition editor is dirty, or separately a reorder is unsaved
- **THEN** the control is disabled and the reason "Save or discard your edit first." is shown

#### Scenario: Dialog states what changes and what does not
- **WHEN** the dialog opens with three restorable and one name-matched default
- **THEN** it shows "3 topics will be added", the three names in full in restore order, "They will be added to the end of your list, in the order shown.", "Your custom topics, the current order, and annotations are not changed.", the line "<name>: a topic with this name is already in your list", and the single-restore sentence

#### Scenario: Singular count
- **WHEN** exactly one default is restorable
- **THEN** the dialog shows "1 topic will be added" and "It will be added to the end of your list."

#### Scenario: Long list is reachable
- **WHEN** twelve restorable names are shown
- **THEN** the list region has a maximum height, is focusable, and all twelve entries are reachable by keyboard with no name truncated

#### Scenario: No forbidden claims
- **WHEN** the dialog and every result message are rendered
- **THEN** none contains "reset", "canonical", "trend" or "history lost", or any claim that original wording returns

#### Scenario: One request on confirm
- **WHEN** the facilitator confirms
- **THEN** exactly one request to `POST /topics/restore-defaults` is sent

### Requirement: The restore result is plain, accurate, and visible only on the management screen

After a `200` response the screen SHALL show one line stating the actual count and where the topics went: "Restored N topics. They are at the end of your list." (singular: "Restored 1 topic. It is at the end of your list."), the restored topics each as "<name> (position <displayOrder>)", and, in restore order, any skipped topics with the same literal line as the dialog. Whenever `restored.length` differs from the count previewed in the dialog, whatever the cause (a single restore in between, or a newly active name), the line SHALL instead read "Restored A of P topics. The list changed after you opened this dialog." with A the actual and P the previewed count, followed by the skipped lines. A `200` with nothing restored SHALL show "Nothing to restore." and no success message. The result SHALL be announced through a polite live region; the dialog SHALL trap focus and return it to the control on close. The UI SHALL NOT use celebratory elements and SHALL NOT highlight restored rows (a transient highlight is deferred). The screen SHALL refetch after a `200` so the lists reflect server state (if that refetch fails: "The default topics were restored, but the list couldn't be refreshed. Reload the page to see them."). While the request is in flight the confirm control SHALL be disabled (a second activation sends no second request). Every non-`200` response SHALL close the dialog and leave the list unchanged. The messages are: `403` shows the server's message (falling back to "You can no longer restore topics for this team."); `404` shows "Team not found."; `409 TOPIC_CUSTOMIZATION_LOCKED` shows "Topics cannot be customized until this team's first session is completed."; `429` and the limiter's `503` show the shared topic-write rate-limit message; any other failure (including `500` and a network error) shows "The default topics couldn't be restored. Try again." `403`, `404` and `409` SHALL also refetch so the screen and the control reflect current state; the others do not refetch (the transaction is atomic, so the list is unchanged and the user may retry). An unknown skip `reason` SHALL render "<name>: not restored".

#### Scenario: Double activation
- **WHEN** the facilitator activates confirm twice quickly
- **THEN** exactly one request is sent and the confirm control is disabled until the response arrives

#### Scenario: Facilitator joined the team after load
- **WHEN** the response is `403 FACILITATOR_IS_TEAM_MEMBER`
- **THEN** the dialog closes, the same message single restore shows appears, and the screen refetches (the control then disappears)

#### Scenario: Success line
- **WHEN** a restore of five topics returns `200`
- **THEN** the screen shows "Restored 5 topics. They are at the end of your list.", the five restored names with positions, and the list refetches

#### Scenario: Delta line
- **WHEN** the preview listed five topics and the response restored four
- **THEN** the screen shows "Restored 4 of 5 topics. The list changed after you opened this dialog."

#### Scenario: Skipped after confirm
- **WHEN** a name became active after the preview so a previewed topic is skipped
- **THEN** the delta line is shown and the skipped topic appears with "<name>: a topic with this name is already in your list"

#### Scenario: Nothing to restore
- **WHEN** the response is `200` with empty `restored`
- **THEN** the screen shows "Nothing to restore." and no success message

#### Scenario: Participants see nothing
- **WHEN** a session is open for the team
- **THEN** no session view shows the control, the result, or any trace of the restore

### Requirement: With zero active topics, restoring defaults is the primary recovery when it is possible

When the active-topics list is empty and a restorable archived default exists, the empty state SHALL present "Restore default topics" as the primary action, because it brings back original rows and their history, and "Assign default topics" (administrator only, per `topic-customization-lock`) as a secondary action whose copy reads "Assign default topics creates new copies of the default topics; it does not bring back the originals or their history." "Primary" means the restore control is first in DOM order and uses the primary button style; assign uses the secondary style. When no restorable archived default exists, only the existing assign action appears.

#### Scenario: Restorable defaults exist in an empty team
- **WHEN** a team has zero active topics and archived defaults with no active name conflicts
- **THEN** "Restore default topics" is the primary action and "Assign default topics" is secondary with copy about fresh copies

#### Scenario: Nothing restorable in an empty team
- **WHEN** a team has zero active topics and no restorable archived default
- **THEN** only the existing assign action is offered
