## ADDED Requirements

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
