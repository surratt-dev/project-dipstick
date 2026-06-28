# Feature Set 5: Session Notes & Action Items

This document contains use cases for the Session Notes & Action Items feature of the Engineering Health Check Application.

---

# Use Case: Add Session Notes During Topic Discussion

## Summary
**Actor:** Participant (Team Member)

**Trigger:** Participant clicks on the notes input field for the current discussion topic

**Goal:** As a Participant, I want to add notes during a topic discussion so that important context, observations, or discussion points are captured for future reference.

---

## Preconditions
- User is authenticated and authorized as a Participant
- User has joined an active Health Check session
- The session is currently on a topic that supports notes (all topics)
- Real-time connection to the session is established

## Main Flow
1. Participant navigates to the current topic in the session interface
2. Participant clicks on the notes input area for the topic
3. Participant types their note content (text up to 5000 characters)
4. Participant clicks "Save Note" or presses Ctrl+Enter
5. System validates the note content (non-empty, within character limit)
6. System associates the note with the current topic and participant
7. System synchronizes the new note to all connected session participants in real-time
8. System displays a confirmation indicator that the note was saved
9. Participant's avatar/name appears next to the saved note as the author

## Alternate Flows
- **If participant loses connection:** System queues the note locally and retries saving when connection is restored
- **If note is empty:** System displays validation error and prevents save
- **If character limit exceeded:** System truncates and shows warning, or prevents save depending on implementation

## Postconditions
- **Success:** Note is persisted to the database, associated with the topic, and visible to all session participants in real-time
- **Failure:** Note is not saved; user receives error message; no partial data is stored

---

## Acceptance Criteria
- [ ] Participant can add text notes to any active topic during a session
- [ ] Notes appear in real-time for all connected participants viewing the same topic
- [ ] Each note displays the author's name and timestamp
- [ ] Notes are limited to 5000 characters with clear feedback when approaching limit
- [ ] Notes persist after the session ends and are viewable in session history

## Out of Scope
- Rich text formatting (bold, italic, lists) in notes - plain text only
- Attaching files or images to notes
- Editing or deleting notes after submission

## Dependencies
- Real-time synchronization service (UC-XXX)
- Session management (UC-XXX)
- Authentication and authorization (UC-XXX)

## Notes
- Notes should be visible to all participants in the session, not just the author
- The Facilitator should be able to see all notes to guide discussion
- Consider implementing a "pin" feature for important notes (future enhancement)

---

# Use Case: Facilitator Adds Session Notes

## Summary
**Actor:** Facilitator

**Trigger:** Facilitator clicks on the notes input field for the current discussion topic

**Goal:** As a Facilitator, I want to add notes during a topic discussion so that I can capture key discussion points, decisions, and context for the team's session history.

---

## Preconditions
- User is authenticated and authorized as a Facilitator
- Facilitator has created or been assigned to an active Health Check session
- The session is currently on a topic that supports notes
- Real-time connection to the session is established

## Main Flow
1. Facilitator navigates to the current topic in the session interface
2. Facilitator clicks on the notes input area for the topic (distinguished visually from participant notes)
3. Facilitator types their note content
4. Facilitator clicks "Save Note" or presses Ctrl+Enter
5. System validates the note content
6. System associates the note with the current topic and marks it as facilitator-authored
7. System synchronizes the new note to all connected session participants in real-time
8. System displays the note with a facilitator badge/indicator

## Alternate Flows
- **If session is not active:** System displays message "Session is not active; notes cannot be added"
- **If user is no longer facilitator for this session:** System denies access and redirects

## Postconditions
- **Success:** Note is persisted with facilitator attribution and visible to all participants
- **Failure:** Error displayed; note not saved

---

## Acceptance Criteria
- [ ] Facilitator can add notes to any topic during an active session
- [ ] Facilitator notes are visually distinguished from participant notes
- [ ] Facilitator notes appear in real-time for all participants
- [ ] All session notes (facilitator and participant) are retained in session history

## Out of Scope
- Editing or deleting participant notes (only facilitator's own notes)

## Dependencies
- Use Case: Add Session Notes During Topic Discussion
- Role-based access control for Facilitator

## Notes
- Facilitator notes should be clearly identifiable to participants
- Consider allowing Facilitator to pin participant notes as important

---

# Use Case: Create Action Item from Discussion

## Summary
**Actor:** Facilitator

**Trigger:** During or after topic discussion, Facilitator clicks "Create Action Item" button

**Goal:** As a Facilitator, I want to create action items from discussion points so that there is clear accountability for follow-up work identified during the Health Check session.

---

## Preconditions
- User is authenticated and authorized as a Facilitator
- Facilitator is leading an active or recently concluded Health Check session
- A discussion topic has been covered (or is currently being discussed)
- Real-time connection to the session is established (for active sessions)

## Main Flow
1. Facilitator clicks "Create Action Item" button in the topic context or action items panel
2. System displays action item creation form with fields:
   - Description (required, text, max 1000 characters)
   - Owner (required, dropdown or search of session participants)
   - Due Date (required, date picker, must be future date)
   - Topic Association (auto-populated if created from topic context)
3. Facilitator fills in the action item details
4. Facilitator clicks "Create" to submit
5. System validates all required fields:
   - Description is not empty
   - Owner is selected from valid participants
   - Due date is a future date
6. System creates the action item with status "Open"
7. System associates the action item with the session and topic
8. System notifies the assigned owner (via in-app notification and optional email)
9. System displays confirmation and adds the action item to the session's action items list
10. System synchronizes the new action item to all connected participants in real-time

## Alternate Flows
- **If required fields are missing:** System displays validation errors for each missing field
- **If due date is in the past:** System displays error "Due date must be in the future"
- **If selected owner is not a valid participant:** System displays error and prevents creation
- **If session is archived:** System displays error "Cannot create action items for archived sessions"

## Postconditions
- **Success:** Action item is created, persisted, assigned to owner, and visible to all session participants
- **Failure:** Action item is not created; user receives specific error messages

---

## Acceptance Criteria
- [ ] Facilitator can create action items with description, owner, and due date
- [ ] Due date must be a future date (minimum tomorrow)
- [ ] Owner must be a valid session participant
- [ ] New action items appear in real-time for all connected participants
- [ ] Action item owner receives notification of assignment
- [ ] Action items are associated with the correct session and topic

## Out of Scope
- Editing action items after creation (future enhancement)
- Deleting action items
- Recurring action items
- Action item dependencies or subtasks

## Dependencies
- Participant directory/selection (UC-XXX)
- Notification system (UC-XXX)
- Session management (UC-XXX)

## Notes
- Action items should be create-able during active session or within 24 hours after session concludes
- Consider providing templates for common action item types (e.g., "Investigate", "Research", "Implement")

---

# Use Case: View Session Notes and Action Items

## Summary
**Actor:** Engineering Manager

**Trigger:** Engineering Manager navigates to a concluded session's details page

**Goal:** As an Engineering Manager, I want to view session notes and action items after a session concludes so that I can understand what was discussed and what follow-up work was identified.

---

## Preconditions
- User is authenticated and authorized as an Engineering Manager
- User has management responsibility for the team that owns the session
- The session has concluded (status is "Concluded" or "Archived")
- Session is associated with a team the Engineering Manager manages

## Main Flow
1. Engineering Manager navigates to the Sessions list
2. Engineering Manager filters or selects a concluded session for their team
3. Engineering Manager clicks on the session to view details
4. System displays session summary including:
   - Session date, duration, facilitator, participants
   - Topic-by-topic breakdown with voting results
   - All notes organized by topic
   - All action items with status, owner, and due date
5. Engineering Manager can expand each topic to see full notes
6. Engineering Manager can filter action items by status (All, Open, In Progress, Completed)
7. System displays the requested information

## Alternate Flows
- **If user is not authorized for this team's sessions:** System denies access with appropriate message
- **If session is still active:** System redirects to live session view (or shows "Session in progress" message)
- **If no sessions exist for user's teams:** System displays empty state with helpful message

## Postconditions
- **Success:** Engineering Manager can view all notes and action items for the selected session
- **Failure:** Access denied or session not found; appropriate error displayed

---

## Acceptance Criteria
- [ ] Engineering Manager can view all notes from a concluded session, organized by topic
- [ ] Engineering Manager can view all action items with their current status
- [ ] Engineering Manager can filter action items by status
- [ ] Notes display author information and timestamps
- [ ] Action items display owner, due date, and status
- [ ] Engineering Manager can only view sessions for teams they manage

## Out of Scope
- Editing notes or action items (Engineering Manager has read-only access)
- Viewing notes from sessions for teams they don't manage

## Dependencies
- Session access control (UC-XXX)
- Authentication and role-based authorization (UC-XXX)

## Notes
- Engineering Manager should NOT be able to edit or modify notes or action items
- Consider showing trend data comparing action items across multiple sessions

---

# Use Case: Update Action Item Status

## Summary
**Actor:** Participant (Team Member)

**Trigger:** Participant clicks on an action item assigned to them and changes its status

**Goal:** As a Participant, I want to update the status of action items assigned to me so that the team has visibility into progress on follow-up work.

---

## Preconditions
- User is authenticated and authorized as a Participant
- User has action items assigned to them from Health Check sessions
- User is viewing the Action Items dashboard or session details
- Real-time connection is established (for seeing updates from others)

## Main Flow
1. Participant navigates to their assigned action items (personal dashboard or session view)
2. Participant locates the action item they want to update
3. Participant clicks on the action item to expand details
4. Participant clicks on the status dropdown/selector
5. Participant selects new status from available options:
   - Open → In Progress
   - In Progress → Completed
   - Can reopen completed items back to Open or In Progress
6. System validates the status transition is allowed
7. System updates the action item status
8. System records the status change with timestamp and actor
9. System synchronizes the update to all connected users viewing the action item
10. System displays confirmation and updated status

## Alternate Flows
- **If user is not the owner:** System displays the status as read-only with message "Only the owner can update status"
- **If action item is overdue:** System shows warning indicator but allows status update
- **If system encounters error:** System reverts to previous status and displays error

## Postconditions
- **Success:** Action item status is updated, persisted, and synchronized to all viewers
- **Failure:** Status remains unchanged; error message displayed

---

## Acceptance Criteria
- [ ] Participant can update status of action items they own
- [ ] Status options include: Open, In Progress, Completed
- [ ] Status changes appear in real-time to other users viewing the action item
- [ ] Status history is maintained (who changed status and when)
- [ ] Participants cannot update status of action items they don't own
- [ ] System validates status transitions are valid

## Out of Scope
- Changing the owner of an action item (Facilitator only)
- Changing description or due date after creation

## Dependencies
- Action item creation (UC-XXX)
- Real-time synchronization (UC-XXX)

## Notes
- Consider adding optional "status comment" when changing status (e.g., "Completed - deployed fix to production")
- Overdue action items should be visually highlighted

---

# Use Case: Review Action Items in Dashboard

## Summary
**Actor:** Engineering Manager

**Trigger:** Engineering Manager navigates to the Action Items dashboard

**Goal:** As an Engineering Manager, I want to review all action items across my team's sessions in a dashboard view so that I can track progress and ensure follow-up work is being completed.

---

## Preconditions
- User is authenticated and authorized as an Engineering Manager
- User has one or more teams assigned to them

## Main Flow
1. Engineering Manager clicks on "Action Items" in the main navigation
2. System displays dashboard with all action items from all sessions for managed teams
3. Dashboard shows:
   - Total action items count by status
   - List/table of action items with columns: Description, Session, Topic, Owner, Due Date, Status
   - Filtering options: By team, by status, by owner, by date range
   - Sorting options: By due date, by status, by creation date
4. Engineering Manager applies filters to narrow the view
5. System updates the displayed action items based on filters
6. Engineering Manager can click on any action item to view full details and history
7. System displays the action item detail view with:
   - Full description
   - Session and topic association
   - Owner and due date
   - Status history (all changes with timestamps)
   - Link to the original session

## Alternate Flows
- **If user has no managed teams:** System displays empty state with message
- **If no action items exist:** System displays empty state with encouraging message
- **If filters return no results:** System displays "No action items match your filters" message

## Postconditions
- **Success:** Engineering Manager can view and analyze all action items across their teams
- **Failure:** Error message displayed; partial data may be shown

---

## Acceptance Criteria
- [ ] Dashboard displays all action items from all sessions for teams the Engineering Manager manages
- [ ] Action items can be filtered by team, status, owner, and date range
- [ ] Action items can be sorted by due date, status, and creation date
- [ ] Overdue action items are visually highlighted
- [ ] Clicking an action item shows full details and status history
- [ ] Summary statistics show counts by status (Open, In Progress, Completed)
- [ ] Engineering Manager can only see action items for teams they manage

## Out of Scope
- Editing or modifying action items (Engineering Manager has review-only access)
- Creating new action items from dashboard
- Bulk status updates

## Dependencies
- Action item creation (UC-XXX)
- Status updates (UC-XXX)
- Team/user management (UC-XXX)

## Notes
- Consider adding visual indicators for action items nearing due date (e.g., due in 3 days)
- Consider showing completion rate trends over time
- Dashboard should support both list view and board/Kanban view

---

# Use Case: Action Item Review Workflow

## Summary
**Actor:** Facilitator

**Trigger:** Facilitator initiates review of action items from a previous session

**Goal:** As a Facilitator, I want to review action items with the team in a subsequent session so that we can discuss progress, identify blockers, and update status accordingly.

---

## Preconditions
- User is authenticated and authorized as a Facilitator
- Facilitator has an upcoming or active session with a team that has prior action items
- At least one prior session has open or in-progress action items

## Main Flow
1. Facilitator creates or joins a new session for a team
2. System automatically identifies open action items from previous sessions for this team
3. System displays "Prior Action Items" section in the session preparation view
4. Facilitator reviews the list of prior action items
5. Facilitator can add prior action items to the session agenda for discussion
6. During the session, Facilitator presents each action item:
   - Owner provides update on progress
   - Team discusses any blockers
   - Facilitator may update status based on discussion:
     - Mark as Completed if work is done
     - Keep as In Progress if work is ongoing
     - Reassign to different owner if original owner cannot complete
     - Update due date if timeline has changed
7. Facilitator makes necessary updates through the action item detail panel
8. System records all status changes and comments
9. System synchronizes updates to all participants in real-time

## Alternate Flows
- **If owner is not in current session:** Facilitator can still update status based on out-of-band communication
- **If action item is no longer relevant:** Facilitator can mark as "Won't Do" or "Cancelled" (future enhancement)
- **If new information requires action item modification:** Facilitator updates description or due date (if enabled)

## Postconditions
- **Success:** Action items are reviewed, status updated as needed, and changes persisted
- **Failure:** Error prevents updates; prior state maintained

---

## Acceptance Criteria
- [ ] Facilitator can see all open action items from prior sessions when preparing a new session
- [ ] Facilitator can add prior action items to the session agenda
- [ ] During session, Facilitator can update status of any prior action item
- [ ] Status updates are synchronized in real-time to all participants
- [ ] Status change history is preserved
- [ ] Action items can be reassigned to different owners during review
- [ ] Due dates can be extended during review if needed

## Out of Scope
- Facilitator editing action item descriptions (unless specifically enabled)
- Cancelling or marking action items as "won't do"
- Automated reminders (handled by notification system)

## Dependencies
- Action item creation (UC-XXX)
- Status updates (UC-XXX)
- Session management (UC-XXX)
- Real-time synchronization (UC-XXX)

## Notes
- Facilitator should come prepared with context on each action item's origin
- Consider showing original session date and topic for context
- This workflow is critical for ensuring accountability in the Health Check process

---

# Use Case: View My Action Items

## Summary
<parameter name="Actor">Participant (Team Member)

**Trigger:** Participant navigates to their personal action items view

**Goal:** As a Participant, I want to view all action items assigned to me across all sessions so that I can track what I need to complete.

---

## Preconditions
- User is authenticated and authorized as a Participant
- User has been assigned action items in one or more Health Check sessions

## Main Flow
1. Participant clicks on "My Action Items" in the navigation or their profile
2. System retrieves all action items where the user is the owner
3. System displays a list of action items grouped by status:
   - Overdue (past due date, not completed)
   - Due Soon (within 3 days)
   - Open
   - In Progress
   - Completed
4. For each action item, system displays:
   - Description (truncated with expansion)
   - Session name and date
   - Topic
   - Due date
   - Current status
5. Participant can filter by status or search by description
6. Participant can click on any action item to view full details
7. Participant can update status directly from this view

## Alternate Flows
- **If user has no action items:** System displays empty state with message "No action items assigned"
- **If session data is unavailable:** System shows partial data with warning

## Postconditions
- **Success:** Participant can view all their assigned action items with full details
- **Failure:** Error displayed; no data shown

---

## Acceptance Criteria
- [ ] Participant can view all action items assigned to them
- [ ] Action items are grouped/filtered by status
- [ ] Overdue items are prominently highlighted
- [ ] Each action item shows session context and due date
- [ ] Participant can update status directly from this view
- [ ] List updates in real-time when other users make changes

## Out of Scope
- Viewing action items assigned to others
- Aggregated team views (Engineering Manager feature)

## Dependencies
- Action item creation (UC-XXX)
- Status updates (UC-XXX)

## Notes
- This is a personal dashboard; privacy is important - participants only see their own items
- Consider showing completion statistics (e.g., "You've completed 8 of 12 action items")

---

# Use Case: System Persists Session Notes and Action Items

## Summary
**Actor:** System (Application)

**Trigger:** Any create, update, or delete operation on notes or action items

**Goal:** As the System, I want to persist all notes and action items with proper data integrity so that they are available for future retrieval and analysis.

---

## Preconditions
- Database is accessible
- User authentication token is valid
- User is authorized for the operation being performed

## Main Flow
1. User initiates an operation (create/update note or action item)
2. System validates user authorization for this operation
3. System validates data according to business rules
4. System begins database transaction
5. System creates/updates the record with:
   - Unique identifier
   - All required fields
   - Timestamps (created_at, updated_at)
   - User references (created_by, owned_by)
   - Session and topic associations
6. System commits the transaction
7. System returns success confirmation to user
8. System triggers real-time broadcast to relevant connected clients

## Alternate Flows
- **If database is unavailable:** System returns error; operation not persisted
- **If transaction fails:** System rolls back; no partial data stored
- **If validation fails:** System returns specific validation errors
- **If authorization fails:** System returns 403 Forbidden

## Postconditions
- **Success:** Data is persisted to database; synchronization triggered
- **Failure:** No data persisted; error returned to user

---

## Acceptance Criteria
- [ ] All notes and action items are stored in the database with complete data
- [ ] Timestamps are automatically captured for audit trail
- [ ] User references are properly stored
- [ ] Data is available for retrieval after successful commit
- [ ] Failed operations do not leave partial data
- [ ] Database transactions maintain data integrity

## Out of Scope
- Manual data export/import (future enhancement)
- Data archival and retention policies

## Dependencies
- Database infrastructure
- Authentication service
- Authorization service

## Notes
- Consider implementing soft-delete for notes and action items (for audit purposes)
- All CRUD operations should be logged for security auditing
