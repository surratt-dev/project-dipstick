# Feature Set 1: Session Management

---

# Use Case: Create New Session with Join Code

## Summary
**Actor:** Facilitator

**Trigger:** Facilitator clicks "Create New Session" button

**Goal:** As a Facilitator, I want to create a new health check session with a unique join code so that participants can join the session.

---

## Preconditions
- User is authenticated via Microsoft Entra ID
- User has Facilitator role
- User has permission to create sessions for the assigned team(s)

## Main Flow
1. Facilitator navigates to the session creation interface
2. Facilitator clicks "Create New Session" button
3. System displays session creation form with fields: Team Selection, Session Name (optional), Scheduled Start Time (optional)
4. Facilitator selects the team for the session
5. Facilitator optionally configures session settings (topic order, time limits, etc.)
6. Facilitator clicks "Create Session"
7. System generates a unique 6-character alphanumeric join code
8. System creates the session record in "pending" state
9. System displays the session dashboard with the join code prominently shown
10. System provides options to copy join code or generate shareable link
11. System confirms success with a toast notification

## Alternate Flows
- **Join code collision:** System regenerates code if collision detected (extremely rare)
- **No teams assigned:** System displays message "No teams assigned; contact administrator"
- **Session limit reached:** System warns if active session limit for team is reached
- **Concurrent session exists:** System warns if another active session exists for the same team

## Postconditions
- **Success:** Session is created with unique join code; Facilitator can share code with participants
- **Failure:** Session not created; error displayed with guidance

## Acceptance Criteria
- [ ] Unique join code is generated for each session
- [ ] Join code is displayed prominently to the Facilitator
- [ ] Copy-to-clipboard functionality works for join code
- [ ] Session is created in "pending" state
- [ ] Session is associated with the correct team
- [ ] Session appears in Facilitator's session list

## Out of Scope
- Participant joining (separate use case)
- Session topics configuration (handled in Topic Management)
- Scheduling sessions for future dates (basic support only)

## Dependencies
- Authentication via Microsoft Entra ID
- Team/organization data persistence
- Join code generation service

## Notes
- Join codes should be case-insensitive for participant entry
- Consider implementing join code expiration (e.g., 24 hours)
- Join codes should be memorable/readable (avoid ambiguous characters like 0/O, 1/l)

---

# Use Case: Join Session via Code Entry

## Summary
**Actor:** Participant

**Trigger:** Participant enters session join code on landing page

**Goal:** As a Participant, I want to join a health check session by entering a join code so that I can participate in the session.

---

## Preconditions
- User is authenticated via Microsoft Entra ID
- User has Participant role
- Session exists and is in "pending" or "active" state
- Join code is valid and has not expired

## Main Flow
1. Participant navigates to the application landing page
2. Participant clicks "Join Session" button
3. System displays join code entry form with input field
4. Participant enters the 6-character join code
5. Participant clicks "Join" button
6. System validates the join code against active/pending sessions
7. System retrieves session details (team name, scheduled start time, facilitator name)
8. System displays session preview with "Join Now" confirmation
9. Participant clicks "Join Session" to confirm
10. System adds Participant to the session's participant list
11. System redirects Participant to the active session view
12. System displays the current session state (waiting, in progress, topic)

## Alternate Flows
- **Invalid code:** System displays error "Session not found; check the code and try again"
- **Session already started:** System allows Participant to join mid-session with notification
- **Session concluded:** System displays "This session has ended; view results in dashboard"
- **User already in session:** System redirects to existing session view
- **Join code expired:** System displays "This join code has expired; request a new one from the Facilitator"
- **Role not authorized:** System displays "You do not have permission to join this session"

## Postconditions
- **Success:** Participant is added to session; redirected to session view
- **Failure:** Participant remains on join page; error message displayed

## Acceptance Criteria
- [ ] Valid join code grants access to the session
- [ ] Invalid join code shows appropriate error message
- [ ] Participant appears in real-time participant list
- [ ] Participant can view session state upon joining
- [ ] Duplicate join attempts are handled gracefully
- [ ] Join code validation is case-insensitive

## Out of Scope
- Session creation (Facilitator only)
- Session management controls (Facilitator only)
- Viewing past session results

## Dependencies
- Authentication via Microsoft Entra ID
- Session state management
- Real-time participant synchronization

## Notes
- Consider auto-redirect if only one active session exists
- Provide clear feedback when session is in "pending" state (waiting for start)
- Participant should see a welcome message explaining what to expect

---

# Use Case: View Real-Time Participant List

## Summary
**Actor:** Participant, Facilitator

**Trigger:** User navigates to or is already in an active session

**Goal:** As a Participant or Facilitator, I want to view the real-time participant list so that I know who is in the session.

---

## Preconditions
- User is authenticated and has joined an active or pending session
- Session exists in the system

## Main Flow
1. User is on the session view (either as Participant or Facilitator)
2. System displays a participant list panel/section
3. System retrieves current participant list from session data
4. System displays participant names/avatars in the list
5. As participants join or leave, system updates the list in real-time
6. System shows participant count indicator
7. User can see when participants join (animation/notification)

## Alternate Flows
- **No participants yet:** System displays "Waiting for participants..." message
- **Participant disconnects:** System marks participant as "disconnected" after timeout
- **Participant leaves:** System removes participant from list with animation
- **Facilitator view:** Facilitator sees additional indicators (who has voted, etc.)

## Postconditions
- **Success:** Participant list is displayed and updated in real-time
- **Failure:** Static list displayed; real-time updates unavailable (graceful degradation)

## Acceptance Criteria
- [ ] Participant list shows all currently connected participants
- [ ] List updates within 2 seconds of participant join/leave
- [ ] Participant count is visible
- [ ] User can identify themselves in the list
- [ ] Disconnected participants are visually distinguished
- [ ] Facilitator sees additional participant metadata

## Out of Scope
- Anonymous voting (participant names hidden from each other during voting)
- Detailed participant profiles

## Dependencies
- Real-time WebSocket/synchronization service
- Session participant data

## Notes
- Consider showing participant avatars for quick identification
- Facilitator should see which participants have completed current action (e.g., voted)
- Names should be displayed as user configured in Microsoft Entra ID profile

---

# Use Case: Start Session

## Summary
**Actor:** Facilitator

**Trigger:** Facilitator clicks "Start Session" button

**Goal:** As a Facilitator, I want to start a pending health check session so that participants can begin the voting and discussion process.

---

## Preconditions
- User is authenticated as Facilitator
- User created the session or has permission to manage it
- Session is in "pending" state
- At least one topic is configured for the session

## Main Flow
1. Facilitator is on the session management view
2. Facilitator clicks "Start Session" button
3. System displays confirmation dialog with session summary (team name, topic count, participant count)
4. Facilitator confirms the action
5. System changes session state from "pending" to "active"
6. System marks the first topic as "current"
7. System notifies all connected participants that the session has started
8. System displays the first topic to all participants
9. System enables voting controls for the current topic

## Alternate Flows
- **No participants joined:** System warns "No participants have joined yet; start anyway?"
- **Topic not configured:** System prevents start; displays "Add at least one topic before starting"
- **Concurrent session active:** System warns and prevents start for same team
- **Cancel start:** Facilitator clicks "Cancel"; session remains pending

## Postconditions
- **Success:** Session state is "active"; first topic is displayed; voting is enabled
- **Failure:** Session remains in "pending" state; error displayed

## Acceptance Criteria
- [ ] Session state transitions from "pending" to "active"
- [ ] All connected participants receive session start notification
- [ ] First topic is displayed as current
- [ ] Voting controls are enabled for participants
- [ ] Session start time is recorded
- [ ] Facilitator can proceed to advance topics

## Out of Scope
- Automatic session scheduling
- Session pause/resume (separate use case)

## Dependencies
- Session state management
- Real-time participant notification
- Topic management integration

## Notes
- Consider adding a countdown before first topic becomes active
- Session start time should be recorded for historical tracking

---

# Use Case: Advance to Next Topic

## Summary
**Actor:** Facilitator

**Trigger:** Facilitator clicks "Next Topic" or "Advance" button

**Goal:** As a Facilitator, I want to advance to the next topic so that participants can vote on the next discussion item.

---

## Preconditions
- User is authenticated as Facilitator
- Session is in "active" state
- Current topic has been displayed and participants have had time to vote

## Main Flow
1. Facilitator is on the active session view
2. Facilitator reviews voting progress for current topic
3. Facilitator clicks "Next Topic" button
4. System displays confirmation (optional): "Advance to next topic?"
5. Facilitator confirms
6. System records voting results for the current topic
7. System marks current topic as "completed"
8. System advances to the next topic in the configured order
9. System displays the new current topic to all participants
10. System clears previous topic votes from participant view
11. System enables voting controls for the new topic

## Alternate Flows
- **Last topic:** System shows "End Session" option instead of "Next Topic"
- **Not all participants voted:** System shows warning "Some participants haven't voted yet; advance anyway?"
- **No more topics:** System prompts to end session
- **Session timeout:** System auto-advances if configured

## Postconditions
- **Success:** New topic is displayed; voting is reset for new topic
- **Failure:** Current topic remains active; error displayed

## Acceptance Criteria
- [ ] Current topic results are saved when advancing
- [ ] Next topic becomes active and visible to all
- [ ] All participants see the new topic
- [ ] Voting controls reset for new topic
- [ ] Topic progression is tracked in session history

## Out of Scope
- Skipping topics (different workflow)
- Reordering topics mid-session

## Dependencies
- Session state management
- Topic order configuration
- Voting results persistence
- Real-time synchronization

## Notes
- Consider allowing Facilitator to view summary before advancing
- Add optional timer display for each topic

---

# Use Case: End Session

## Summary
**Actor:** Facilitator

**Trigger:** Facilitator clicks "End Session" button (after last topic or manually)

**Goal:** As a Facilitator, I want to end a health check session so that voting closes and session results become available.

---

## Preconditions
- User is authenticated as Facilitator
- Session is in "active" state

## Main Flow
1. Facilitator is on the active session view (after last topic or manually)
2. Facilitator clicks "End Session" button
3. System displays confirmation dialog: "End session? This will close voting and save results."
4. Facilitator confirms the action
5. System records final voting results for current topic (if any)
6. System changes session state from "active" to "concluded"
7. System calculates aggregate scores for all topics
8. System stores session results in the database
9. System displays session summary to Facilitator
10. System notifies all participants that the session has ended
11. System provides options: "View Results", "Create Action Items", "Download Report"

## Alternate Flows
- **Active votes in progress:** System warns "Voting is in progress; end anyway and lose votes?"
- **Cancel end:** Facilitator clicks "Cancel"; session remains active
- **Facilitator disconnects:** System auto-ends session after timeout (configurable)

## Postconditions
- **Success:** Session is "concluded"; results are saved; participants can no longer vote
- **Failure:** Session remains "active"; error displayed

## Acceptance Criteria
- [ ] Session state changes to "concluded"
- [ ] All voting data is persisted
- [ ] Aggregate scores are calculated and stored
- [ ] Participants are notified of session end
- [ ] Results are accessible to Engineering Manager
- [ ] Session end time is recorded

## Out of Scope
- Automatic report generation
- Action item creation (separate use case)

## Dependencies
- Session state management
- Voting results aggregation
- Real-time participant notification

## Notes
- Consider adding a "session feedback" prompt (how did the session go?)
- Session duration should be recorded for analytics

---

# Use Case: View Session State

## Summary
**Actor:** Participant, Facilitator

**Trigger:** User navigates to session view or session state changes

**Goal:** As a Participant or Facilitator, I want to view the current session state so that I know what phase the session is in.

---

## Preconditions
- User is authenticated and has joined a session
- Session exists in the system

## Main Flow
1. User navigates to the session view or is already connected
2. System retrieves current session state from the database
3. System displays the session state information:
   - Session status indicator (Pending/Active/Concluded)
   - Current topic (if active)
   - Topic progress (e.g., "Topic 2 of 5")
   - Voting status (Open/Closed)
4. System updates the display when state changes
5. User can see countdown timer if topic has time limit

## Alternate Flows
- **Session not found:** User is redirected to appropriate page
- **User not in session:** User is prompted to join
- **Session concluded:** User is shown results view instead of active view

## Postconditions
- **Success:** Current session state is displayed accurately
- **Failure:** Error message displayed

## Acceptance Criteria
- [ ] Session status is clearly displayed (Pending/Active/Concluded)
- [ ] Current topic is visible to all participants
- [ ] Topic progress shows position in sequence
- [ ] Voting status is indicated
- [ ] State changes reflect in real-time

## Out of Scope
- Historical session state queries (for concluded sessions)

## Dependencies
- Session state management
- Real-time synchronization

## Notes
- Consider color-coding status (gray=pending, green=active, blue=concluded)
- Facilitator should see additional controls based on state

---

# Use Case: Manage Session Settings

## Summary
**Actor:** Facilitator

**Trigger:** Facilitator accesses session settings before starting

**Goal:** As a Facilitator, I want to manage session settings so that I can customize how the session operates.

---

## Preconditions
- User is authenticated as Facilitator
- Session exists and is in "pending" state

## Main Flow
1. Facilitator navigates to session management view
2. Facilitator clicks "Session Settings" or "Configure"
3. System displays settings panel with options:
   - Topic order (reorder topics)
   - Time per topic (optional timer)
   - Voting method (individual or group)
   - Anonymous voting toggle
   - Allow late join toggle
4. Facilitator modifies desired settings
5. Facilitator clicks "Save Settings"
6. System validates settings
7. System persists settings to session record
8. System confirms success with notification

## Alternate Flows
- **Session already active:** System restricts certain settings; displays warning
- **Invalid settings:** System displays validation errors
- **Settings conflict:** System warns if settings conflict (e.g., timer too short)

## Postconditions
- **Success:** Settings are saved and will apply to the session
- **Failure:** Settings not saved; error displayed

## Acceptance Criteria
- [ ] All configurable settings are accessible
- [ ] Settings persist across page reloads
- [ ] Settings apply correctly when session starts
- [ ] Some settings can be modified mid-session (with warning)
- [ ] Settings are visible to other Facilitators

## Out of Scope
- Advanced topic configuration (separate use case)
- Template-based settings presets

## Dependencies
- Session data persistence
- Settings validation

## Notes
- Consider providing sensible defaults for all settings
- Document each setting option for Facilitators

---

# Use Case: View Historical Session

## Summary
**Actor:** Engineering Manager, Participant

**Trigger:** User selects a past session from the list

**Goal:** As an Engineering Manager or Participant, I want to view a historical session so that I can review past results and trends.

---

## Preconditions
- User is authenticated with appropriate role
- Session exists and is in "concluded" state
- User has permission to view the session results

## Main Flow
1. User navigates to session history or dashboard
2. System displays list of past sessions with date, team, status
3. User selects a specific session
4. System retrieves session data including all topic scores
5. System displays session summary:
   - Date and duration
   - Participants (names if authorized, count otherwise)
   - Topic scores and results
   - Any notes or action items
6. User can drill down into individual topic results

## Alternate Flows
- **No historical sessions:** System displays "No sessions completed yet"
- **Permission denied:** System displays "You do not have permission to view this session"
- **Data unavailable:** System displays partial data with note

## Postconditions
- **Success:** Historical session data is displayed to authorized user
- **Failure:** Error or access denied message displayed

## Acceptance Criteria
- [ ] All concluded sessions appear in history list
- [ ] Session results are visible to authorized roles
- [ ] Topic scores are displayed accurately
- [ ] Participant list shows who attended
- [ ] Session duration is displayed

## Out of Scope
- Modifying historical data
- Comparing sessions across teams (Engineering Manager only)

## Dependencies
- Session data persistence
- Authentication/authorization

## Notes
- Engineering Managers see full results including individual votes
- Participants see aggregate results only (anonymity preserved)
- Consider allowing export of session results

---

# Use Case: System Generates Join Code

## Summary
**Actor:** System

**Trigger:** Session creation request received

**Goal:** As the System, I want to generate a unique join code for each session so that participants can join the correct session.

---

## Preconditions
- Session creation is initiated
- Database is accessible

## Main Flow
1. System receives session creation request
2. System requests join code generation
3. System generates 6-character alphanumeric code using cryptographically secure random
4. System checks code against existing active/pending sessions
5. If collision detected, system regenerates (max 3 attempts)
6. System returns the unique join code
7. System associates code with session record

## Alternate Flows
- **Collision after max attempts:** System uses alternative algorithm or adds suffix
- **Database error:** System logs error and retries with exponential backoff

## Postconditions
- **Success:** Unique join code is associated with session
- **Failure:** Session creation fails with error

## Acceptance Criteria
- [ ] Join code is 6 characters
- [ ] Join code uses uppercase letters and numbers only
- [ ] Ambiguous characters are excluded (0, O, 1, l, I)
- [ ] Code is unique among active/pending sessions
- [ ] Code generation is deterministic only with random seed

## Out of Scope
- Join code customization by user

## Dependencies
- Cryptographically secure random number generator
- Session database

## Notes
- Consider implementing code expiration (24 hours default)
- Log code generation for security auditing

---

# Use Case: System Synchronizes Session State

## Summary
**Actor:** System

**Trigger:** Session state changes or client connects to session

**Goal:** As the System, I want to synchronize session state across all connected clients in real-time so that all participants see consistent information.

---

## Preconditions
- Session exists in database
- At least one client is connected to the session
- WebSocket connection is established

## Main Flow
1. System detects state change event (topic advance, vote cast, participant join/leave)
2. System updates session state in database
3. System broadcasts state update to all connected clients via WebSocket
4. Clients receive update and update UI
5. System confirms broadcast completion

## Alternate Flows
- **Client disconnected:** System queues update; delivers on reconnect
- **Broadcast failure:** System retries; logs error if persistent
- **Concurrent updates:** System handles via optimistic locking or last-write-wins

## Postconditions
- **Success:** All connected clients have consistent session state
- **Failure:** Client receives update on reconnect; stale data indicator shown

## Acceptance Criteria
- [ ] State updates propagate within 500ms
- [ ] All clients receive same state data
- [ ] Reconnecting clients receive current state
- [ ] Offline changes are reconciled on reconnect

## Out of Scope
- Conflict resolution for simultaneous edits (handled by use case)

## Dependencies
- WebSocket service
- Session state database

## Notes
- Consider implementing heartbeat for connection health
- Document state synchronization protocol for client developers

---

# Use Case: Cancel Session

## Summary
**Actor:** Facilitator

**Trigger:** Facilitator clicks "Cancel Session" button

**Goal:** As a Facilitator, I want to cancel a pending session so that it is removed from active status.

---

## Preconditions
- User is authenticated as Facilitator
- Session is in "pending" state (not yet started)

## Main Flow
1. Facilitator navigates to session management view
2. Facilitator clicks "Cancel Session" button
3. System displays confirmation: "Cancel this session? Participants will be notified."
4. Facilitator confirms cancellation
5. System changes session state to "cancelled"
6. System invalidates the join code
7. System notifies any participants who have joined
8. System removes session from Facilitator's active list
9. System confirms cancellation with notification

## Alternate Flows
- **Session already active:** System prevents cancellation; suggests "End Session" instead
- **Participants joined:** System warns that participants will lose access
- **Cancel end:** Facilitator clicks "Cancel"; no changes made

## Postconditions
- **Success:** Session is cancelled; join code invalidated
- **Failure:** Error displayed; session remains pending

## Acceptance Criteria
- [ ] Session state changes to "cancelled"
- [ ] Join code is invalidated
- [ ] Participants are notified
- [ ] Session does not appear in active/pending lists

## Out of Scope
- Refunding or undoing any actions

## Dependencies
- Session state management
- Real-time notification

## Notes
- Consider requiring reason for cancellation (optional)
- Log cancellation for audit purposes
