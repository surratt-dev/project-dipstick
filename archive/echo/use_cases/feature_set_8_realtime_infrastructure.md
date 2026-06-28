# Use Cases: Feature Set 8 - Real-Time Infrastructure

---

# Use Case: Establish Real-Time Connection

## Summary
**Actor:** System

**Trigger:** Participant or Facilitator loads the application or navigates to an active session

**Goal:** As a System, I want to establish a real-time connection so that clients can receive live updates without polling.

---

## Preconditions
- User is authenticated via Microsoft Entra ID
- User has access to the session (participant, facilitator, or manager with access)
- Active session exists in the system

## Main Flow
1. User navigates to session URL or dashboard
2. System detects active session context
3. System initiates WebSocket connection (or SSE as fallback)
4. Server validates user session token
5. System subscribes user to relevant session channel
6. Server confirms subscription and sends current session state
7. Connection remains open for bidirectional communication

## Alternate Flows
- **If WebSocket unavailable:** System falls back to Server-Sent Events (SSE)
- **If both unavailable:** System falls back to long-polling with degraded experience
- **If authentication token expired:** System prompts re-authentication; connection closes
- **If session does not exist:** System redirects to appropriate page with error message

## Postconditions
- **Success:** Persistent real-time connection established; user receives live updates
- **Failure:** Connection failed; user sees error and can retry

---

## Acceptance Criteria
- [ ] Real-time connection established within 3 seconds of page load
- [ ] Connection automatically reconnects on network disruption (up to 5 attempts)
- [ ] Fallback mechanisms work when primary protocol unavailable
- [ ] Heartbeat/ping mechanism detects stale connections
- [ ] Connection closes cleanly when user navigates away

## Out of Scope
- Connection through proxy/ firewalls with limited WebSocket support (document as limitation)

## Dependencies
- Use Case: User Authentication (Feature Set 7)

## Notes
- Consider implementing connection quality indicator for users

---

# Use Case: Receive Live Session Updates

## Summary
**Actor:** Participant

**Trigger:** Real-time connection is established; session state changes

**Goal:** As a Participant, I want to receive live updates so that I always see the current session state without manual refresh.

---

## Preconditions
- Participant has joined an active session
- Real-time connection is established
- Participant has authenticated

## Main Flow
1. System detects session state change (topic change, voting phase, etc.)
2. Server broadcasts update to all connected participants in session
3. Participant's client receives update payload
4. UI updates to reflect new state (topic displayed, voting controls, etc.)
5. Participant acknowledges update (visual feedback)

## Alternate Flows
- **If update conflicts with local state:** Server state wins; client re-renders
- **If network drops during update:** Client queues request; retries on reconnection
- **If update is for different phase:** Client ignores irrelevant updates

## Postconditions
- **Success:** Participant sees current session state within 500ms of server update
- **Failure:** Participant may see stale state until next successful sync

---

## Acceptance Criteria
- [ ] Topic changes appear within 500ms for all participants
- [ ] Phase transitions (discussion → voting → results) update immediately
- [ ] Participant presence list updates when users join/leave
- [ ] UI reflects state changes without page reload
- [ ] Updates are idempotent (receiving same update twice has no side effects)

## Out of Scope
- Historical session playback (view-only mode)

## Dependencies
- Use Case: Establish Real-Time Connection

## Notes
- Optimize payload size to reduce bandwidth on mobile connections

---

# Use Case: Receive Live Session Updates (Facilitator)

## Summary
**Actor:** Facilitator

**Trigger:** Real-time connection established; session state changes

**Goal:** As a Facilitator, I want to receive live updates so that I can manage the session effectively and see participant responses in real-time.

---

## Preconditions
- Facilitator is authenticated and assigned to active session
- Real-time connection is established

## Main Flow
1. Session state changes (vote cast, participant joins, topic changes)
2. Server broadcasts update to facilitator's client
3. Facilitator's dashboard updates in real-time:
   - Vote counts appear as participants vote
   - Participant list shows join/leave events
   - Topic timer displays current status
4. Facilitator can act on the information (advance phase, address outlier)

## Alternate Flows
- **If facilitator's connection lags:** System shows connection quality indicator
- **If facilitator is multi-tasking:** Notification appears for critical events

## Postconditions
- **Success:** Facilitator sees real-time state; can make informed decisions about session flow
- **Failure:** Facilitator may need to refresh; auto-sync resumes on reconnect

---

## Acceptance Criteria
- [ ] Vote aggregation updates in real-time as participants vote
- [ ] Participant presence list shows current attendee count
- [ ] Phase transition announcements appear immediately
- [ ] Facilitator can see which participants have not yet voted
- [ ] Timer synchronization across all participants

## Out of Scope
- Automatic session advancement (facilitator controls pacing)

## Dependencies
- Use Case: Establish Real-Time Connection
- Use Case: Cast Finger Vote (Feature Set 3)

## Notes
- Facilitator may want to filter which updates are most critical

---

# Use Case: Track Participant Presence

## Summary
**Actor:** Facilitator

**Trigger:** Participant joins or leaves session; periodic heartbeat check

**Goal:** As a Facilitator, I want to track participant presence so that I know who is currently in the session and can ensure everyone participates.

---

## Preconditions
- Session is active
- Facilitator has established real-time connection
- Participants have joined the session

## Main Flow
1. Participant navigates to session URL
2. System establishes real-time connection
3. System registers participant presence and notifies facilitator
4. Participant heartbeat mechanism begins (periodic ping)
5. System tracks participant as "active" while heartbeat continues
6. If heartbeat stops, system marks participant as "away" after timeout
7. If participant closes tab/navigates away, system marks as "disconnected"

## Alternate Flows
- **If participant has poor connection:** System shows "reconnecting" status briefly
- **If participant is idle:** System marks as "away" after 2 minutes of no interaction
- **If participant returns:** System immediately updates status back to "active"
- **If facilitator has no participants:** System shows empty state with instructions

## Postconditions
- **Success:** Facilitator sees accurate list of present participants with status indicators
- **Failure:** Presence may be stale; system attempts re-sync on reconnection

---

## Acceptance Criteria
- [ ] New participant appears in facilitator's list within 2 seconds of joining
- [ ] Participant departure is reflected within 5 seconds
- [ ] Status indicators show: active (green), away (yellow), disconnected (gray)
- [ ] Participant count badge shows current attendance
- [ ] Facilitator can see which participants have joined late or left early

## Out of Scope
- Geolocation tracking of participants
- Automatic session closure when all participants leave

## Dependencies
- Use Case: Establish Real-Time Connection
- Use Case: Join Active Session

## Notes
- Consider privacy implications of showing "last active" timestamps

---

# Use Case: Track My Own Presence Status

## Summary
**Actor:** Participant

**Trigger:** Participant joins session; system monitors connection status

**Goal:** As a Participant, I want my presence status tracked so that the facilitator knows I'm actively engaged in the session.

---

## Preconditions
- Participant has authenticated and joined active session
- Real-time connection established

## Main Flow
1. Participant joins session
2. System registers presence and broadcasts to facilitator
3. Participant's client sends periodic heartbeats
4. System marks participant as "active" based on heartbeat
5. If participant tab loses focus or network degrades:
   - System shows connection indicator (green/yellow/red)
   - Facilitator may see participant as "away" or "reconnecting"

## Alternate Flows
- **If participant accidentally closes tab:** System detects disconnection within 10 seconds
- **If participant switches to another tab:** System may mark as "away" after idle timeout
- **If participant has connectivity issues:** Visual indicator shows reconnecting state

## Postconditions
- **Success:** Participant status accurately reflected to facilitator; reconnection handled gracefully
- **Failure:** Participant may need to rejoin session manually

---

## Acceptance Criteria
- [ ] Presence indicator shows my current connection status
- [ ] Automatic reconnection works if network drops temporarily
- [ ] Participant receives notification if disconnected from session
- [ ] "Rejoin" option available if kicked due to connection issues
- [ ] Status updates within 2 seconds of connectivity change

## Out of Scope
- Automatic session re-entry after extended disconnection

## Dependencies
- Use Case: Establish Real-Time Connection
- Use Case: Join Active Session

## Notes
- Mobile users may experience more presence fluctuations due to network changes

---

# Use Case: Synchronize Vote in Real-Time

## Summary
**Actor:** Participant

**Trigger:** Facilitator opens voting phase; participant casts vote

**Goal:** As a Participant, I want my vote synchronized in real-time so that the facilitator can see my response immediately.

---

## Preconditions
- Participant is in active session with real-time connection
- Facilitator has opened voting phase
- Participant has physically indicated vote (finger count or thumbs)

## Main Flow
1. Participant raises fingers/thumbs to indicate vote
2. Participant taps corresponding vote button on their device
3. Client sends vote to server via real-time connection
4. Server validates vote (correct phase, authenticated participant, within time window)
5. Server broadcasts vote to facilitator's dashboard
6. Vote aggregation updates in real-time
7. Client shows confirmation of vote capture

## Alternate Flows
- **If vote sent after phase closed:** System rejects vote; participant notified
- **If network error on send:** Client retries with exponential backoff; shows "sending" state
- **If participant double-taps:** System deduplicates votes
- **If facilitator locks voting early:** System rejects subsequent votes with clear message

## Postconditions
- **Success:** Vote captured, aggregated, and visible to facilitator within 500ms
- **Failure:** Vote rejected or lost; participant can retry if voting still open

---

## Acceptance Criteria
- [ ] Vote reaches facilitator's view within 500ms of submission
- [ ] Participant receives visual confirmation of vote capture
- [ ] Vote cannot be changed once cast (within same phase)
- [ ] Facilitator sees vote count update in real-time
- [ ] System handles network interruptions gracefully (queue and retry)

## Out of Scope
- Vote anonymity at time of voting (identity visible for outlier discussion)

## Dependencies
- Use Case: Establish Real-Time Connection
- Use Case: Cast Finger Vote (Feature Set 3)
- Use Case: Cast Roman Vote (Feature Set 3)

## Notes
- Vote submission should work even with 1-2 second network latency

---

# Use Case: View Real-Time Vote Aggregation (Facilitator)

## Summary
**Actor:** Facilitator

**Trigger:** Participants cast votes during voting phase

**Goal:** As a Facilitator, I want to see vote aggregation in real-time so that I can quickly gauge team sentiment and identify outliers.

---

## Preconditions
- Facilitator is authenticated and running active session
- Real-time connection established
- Voting phase is open

## Main Flow
1. Participant casts vote
2. Vote transmitted via real-time channel to server
3. Server validates and processes vote
4. Server broadcasts updated aggregate to facilitator
5. Facilitator's dashboard updates:
   - Vote count per option increments
   - Visual chart/graph updates
   - Outlier indicators appear if votes diverge significantly
6. Facilitator can discuss results immediately

## Alternate Flows
- **If no votes yet:** Display shows "Waiting for votes..."
- **If all votes in:** Display shows "All votes received"
- **If outlier detected:** System highlights participants with divergent votes for discussion

## Postconditions
- **Success:** Facilitator sees live vote counts; can proceed with discussion or move to next topic
- **Failure:** Aggregated view may lag; manual refresh available as fallback

---

## Acceptance Criteria
- [ ] Individual vote updates appear within 500ms
- [ ] Aggregate percentages update in real-time
- [ ] Facilitator can see vote distribution (1-2-3-4 or thumbs up/down)
- [ ] Outlier detection highlights votes that differ significantly from average
- [ ] Final results can be locked/confirmed by facilitator

## Out of Scope
- Automatic outlier detection algorithms (facilitator interprets)

## Dependencies
- Use Case: Establish Real-Time Connection
- Use Case: Cast Finger Vote (Feature Set 3)
- Use Case: Cast Roman Vote (Feature Set 3)

## Notes
- Consider color-coding for quick visual assessment (red=low, green=high)

---

# Use Case: Engineering Manager Views Historical Session Results (Post-Session)

## Summary
**Actor:** Engineering Manager

**Trigger:** Manager navigates to historical session data

**Goal:** As an Engineering Manager, I want to view session results so that I can understand my team's health metrics and take action on identified issues.

---

## Preconditions
- Manager is authenticated with appropriate role
- Session has concluded
- Manager has access to the team's historical data

## Main Flow
1. Manager navigates to team dashboard
2. System loads historical session data from database
3. Manager views aggregated results:
   - Vote distributions per topic
   - Trend charts over time
   - Action items and their status
4. Manager can drill down into individual sessions
5. Manager can export data for reporting

## Alternate Flows
- **If no sessions completed:** System shows empty state with guidance
- **If manager lacks permissions:** System shows access denied message
- **If data is loading:** System shows loading skeleton/spinner

## Postconditions
- **Success:** Manager sees complete historical data; can analyze trends
- **Failure:** Manager sees error; can contact support

---

## Acceptance Criteria
- [ ] Manager can view all completed sessions for their team
- [ ] Vote distributions display accurately per topic
- [ ] Trend charts render correctly over time periods
- [ ] Action items show status (open, in progress, completed)
- [ ] Data can be exported (CSV/PDF) for reporting

## Out of Scope
- Real-time updates during live sessions (manager does not attend)

## Dependencies
- Use Case: Authentication and Access Control (Feature Set 7)
- Use Case: Session Notes and Action Items (Feature Set 5)
- Use Case: Trend Visualization (Feature Set 4)

## Notes
- Manager should not see individual participant votes (aggregate only)

---

# Use Case: Handle Real-Time Connection Recovery

## Summary
**Actor:** System

**Trigger:** Network connection is lost or becomes unstable

**Goal:** As a System, I want to handle connection failures gracefully so that users experience minimal disruption during live sessions.

---

## Preconditions
- User has established real-time connection
- User is participating in active session

## Main Flow
1. System detects connection failure (heartbeat timeout, transport error)
2. System enters "reconnecting" state
3. System attempts reconnection with exponential backoff:
   - Attempt 1: Immediate
   - Attempt 2: 1 second delay
   - Attempt 3: 2 second delay
   - Attempt 4: 4 second delay
   - Attempt 5: 8 second delay (max)
4. On successful reconnection:
   - System re-subscribes to session channel
   - System requests state delta (changes since last known state)
   - System reconciles local state with server state
5. User interface updates to reflect current state
6. If all reconnection attempts fail:
   - System shows "Connection Lost" message
   - User prompted to rejoin manually

## Alternate Flows
- **If session ended during disconnection:** System redirects to appropriate page
- **If user session token expired:** System prompts re-authentication
- **If server is unreachable:** System shows service unavailable message

## Postconditions
- **Success:** User reconnected; state synchronized; can continue participating
- **Failure:** User sees error; must manually rejoin session

---

## Acceptance Criteria
- [ ] Connection loss detected within 10 seconds
- [ ] Automatic reconnection attempts up to 5 times
- [ ] User sees visual indicator during reconnection
- [ ] State reconciliation occurs on successful reconnection
- [ ] No duplicate votes/actions after reconnection
- [ ] Clear error message after all reconnection attempts fail

## Out of Scope
- Offline mode with local caching (future enhancement)

## Dependencies
- Use Case: Establish Real-Time Connection

## Notes
- Track reconnection success rate as a reliability metric

---

# Use Case: Broadcast Session Event Notifications

## Summary
**Actor:** System

**Trigger:** Significant session event occurs

**Goal:** As a System, I want to broadcast event notifications so that participants and facilitators are aware of important session changes.

---

## Preconditions
- Session is active
- Real-time connections established for relevant users

## Main Flow
1. Significant event occurs (phase change, participant join/leave, vote recorded)
2. Server determines which users should receive notification
3. Server constructs notification payload
4. Server broadcasts via real-time channel
5. Client receives notification:
   - Non-intrusive toast for minor events
   - Modal for critical events (session ending)
   - Audio chime for voting phase start (if enabled)

## Alternate Flows
- **If user has notifications disabled:** Suppress non-critical notifications
- **If user is disconnected:** Notification queued for delivery on reconnection
- **If event is urgent:** System may escalate to email/push notification

## Postconditions
- **Success:** Relevant users notified; can respond appropriately
- **Failure:** User may miss event; state visible on next interaction

---

## Acceptance Criteria
- [ ] Phase change announcements delivered to all participants within 1 second
- [ ] Participant join/leave notifications shown to facilitator
- [ ] Critical session events (ending soon, closed) show prominent alerts
- [ ] Notification preferences respected per user
- [ ] Notifications do not interrupt active voting

## Out of Scope
- Email notifications for session events
- Push notifications to mobile devices

## Dependencies
- Use Case: Establish Real-Time Connection

## Notes
- Allow users to enable/disable sound notifications

---

# Use Case: Synchronize Session Timer

## Summary
**Actor:** System

**Trigger:** Facilitator starts/pauses/advances session timer

**Goal:** As a System, I want to synchronize the session timer across all participants so that everyone shares the same understanding of time remaining.

---

## Preconditions
- Facilitator has started a timed phase (discussion, voting)
- All participants have active real-time connections

## Main Flow
1. Facilitator starts timer for current phase
2. Server records start timestamp and duration
3. Server broadcasts timer start event to all participants
4. Each client's timer display starts countdown
5. Server broadcasts periodic sync (every 10 seconds) to prevent drift
6. When timer expires:
   - Server broadcasts "time's up" event
   - All clients display "time expired" simultaneously
7. Facilitator can pause/resume, extending time

## Alternate Flows
- **If participant joins mid-timer:** Client calculates remaining time from start timestamp
- **If participant's clock is wrong:** Server timestamp ensures correctness
- **If network latency causes slight desync:** Periodic sync corrects drift

## Postconditions
- **Success:** All participants see same remaining time within 1 second accuracy
- **Failure:** Timer may show slight variance; periodic sync corrects

---

## Acceptance Criteria
- [ ] Timer displays within 1 second accuracy across all clients
- [ ] Timer starts simultaneously for all participants
- [ ] "Time's up" appears at same moment for everyone
- [ ] Late joiners see correct remaining time
- [ ] Facilitator can adjust timer without disrupting sync

## Out of Scope
- Per-topic custom timer durations (handled by facilitator)

## Dependencies
- Use Case: Establish Real-Time Connection

## Notes
- Consider adding 5-second warning before timer expires

---

# Use Case: Multi-Team Session Coordination (System)

## Summary
**Actor:** System

**Trigger:** Multiple sessions running concurrently across teams

**Goal:** As a System, I want to coordinate multiple real-time sessions so that each team's session operates independently without interference.

---

## Preconditions
- Multiple sessions active simultaneously
- Users distributed across different teams/sessions

## Main Flow
1. Each session is assigned unique channel identifier
2. Real-time connection routes messages based on channel subscription
3. Server isolates session state:
   - Votes for Session A never appear in Session B
   - Presence lists are scoped per session
   - Timer events only broadcast to relevant channel
4. System manages resource allocation:
   - Connection limits enforced per session
   - Server load balanced across sessions
5. Session lifecycle managed independently:
   - Session A can end while Session B continues
   - Reconnection only affects user's specific session

## Alternate Flows
- **If session reaches capacity:** System rejects new connections with message
- **If server load high:** System prioritizes active voting sessions
- **If session crashes:** Only affected session impacted; others continue

## Postconditions
- **Success:** Multiple sessions run concurrently with isolation
- **Failure:** Affected session may degrade; others unaffected

---

## Acceptance Criteria
- [ ] Sessions are fully isolated (no cross-talk between teams)
- [ ] System supports at least 50 concurrent sessions
- [ ] Each session supports up to 20 participants
- [ ] Session state does not leak between teams
- [ ] Facilitator can only see their assigned sessions

## Out of Scope
- Cross-team aggregate reporting (requires explicit permissions)

## Dependencies
- Use Case: Establish Real-Time Connection
- Use Case: Create Health Check Session (Feature Set 1)

## Notes
- Monitor per-session resource usage for scaling decisions
