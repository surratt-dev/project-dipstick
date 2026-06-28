# Feature Set 6: Team Dashboard

This document contains use cases for the Team Dashboard feature of the Engineering Health Check Application.

---

# Use Case: View Upcoming Sessions

## Summary
**Actor:** Participant, Facilitator, Engineering Manager

**Trigger:** User navigates to the Team Dashboard or dashboard is loaded after login

**Goal:** As a [Actor], I want to view upcoming scheduled sessions so that I can prepare to participate or coordinate session logistics.

---

## Preconditions
- User is authenticated via Microsoft Entra ID
- User has a valid role (Participant, Facilitator, or Engineering Manager)
- At least one session is scheduled in the system

## Main Flow
1. User accesses the Team Dashboard view
2. System retrieves upcoming sessions for teams the user is associated with
3. System displays upcoming sessions in chronological order with session details (team name, date/time, facilitator, topic)
4. User can view session details including scheduled topics and participant list

## Alternate Flows
- **No upcoming sessions:** System displays a message indicating no upcoming sessions with an option to contact a facilitator
- **User has no team associations:** System displays a message indicating the user needs to be assigned to a team
- **Session is full:** System indicates the session has reached maximum participants (if applicable)

## Postconditions
- **Success:** Upcoming sessions list is displayed with relevant details
- **Failure:** Error message is displayed with retry option

---

## Acceptance Criteria
- [ ] Upcoming sessions are displayed in chronological order
- [ ] Each session shows team name, date/time, facilitator name, and topic
- [ ] Sessions starting within the next hour are visually highlighted
- [ ] Past sessions are not shown in the upcoming list

## Out of Scope
- Joining a session (covered in "Quick-Join Active Session")
- Session creation and scheduling (covered in Session Management feature)

## Dependencies
- Authentication via Microsoft Entra ID
- Session data stored in database
- User-team association data

## Notes
- Engineering Managers only see sessions for teams they manage
- Facilitators see sessions they are assigned to and sessions for their own team

---

# Use Case: View Past Sessions

## Summary
**Actor:** Participant, Facilitator, Engineering Manager

**Trigger:** User selects "Past Sessions" tab or scrolls down on Team Dashboard

**Goal:** As a [Actor], I want to view past session history so that I can review previous health check results and track team progress.

---

## Preconditions
- User is authenticated via Microsoft Entra ID
- User has a valid role (Participant, Facilitator, or Engineering Manager)
- At least one session has been completed in the past

## Main Flow
1. User navigates to the Past Sessions section of the Team Dashboard
2. System retrieves completed sessions for teams the user is associated with
3. System displays past sessions in reverse chronological order with summary results
4. User can click on a past session to view detailed results

## Alternate Flows
- **No past sessions:** System displays a message indicating no completed sessions yet
- **Accessing restricted session:** If user attempts to view a session they don't have access to, system shows authorization error

## Postconditions
- **Success:** Past sessions list is displayed with summary information
- **Failure:** Error message is displayed with retry option

---

## Acceptance Criteria
- [ ] Past sessions are displayed in reverse chronological order
- [ ] Each session shows team name, date, and overall health score
- [ ] Action item completion status is visible
- [ ] Clicking a session navigates to detailed results view

## Out of Scope
- Detailed session analysis (covered in Session Results feature)
- Exporting session data (future enhancement)

## Dependencies
- Authentication via Microsoft Entra ID
- Historical session data
- User-team association data

## Notes
- Engineering Managers can view all past sessions for their teams
- Participants can only see sessions they attended or that have been shared

---

# Use Case: View Current Scores Overview

## Summary
**Actor:** Participant, Facilitator, Engineering Manager

**Trigger:** User views the Team Dashboard or navigates to scores section

**Goal:** As a [Actor], I want to view current health scores so that I can understand the team's current state at a glance.

---

## Preconditions
- User is authenticated via Microsoft Entra ID
- User has a valid role (Participant, Facilitator, or Engineering Manager)
- At least one completed session exists for the user's team(s)

## Main Flow
1. User accesses the Team Dashboard
2. System retrieves the most recent session scores for each category
3. System displays scores in a visual overview (e.g., score cards, gauge charts)
4. User can view breakdown by category (codebase, tooling, process, etc.)

## Alternate Flows
- **No completed sessions:** System displays placeholder content encouraging users to schedule first session
- **Scores below threshold:** System highlights low scores with visual indicators (red/amber)
- **Stale data warning:** If scores are older than 30 days, system displays a warning

## Postconditions
- **Success:** Current scores overview is displayed with category breakdown
- **Failure:** Error message is displayed with retry option

---

## Acceptance Criteria
- [ ] All health categories display current scores
- [ ] Scores are color-coded based on health level (green/amber/red)
- [ ] Scores are compared to previous session (delta shown)
- [ ] Score timestamp or session date is visible

## Out of Scope
- Detailed voting breakdown (covered in Session Results)
- Score projections or predictions

## Dependencies
- Session results data
- Category definitions

## Notes
- Engineering Managers see all categories for their teams
- Participants see aggregate scores but not individual votes

---

# Use Case: View Trend Indicators

## Summary
**Actor:** Participant, Facilitator, Engineering Manager

**Trigger:** User navigates to trends view or hovers over score indicators

**Goal:** As a [Actor], I want to view trend indicators so that I can understand how team health has changed over time.

---

## Preconditions
- User is authenticated via Microsoft Entra ID
- User has a valid role (Participant, Facilitator, or Engineering Manager)
- At least two completed sessions exist to show a trend

## Main Flow
1. User selects the Trends view on the Team Dashboard
2. System retrieves historical scores for the selected time period
3. System displays trend charts for each health category
4. User can filter by time range (30 days, 90 days, 6 months, 1 year)

## Alternate Flows
- **Insufficient data for trends:** System displays a message indicating more sessions are needed
- **Time range with no data:** System adjusts the view to show available data with notification
- **All scores declining:** System highlights the concern with visual indicators

## Postconditions
- **Success:** Trend charts are displayed with historical data points
- **Failure:** Error message with suggestion to check back later

---

## Acceptance Criteria
- [ ] Line charts show score progression over time for each category
- [ ] Trend direction indicators (up/down/stable) are clearly visible
- [ ] User can select different time ranges
- [ ] Notable events (major changes) are annotated on the chart

## Out of Scope
- Predictive analytics or forecasting
- Cross-team trend comparisons (future enhancement)

## Dependencies
- Historical session data
- Time-series data aggregation

## Notes
- Engineering Managers see trends for all their teams
- Facilitators see trends for teams they facilitate
- Participants see trends for their own team

---

# Use Case: Quick-Join Active Session

## Summary
**Actor:** Participant, Facilitator

**Trigger:** User sees an active session on the dashboard or receives a session notification

**Goal:** As a [Actor], I want to quickly join an active session so that I can participate in the current health check without delay.

---

## Preconditions
- User is authenticated via Microsoft Entra ID
- User has a valid role (Participant or Facilitator)
- An active session exists for a team the user belongs to
- User has not already joined the current session

## Main Flow
1. User views the Team Dashboard and sees an active session indicator
2. User clicks the "Join" button on the active session card
3. System validates user's eligibility to join the session
4. System navigates user to the active session view
5. User can now participate in voting and discussion

## Alternate Flows
- **User is not a team member:** System displays error message indicating they cannot join this session
- **Session is full:** System displays message that session is at capacity
- **User already joined:** System redirects to the session they are already in
- **Session has ended while joining:** System displays message that session has ended and redirects to results

## Postconditions
- **Success:** User is added to the active session and can participate
- **Failure:** User remains on dashboard with appropriate error message

---

## Acceptance Criteria
- [ ] Active sessions are prominently displayed on the dashboard
- [ ] Join button is visible and clickable for eligible users
- [ ] Joining redirects user to session within 3 seconds
- [ ] Ineligible users see clear error message

## Out of Scope
- Session facilitation controls (covered in Session Management)
- Voting and discussion features (covered in Session Participation)

## Dependencies
- Real-time session status
- User-team associations
- Session capacity settings

## Notes
- Facilitators can join any active session they are assigned to
- Participants can only join sessions for their team
- Quick-join is available up until voting closes for a topic

---

# Use Case: Real-Time Dashboard Updates

## Summary
**Actor:** System (Application)

**Trigger:** Session state changes in the system (session starts, ends, scores update)

**Goal:** As the System, I want to update the Team Dashboard in real-time so that users always see current information without manual refresh.

---

## Preconditions
- WebSocket connection is established with the client
- User is authenticated and viewing the Team Dashboard

## Main Flow
1. System detects a change in session state (new session scheduled, session starts, scores calculated)
2. System broadcasts update to all connected clients viewing the dashboard
3. Clients receive update via WebSocket
4. Dashboard UI updates to reflect new state without page reload
5. Visual indicator shows users what changed

## Alternate Flows
- **WebSocket disconnected:** System falls back to periodic polling every 30 seconds
- **Update conflict:** System reconciles state and shows most recent data
- **High frequency updates:** System batches updates to prevent UI flicker

## Postconditions
- **Success:** Dashboard reflects current state within 2 seconds of change
- **Failure:** User can manually refresh to get current state

---

## Acceptance Criteria
- [ ] Active session indicators update within 2 seconds of session start
- [ ] Score changes are reflected in real-time after session concludes
- [ ] New session appearances are pushed to dashboard immediately
- [ ] Connection status indicator shows WebSocket state

## Out of Scope
- Offline mode support (future enhancement)
- Push notifications for mobile devices

## Dependencies
- WebSocket infrastructure
- Real-time event publishing
- Client-side state management

## Notes
- System handles reconnection automatically
- Fallback polling ensures data consistency if WebSocket fails

---

# Use Case: Filter Dashboard by Team

## Summary
**Actor:** Engineering Manager

**Trigger:** Engineering Manager manages multiple teams and wants to view specific team data

**Goal:** As an Engineering Manager, I want to filter the dashboard by team so that I can focus on the teams I manage.

---

## Preconditions
- User is authenticated as an Engineering Manager
- User is associated with multiple teams

## Main Flow
1. Engineering Manager accesses the Team Dashboard
2. System displays a team selector dropdown
3. User selects a specific team from the dropdown
4. Dashboard filters all views (upcoming, past, scores, trends) to show selected team data
5. User can switch teams at any time

## Alternate Flows
- **Single team association:** Team selector is hidden; dashboard shows only user's team
- **No team selected (default):** Dashboard shows aggregate view across all teams

## Postconditions
- **Success:** Dashboard displays data for the selected team only
- **Failure:** Error message; user can return to all-teams view

---

## Acceptance Criteria
- [ ] Team selector is visible for managers with multiple teams
- [ ] Filtering updates all dashboard sections simultaneously
- [ ] Selected team is persisted during session
- [ ] Aggregate view is available as default option

## Out of Scope
- Cross-team benchmarking reports
- Team comparison charts

## Dependencies
- User-team associations
- Multi-team permissions

## Notes
- Facilitators can only see teams they facilitate or belong to
- Participants see only their own team (no filter needed)
