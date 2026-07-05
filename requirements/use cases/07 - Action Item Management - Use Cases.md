# Action Item Management — Use Cases

---

# Use Case: View the Action Item Backlog

## Summary
**Actor:** Engineering Manager

**Trigger:** The Engineering Manager navigates to the action item backlog for one of their teams.

**Goal:** As an Engineering Manager, I want to view all open and in-progress action items across sessions for my team so that I can track outstanding commitments and assess team health without participating in sessions.

---

## Preconditions
- The Engineering Manager is authenticated.
- The Engineering Manager has a manager/team relationship with at least one team in the application.
- At least one action item exists for that team (in any status).

## Main Flow
1. The Engineering Manager navigates to the action item backlog for a team they manage.
2. The application verifies the Engineering Manager's read access to that team.
3. The application queries all action items associated with the team, across all sessions, ordered by status (open and in progress first) and then by creation session (oldest first).
4. The application renders the backlog, displaying for each item: description, owner name, current status, the session in which it was created, and a staleness color indicator if applicable (yellow = 1 session, orange = 2 sessions, red = 3+ sessions).
5. The Engineering Manager can filter or sort the backlog by status, owner, or session (see Notes).
6. The Engineering Manager reviews the items.

## Alternate Flows
- **No action items exist for the team:** The application renders an empty state (e.g., "No action items have been created for this team."). No error is shown.
- **Engineering Manager has no teams:** The application renders an empty state and surfaces no team selector or backlog.
- **Team has only resolved items:** The Engineering Manager can still view them; resolved items are included in the backlog but are visually or positionally de-emphasized relative to open and in-progress items.

## Postconditions
- **Success:** The Engineering Manager sees an accurate, up-to-date list of all action items for the selected team.
- **Failure:** If the query fails, the application surfaces an error. The backlog is not shown. The Engineering Manager can retry.

---

## Acceptance Criteria
- [ ] The Engineering Manager can access the action item backlog for any team they manage.
- [ ] The backlog displays: description, owner, status, originating session, and staleness color indicator for each item where applicable.
- [ ] Items with status "open" or "in progress" appear before resolved items.
- [ ] The Engineering Manager has no controls to create, edit, or update action item status.
- [ ] The view is read-only; no modification actions are available to the Engineering Manager.
- [ ] The Engineering Manager cannot access the backlog for teams they do not manage.

## Out of Scope
- The Engineering Manager modifying action items or reassigning ownership.
- Sending notifications or escalations based on backlog state (notifications are out of scope).
- Cross-team aggregate views (this use case covers a single team's backlog at a time).

## Dependencies
- Identity & Access — manager/team relationship must be established and enforced.
- Action Item data model — items must record owner, status, and originating session.
- UC: Flag a Stale Action Item (Action Item Management) — staleness color indicators must be computed and available for display.

## Notes
- Whether the Engineering Manager can view backlogs across multiple teams simultaneously (e.g., an aggregate view) is not specified. This use case covers single-team access.
- Filtering and sorting behavior is mentioned as expected capability; exact UI mechanics are a design decision.
- Resolved items are included in the backlog for completeness but the precise presentation (e.g., collapsed section, separate tab) is a design decision.

---

---

# Use Case: Engineer Updates Status of an Action Item They Own

## Summary
**Actor:** Engineer

**Trigger:** The engineer wants to update the status of one of their action items — either during the Pre-Session Action Item Review or, if supported, outside of a session.

**Goal:** As an Engineer, I want to update the status of an action item I own so that the team's records accurately reflect my progress on that commitment.

---

## Preconditions
- The engineer is authenticated.
- The action item is owned by this engineer.
- The action item has a current status of "open" or "in progress" (resolved items cannot be re-opened through this flow — see Notes).
- The engineer has access to a view where their action items are displayed.

## Main Flow
1. The engineer views their action item(s) — either during the Pre-Session Action Item Review or in a personal or team action item view.
2. The engineer selects a new status for an item they own (from: open, in progress, resolved).
3. The application validates that the authenticated engineer is the owner of that item.
4. The application persists the status change.
5. The updated status is reflected in the view immediately.
6. If the item is being viewed in a shared session context (e.g., Pre-Session Review), the update is reflected for all other participants in real time.

## Alternate Flows
- **Engineer selects the same status already set:** The application accepts the update gracefully; no error is shown. The staleness clock is reset (see Notes).
- **Engineer selects "resolved" without providing a resolution note:** The application allows the status change. A resolution note is optional. The item is marked resolved without a note.
- **Network interruption during update:** The application displays an inline error and retains the previous status. The engineer can retry.
- **Engineer attempts to update an item they do not own:** The update control is not rendered for items owned by other engineers. A direct API attempt is rejected with a permissions error.

## Postconditions
- **Success:** The action item's status is updated in the database. The updated status is visible to all actors with access to the team's action items.
- **Failure:** The status is not changed. The previous status is displayed. An error is shown to the engineer.

---

## Acceptance Criteria
- [ ] An engineer can change the status of an action item they own to "open," "in progress," or "resolved."
- [ ] Status controls are only rendered for items owned by the currently authenticated engineer.
- [ ] A status change is persisted immediately and reflected in the current view.
- [ ] If the item is visible to multiple participants in a session context, the update is reflected for all participants without a page refresh.
- [ ] An engineer cannot update the status of an action item owned by another engineer — this is enforced server-side.
- [ ] If the update fails, the engineer sees an error and the displayed status reverts to its last confirmed value.

## Out of Scope
- Reassigning ownership of an action item to another engineer.
- Adding a resolution note as part of this status update flow (resolution notes are covered by a separate use case).
- Reopening a resolved action item. (Whether this is allowed is an open question — see Notes.)

## Dependencies
- Identity & Access — the application must identify the authenticated engineer and enforce ownership.
- Action Item data model — owner and status fields must be persisted.
- UC: Surface Open Action Items at Session Start (Pre-Session Action Item Review) — one primary context in which this use case occurs.

## Notes
- The application must enforce ownership server-side, not only in the UI, to prevent circumvention.
- Whether an engineer can reopen a resolved item (i.e., change status from "resolved" back to "open" or "in progress") is not specified. This should be clarified with stakeholders before implementation.
- Whether status updates are recorded with a timestamp and actor in an audit log is an open question.
- A no-op status update (setting "open" to "open") should still reset the staleness clock to reflect deliberate attention paid to the item. This assumption should be confirmed.

---

---

# Use Case: Add a Resolution Note When Marking an Item Resolved

## Summary
**Actor:** Engineer or Facilitator

**Trigger:** An actor marks an action item as "resolved" and chooses to add a brief note describing what was done.

**Goal:** As an Engineer (or Facilitator), I want to attach a resolution note to a resolved action item so that the team has a record of what was done and why the item is considered complete.

---

## Preconditions
- The actor is authenticated and has permission to update the action item: either they are the owner (Engineer) or they are the active session's facilitator.
- The action item currently has a status of "open" or "in progress."
- The actor is in a context where action item status can be updated (Pre-Session Review, Session Wrap-up, or any supported action item view).

## Main Flow
1. The actor selects "resolved" as the new status for the action item.
2. The application presents an optional resolution note field (e.g., a text input inline with the status change, or a secondary prompt).
3. The actor enters a brief description of what was done.
4. The actor confirms/saves the update.
5. The application persists the status as "resolved," records the resolution note, and records the session in which the resolution occurred (if applicable).
6. The resolved item (with its note) is visible to all actors with access to the team's action items.

## Alternate Flows
- **Actor changes status to "resolved" but leaves the resolution note blank:** The application permits this. Resolution notes are optional. The item is saved as resolved with no note.
- **Actor changes status to something other than "resolved":** The resolution note field is not shown (or is hidden/cleared), as notes are only relevant to resolved items.
- **Actor enters a resolution note but then changes the status back before saving:** The resolution note is discarded or cleared. Notes are only stored when the final saved status is "resolved."
- **Save fails due to a server error:** The application displays an error. The item's status and note are not changed. The actor can retry.

## Postconditions
- **Success:** The action item status is "resolved," the resolution note (if provided) is stored and associated with the item, and the resolving session is recorded.
- **Failure:** The action item status and note are unchanged. The actor can retry.

---

## Acceptance Criteria
- [ ] When marking an action item resolved, the actor is given the opportunity to enter a resolution note.
- [ ] A resolution note is optional — the item can be resolved without one.
- [ ] If provided, the resolution note is stored with the action item and is visible to all actors with access to the team's action items.
- [ ] The resolution note field is not presented when the actor selects a non-resolved status.
- [ ] The session in which the item was resolved is recorded alongside the resolution note.
- [ ] Resolving with a note and resolving without a note both result in the item being marked "resolved" — no behavioral difference other than the presence or absence of the note text.

## Out of Scope
- Requiring a resolution note before an item can be marked resolved. Notes are advisory, not enforced.
- Editing a resolution note after the item has been resolved. Whether post-resolution edits are allowed is an open question (see Notes).
- Adding notes to items in statuses other than "resolved."

## Dependencies
- UC: Engineer Updates Status of an Action Item They Own — this use case extends that one.
- Action Item data model — resolution note and resolving session fields must be supported.
- Identity & Access — ownership and role enforcement are required to restrict who can resolve an item.

## Notes
- The resolution note field should have a reasonable character limit. The prompt calls it "a brief note" — implementors should define the constraint (e.g., 500 characters).
- Whether a resolution note can be edited after the fact (e.g., by the owner or facilitator) is not specified. Implementors should clarify before building.
- If the resolution note is added during a session's Pre-Session Review, the note should still be associated with the item permanently — not scoped to the session view.

---

---

# Use Case: Flag a Stale Action Item

## Summary
**Actor:** Application

**Trigger:** The application evaluates open and in-progress action items when loading any view that displays them, and identifies items that have been open across multiple sessions without a status update.

**Goal:** As the Application, I want to visually indicate action items that have remained open across sessions without a status update using an incremental color scale so that the team and facilitator can gauge urgency at a glance.

---

## Preconditions
- At least one action item exists for the team with a status of "open" or "in progress."
- At least one completed session for the team has occurred after the item was created or last updated.
- The application is computing staleness as part of rendering a view that includes action items (e.g., Pre-Session Action Item Review, action item backlog).

## Main Flow
1. The application queries open and in-progress action items for the team.
2. For each item, the application computes the number of completed team sessions that have elapsed since the item was created or since its status was last changed — whichever is more recent.
3. The application assigns a staleness color to each item based on the elapsed session count:
   - **1 session elapsed:** yellow indicator
   - **2 sessions elapsed:** orange indicator
   - **3 or more sessions elapsed:** red indicator
   - **0 sessions elapsed:** no indicator (item is not stale)
4. The staleness color is included in the data returned to any view displaying these items.
5. Views that display action items render the staleness color as a visual indicator (e.g., badge, border, or row highlight) alongside the item.
6. The staleness indicator is advisory — no automated action is taken beyond the visual indicator.

## Alternate Flows
- **An item's status is updated (even to the same status):** The staleness clock resets. The item is no longer stale until another full session passes without a further update.
- **All open items were created in the most recent session:** No items qualify as stale. The view renders without any stale flags.
- **Staleness cannot be computed (e.g., session history query fails):** Items are displayed without a stale flag. The failure is logged. The view is not blocked.
- **An item is resolved during the same session it would have been flagged as stale:** Once resolved, the item is no longer in scope for staleness evaluation.

## Postconditions
- **Success:** Stale items are identified and their stale flag is available to all views that render action items.
- **Failure:** If staleness cannot be determined, items are displayed without a flag. No data is corrupted. The application logs the error.

---

## Acceptance Criteria
- [ ] An action item with 1 completed session elapsed since its last update is displayed with a yellow indicator.
- [ ] An action item with 2 completed sessions elapsed since its last update is displayed with an orange indicator.
- [ ] An action item with 3 or more completed sessions elapsed since its last update is displayed with a red indicator.
- [ ] An action item with 0 sessions elapsed (created or updated in the most recent completed session) displays no staleness indicator.
- [ ] The staleness indicator is visible to all actors who can view action items: team members, the facilitator, and the Engineering Manager.
- [ ] Updating an item's status (to any value) resets the elapsed session count, clearing the indicator.
- [ ] If staleness computation fails, items are displayed without an indicator rather than blocking the view.
- [ ] The staleness indicator is advisory only — no automated action is taken.

## Out of Scope
- Automated escalation, notification, or reassignment of stale items. Notifications are out of scope.
- Automatically resolving or closing stale items.
- Staleness thresholds that vary by team or topic. A single application-level threshold is assumed.

## Dependencies
- Action Item data model — creation session and last-updated session/timestamp must be stored.
- Session history — the application must be able to count completed sessions for the team since an item's last update.
- UC: Surface Open Action Items at Session Start (Pre-Session Action Item Review) — staleness is surfaced there.
- UC: View the Action Item Backlog — staleness is also surfaced in the backlog view.

## Notes
- The staleness color scale is: 1 session = yellow, 2 sessions = orange, 3+ sessions = red. This is a decided requirement, not a threshold to confirm.
- Setting an item to the same status it already has (a no-op status change) resets the elapsed session count, as it signals deliberate attention was paid to the item.
- The staleness level should be computed at read time from the session count, not stored as a persistent field, to avoid stale staleness data. This is an implementor recommendation.

---

---

# Use Case: View the History of a Specific Action Item

## Summary
**Actor:** Engineer, Facilitator, or Engineering Manager

**Trigger:** The actor selects an individual action item to view its full history across sessions.

**Goal:** As a [Actor], I want to see the complete history of an action item — when it was created, how its status has changed, and when and how it was resolved — so that I can understand the context and trajectory of a specific commitment.

---

## Preconditions
- The actor is authenticated.
- The actor has access to the team's action items: they are a team member, the team's Engineering Manager, or the current session's facilitator.
- The action item exists and is associated with the team.

## Main Flow
1. The actor navigates to the action item detail view (e.g., by selecting an item from the backlog or from a session history view).
2. The application retrieves the action item's full record.
3. The application renders the item detail, including:
   - Description.
   - Owner name (current or most recent, if ownership has been reassigned).
   - Current status.
   - The session in which the item was created.
   - A chronological log of status changes, each showing: new status, the session in which the change occurred, and the actor who made the change (if recorded).
   - If resolved: the session of resolution and the resolution note (if any).
   - Whether the item was flagged as stale during any session review (if tracked).
4. The actor reviews the history.

## Alternate Flows
- **The action item has never had a status update (status has been "open" since creation):** The history log shows only the creation entry. No status change entries are present.
- **The item was resolved with no resolution note:** The detail view shows the resolved status and resolving session, with an explicit indication that no note was provided (rather than a blank field).
- **The actor does not have access to this team's data:** The application denies access and returns an authorization error. The actor is not shown any information about the item.

## Postconditions
- **Success:** The actor sees the full available history for the action item. No state changes occur as a result of viewing.
- **Failure:** If the history cannot be retrieved, the application surfaces an error. The actor can retry.

---

## Acceptance Criteria
- [ ] The item detail view displays: description, owner, current status, creation session, and all recorded status changes in chronological order.
- [ ] Resolved items display the session of resolution and the resolution note (or a clear indicator that no note was provided).
- [ ] The actor who made each status change is visible in the history log (if recorded — see Notes).
- [ ] The view is accessible to engineers on the team, the Engineering Manager, and the current session's facilitator.
- [ ] The view is read-only for all actors.
- [ ] An actor without access to the team cannot retrieve item history — this is enforced server-side.

## Out of Scope
- Editing action item history or modifying past entries.
- Comparing action item histories across items or sessions in aggregate (that belongs to the Trend Dashboard).

## Dependencies
- Identity & Access — access control based on team membership and manager/team relationships.
- Action Item data model — must support recording status change history with session and actor attribution.
- Session data model — session identifiers must be resolvable to human-readable labels (e.g., session date or number).

## Notes
- Whether the actor who made each status change is recorded (i.e., whether there is an audit log on the action item) is not explicitly stated in the feature specification. Implementors should confirm this requirement, as it meaningfully affects the data model.
- The level of history granularity (every status change, or only final state per session) is a design decision that should be made before implementation.

---

---

# Use Case: Reassign an Action Item When an Owner Leaves the Team

## Summary
**Actor:** Facilitator

**Trigger:** A facilitator discovers that an open or in-progress action item is owned by an engineer who has left the team, and needs to assign it to an active team member.

**Goal:** As a Facilitator, I want to reassign an action item whose owner has left the team so that the item has an accountable owner and can be acted upon.

---

## Preconditions
- The facilitator is authenticated and recognized as the facilitator for an active session.
- An action item exists with a status of "open" or "in progress."
- The current owner of that action item is no longer an active member of the team (they have left or been removed).
- At least one active engineer remains on the team who can accept ownership.

## Main Flow
1. The facilitator views the action item list (during the Pre-Session Action Item Review or another supported view).
2. The application identifies that the item's owner is no longer an active team member and renders the item with a visual indicator (e.g., "Owner has left the team").
3. The facilitator selects the option to reassign the item.
4. The application presents a selector populated with active engineers on the team.
5. The facilitator selects a new owner.
6. The application persists the ownership change, recording the prior owner and the session in which the reassignment occurred.
7. The item is updated in all views to reflect the new owner.

## Alternate Flows
- **No active engineers remain on the team:** The owner selector is empty. The facilitator cannot complete the reassignment. The application surfaces an error state. The item remains in limbo with the former owner until team membership is resolved.
- **The facilitator reassigns a resolved item:** Reassignment applies only to open or in-progress items. Resolved items retain their historical owner for the record and cannot be reassigned (the assignment would have no operational effect).
- **Reassignment fails due to a server error:** The application displays an error. Ownership is unchanged. The facilitator can retry.
- **The former owner is removed from the team but their items were already resolved:** No action is required. Resolved items are historical records and retain the original owner attribution.

## Postconditions
- **Success:** The action item has a new, active owner. The prior owner and reassignment session are recorded in the item's history. The item appears under the new owner's name in all views.
- **Failure:** Ownership is unchanged. The item may remain without an active owner until the facilitator retries or team membership is resolved.

---

## Acceptance Criteria
- [ ] The application visually distinguishes action items whose owner is no longer an active team member.
- [ ] The facilitator can reassign any open or in-progress item whose owner has left the team.
- [ ] The reassignment owner selector is populated only with currently active engineers on the team.
- [ ] The prior owner and the session of reassignment are recorded in the item's history.
- [ ] Resolved items cannot be reassigned.
- [ ] If no active engineers are available, the facilitator is shown an error and reassignment is blocked until the team membership issue is resolved.
- [ ] Reassignment is enforced server-side — only a facilitator can perform this action.

## Out of Scope
- Engineers reassigning items they own to other engineers (ownership transfer is not a self-service action for engineers).
- The Engineering Manager reassigning items (Engineering Manager access is read-only).
- Automatically reassigning items when a team member leaves (no automated actions are taken by the application; a facilitator must act).
- Defining what "leaving the team" means in the application (this depends on the Identity & Access / team membership model).

## Dependencies
- Identity & Access / Team Membership — the application must be able to determine that an engineer is no longer an active team member.
- UC: View the History of a Specific Action Item — the reassignment event should appear in the item's history.
- Action Item data model — must support recording ownership changes with prior owner and session.
- Session state — reassignment should occur within the context of a session the facilitator is leading.

## Notes
- "Leaving the team" must be defined in the team membership model. It may mean the user's team membership record is deactivated, they are removed from the team, or they are marked inactive. This definition is owned by the Identity & Access feature set.
- Whether items belonging to a departed owner are automatically surfaced to the facilitator (e.g., filtered or highlighted) at session start is a UX decision. This use case assumes the facilitator identifies them, possibly aided by a visual indicator.
- Open question: can a facilitator reassign an item to themselves? The facilitator is from a different team and is not typically an action item owner — the owner selector should draw from the facilitated team's active engineers, not the facilitator.
- Whether the former owner retains any visibility into items they previously owned after leaving the team is an access control question to be resolved in Identity & Access.

---
