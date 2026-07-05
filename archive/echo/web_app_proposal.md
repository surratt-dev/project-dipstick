# Engineering Health Check Web Application Proposal

## Overview

A real-time web application for distributed engineering teams to conduct Health Check voting sessions remotely. The application handles voting mechanics only—voice and video are handled via separate tools.

---

## Core Assumptions

- **Session Type**: Fully remote, real-time (synchronous)
- **Scope**: Single tenant, multiple teams per organization
- **Access**: Team members and current facilitator (Engineering Managers do not attend sessions)
- **Auth**: Microsoft Entra ID (initially), with abstraction for future providers
- **Platform**: Desktop-first (no mobile priority at this time)
- **Data**: No historical import needed; starting fresh

---

## User Roles

### Participant
- Team member attending the session
- Can cast votes during active sessions
- Can view team's historical trends
- Can add notes to session (if permitted)

### Facilitator
- Leads the session (from another team)
- Controls session flow (start/advance topics)
- Can view all teams they facilitate
- Can add session notes
- Creates/assigns action items

### Engineering Manager
- Does NOT attend live sessions (maintains emotional safety for honest voting)
- Can view their team's metrics after sessions conclude
- Can view all votes and session details after the fact
- Can view action items assigned to their team
- Cannot vote or participate in live sessions

---

## Feature Specifications

### 1. Session Management

#### Creating a Session
- Facilitator creates a new session for a specific team
- System generates a session code or unique link
- Participants join by entering their name and session code
- Real-time participant list shows who's joined

#### Session Flow
- Facilitator controls session pacing
- Each topic displays sequentially:
  1. Topic name
  2. Voting type (Finger 1-4, Roman, Modified Roman)
  3. Optional prompt/question text
  4. "Ready" phase (participants signal readiness)
  5. "Vote" phase (all participants vote simultaneously)
  6. Results displayed (anonymized but visible to all)
  7. Outlier highlighting (auto-calculated)
  8. Brief discussion notes field

#### Voting Interface (Participant View)
- Large, clear vote buttons matching vote type:
  - Finger: Four buttons labeled 1, 2, 3, 4
  - Roman: Thumbs up / Thumbs down
  - Modified Roman: Thumbs up / Flat hand / Thumbs down
- Visual feedback when vote is cast
- Cannot change vote once submitted (maintains honesty)
- Ready button to signal preparation complete

#### Voting Interface (Facilitator View)
- Participant list with ready status indicators
- "Start voting" countdown controls (3-2-1-Vote)
- Live results appearing as votes come in
- Average/mean calculation for finger votes
- Tally display for Roman votes
- Outlier indicators highlighted
- Next topic controls

---

### 2. Topic Management

#### Default Topics
System ships with standard Engineering Health Check topics:

**Developing and Changing Code**
- How easy is it to add features to production code? (Finger 1-4)
- How easy is it to reason about production code? (Finger 1-4)
- How would you rate the code under active development? (Finger 1-4)
- How would you rate the code for the entirety of the project? (Finger 1-4)

**Automated Development Tests**
- Is the test suite effective? (Finger 1-4)
- Is the test suite consistent? (Roman)
- How would you rate the tests you are writing for code under active development? (Finger 1-4)
- How would you rate the tests for the entirety of the project? (Finger 1-4)

**Others**
- Confidence in the pipeline (Finger 1-4)
- Are you comfortable with the technology stack? (Roman)
- How effective is pairing? (Finger 1-4)

**Overall**
- Project Trend (Modified Roman: up/sideways/down)

#### Customization
- Teams can add/remove/reorder topics
- Teams can modify topic text and voting type
- Custom topics persist across sessions
- Teams can create topic presets for different use cases

---

### 3. Trend Visualization

#### Individual Topic Trends
- Line chart showing topic score over time (sessions on X-axis)
- Visual markers for each data point
- Configurable time range (last 3 months, 6 months, year, all time)
- Hover to see exact values and session date

#### Project Trend Display
- Special visualization for Modified Roman votes
- Sparkline showing direction over time (up/steady/down)

#### Team Comparison (Manager View)
- Engineering managers can see their team's trends
- Multiple topics viewable side-by-side

---

### 4. Session Notes & Action Items

#### Session Notes
- Free-text notes attached to each topic within a session
- Who added the note (not anonymous—supports trust building)
- Notes visible to all session participants

#### Action Items
- Created during or after session
- Fields:
  - Description
  - Owner (team member)
  - Due date (optional)
  - Related topic (optional)
  - Status (Open, In Progress, Complete)
- Action items appear on team dashboard
- Status can be updated between sessions
- Previous action items reviewed at start of each session

---

### 5. Team Dashboard

#### Home View
- List of upcoming/past sessions
- Quick-join for active session
- Days since last session indicator

#### Team Health Overview
- Current scores for all topics (most recent session)
- Trend arrows (up/down/stable) for each topic
- Overdue action items count
- Link to detailed trends

#### Facilitator Dashboard
- Teams the facilitator has access to
- Upcoming session schedule
- Quick-start new session

---

### 6. Authentication & Access Control

#### Authentication (Microsoft Entra ID)
- Initial implementation: Microsoft Entra ID (Azure AD)
- Abstraction layer: Auth provider interface
  - Interface defines: login, logout, get user info, get user groups/roles
  - Pluggable adapters for future providers (Google, Okta, SAML, etc.)
  - Configuration-driven provider selection

#### Role Mapping
- Engineering Manager: Identified by Entra group membership or team assignment
- Facilitator: Explicitly granted per-team facilitator access
- Team Member: Added to team by manager or facilitator

#### Access Matrix

| View | Team Member | Engineering Manager | Facilitator |
|------|-------------|---------------------|-------------|
| Vote in session | Yes | No (post-session only) | No (leads) |
| View live session | Yes | No | Yes |
| View session results (after) | Yes | Yes | Yes |
| View own team trends | Yes | Yes | Yes (for teams they facilitate) |
| Edit team topics | Yes (if permitted) | Yes | No |
| Create session | No | No | Yes |
| Manage action items | Yes (own) | Yes | Yes |
| View team action items | Yes | Yes | Yes |

---

## User Flows

### Flow 1: Facilitator Starts a Session

1. Facilitator logs in
2. Navigates to "Start Session" for specific team
3. System creates new session, generates join code
4. Facilitator shares code with participants (via chat/email)
5. Participants join by entering name + code
6. Participant list updates in real-time
7. Facilitator sees "Ready" status from each participant

### Flow 2: Conducting a Vote

1. Facilitator displays current topic
2. Participants read prompt, think privately
3. Participants click "Ready" button
4. When all ready, facilitator clicks "3-2-1-Vote"
5. Participants simultaneously select vote (1-4 or thumbs)
6. Results appear instantly
7. System calculates average and identifies outliers
8. Outliers are highlighted for discussion
9. Facilitator/participants add brief notes
10. Facilitator advances to next topic

### Flow 3: Creating Action Items

1. After voting on a topic, discussion reveals an issue
2. Facilitator or participant creates action item
3. Assigns owner from team members present
4. Action item saved to session
5. At next session, action item appears in review
6. Owner updates status or provides update

### Flow 4: Viewing Trends

1. Team member logs in
2. Sees team dashboard with current scores
3. Clicks on topic to see detailed trend
4. Views line chart over time
5. Can filter by date range

---

## Technical Considerations (UX-Relevant Only)

### Real-Time Requirements
- WebSocket or Server-Sent Events for live voting
- Sub-second update latency to feel synchronous
- Reconnection handling if network drops

### Accessibility
- Keyboard navigation for voting
- Screen reader support
- High contrast mode
- Focus indicators for accessibility

### Performance
- Session state should handle 20+ simultaneous participants
- Trend queries should load in under 2 seconds

---

## Out of Scope

- Voice/video communication (handled externally)
- Mobile application
- Data export/import
- Third-party integrations (Slack, Jira, etc.)
- Anonymity features
- Automated recommendations
- Sentiment analysis
- Push notifications (email-based only)

---

## Future Considerations (Not in Initial Release)

- Authentication abstraction layer (add Google, Okta, SAML providers)
- Topic templates library (share topics between teams)
- Session recording/playback
- Browser extension for quick access
- Integration hooks for external tools
- Offline voting support
- Guest participant mode (non-authenticated)
