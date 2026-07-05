# Feature Set 9: Facilitator Tools

---

# Use Case: Track Participant Readiness

## Summary
**Actor:** Facilitator

**Trigger:** Session is in "pending" state and participants have joined

**Goal:** As a Facilitator, I want to track participant readiness so that I know when to start the session.

---

## Preconditions
- User is authenticated as Facilitator
- Session is in "pending" state
- At least one participant has joined the session

## Main Flow
1. Facilitator is on the session management view
2. System displays participant list with readiness status indicators
3. Each participant who has joined shows as "Ready" or "Not Ready"
4. Participants can click "I'm Ready" button to indicate preparedness
5. System updates participant status in real-time
6. Facilitator can see a count: "3 of 5 participants ready"
7. Facilitator can send reminder notifications to not-ready participants
8. Facilitator can start session even if not all participants are ready

## Alternate Flows
- **Participant leaves:** System updates readiness count accordingly
- **Participant disconnects:** System marks as "disconnected" with unknown readiness
- **Session already started:** Readiness tracking is disabled; all participants are assumed active
- **No participants joined:** System displays "Waiting for participants..."

## Postconditions
- **Success:** Facilitator can see real-time readiness status of all participants
- **Failure:** Static list displayed; real-time updates unavailable

## Acceptance Criteria
- [ ] Participant list shows readiness status for each participant
- [ ] Status updates within 2 seconds of participant action
- [ ] Ready count / total count is displayed
- [ ] Facilitator can send reminder notifications
- [ ] Visual distinction between ready and not-ready participants
- [ ] Disconnected participants are clearly marked

## Out of Scope
- Automatic session start when all ready (Facilitator controls start)
- Participant-to-participant readiness visibility

## Dependencies
- Real-time WebSocket synchronization
- Session participant data
- Notification service for reminders

## Notes
- Consider color-coding: green = ready, gray = not ready, yellow = disconnected
- "I'm Ready" button should have a debounce to prevent accidental clicks
- Facilitator should see which participants have been ready the longest

---

# Use Case: View Participant Voting Progress

## Summary
**Actor:** Facilitator

**Trigger:** Session is active and voting is open for current topic

**Goal:** As a Facilitator, I want to view participant voting progress so that I can gauge when to advance to the next topic.

---

## Preconditions
- User is authenticated as Facilitator
- Session is in "active" state
- Current topic has voting enabled

## Main Flow
1. Facilitator is on the active session view
2. System displays voting progress panel
3. Panel shows: "3 of 5 participants have voted"
4. Facilitator can see which participants have completed voting (anonymized indicator)
5. Facilitator can view live vote distribution as participants vote (aggregate only, not individual votes)
6. Facilitator can see average score for current topic updating in real-time
7. Facilitator can see outlier votes highlighted (if configured)

## Alternate Flows
- **All participants voted:** System shows "All participants have voted" indicator
- **No votes yet:** System shows "Waiting for votes..."
- **Participant disconnects mid-vote:** System marks as "incomplete" after timeout
- **Voting closed:** System locks progress display

## Postconditions
- **Success:** Facilitator has accurate view of voting completion status
- **Failure:** Static snapshot displayed; no real-time updates

## Acceptance Criteria
- [ ] Vote count / total count is clearly displayed
- [ ] Progress updates in real-time as votes are cast
- [ ] Aggregate vote distribution is visible (histogram or percentages)
- [ ] Average score is displayed and updates live
- [ ] Outlier indicators work correctly
- [ ] Facilitator cannot see individual participant votes

## Out of Scope
- Individual vote disclosure to other participants
- Detailed vote analytics (post-session only)

## Dependencies
- Real-time voting synchronization
- Session state management
- Aggregate calculation service

## Notes
- Consider showing a simple progress bar in addition to numbers
- Outlier detection threshold should be configurable
- Facilitator should see completion percentage for pacing decisions

---

# Use Case: Configure Voting Countdown Timer

## Summary
**Actor:** Facilitator

**Trigger:** Facilitator accesses session settings before or during session

**Goal:** As a Facilitator, I want to configure voting countdown controls so that I can manage session pacing effectively.

---

## Preconditions
- User is authenticated as Facilitator
- Session exists (in pending or active state)

## Main Flow
1. Facilitator navigates to session settings or timer controls
2. System displays timer configuration options:
   - Enable/disable timer per topic
   - Set default time per topic (e.g., 60 seconds, 2 minutes)
   - Set minimum time before early advance allowed
   - Enable/disable auto-advance when timer expires
   - Set warning threshold (e.g., "10 seconds remaining" alert)
3. Facilitator configures desired timer settings
4. Facilitator can also set custom time for specific topics
5. Facilitator clicks "Save" or applies settings
6. System persists timer configuration
7. System confirms success with notification

## Alternate Flows
- **Session active with participants voting:** System warns that timer changes will apply immediately
- **Invalid time value:** System displays validation error
- **Topic already in progress:** System offers to apply to next topic only

## Postconditions
- **Success:** Timer configuration is saved and will apply to voting sessions
- **Failure:** Error displayed; previous settings retained

## Acceptance Criteria
- [ ] Timer can be enabled/disabled per topic
- [ ] Default time is configurable
- [ ] Minimum time threshold works correctly
- [ ] Auto-advance setting functions properly
- [ ] Warning alerts appear at configured threshold
- [ ] Custom times can be set for specific topics

## Out of Scope
- Timer visualization design (handled in UI use case)
- Automatic pause/resume based on activity

## Dependencies
- Session settings persistence
- Timer service integration

## Notes
- Sensible defaults: 90 seconds per topic, 30 second warning, no auto-advance
- Consider providing preset timer templates (quick, standard, relaxed)
- Document timer behavior for Facilitators

---

# Use Case: Control Voting Countdown During Session

## Summary
**Actor:** Facilitator

**Trigger:** Session is active, voting is open, and timer is enabled

**Goal:** As a Facilitator, I want to control the voting countdown timer during a session so that I can manage the pacing of discussions.

---

## Preconditions
- User is authenticated as Facilitator
- Session is in "active" state
- Timer has been configured and enabled for current topic

## Main Flow
1. Facilitator sees countdown timer displayed prominently
2. Timer counts down from configured duration
3. System displays warning at configured threshold (e.g., 10 seconds)
4. Facilitator can click "Pause Timer" to temporarily stop countdown
5. Facilitator can click "Resume Timer" to continue countdown
6. Facilitator can click "Add Time" to extend the timer (e.g., +30 seconds)
7. Facilitator can click "Skip Timer" to end voting early
8. System updates all participants with timer status changes
9. When timer reaches zero:
   - If auto-advance enabled: System automatically advances topic
   - If auto-advance disabled: System shows "Time's up" and keeps voting open

## Alternate Flows
- **All participants vote before timer ends:** System continues countdown; Facilitator can advance early
- **No participants have voted:** System warns Facilitator before auto-advance
- **Facilitator pauses during vote:** Participants see timer as paused
- **Timer expires with auto-advance off:** Voting remains open until Facilitator advances

## Postconditions
- **Success:** Timer functions according to Facilitator controls
- **Failure:** Timer continues independently; Facilitator can still advance manually

## Acceptance Criteria
- [ ] Timer displays and counts down correctly
- [ ] Pause/resume works and syncs to participants
- [ ] Add time extends countdown properly
- [ ] Skip timer ends countdown immediately
- [ ] Warning appears at configured threshold
- [ ] Auto-advance triggers correctly when enabled

## Out of Scope
- Participant-initiated timer requests
- Timer behavior when Facilitator disconnects

## Dependencies
- Real-time timer synchronization
- Session state management
- WebSocket broadcast service

## Notes
- Consider audio/visual alert when timer reaches zero
- Facilitator should always have manual override capability
- Timer state should persist if Facilitator navigates away and returns

---

# Use Case: Create Session Note

## Summary
**Actor:** Facilitator

**Trigger:** Facilitator clicks "Add Note" during active session

**Goal:** As a Facilitator, I want to create session notes so that I can capture important discussion points and context.

---

## Preconditions
- User is authenticated as Facilitator
- Session exists and is in "active" or "concluded" state
- User has permission to add notes to this session

## Main Flow
1. Facilitator clicks "Add Note" button during session
2. System displays note input interface:
   - Text input field (rich text optional)
   - Topic association dropdown (optional)
   - Timestamp (auto-populated, editable)
   - Category/tag selection (optional)
3. Facilitator enters note content
4. Facilitator optionally associates note with current topic
5. Facilitator clicks "Save Note"
6. System validates note content (not empty, within length limits)
7. System persists note to session record
8. System confirms success with notification
9. Note appears in session notes panel with timestamp

## Alternate Flows
- **Empty note:** System displays validation error "Note cannot be empty"
- **Note too long:** System warns or truncates based on configuration
- **Session concluded:** Notes can still be added (appended)
- **Network error:** System retries; shows error if persistent

## Postconditions
- **Success:** Note is saved and visible in session notes
- **Failure:** Error displayed; note not saved

## Acceptance Criteria
- [ ] Note text can be entered in input field
- [ ] Note is associated with correct session
- [ ] Note timestamp is recorded automatically
- [ ] Topic association works correctly
- [ ] Note appears in notes list immediately after save
- [ ] Note persists after page reload

## Out of Scope
- Note editing after save (separate use case)
- Note sharing with participants during session

## Dependencies
- Session data persistence
- Note data model

## Notes
- Consider allowing formatting (bold, bullet points)
- Notes should be editable within a grace period (e.g., 5 minutes)
- Maximum note length: 2000 characters

---

# Use Case: View Session Notes

## Summary
**Actor:** Facilitator, Participant

**Trigger:** User navigates to session notes panel

**Goal:** As a Facilitator or Participant, I want to view session notes so that I can review important discussion points.

---

## Preconditions
- User is authenticated with appropriate role
- Session exists (in any state)
- User has permission to view notes for this session

## Main Flow
1. User clicks "Notes" tab or panel in session view
2. System retrieves notes for the session from database
3. System displays notes in chronological order (newest first or oldest first, configurable)
4. Each note displays:
   - Note content
   - Timestamp
   - Author name (Facilitator name)
   - Associated topic (if applicable)
5. User can filter notes by topic using dropdown
6. User can search notes using text search

## Alternate Flows
- **No notes yet:** System displays "No notes have been added"
- **Session not found:** User redirected to appropriate page
- **Permission denied:** System displays access denied message
- **Empty filter results:** System displays "No notes match the filter"

## Postconditions
- **Success:** Notes are displayed to authorized user
- **Failure:** Appropriate error or empty state displayed

## Acceptance Criteria
- [ ] All session notes are retrieved and displayed
- [ ] Notes display timestamp and author
- [ ] Topic association is visible
- [ ] Filtering by topic works correctly
- [ ] Text search returns relevant results
- [ ] Notes display in correct sort order

## Out of Scope
- Note editing (separate use case)
- Note export functionality

## Dependencies
- Session data persistence
- Note data retrieval

## Notes
- Consider pagination for sessions with many notes
- Participant view may be limited to notes from concluded sessions only

---

# Use Case: Edit Session Note

## Summary
**Actor:** Facilitator

**Trigger:** Facilitator clicks "Edit" on an existing note

**Goal:** As a Facilitator, I want to edit a session note so that I can correct or update information.

---

## Preconditions
- User is authenticated as Facilitator
- Session exists and note exists
- Note is within edit grace period (e.g., 5 minutes from creation)

## Main Flow
1. Facilitator views session notes panel
2. Facilitator clicks "Edit" button on a note
3. System displays note in editable text field with current content
4. Facilitator modifies the note content
5. Facilitator clicks "Save Changes"
6. System validates the changes
7. System updates the note record
8. System displays updated note with "edited" indicator
9. System confirms success with notification

## Alternate Flows
- **Grace period expired:** System disables edit; displays "Notes can only be edited within 5 minutes of creation"
- **Empty note:** System displays validation error
- **Concurrent edit:** System warns of conflicts; allows force save

## Postconditions
- **Success:** Note is updated; displays edit timestamp
- **Failure:** Error displayed; note unchanged

## Acceptance Criteria
- [ ] Edit button is visible on notes within grace period
- [ ] Note content is editable
- [ ] Changes are persisted after save
- [ ] Edit timestamp is recorded
- [ ] "Edited" indicator is displayed
- [ ] Edit fails gracefully outside grace period

## Out of Scope
- Deleting notes (separate use case)
- Note version history

## Dependencies
- Session data persistence
- Note edit validation

## Notes
- Consider showing original note content on hover/toggle
- Track editor identity for audit purposes

---

# Use Case: Delete Session Note

## Summary
**Actor:** Facilitator

**Trigger:** Facilitator clicks "Delete" on an existing note

**Goal:** As a Facilitator, I want to delete a session note so that I can remove irrelevant or incorrect notes.

---

## Preconditions
- User is authenticated as Facilitator
- Session exists and note exists

## Main Flow
1. Facilitator views session notes panel
2. Facilitator clicks "Delete" button on a note
3. System displays confirmation dialog: "Delete this note? This action cannot be undone."
4. Facilitator confirms deletion
5. System removes note from database
6. System updates notes list
7. System confirms success with notification

## Alternate Flows
- **Cancel delete:** Facilitator clicks "Cancel"; note remains
- **Session concluded:** System allows deletion but logs the action
- **Network error:** System retries; shows error if persistent

## Postconditions
- **Success:** Note is permanently deleted
- **Failure:** Error displayed; note remains

## Acceptance Criteria
- [ ] Delete button is visible on notes
- [ ] Confirmation dialog appears before deletion
- [ ] Note is removed from database
- [ ] Note no longer appears in notes list
- [ ] Deletion is logged for audit

## Out of Scope
- Soft delete / archive functionality
- Note recovery

## Dependencies
- Session data persistence
- Audit logging

## Notes
- Consider limiting deletion to notes created by same Facilitator
- Log who deleted what and when

---

# Use Case: Manage Session Asynchronously

## Summary
**Actor:** Facilitator

**Trigger:** Facilitator needs to prepare or follow up on a session outside of live session time

**Goal:** As a Facilitator, I want to manage session details asynchronously so that I can prepare topics and review notes.

---

## Preconditions
- User is authenticated as Facilitator
- User has permission to manage the session

## Main Flow
1. Facilitator navigates to session management list
2. Facilitator selects a session (pending, active, or concluded)
3. System displays session detail view:
   - Session summary (team, date, status)
   - Participant list (for concluded sessions)
   - Topic list with results
   - Notes section
   - Action items section
4. Facilitator can:
   - Edit session details (for pending sessions)
   - Add/modify topics (for pending sessions)
   - Review and edit notes
   - Create action items (for concluded sessions)
   - Export session report

## Alternate Flows
- **Session active:** Facilitator can rejoin the live session from this view
- **No permission:** System displays access denied
- **Session not found:** System shows error

## Postconditions
- **Success:** Facilitator can view and modify session as permitted
- **Failure:** Appropriate error displayed

## Acceptance Criteria
- [ ] Session details are displayed correctly
- [ ] Pending sessions show edit options
- [ ] Concluded sessions show full results
- [ ] Facilitator can return to live session if active
- [ ] Export functionality works

## Out of Scope
- Real-time participation
- Concurrent session management (one at a time)

## Dependencies
- Session data retrieval
- Role-based access control

## Notes
- Consider showing session history timeline
- Facilitators can manage multiple sessions from this view

---

# Use Case: Monitor Participant Engagement

## Summary
**Actor:** Facilitator

**Trigger:** Session is active and facilitator wants to gauge engagement

**Goal:** As a Facilitator, I want to monitor participant engagement so that I can ensure productive participation.

---

## Preconditions
- User is authenticated as Facilitator
- Session is in "active" state

## Main Flow
1. Facilitator views the active session dashboard
2. System displays engagement indicators:
   - Active participant count (connected and responsive)
   - Idle participant count (connected but inactive)
   - Disconnected participant count
   - Last activity timestamp per participant
3. Facilitator can see who may be disengaged
4. Facilitator can send engagement reminder to all or specific participants
5. Facilitator can note disengagement for session follow-up

## Alternate Flows
- **All participants active:** System shows green indicators
- **Multiple disconnected:** System shows warning
- **Session concluded:** Engagement metrics are saved as session analytics

## Postconditions
- **Success:** Facilitator has visibility into participant engagement levels
- **Failure:** Static snapshot displayed

## Acceptance Criteria
- [ ] Connection status displayed for each participant
- [ ] Activity tracking shows last interaction time
- [ ] Idle threshold is configurable
- [ ] Reminder can be sent to participants
- [ ] Engagement metrics are saved for concluded sessions

## Out of Scope
- Automatic participant removal for inactivity
- Real-time chat or intervention tools

## Dependencies
- Real-time connection monitoring
- Activity timestamp tracking

## Notes
- Consider marking participants as "idle" after 2 minutes of no interaction
- Engagement data contributes to session analytics

---

# Use Case: System Notifies Participants of Session State Changes

## Summary
**Actor:** System

**Trigger:** Session state changes (start, advance, end) or Facilitator action

**Goal:** As the System, I want to notify participants of session state changes so that they are aware of what's happening in real-time.

---

## Preconditions
- Session exists and state is changing
- Participants are connected to the session

## Main Flow
1. System detects session state change event
2. System prepares notification payload including:
   - New state type
   - Current topic (if applicable)
   - Next steps for participant
   - Timestamp
3. System broadcasts notification to all connected participants via WebSocket
4. Participants' clients receive and process notification
5. Participants' UI updates to reflect new state
6. System logs notification delivery

## Alternate Flows
- **Participant disconnected:** System queues notification; delivers on reconnect
- **Broadcast failure:** System retries; logs error if persistent
- **Multiple rapid changes:** System coalesces notifications to prevent spam

## Postconditions
- **Success:** All connected participants receive and acknowledge notification
- **Failure:** Participant receives notification on reconnect

## Acceptance Criteria
- [ ] Notifications delivered within 500ms
- [ ] All connected participants receive same notification
- [ ] Disconnected participants receive on reconnect
- [ ] Notification includes relevant context
- [ ] Notification format is consistent

## Out of Scope
- Push notifications for disconnected users (email/other)
- Notification preferences per user

## Dependencies
- WebSocket service
- Session state management
- Notification queue

## Notes
- Consider visual and audio cues for important state changes
- Minimize notification frequency to prevent participant fatigue

---

# Use Case: System Persists Session Notes

## Summary
**Actor:** System

**Trigger:** Facilitator creates, edits, or deletes a session note

**Goal:** As the System, I want to persist session notes so that they are available for future reference.

---

## Preconditions
- Session exists in the system
- Note data is validated

## Main Flow
1. System receives note action (create, edit, delete)
2. System validates note data:
   - Content is not empty
   - Content length within limits
   - User has permission
3. System updates note record in database
4. System updates session's notes collection
5. System records audit trail (who, what, when)
6. System confirms persistence success
7. Real-time clients receive note update

## Alternate Flows
- **Validation failure:** System returns validation error
- **Database error:** System retries; returns error if persistent
- **Concurrent modification:** System handles via optimistic locking

## Postconditions
- **Success:** Note is persisted; visible to authorized users
- **Failure:** Error returned; no partial state

## Acceptance Criteria
- [ ] Notes are stored in database
- [ ] Notes are associated with correct session
- [ ] Timestamps are accurate
- [ ] Edit history is tracked
- [ ] Deletion is permanent
- [ ] Real-time sync to connected clients

## Out of Scope
- Note search indexing (basic LIKE query acceptable)
- Note export formats

## Dependencies
- Database persistence
- Real-time synchronization
- Audit logging

## Notes
- Consider soft delete for audit purposes
- Index notes by session and topic for efficient retrieval
