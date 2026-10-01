## ADDED Requirements

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
