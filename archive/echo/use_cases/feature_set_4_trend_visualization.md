# Feature Set 4: Trend Visualization

---

# Use Case: View Per-Topic Trend Chart

## Summary
**Actor:** Engineering Manager

**Trigger:** Manager navigates to the trend visualization section for their team

**Goal:** As an Engineering Manager, I want to view trend charts for individual topics so that I can understand how each aspect of team health has evolved over time.

---

## Preconditions
- User is authenticated via Microsoft Entra ID
- User has Engineering Manager role with access to their team's data
- At least one Health Check session has been completed for the team

## Main Flow
1. Manager navigates to the Team Dashboard
2. Manager selects "Trends" or "Trend Analysis" from the navigation
3. System displays a list of available topics with trend summaries
4. Manager clicks on a specific topic (e.g., "Code Quality", "Team Collaboration", "Tooling")
5. System loads and displays a line chart showing the topic's scores over time
6. Chart displays date labels on x-axis and score values on y-axis
7. Manager can hover over data points to see exact scores and session dates
8. System highlights any significant changes (outliers) with visual indicators

## Alternate Flows
- **No historical data:** If no sessions have been completed, system displays a "No trend data available" message with guidance to schedule first session
- **Single session:** If only one session exists, displays the single data point with a note that trend analysis requires multiple sessions
- **No team access:** If manager attempts to view trends for a team they don't manage, system denies access with appropriate error

## Postconditions
- **Success:** Chart displays correctly with historical data points, axis labels, and interactive hover states
- **Failure:** Error message displayed if data cannot be retrieved; previous view state is preserved

---

## Acceptance Criteria
- [ ] Line chart renders with at least 2 data points showing historical scores
- [ ] X-axis displays session dates in readable format
- [ ] Y-axis displays appropriate score range (1-4 or percentage depending on voting type)
- [ ] Hovering over data points shows tooltip with exact score and date
- [ ] Outlier data points are visually distinguished (different color or marker)
- [ ] Chart is responsive and works on tablet/desktop viewports

## Out of Scope
- Exporting charts to image/PDF formats
- Comparing trends across multiple teams in a single view
- Real-time updates during active sessions (trends only show concluded sessions)

## Dependencies
- Use Case: View Team Dashboard
- Use Case: Session Completion and Results Calculation

## Notes
- Trend charts only include concluded sessions to maintain confidentiality
- Data should be aggregated by topic, not by individual vote

---

# Use Case: View Project Trend Sparkline

## Summary
**Actor:** Participant (Team Member)

**Trigger:** Participant views their team dashboard or session list

**Goal:** As a Participant, I want to see a sparkline visualization of overall team health trends so that I can quickly understand the team's trajectory at a glance.

---

## Preconditions
- User is authenticated and is a member of a team
- At least one Health Check session has been completed

## Main Flow
1. Participant navigates to their Team Dashboard
2. System displays a summary card for each team they belong to
3. Each team card includes an overall health sparkline (mini line chart)
4. Sparkline shows the trend of the team's aggregate health score over recent sessions
5. Participant can see direction of trend (improving, declining, stable) at a glance
6. Optional: Participant clicks on the sparkline to expand into full trend view

## Alternate Flows
- **No data available:** Display placeholder sparkline with message "Complete your first session to see trends"
- **Single session:** Display flat line with single point, indicating baseline established

## Postconditions
- **Success:** Sparkline renders correctly with 3-10 data points, trend direction is visually clear
- **Failure:** Graceful fallback to numeric display if sparkline cannot render

---

## Acceptance Criteria
- [ ] Sparkline displays on team summary cards in the dashboard
- [ ] Sparkline shows at least 3 data points when available
- [ ] Trend direction is immediately apparent (color-coded: green=improving, red=declining, gray=stable)
- [ ] Sparkline is compact, fitting within card dimensions (approximately 100x30px)
- [ ] Clicking sparkline navigates to detailed trend view

## Out of Scope
- Customizing sparkline colors by user preference
- Adding data point labels within the sparkline itself

## Dependencies
- Use Case: View Team Dashboard
- Session results calculation (aggregate scores)

## Notes
- Sparklines should be visually simple to avoid cluttering the dashboard
- Consider accessibility: ensure trend direction is also conveyed via text for screen readers

---

# Use Case: Filter Trends by Date Range

## Summary
**Actor:** Facilitator

**Trigger:** Facilitator wants to analyze trends within a specific time period

**Goal:** As a Facilitator, I want to filter trend data by date range so that I can analyze team health during specific time periods (e.g., after a major release, during onboarding, post-restructuring).

---

## Preconditions
- User is authenticated as Facilitator
- Team has completed multiple Health Check sessions

## Main Flow
1. Facilitator navigates to the Trend Analysis page for a team
2. System displays default view showing all historical data
3. Facilitator locates the date range filter controls
4. Facilitator selects a predefined range (Last 30 days, Last Quarter, Last 6 months, Year to Date) OR
5. Facilitator selects custom start and end dates via date picker
6. System updates all charts and visualizations to show only data within the selected range
7. System displays a summary banner showing "Showing trends from [start date] to [end date]"
8. Facilitator can clear the filter to return to full history view

## Alternate Flows
- **No data in range:** Display message "No sessions found in the selected date range. Try selecting a different period."
- **Invalid date range (end before start):** System prevents selection or shows validation error
- **Very large range:** System may show warning about performance but still loads data

## Postconditions
- **Success:** All trend visualizations update to reflect only the selected date range; URL updates to preserve filter state
- **Failure:** Filter controls remain available; error message explains issue without breaking the page

---

## Acceptance Criteria
- [ ] Date range filter control is visible and accessible on the Trend Analysis page
- [ ] Selecting a predefined range updates all charts within 2 seconds
- [ ] Custom date picker allows selecting both start and end dates
- [ ] Selected range is visually indicated in the UI
- [ ] Clearing filter restores full historical view
- [ ] Filter state persists when navigating away and returning (via URL parameters)

## Out of Scope
- Comparing two date ranges side-by-side
- Exporting filtered data

## Dependencies
- Use Case: View Per-Topic Trend Chart
- Use Case: View Project Trend Sparkline

## Notes
- Default view should show last 6 months to balance relevance with performance
- Consider fiscal quarter presets in addition to calendar periods

---

# Use Case: View Historical Session Data

## Summary
**Actor:** Engineering Manager

**Trigger:** Manager wants to review detailed results from past sessions

**Goal:** As an Engineering Manager, I want to view historical data from previous Health Check sessions so that I can analyze patterns, compare results, and make informed decisions about team improvements.

---

## Preconditions
- User is authenticated as Engineering Manager
- User has access to the team (is the manager or has been granted view permissions)
- At least one session has been completed

## Main Flow
1. Manager navigates to the Historical Data section
2. System displays a paginated or scrollable list of past sessions
3. Each session entry shows: date, facilitator, participant count, overall score, topic summaries
4. Manager clicks on a session to expand its details
5. System displays full results including:
   - Per-topic vote distributions and averages
   - Outlier indicators
   - Session notes (if any)
   - Action items created (if any)
6. Manager can navigate between sessions using next/previous controls
7. Manager can filter the session list by date or topic score range

## Alternate Flows
- **Session notes are empty:** Display "No notes recorded for this session"
- **Action items incomplete:** Highlight overdue items with visual indicator
- **User lacks permission for specific session:** Hide that session from view entirely

## Postconditions
- **Success:** Historical session data displays accurately; user can drill down into any past session
- **Failure:** Appropriate error if data retrieval fails; graceful degradation showing available data

---

## Acceptance Criteria
- [ ] Session list displays at least date, facilitator, and overall score for each session
- [ ] Expanded session view shows per-topic breakdown with vote counts/averages
- [ ] Outlier results are highlighted or flagged in the detailed view
- [ ] Session notes are visible when present
- [ ] Action items associated with session are listed with status
- [ ] Navigation between sessions is smooth without full page reload

## Out of Scope
- Editing historical session data
- Viewing individual voter identities (anonymized)
- Exporting historical data to external formats

## Dependencies
- Use Case: Session Completion and Results Calculation
- Use Case: Action Item Management

## Notes
- All historical data should be read-only to maintain integrity
- Consider data retention policy: may need to archive or anonymize very old sessions

---

# Use Case: Export Trend Data

## Summary
**Actor:** Engineering Manager

**Trigger:** Manager needs to share trend data with stakeholders or include in reports

**Goal:** As an Engineering Manager, I want to export trend data so that I can include it in presentations, executive summaries, or further analysis in external tools.

---

## Preconditions
- User is authenticated as Engineering Manager
- At least one session has been completed

## Main Flow
1. Manager views trend visualizations on the Trend Analysis page
2. Manager locates the "Export" or "Download" button
3. Manager selects export format (CSV, Excel, PDF)
4. Manager confirms the export (optionally selecting specific topics or date range)
5. System generates the export file with current filter/selection applied
6. Browser downloads the file automatically

## Alternate Flows
- **Large dataset:** System shows progress indicator during export generation
- **Export fails:** Error message with option to retry

## Postconditions
- [ ] Export file is generated and downloaded to user's device
- [ ] File contains all visible data with appropriate formatting

---

## Acceptance Criteria
- [ ] Export button is visible on Trend Analysis page
- [ ] CSV export includes all visible trend data with headers
- [ ] Date range filter is respected in exported data
- [ ] Export completes within reasonable time (<10 seconds for typical dataset)

## Out of Scope
- Scheduled/automated exports
- Email delivery of exports

## Dependencies
- Use Case: Filter Trends by Date Range

## Notes
- Export should respect same access controls as the UI (only data the user can see)

---

# Use Case: System Calculates and Stores Trend Metrics

## Summary
**Actor:** System (Application)

**Trigger:** A Health Check session is concluded

**Goal:** As the System, I want to automatically calculate and store trend metrics when sessions conclude so that trend visualizations remain performant and up-to-date.

---

## Preconditions
- A Health Check session has reached "Concluded" status
- All votes have been tallied and results calculated

## Main Flow
1. Session status transitions to "Concluded"
2. System triggers trend calculation workflow
3. System calculates aggregate scores per topic for the session
4. System stores these metrics in the trend data store
5. System recalculates running averages and trend indicators
6. System marks trend data as updated with current timestamp
7. System invalidates any cached trend visualizations for affected teams

## Alternate Flows
- **Calculation fails:** System retries up to 3 times, then logs error and marks trend data as "stale"
- **Concurrent session conclude:** System handles race condition gracefully using appropriate locking

## Postconditions
- **Success:** Trend metrics are persisted and available for visualization queries
- **Failure:** Error is logged; admin notification triggered; visualization shows "Data temporarily unavailable"

---

## Acceptance Criteria
- [ ] Trend metrics are calculated within 30 seconds of session conclusion
- [ ] Calculated metrics match manual calculation from raw votes
- [ ] Trend data is queryable via API for visualization components
- [ ] Cached visualizations are invalidated appropriately

## Out of Scope
- Real-time trend updates during active sessions
- Predictive trend analysis

## Dependencies
- Session state management
- Vote calculation and result aggregation

## Notes
- Consider pre-calculating common aggregations for performance
- Trend data should be stored separately from session data for efficient querying

---

# Use Case: View Topic Comparison Across Sessions

## Summary
**Actor:** Participant (Team Member)

**Trigger:** Participant wants to understand how specific topics have changed

**Goal:** As a Participant, I want to compare how specific topics have scored across multiple sessions so that I can identify which areas have improved or declined.

---

## Preconditions
- User is authenticated as Participant
- User belongs to a team with at least 2 completed sessions

## Main Flow
1. Participant navigates to the Trends section
2. System displays a topic comparison view (table or chart)
3. Each row represents a topic; columns represent sessions (most recent first)
4. Participant can see the score for each topic in each session
5. System highlights significant changes (>0.5 score difference) between consecutive sessions
6. Participant can sort by most improved or most declined
7. Participant can filter to focus on specific topics of interest

## Alternate Flows
- **Few sessions:** If fewer than 2 sessions, display message explaining comparison needs more data

## Postconditions
- [ displayed with clear visual ] Topic comparison is indicators for improvement/decline

---

## Acceptance Criteria
- [ ] All topics are displayed with their scores across available sessions
- [ ] Significant changes are visually highlighted
- [ ] Sorting and filtering work correctly
- [ ] View is accessible and understandable

## Out of Scope
- Comparing topics across different teams
- Automated insights or recommendations

## Dependencies
- Use Case: View Per-Topic Trend Chart

## Notes
- Consider accessibility for color-blind users when showing improvement/decline

---

# Use Case: System Enforces Trend Data Access Control

## Summary
**Actor:** System (Application)

**Trigger:** Any request for trend data

**Goal:** As the System, I want to enforce access control on trend data so that users only see information they are authorized to view.

---

## Preconditions
- User is authenticated (valid Microsoft Entra ID token)
- User has a defined role (Participant, Facilitator, or Engineering Manager)

## Main Flow
1. User requests trend data for a specific team
2. System validates user's authentication token
3. System determines user's role and team memberships
4. System checks authorization:
   - Engineering Managers can view trends for teams they manage
   - Facilitators can view trends for teams they facilitate
   - Participants can view trends for teams they belong to
5. If authorized, system returns requested trend data
6. If not authorized, system returns 403 Forbidden with appropriate message

## Alternate Flows
- **User not authenticated:** Redirect to login page
- **User role unknown:** Deny access by default
- **Team does not exist:** Return 404 Not Found

## Postconditions
- **Success:** Authorized users receive trend data for permitted teams
- **Failure:** Unauthorized requests are denied with appropriate HTTP status and message

---

## Acceptance Criteria
- [ ] Engineering Manager cannot view trends for teams they don't manage
- [ ] Facilitator cannot view trends for teams they don't facilitate
- [ ] Participants cannot view trends for other teams
- [ ] All access denials are logged for security auditing

## Out of Scope
- Cross-team reporting for executives (future feature)
- Data sharing between teams

## Dependencies
- Authentication (Microsoft Entra ID)
- Role-based access control configuration

## Notes
- Access control should be enforced at API level, not just UI level
- Consider team hierarchy in access decisions (e.g., director can see all team trends)

---

# Use Case: View Team Health Score Distribution

## Summary
**Actor:** Facilitator

**Trigger:** Facilitator wants to understand the distribution of scores in a session

**Goal:** As a Facilitator, I want to view the distribution of health scores across topics so that I can identify which areas need the most attention.

---

## Preconditions
- User is authenticated as Facilitator
- At least one session has been completed

## Main Flow
1. Facilitator navigates to session results or trend view
2. System displays a bar chart or histogram showing score distribution
3. Facilitator can see how many topics scored in each range (1-2 at risk, 2-3 needs work, 3-4 healthy)
4. Facilitator can see which specific topics fall into each category
5. Facilitator can click on a category to filter to those topics

## Alternate Flows
- **All topics in healthy range:** Display positive confirmation message
- **All topics in at-risk range:** Display alert suggesting immediate follow-up

## Postconditions
- [ ] Distribution view clearly communicates overall team health status

---

## Acceptance Criteria
- [ ] Distribution chart accurately reflects score categorization
- [ ] Clicking category filters to relevant topics
- [ ] Color coding is consistent (red/yellow/green)

## Out of Scope
- Predictive suggestions based on distribution

## Dependencies
- Use Case: View Per-Topic Trend Chart

## Notes
- This view helps facilitators prioritize which topics to discuss in future sessions
