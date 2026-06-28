# Session Wrap-up — Use Cases

---

# Use Case: Enter Wrap-up Phase

## Summary
**Actor:** Facilitator

**Trigger:** The facilitator advances past the final topic in the session.

**Goal:** As a Facilitator, I want to transition the session into wrap-up mode so that I can review discussion notes and confirm action items before closing the session.

---

## Preconditions
- The facilitator is authenticated and recognized by the application as the active facilitator for this session.
- The session is in progress and all topics have been completed (voted on and either advanced or marked for discussion).
- At least the final topic has been revealed and the facilitator has chosen to advance past it.

## Main Flow
1. The facilitator clicks "Advance" (or equivalent control) after the last topic.
2. The application detects that no further topics remain in the session.
3. The application transitions the session state to "wrap-up."
4. The facilitator's view changes to the wrap-up screen, which presents:
   - A list of all topics marked for discussion during the session, each showing the captured discussion notes (if any).
   - A section for action items, initially listing any action items created during the live session flow (if that is supported), or empty if none yet exist.
   - A "Mark Session Complete" control, which is visible but not yet the primary call to action.
5. Participants' views update to indicate the session is in wrap-up; they can no longer vote.

## Alternate Flows
- **Facilitator advances from the last topic with no topics marked for discussion:** The wrap-up screen loads with the discussion notes section empty. The action items section is still available.
- **Session already in wrap-up state (e.g., facilitator reloads the page):** The application restores the wrap-up view with all current state intact, including any draft action items not yet saved.

## Postconditions
- **Success:** The session state is "wrap-up." The facilitator sees the wrap-up screen. No further voting is possible. Discussion notes and action item drafts are preserved.
- **Failure:** The session remains in its prior state; the facilitator is shown an error and can retry.

---

## Acceptance Criteria
- [ ] Advancing past the last topic automatically triggers the wrap-up transition — no separate "begin wrap-up" button is required.
- [ ] The wrap-up screen displays all topics that were marked for discussion during the session.
- [ ] Participants' views reflect that the session is in wrap-up and voting controls are no longer available.
- [ ] The session state of "wrap-up" is persisted server-side so that a page reload restores the correct view.
- [ ] The "Mark Session Complete" control is present on the wrap-up screen but does not require immediate action.

## Out of Scope
- Editing or re-voting on any topic after wrap-up begins. (Votes are locked once revealed.)
- Participants taking any action during wrap-up other than observing. (Participant actions during wrap-up are out of scope.)

## Dependencies
- Live Voting use cases (session must have completed all topics before wrap-up begins).
- Session state persistence layer.

## Notes
- The application should make clear to participants that the session is in its closing phase, not that it is over. The session is not complete until the facilitator explicitly marks it so.
- If the facilitator has not captured discussion notes for topics marked for discussion, this is allowed — notes are not required.

---

# Use Case: Review Discussion Notes

## Summary
**Actor:** Facilitator

**Trigger:** The facilitator opens the wrap-up screen after the final topic is complete.

**Goal:** As a Facilitator, I want to review the discussion notes captured during the session so that I can use them to inform action item creation before closing the session.

---

## Preconditions
- The session is in "wrap-up" state.
- The facilitator is viewing the wrap-up screen.
- At least one topic was marked for discussion during the live voting phase.

## Main Flow
1. The wrap-up screen displays a list of topics that were marked for discussion during the session.
2. For each such topic, the application shows:
   - The topic name and prompt.
   - Any discussion notes captured during the session for that topic.
3. The facilitator reads through the notes for each topic.
4. The facilitator uses the notes as context when creating or confirming action items.

## Alternate Flows
- **No topics were marked for discussion:** The discussion notes section displays an empty state message (e.g., "No topics were marked for discussion this session."). The facilitator can proceed directly to action items.
- **A topic was marked for discussion but has no notes:** The topic appears in the list with an indication that no notes were captured. The facilitator can proceed without notes.

## Postconditions
- **Success:** The facilitator has reviewed all available discussion notes. No state change occurs as a result of viewing notes.
- **Failure:** If discussion notes fail to load, the facilitator is shown an error. The session remains in wrap-up and the facilitator can retry or proceed without notes.

---

## Acceptance Criteria
- [ ] Only topics marked for discussion during the session appear in the discussion notes section.
- [ ] Notes are displayed in the order topics occurred during the session.
- [ ] Topics with no notes captured are still listed, with a clear empty state rather than being hidden.
- [ ] Discussion notes are read-only during wrap-up — the facilitator cannot edit them at this stage.
- [ ] If no topics were marked for discussion, the section shows a clear empty state rather than an error.

## Out of Scope
- Editing discussion notes during wrap-up. (Note capture is part of the live voting phase.)
- Displaying vote results or outlier information inline with notes. (That detail is in the session history view, not the wrap-up screen.)

## Dependencies
- Live Voting / Outlier Detection and Discussion Prompts feature set (source of discussion markings and notes).
- Session data persistence layer.

## Notes
- It is assumed that note capture, if supported, occurs during the live session as the facilitator or a designated note-taker enters text. The wrap-up screen is for review, not capture.
- Open question: can the facilitator add brief notes during wrap-up for topics that were discussed but where no notes were captured in the moment? This should be clarified before implementation.

---

# Use Case: Create an Action Item During Wrap-up

## Summary
**Actor:** Facilitator

**Trigger:** The facilitator identifies a follow-up item while reviewing discussion notes and chooses to create a new action item.

**Goal:** As a Facilitator, I want to create a new action item with an owner and description so that the team has a clear, recorded commitment before the session closes.

---

## Preconditions
- The session is in "wrap-up" state.
- The facilitator is authenticated and has permission to create action items.
- The team has at least one engineer who can be assigned as owner.

## Main Flow
1. The facilitator clicks "Add Action Item" (or equivalent control) on the wrap-up screen.
2. The application presents a form with:
   - A text field for the action item description (required).
   - An owner selector listing engineers on the team (required).
3. The facilitator enters a description of the action item.
4. The facilitator selects an owner from the team member list.
5. The facilitator submits the form.
6. The application saves the action item as a draft with:
   - The provided description.
   - The selected owner.
   - Status: "open."
   - The current session recorded as the session of creation.
7. The new action item appears in the action items list on the wrap-up screen.
8. The facilitator can continue adding more action items or proceed to mark the session complete.

## Alternate Flows
- **Facilitator submits without a description:** The application displays a validation error. The form is not submitted. The facilitator must provide a description before saving.
- **Facilitator submits without selecting an owner:** The application displays a validation error. The form is not submitted. The facilitator must select an owner before saving.
- **The team has no engineers listed:** The owner selector is empty. The facilitator cannot complete the form. The application should surface an error state and may need administrator intervention — this represents a data integrity issue.
- **Save fails due to a server error:** The application displays an error message. The form data is preserved so the facilitator does not lose their input. The facilitator can retry.

## Postconditions
- **Success:** The action item is persisted as a draft (status: "open," associated with the current session) and is visible in the wrap-up screen's action items list. It is not yet finalized until the session is marked complete.
- **Failure:** No action item is created. The facilitator's input is preserved for retry.

---

## Acceptance Criteria
- [ ] The facilitator can add a new action item from the wrap-up screen without leaving the wrap-up flow.
- [ ] Both description and owner are required fields; the form cannot be submitted without them.
- [ ] The owner selector is populated exclusively with engineers on the team being facilitated.
- [ ] A newly created action item immediately appears in the action items list on the wrap-up screen.
- [ ] The action item is saved with status "open" and the current session recorded as its creation session.
- [ ] The facilitator can create multiple action items in sequence during a single wrap-up.
- [ ] If a save fails, the facilitator's input is preserved and they can retry without re-entering data.

## Out of Scope
- Setting an initial status other than "open" during creation. (Status changes are managed through Action Item Management.)
- Assigning action items to people outside the team (e.g., the Engineering Manager or the facilitator themselves).
- Linking an action item to a specific topic. (Action items are session-level, not topic-level, unless otherwise specified.)

## Dependencies
- Team membership data (required to populate the owner selector).
- Action Item data model (description, owner, status, session of creation).
- Session state must be "wrap-up."

## Notes
- Action items created during wrap-up are considered draft until the session is marked complete. This distinction may or may not be user-visible — clarify whether drafts appear in the team's action item backlog before the session is finalized.
- The facilitator is from a different team than the one being facilitated. The owner selector must draw from the facilitated team's engineers, not the facilitator's own team.

---

# Use Case: Edit a Draft Action Item

## Summary
**Actor:** Facilitator

**Trigger:** The facilitator notices an error or wants to refine an action item they have already added during wrap-up, before the session is marked complete.

**Goal:** As a Facilitator, I want to edit the description or owner of a draft action item so that the record is accurate before it is finalized.

---

## Preconditions
- The session is in "wrap-up" state and has not yet been marked complete.
- At least one action item has been created during the current wrap-up.
- The facilitator is viewing the wrap-up screen.

## Main Flow
1. The facilitator locates the action item they want to edit in the wrap-up screen's action items list.
2. The facilitator clicks "Edit" (or equivalent control) on that action item.
3. The application presents the action item in an editable form, pre-populated with the current description and owner.
4. The facilitator updates the description, the owner, or both.
5. The facilitator saves the changes.
6. The application updates the action item record and refreshes the display on the wrap-up screen.

## Alternate Flows
- **Facilitator clears the description field and tries to save:** The application displays a validation error. The save is rejected. The description field must not be empty.
- **Facilitator clears the owner selection and tries to save:** The application displays a validation error. The save is rejected. An owner must be selected.
- **Facilitator clicks "Edit" but then cancels without saving:** The action item remains unchanged. No state is modified.
- **Save fails due to a server error:** The application displays an error. The facilitator's edits are preserved in the form for retry.

## Postconditions
- **Success:** The action item reflects the updated description and/or owner. The session remains in "wrap-up."
- **Failure:** The action item is unchanged. The facilitator can retry.

---

## Acceptance Criteria
- [ ] The facilitator can edit any action item created during the current wrap-up, up until the session is marked complete.
- [ ] The edit form is pre-populated with the action item's current values.
- [ ] Saving an edit with an empty description or no owner is rejected with a clear validation message.
- [ ] Canceling an edit leaves the action item unchanged.
- [ ] The updated action item is reflected immediately in the wrap-up screen's action items list after a successful save.
- [ ] Editing is not possible once the session has been marked complete.

## Out of Scope
- Editing action items from prior sessions. (Historical session data cannot be modified.)
- Changing the status of an action item during wrap-up. (Status starts as "open"; status updates are managed through Action Item Management.)

## Dependencies
- Action item persistence layer.
- Team membership data (required for owner selector).
- Session state must be "wrap-up."

## Notes
- The edit capability applies only to action items created in the current wrap-up. Action items from prior sessions that appear in the Pre-Session Action Item Review are governed by separate rules.
- It should be considered whether engineers (not just the facilitator) can see draft action items before the session is complete. This affects whether edits are visible to participants in real time.

---

# Use Case: Remove a Draft Action Item

## Summary
**Actor:** Facilitator

**Trigger:** The facilitator decides that an action item they added during wrap-up should not be recorded, before the session is marked complete.

**Goal:** As a Facilitator, I want to remove a draft action item so that it is not finalized as part of the session record.

---

## Preconditions
- The session is in "wrap-up" state and has not yet been marked complete.
- At least one action item has been created during the current wrap-up.
- The facilitator is viewing the wrap-up screen.

## Main Flow
1. The facilitator locates the action item they want to remove in the wrap-up screen's action items list.
2. The facilitator clicks "Remove" (or equivalent control) on that action item.
3. The application prompts the facilitator to confirm the removal (e.g., "Are you sure you want to remove this action item?").
4. The facilitator confirms.
5. The application deletes the draft action item.
6. The action item is removed from the wrap-up screen's list.

## Alternate Flows
- **Facilitator initiates removal but cancels at the confirmation prompt:** The action item is not removed. No state is modified.
- **Removal fails due to a server error:** The application displays an error. The action item remains in the list. The facilitator can retry.

## Postconditions
- **Success:** The draft action item is permanently deleted and no longer appears in the wrap-up list. It will not be part of the session record.
- **Failure:** The action item is unchanged. The facilitator can retry.

---

## Acceptance Criteria
- [ ] The facilitator can remove any action item created during the current wrap-up, up until the session is marked complete.
- [ ] The application prompts for confirmation before permanently removing an action item.
- [ ] After confirmed removal, the action item disappears from the wrap-up list immediately.
- [ ] Removal is not possible once the session has been marked complete.
- [ ] If removal fails, an error is shown and the item remains in the list.

## Out of Scope
- Removing action items from prior sessions.
- "Soft delete" or archive behavior — removal during wrap-up is permanent because the item was never finalized.

## Dependencies
- Action item persistence layer.
- Session state must be "wrap-up."

## Notes
- Because the session is not yet complete, removed draft action items should not appear anywhere in the team's action item backlog or session history.

---

# Use Case: Mark Session Complete

## Summary
**Actor:** Facilitator

**Trigger:** The facilitator has reviewed discussion notes and is satisfied with the action items, and clicks "Mark Session Complete."

**Goal:** As a Facilitator, I want to mark the session complete so that the session record is finalized and the team's trend history is updated.

---

## Preconditions
- The session is in "wrap-up" state.
- The facilitator is authenticated as the active facilitator for this session.
- The facilitator has reviewed the discussion notes and action items (no minimum number of action items is required).

## Main Flow
1. The facilitator clicks "Mark Session Complete" on the wrap-up screen.
2. The application prompts the facilitator to confirm (e.g., "Once marked complete, the session cannot be edited. Continue?").
3. The facilitator confirms.
4. The application transitions the session state to "complete."
5. All draft action items are finalized: they are written to the team's action item backlog with status "open" and the current session recorded as their creation session.
6. The application triggers persistence of all session data to the team's trend history (see: Persist Session Data to Trend History).
7. The facilitator is navigated to a session summary or confirmation screen.
8. Participants' views update to indicate the session is complete.

## Alternate Flows
- **Facilitator clicks "Mark Session Complete" but cancels at the confirmation prompt:** The session remains in "wrap-up." No state changes.
- **Finalization fails due to a server error:** The session remains in "wrap-up." The facilitator is shown an error and can retry. No partial data is committed (the operation is atomic).
- **Facilitator has no action items:** The session can still be marked complete. Action items are not required to close a session.

## Postconditions
- **Success:** The session state is "complete." All action items are finalized and visible in the team's backlog. Session data is incorporated into trend history. The session can no longer be edited.
- **Failure:** The session remains in "wrap-up." No data is permanently committed. The facilitator can retry.

---

## Acceptance Criteria
- [ ] The "Mark Session Complete" control is available on the wrap-up screen.
- [ ] The application prompts for confirmation before finalizing.
- [ ] Upon confirmation, the session state transitions to "complete" and can no longer be edited by any actor.
- [ ] All draft action items are finalized and written to the team's action item backlog as part of the completion step.
- [ ] Participants' views reflect that the session is complete immediately after finalization.
- [ ] Finalization is atomic: either all data is committed or nothing is committed; there is no partial state.
- [ ] The facilitator is navigated to an appropriate post-session view after successful completion.
- [ ] A session with no action items can still be marked complete.

## Out of Scope
- Any mechanism for the facilitator or any other actor to reopen or edit a completed session.
- Notifying participants outside the application (e.g., email or Slack). Notifications are out of scope.

## Dependencies
- Persist Session Data to Trend History use case (triggered as part of this flow).
- Action item persistence layer.
- Session state machine.

## Notes
- The finalization must be atomic. If the trend history write fails, the session should not be marked complete and no action items should be finalized.
- Consider what happens to participants who are not actively viewing the session when it is marked complete — their views should update on their next interaction or via a real-time push.

---

# Use Case: Persist Session Data to Trend History

## Summary
**Actor:** Application

**Trigger:** The session is marked complete by the facilitator.

**Goal:** As the Application, I want to incorporate the completed session's data into the team's trend history so that future sessions and the trend dashboard reflect accurate, up-to-date results.

---

## Preconditions
- The session state has been confirmed as transitioning to "complete."
- All vote results for all topics in the session are present and finalized.
- The session is associated with a valid team.

## Main Flow
1. The application receives the signal that the session has been marked complete.
2. For each topic in the session, the application records the session's results (votes and aggregate) as a new data point in the team's historical record for that topic.
3. The application records the session metadata: date, participants, facilitator, topics covered, discussion notes, and action items created.
4. The application updates any computed trend values (e.g., trailing averages used for trend outlier detection in future sessions).
5. The application marks the session as fully persisted in trend history.
6. The trend dashboard for the team is immediately updated to include the new session.

## Alternate Flows
- **A topic in the session has no votes (e.g., it was skipped):** The application records the topic as present in the session with no result. The trend chart for that topic reflects the gap rather than omitting the session entirely.
- **Persistence fails part way through:** The application rolls back any partial writes and marks the session as pending finalization. The session remains in a recoverable "complete-pending" state. An error is surfaced to the facilitator. The application can retry the persistence operation.

## Postconditions
- **Success:** The team's trend history includes all data from the completed session. The trend dashboard reflects the new session. The session is fully finalized.
- **Failure:** No partial data is written to trend history. The session is in a "complete-pending" state and can be retried.

---

## Acceptance Criteria
- [ ] Every topic voted on during the session has its result recorded as a new data point in the team's topic trend history.
- [ ] Session metadata (date, participants, facilitator, discussion notes, action items) is stored and retrievable via the session history view.
- [ ] The team's trend dashboard reflects the new session immediately after successful persistence.
- [ ] Skipped or unvoted topics are recorded as gaps in the trend, not silently omitted.
- [ ] Persistence is atomic: either all data for the session is committed or none is.
- [ ] If persistence fails, the facilitator is notified and the session remains in a retryable state.

## Out of Scope
- Sending notifications to the Engineering Manager or participants when a session is completed. (Notifications are out of scope.)
- Recalculating historical trend data for prior sessions as part of this operation.

## Dependencies
- Mark Session Complete use case (this use case is triggered by it).
- Trend history data store.
- Session data model.

## Notes
- The persistence operation should be designed so it can be safely retried if it fails partway through (idempotent writes where possible).
- The computed trailing averages written here will be used by the outlier detection logic in future sessions. Accuracy of this data is critical.

---

# Use Case: Recover Session State After Browser Close

## Summary
**Actor:** Facilitator

**Trigger:** The facilitator closes the browser, navigates away, or loses connectivity during wrap-up, before marking the session complete, and subsequently returns to the application.

**Goal:** As a Facilitator, I want the session to be recoverable when I return so that I can complete the wrap-up without losing discussion notes or draft action items.

---

## Preconditions
- The session was in "wrap-up" state when the facilitator's session was interrupted.
- The facilitator returns to the application and authenticates.
- The session has not been marked complete by any other actor.

## Main Flow
1. The facilitator returns to the application (e.g., reopens the browser, navigates to the session URL, or is redirected to an in-progress session).
2. The application detects that the facilitator has an active session in "wrap-up" state.
3. The application restores the wrap-up screen with all state intact:
   - Discussion notes for topics marked for discussion.
   - All draft action items created before the interruption, with their descriptions and owners.
4. The facilitator reviews the restored state to confirm it is complete and accurate.
5. The facilitator may add, edit, or remove draft action items as needed.
6. The facilitator marks the session complete when ready.

## Alternate Flows
- **The facilitator returns but the session has been in wrap-up for an unusually long time (e.g., multiple days):** The application restores the session normally. There is no automatic timeout or expiration of sessions in wrap-up. The facilitator must explicitly mark it complete or it remains open. (See Notes.)
- **Another facilitator or the same facilitator on a different device attempts to access the wrap-up:** The application allows access — the session state is server-side and device-agnostic. The most recent state is shown.
- **The application cannot restore session state (e.g., data corruption or server error):** The application surfaces an error. The session remains in "wrap-up" state but the facilitator cannot proceed. This requires technical intervention.
- **A participant views the session during a prolonged wrap-up:** Participants see the session as in wrap-up. No voting or other actions are available to them.

## Postconditions
- **Success:** The facilitator is returned to the wrap-up screen with all prior state (discussion notes, draft action items) intact. The session is still in "wrap-up" and can be completed normally.
- **Failure:** The session remains in "wrap-up" in an unrecoverable state. Technical intervention may be required.

---

## Acceptance Criteria
- [ ] If the facilitator closes and reopens the browser during wrap-up, the session is restored to the wrap-up screen with all state intact.
- [ ] Draft action items created before the interruption are present and unmodified when the facilitator returns.
- [ ] Discussion notes for topics marked for discussion are present when the facilitator returns.
- [ ] Session state is stored server-side, not only in browser memory or local storage, so that state survives a full browser close.
- [ ] The application detects an in-progress wrap-up session for the returning facilitator and presents it without requiring the facilitator to manually navigate to it.
- [ ] There is no automatic expiration of sessions in wrap-up — only an explicit facilitator action marks the session complete.

## Out of Scope
- Automatic session completion after a timeout. (Session completion requires an explicit facilitator action.)
- Notifying participants if wrap-up is delayed. (Notifications are out of scope.)
- Handling the case where the facilitator is permanently unavailable and a different person must complete the session. (This is an organizational process, not an application function.)

## Dependencies
- Server-side session state persistence.
- Facilitator authentication (the application must identify the returning user as the session's facilitator).
- Session state machine ("wrap-up" state must be durable).

## Notes
- All wrap-up state — including draft action items — must be persisted server-side at the time of creation/modification, not only when the session is marked complete. This is what makes recovery possible.
- Open question: should there be any operational safeguard (e.g., an admin alert) if a session remains in "wrap-up" for more than a defined period (e.g., 48 hours)? This would help catch abandoned sessions that might need manual resolution.
- The session URL should be stable and predictable so the facilitator can return to it directly via browser history or a bookmark.
