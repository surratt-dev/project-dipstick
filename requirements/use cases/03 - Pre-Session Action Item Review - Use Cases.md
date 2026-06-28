# Pre-Session Action Item Review — Use Cases

---

# Use Case: Surface Open Action Items at Session Start

## Summary
**Actor:** Application

**Trigger:** A session transitions from the "joining" state to the "active" state — i.e., the facilitator starts the session.

**Goal:** As the Application, I want to surface all open action items from the team's prior sessions so that participants can review outstanding commitments before new voting begins.

---

## Preconditions
- The session has been created and the facilitator has started it.
- At least one prior session exists for the team with action items in "open" or "in progress" status.
- All session participants are authenticated and present in the session room.
- The session is in the Pre-Session Action Item Review phase (before any topic has been presented).

## Main Flow
1. The facilitator starts the session.
2. The application queries all action items associated with the team that have a status of "open" or "in progress," ordered by the session in which they were created (oldest first).
3. The application renders the Pre-Session Action Item Review screen, displaying each action item with: description, owner name, current status, and the session it was created in.
4. Items are displayed with a staleness color indicator based on elapsed sessions without a status update: yellow (1 session), orange (2 sessions), red (3+ sessions). See UC: Flag Stale Action Items Open Across Multiple Sessions.
5. The review screen is shown to all participants simultaneously — engineers, and the facilitator — in a read-only view by default.
6. Owners of action items are presented with inline controls to update the status of their own items.
7. The facilitator is presented with a control to advance past the review when ready.

## Alternate Flows
- **No open action items exist:** The application renders a "no open action items" state. See UC: Skip Review When No Open Action Items.
- **Session has no prior sessions (first session for the team):** The application renders a "no open action items" state and the facilitator can immediately advance.
- **A participant joins late during the review:** The participant is placed into the session room and sees the current state of the action item review, including any status updates that have already occurred.

## Postconditions
- **Success:** All session participants see the action item review screen with current status of all open items.
- **Failure:** If the query fails, the application displays an error and does not advance to topic voting. The session remains in the Pre-Session Review phase.

---

## Acceptance Criteria
- [ ] All action items with status "open" or "in progress" for the team are displayed before the first topic begins.
- [ ] Each action item displays: description, owner name, current status, and originating session identifier.
- [ ] Action items are visible to all session participants simultaneously.
- [ ] Action items resolved prior to the session (status "resolved") do not appear in the review list.
- [ ] The review screen appears before any topic prompt is shown.
- [ ] The facilitator sees a control to advance past the review.

## Out of Scope
- Creating new action items during the Pre-Session Review (action item creation occurs during Session Wrap-up).
- Displaying resolved action items or a history of resolved items (belongs to Action Item Management / Trend Dashboard).
- Notifying owners of action items prior to the session (notifications are out of scope for the application).

## Dependencies
- UC: Skip Review When No Open Action Items
- UC: Flag Stale Action Items
- Session Setup — session must be started by the facilitator before this use case begins.
- Action Item Management feature set — action items must be persisted with owner, status, and originating session.

## Notes
- "Open" and "in progress" are the two non-terminal statuses. "Resolved" items are excluded from the review.
- The ordering logic (oldest session first) is an assumption; implementors should confirm preferred sort order with stakeholders.
- Real-time status updates made during this review should be reflected for all participants without requiring a page refresh (implies a live/push update mechanism).

---

---

# Use Case: Engineer Updates Status of Their Own Action Item

## Summary
**Actor:** Engineer

**Trigger:** The engineer sees one of their action items displayed during the Pre-Session Action Item Review and wants to update its status.

**Goal:** As an Engineer, I want to update the status of an action item I own so that the team has an accurate picture of its progress before voting begins.

---

## Preconditions
- The session is in the Pre-Session Action Item Review phase.
- The engineer is authenticated and present in the session room.
- The action item is owned by this engineer and has a status of "open" or "in progress."
- The engineer is the designated owner of the action item (ownership is assigned, not self-selected during this phase).

## Main Flow
1. The engineer views the action item review screen and sees their action item(s) with inline status controls.
2. The engineer selects a new status for one of their items (from: open, in progress, resolved).
3. The application validates that the engineer is the owner of that item.
4. The application persists the status change immediately.
5. The updated status is reflected in real time on the review screen for all participants in the session.
6. The engineer may continue updating other items they own, or leave the screen unchanged.

## Alternate Flows
- **Engineer selects the same status already set:** The application accepts the update gracefully (no-op or silent confirmation); no error is shown.
- **Concurrent update conflict (engineer and facilitator update the same item simultaneously):** The application applies the last-write-wins strategy and reflects the final state to all participants. (See Notes.)
- **Network interruption during update:** The application displays an inline error and retains the previous status. The engineer can retry.
- **Engineer attempts to update an item they do not own:** The status control is not rendered for items owned by other engineers; the action is not available.

## Postconditions
- **Success:** The action item's status is updated in the database and reflected in real time on all participants' screens.
- **Failure:** The status is not changed. The previous status is displayed. An error message is shown to the engineer.

---

## Acceptance Criteria
- [ ] An engineer can change the status of an action item they own to "open," "in progress," or "resolved."
- [ ] Status controls are only rendered for items owned by the currently authenticated engineer.
- [ ] A status change is persisted immediately and reflected on all participant screens without a page refresh.
- [ ] An engineer cannot update the status of an action item owned by another engineer through the UI.
- [ ] If the update fails, the engineer sees an error and the status displayed reverts to its last confirmed value.

## Out of Scope
- Reassigning ownership of an action item (ownership is not changed during the review phase).
- Adding a resolution note to a resolved item during this phase (resolution notes, if supported, belong to Action Item Management).
- Engineers updating action items outside of an active session (belongs to Action Item Management).

## Dependencies
- UC: Surface Open Action Items at Session Start — the review screen must be active for this use case to occur.
- Action Item Management — action item ownership and status fields must be persisted.
- Identity & Access — the application must be able to identify the authenticated engineer to enforce ownership rules.

## Notes
- The application must enforce ownership server-side, not only in the UI, to prevent circumvention.
- If two users (e.g., engineer and facilitator) attempt to update the same item at the same time, a conflict resolution strategy is needed. Last-write-wins is assumed but should be confirmed.
- It is not yet defined whether a status change during the review phase creates an audit log entry. Implementors should confirm.

---

---

# Use Case: Facilitator Updates Status of Any Action Item

## Summary
**Actor:** Facilitator

**Trigger:** During the Pre-Session Action Item Review, the facilitator identifies an action item whose status needs updating and the owner is unable or unavailable to do so.

**Goal:** As a Facilitator, I want to update the status of any action item during the review so that the team's action item list accurately reflects reality before voting begins.

---

## Preconditions
- The session is in the Pre-Session Action Item Review phase.
- The facilitator is authenticated and recognized by the application as the session's facilitator.
- The action item has a status of "open" or "in progress."

## Main Flow
1. The facilitator views the action item review screen with all open and in-progress items displayed.
2. The facilitator selects a new status for any action item in the list (not limited to items they own, as they are not an engineer on this team).
3. The application validates that the actor has facilitator-level access to this session.
4. The application persists the status change immediately.
5. The updated status is reflected in real time on the review screen for all participants in the session.

## Alternate Flows
- **Engineer owner is present and disagrees with the facilitator's update:** No system-enforced resolution; this is a social/facilitation concern. The last status set is persisted. Implementors may consider an audit trail.
- **Network interruption during update:** The application displays an inline error and retains the previous status. The facilitator can retry.

## Postconditions
- **Success:** The action item's status is updated in the database and reflected in real time on all participants' screens.
- **Failure:** The status is not changed. The previous status is displayed. An error message is shown to the facilitator.

---

## Acceptance Criteria
- [ ] The facilitator can change the status of any action item displayed during the review, regardless of which engineer owns it.
- [ ] A status change made by the facilitator is persisted immediately and reflected on all participant screens without a page refresh.
- [ ] Engineers cannot use the facilitator's broader update access (the permission is enforced server-side based on the authenticated session role).
- [ ] If the update fails, the facilitator sees an error and the status reverts to its last confirmed value.

## Out of Scope
- Reassigning ownership of an action item.
- Creating new action items during the review phase (creation occurs in Session Wrap-up).
- The facilitator modifying historical session data.

## Dependencies
- UC: Surface Open Action Items at Session Start — the review screen must be active.
- Identity & Access — the application must recognize the authenticated user as the facilitator for this session.
- Action Item Management — status field must be persisted and role-based update rules must be enforced.

## Notes
- The facilitator is from a different team than the one being assessed. Their ability to update items here is a session-scoped permission, not a general administrative one.
- Whether facilitator-initiated status changes are attributed differently than owner-initiated changes (e.g., in an audit log) is an open question.

---

---

# Use Case: Facilitator Advances Past the Review to Begin the First Topic

## Summary
**Actor:** Facilitator

**Trigger:** The facilitator determines that the Pre-Session Action Item Review is complete and the session is ready to proceed to voting.

**Goal:** As a Facilitator, I want to advance the session past the action item review so that the team can begin voting on health check topics.

---

## Preconditions
- The session is in the Pre-Session Action Item Review phase.
- The facilitator is authenticated and recognized as the session's facilitator.
- At least one topic is configured for the session.

## Main Flow
1. The facilitator reviews the action item list and is satisfied with the current statuses (or acknowledges items that remain open).
2. The facilitator activates the "Begin Session" (or equivalent) control.
3. The application transitions the session state from Pre-Session Review to Active Voting.
4. The application presents the first topic to all participants.
5. All participants' screens transition from the action item review to the first topic prompt.

## Alternate Flows
- **Facilitator advances while an engineer is mid-edit on a status update:** The application persists any in-flight status update that has already been committed (submitted) before transitioning. Unsaved changes are abandoned; the engineer is not warned unless the application tracks pending edits.
- **No topics are configured for the session:** The application prevents the advance and surfaces an error indicating no topics are available. (This is an edge case; session setup should ensure topics exist.)

## Postconditions
- **Success:** The session state is "active," the Pre-Session Action Item Review phase is closed, and the first topic is displayed to all participants.
- **Failure:** The session remains in the Pre-Session Review phase. Participants continue to see the action item review screen.

---

## Acceptance Criteria
- [ ] Only the facilitator sees and can activate the control to advance past the review.
- [ ] Activating the control transitions all participants' screens to the first topic simultaneously.
- [ ] The session state is durably updated to "active voting" upon advancement.
- [ ] Engineers do not have a mechanism to advance the session themselves.
- [ ] The transition is immediate and does not require individual participant action.

## Out of Scope
- Returning to the action item review after the first topic has begun (the review phase is a one-way transition).
- The facilitator reordering topics before advancing (belongs to Topic Management / Session Setup).
- Advancing between topics during voting (belongs to Live Voting).

## Dependencies
- UC: Surface Open Action Items at Session Start — this use case ends where that one began.
- Session Setup — the session must have at least one topic configured.
- Live Voting feature set — the first topic display is handled by that feature set.

## Notes
- There is no minimum time requirement for the review phase; the facilitator advances at their discretion.
- Whether the application sends any confirmation prompt ("Are you sure you want to advance?") before transitioning is a UX decision to be made during design.
- Action item statuses set during the review are preserved regardless of when the facilitator advances.

---

---

# Use Case: Skip Review When No Open Action Items

## Summary
**Actor:** Application

**Trigger:** The session transitions to the Pre-Session Action Item Review phase and the application finds no action items in "open" or "in progress" status for the team.

**Goal:** As the Application, I want to present an appropriate empty state during the Pre-Session Review so that participants understand there are no outstanding items and the facilitator can proceed without confusion.

---

## Preconditions
- The session is started and transitions to the Pre-Session Action Item Review phase.
- The team has either: no prior sessions, or all action items from prior sessions have a status of "resolved."

## Main Flow
1. The facilitator starts the session.
2. The application queries all open and in-progress action items for the team.
3. The query returns zero results.
4. The application renders the Pre-Session Action Item Review screen with an empty state message (e.g., "No open action items — the team is all clear.").
5. The facilitator is presented with the control to advance to the first topic.
6. The facilitator activates the control and the session proceeds to voting.

## Alternate Flows
- **First session for the team:** No prior sessions exist, so no action items can exist. The empty state is displayed. The flow is identical to the main flow.
- **All items were resolved during a previous session's wrap-up:** The same empty state is rendered. The facilitator advances immediately.

## Postconditions
- **Success:** The empty state is displayed to all participants, and the facilitator advances the session to the first topic without delay.
- **Failure:** If the query fails, the application cannot confirm whether items exist. An error state is shown and the session does not advance until the query succeeds.

---

## Acceptance Criteria
- [ ] When no open or in-progress action items exist, the review screen displays an empty state message rather than a blank or broken view.
- [ ] The empty state message clearly communicates that there are no outstanding action items.
- [ ] The facilitator can advance to the first topic from the empty state without any additional steps.
- [ ] The empty state is shown for first-time sessions as well as sessions where all prior items are resolved.
- [ ] Engineers see the same empty state view as the facilitator (minus the advance control).

## Out of Scope
- Displaying resolved items in the empty state (resolved items are excluded from this review).
- Automatically skipping the review phase without showing any screen (a brief acknowledgment is valuable even when empty).

## Dependencies
- UC: Surface Open Action Items at Session Start — this is an alternate outcome of that use case's query step.
- UC: Facilitator Advances Past the Review to Begin the First Topic — the facilitator still controls the transition.

## Notes
- Whether to automatically advance past an empty review (skipping the screen entirely) or always show the screen is a product decision. Showing the screen is assumed here because it provides a consistent ritual moment, even when empty.
- The empty state wording should be confirmed with design/product — it is a user-facing message.

---

---

# Use Case: Flag Stale Action Items Open Across Multiple Sessions

## Summary
**Actor:** Application

**Trigger:** The application loads open action items for the Pre-Session Action Item Review and evaluates each item's age relative to the number of sessions that have elapsed since it was created.

**Goal:** As the Application, I want to display a staleness color indicator on action items based on how many sessions they have been open without a status update so that the team and facilitator can gauge urgency at a glance.

---

## Preconditions
- The session is in the Pre-Session Action Item Review phase.
- At least one action item has a status of "open" or "in progress."
- That item was created in a prior session and has not had its status updated since creation (or since a prior session in which it was also displayed without update).

## Main Flow
1. The application queries all open and in-progress action items for the team.
2. For each item, the application evaluates: how many completed sessions for this team have occurred since the item was created?
3. The application assigns a staleness color to each item based on the count of completed sessions elapsed since the item's last status update:
   - **1 session elapsed:** yellow indicator
   - **2 sessions elapsed:** orange indicator
   - **3 or more sessions elapsed:** red indicator
   - **0 sessions elapsed:** no indicator
4. The application renders the review screen with each item's staleness color displayed as a visual indicator (e.g., badge, border, or row highlight).
5. The staleness indicator is visible to all participants — engineers and the facilitator.
6. No additional action is required from the system; the indicator is advisory.

## Alternate Flows
- **An item's status was updated during a prior review but remains "open" or "in progress":** The item is not stale — the update resets the staleness clock. It will only be flagged if another full session passes without a further update.
- **All open items are from the immediately preceding session:** No items are stale. The review renders without any stale flags.
- **An item is updated during this review:** The stale flag is cleared in real time as soon as the status is updated, even if it remains "in progress."

## Postconditions
- **Success:** Stale items are visually distinguished on the review screen for all participants.
- **Failure:** If staleness cannot be computed (e.g., session history query fails), items are displayed without a stale flag and the error is logged. The review is not blocked.

---

## Acceptance Criteria
- [ ] An action item with 1 completed session elapsed since its last update is displayed with a yellow indicator.
- [ ] An action item with 2 completed sessions elapsed since its last update is displayed with an orange indicator.
- [ ] An action item with 3 or more completed sessions elapsed since its last update is displayed with a red indicator.
- [ ] An action item with 0 sessions elapsed (created or updated in the most recent completed session) displays no staleness indicator.
- [ ] The staleness indicator is visually distinct and visible to all participants, including the facilitator.
- [ ] If a stale item's status is updated during the current review, the staleness indicator is cleared in real time.
- [ ] If staleness cannot be determined, items are shown without an indicator rather than blocking the review.

## Out of Scope
- Automated escalation or notification for stale items (notifications are out of scope for the application).
- Displaying staleness data outside of the Pre-Session Action Item Review (e.g., in the Trend Dashboard — that is a separate feature).
- Automatically resolving or reassigning stale items.

## Dependencies
- UC: Surface Open Action Items at Session Start — staleness flags are computed and displayed as part of that use case's rendering step.
- Action Item Management — session-of-creation and status-update history must be persisted to support staleness evaluation.
- Session history — the application must be able to determine how many sessions have occurred for the team since an item was created.

## Notes
- The staleness color scale is: 1 session elapsed = yellow, 2 sessions = orange, 3+ sessions = red. This is a decided requirement.
- A status update that does not change the status value (e.g., setting "open" to "open") resets the elapsed session count, as it signals deliberate attention was paid to the item.
- The staleness indicator is advisory; the application does not prevent the facilitator from advancing because stale items exist.
