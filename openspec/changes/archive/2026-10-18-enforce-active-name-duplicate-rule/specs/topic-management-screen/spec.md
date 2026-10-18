## MODIFIED Requirements

### Requirement: An active topic with the same name blocks Add; other likely duplicates are flagged before the request without blocking it

After required-field validation passes, the screen SHALL compare the trimmed, lowercased name against the trimmed, lowercased name of every active and archived topic, and the trimmed, lowercased prompt against the trimmed, lowercased prompt of every active and archived topic. "Lowercased" means `String.prototype.toLowerCase()` with no locale argument, using the shared `normalizeTopicNameForMatch`. No other normalisation and no fuzzy matching SHALL apply; in particular, internal whitespace is compared exactly as typed. The comparison uses the topics most recently loaded by the screen. The server enforces the active-name rule (`409 TOPIC_NAME_ACTIVE`, see `add-custom-topic`); the screen's check is the normal path and the server is the backstop for a stale list, a second tab or a race. The server does not enforce prompt uniqueness.

The screen SHALL distinguish three outcomes:

- **Active name match (blocking).** When the submitted name matches an active topic, whatever else matches, the screen SHALL send no request, SHALL disable Submit with the reason visible inline and announced to assistive technology (`role="alert"` or `aria-live`), and SHALL NOT render an "Add anyway" control (or any control that sends the request) for this match. The message text SHALL be exactly: `An active topic with this name already exists: "<stored name>". Choose a different name, or use the existing topic.` (for a blank stored name, `a topic with no name` replaces the quoted name). This block SHALL clear only when Name changes; editing Prompt alone SHALL NOT clear it or re-enable Submit. When the name also matches an archived topic, the archived topic may be offered as information ("Show it in Archived topics") but the active match governs and blocks.
- **Archived name or prompt match (non-blocking).** "This team has an archived topic called '<existing name>'. Restoring it keeps its history in one trend." with a primary action "Show it in Archived topics" and a secondary action "Add as a new topic anyway". When both an archived match and an active prompt-only match exist, the archived message is shown.
- **Active prompt-only match (non-blocking).** When only the prompt matches an active topic, the screen SHALL show a warning visibly different in wording from the blocking name message (same question, the facilitator can still add), with an action that sends the request unchanged.

When more than one topic of the winning kind matches, the message SHALL name, and "Show it in Archived topics" SHALL focus, the first matching topic in that list's display order. "Show it in Archived topics" SHALL expand the Archived section and move focus to the matching archived row's heading (made programmatically focusable for this purpose), SHALL leave the form open with its values, and SHALL NOT restore anything. The sending actions of the non-blocking warnings SHALL send the request unchanged. Editing Name or Prompt SHALL dismiss a non-blocking warning (archived match or prompt-only match), whichever field matched. The active-name block is the exception, governed by the sentence above: it clears only when Name changes. The check runs on Submit only, except that the active-name block SHALL keep Submit disabled until Name is edited. Once the facilitator has chosen a sending action of a non-blocking warning, the check SHALL NOT run again on a later Submit of the same form (for example, a retry after a network failure) until Name or Prompt is edited; this exemption never applies to an active name match.

When the server answers `409` with `TOPIC_NAME_ACTIVE` (a stale list, a second tab, a race), the screen SHALL show the same blocking message (identical text, naming `conflictingName`), SHALL keep the typed values and focus, SHALL refetch the topic list so the hint reflects current data, and SHALL branch on the `code` (never on a bare `409`, which `TOPIC_CUSTOMIZATION_LOCKED` also uses). The locked-team message (its existing text) does not contain the phrase "an active topic with this name already exists"; the Add blocking message and the restore-row message both do (compared case-insensitively). Tests assert this by phrase, not by visual judgment.

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

#### Scenario: An archived-match override is not asked again on retry
- **WHEN** a facilitator selects "Add as a new topic anyway" on an archived-match warning, the request fails with a network error, and the facilitator selects Submit again without editing Name or Prompt
- **THEN** no duplicate warning is shown and the request is sent
- **AND WHEN** the facilitator then edits Name and selects Submit, and the new name still matches an archived topic
- **THEN** the warning is shown again and no request is sent

#### Scenario: An active name match blocks and offers no override
- **WHEN** a facilitator submits a topic named "pairing" and the team has an active topic named "Pairing"
- **THEN** no request is sent and the blocking message names "Pairing"
- **AND** Submit is disabled with the reason visible, and no "Add anyway" control exists in the DOM
- **AND WHEN** the facilitator edits Name to a non-matching value
- **THEN** the message is dismissed and Submit is enabled

#### Scenario: Editing only Prompt leaves an active-name block in place
- **WHEN** an active-name block is showing and the facilitator edits only Prompt
- **THEN** the blocking message is still shown and Submit is still disabled
- **AND WHEN** the facilitator then edits Name to a non-matching value
- **THEN** the message is dismissed and Submit is enabled

#### Scenario: An active prompt-only match warns and can still be added
- **WHEN** a facilitator submits a name that matches nothing and a prompt equal to an active topic's prompt
- **THEN** a non-blocking warning is shown whose wording differs from the blocking name message
- **AND** its action sends the request unchanged

#### Scenario: A server name conflict on a stale list
- **WHEN** the screen's list lacks an active topic named "Safety" that another tab just added, and the facilitator submits "safety"
- **THEN** the server answers `409` with `TOPIC_NAME_ACTIVE`, the form shows the blocking message naming "Safety", the typed values and focus are kept, and the topic list is refetched

#### Scenario: A lock 409 is not shown as a name conflict
- **WHEN** the server answers `409` with `TOPIC_CUSTOMIZATION_LOCKED`
- **THEN** the locked-team message is shown, not the name-conflict message

#### Scenario: The active name match governs when the prompt matches an archived topic
- **WHEN** a submitted name matches an active topic and the submitted prompt matches an archived topic
- **THEN** the blocking active-name message is shown and no request is sent

#### Scenario: Editing Name or Prompt dismisses a non-blocking warning
- **WHEN** a non-blocking warning (archived match or active prompt-only match) is shown and the facilitator edits Prompt
- **THEN** the warning is no longer shown

### Requirement: Adding a topic interlocks with the reorder draft, definition drafts, and Remove/Restore dialogs only at submit time

Submit SHALL be disabled, with the first applicable reason in this order, while:
1. the reorder draft is dirty or saving: "Save or discard your order changes first." (otherwise the new topic would be missing from the draft and the next order save would be stale);
2. a definition editor holds unsaved changes or is saving: "Save or cancel your definition changes first.";
3. a Remove or Restore confirmation is open or submitting: "Finish or cancel the open remove or restore first.".

When an interlock reason above and the active-name block both apply, the interlock reason wins: Submit shows the first applicable interlock reason, and the active-name block's reason is shown only when no interlock applies (the block itself still prevents any request).

The duplicate warning's sending actions ("Add as a new topic anyway" on an archived match, and the action on an active prompt-only warning) each send the request, so they SHALL be disabled under the same conditions and with the same reasons as Submit.

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

## ADDED Requirements

### Requirement: A restore rejected for an active name conflict is explained at the row and changes nothing

When a single-restore request is answered `409` with `TOPIC_NAME_ACTIVE`, the screen SHALL show a persistent inline message at the archived row (not a transient toast), announced to assistive technology, with the exact text `Not restored. An active topic with this name already exists: "<conflictingName>". Nothing was changed. Archive the active topic first if you want to restore this one.` (`a topic with no name` replaces the quoted name when `conflictingName` is empty). The row SHALL remain under Archived without a reload. The message SHALL NOT assume the reader belongs to the team. It persists (no timer) and SHALL clear only on: the next restore attempt on that row, a successful archive of any topic in the team (the refetched list replaces the row state), or a page reload. There is no separate Dismiss control. The message shares the phrase "an active topic with this name already exists" with the Add blocking message and does not share it with the locked-team message. The text is client-owned (the server `message` is not displayed), `conflictingName` is rendered as text only (never as HTML), and the screen SHALL branch on `code`, never on a bare `409`; the same holds for the bulk restore caller, whose skip report keeps the reason `NAME_ACTIVE`. After the facilitator archives the active topic, the same restore SHALL succeed.

#### Scenario: Restore of a name-conflicting topic
- **WHEN** a facilitator confirms restoring "Pairing" while "pairing" is active and the server answers `TOPIC_NAME_ACTIVE`
- **THEN** an inline message at the "Pairing" row reads `Not restored. An active topic with this name already exists: "pairing". Nothing was changed. Archive the active topic first if you want to restore this one.`
- **AND** "Pairing" is still listed under Archived

#### Scenario: The restore-row message clears on the next attempt or an archive
- **WHEN** the restore-row message is showing and the facilitator archives any topic in the team, or retries the restore on that row
- **THEN** the message is no longer shown (and, if the conflict is gone, the retry succeeds)

#### Scenario: Locked-team conflict reads differently
- **WHEN** a restore is answered `409` with `TOPIC_CUSTOMIZATION_LOCKED`
- **THEN** the locked-team message is shown, not the name-conflict message
