# Trend Dashboard & Reporting — Use Cases

---

# Use Case: View Team Trend Dashboard

## Summary
**Actor:** Engineer | Facilitator

**Trigger:** The user navigates to their team's trend dashboard.

**Goal:** As an Engineer or Facilitator, I want to view my team's trend dashboard so that I can understand how the team's engineering health has changed across sessions over time.

---

## Preconditions
- The user is authenticated.
- The user is a member of the team (Engineer) or is the current session's facilitator (Facilitator).
- The team has at least one completed session with recorded results.

## Main Flow
1. The user navigates to the team's trend dashboard.
2. The application verifies the user's authorization to view this team's data.
3. The application retrieves the team's session history and computes trend data for each topic.
4. The dashboard renders with:
   - Per-topic trend charts, each defaulting to the last six sessions.
   - The Project Trend directional indicator (up / steady / down), displayed separately from the numeric charts.
   - A session history list showing completed sessions in reverse chronological order.
   - Any session annotations displayed alongside the sessions they label.
5. The user reviews the dashboard.

## Alternate Flows
- **Team has fewer than six completed sessions:** The trend charts display all available sessions rather than defaulting to six.
- **Team has no completed sessions (or insufficient data for a chart):** The dashboard renders with a blank graph and the text "Insufficient data." in place of any chart that cannot be rendered due to insufficient session history.
- **User is not authorized:** The application denies access and displays an error. No data is disclosed. (See UC: Enforce Access Control on Team Content.)

## Postconditions
- **Success:** The user sees the team's trend dashboard with per-topic charts, the Project Trend indicator, session history, and any annotations.
- **Failure:** Access is denied. The user is shown an error and no team data is disclosed.

---

## Acceptance Criteria
- [ ] The trend dashboard is accessible to Engineers who are members of the team.
- [ ] The trend dashboard is accessible to the Facilitator of the team's current session.
- [ ] Per-topic trend charts default to displaying results from the last six sessions.
- [ ] The Project Trend directional indicator (up / steady / down) is rendered separately from the per-topic numeric charts.
- [ ] Session annotations are visible on the dashboard where they exist.
- [ ] Users with no relationship to the team cannot access the dashboard.
- [ ] When no completed sessions exist, or when data is insufficient to render a chart, the dashboard displays a blank graph with the text "Insufficient data." in place of that chart. This applies to individual per-topic trend charts as well as to the overall dashboard state.

## Out of Scope
- Engineering Manager access to the dashboard — covered in UC: Engineering Manager Views Team Trend Dashboard.
- Expanding a chart to show full session history — covered in UC: Expand Topic Trend Chart to Full History.
- Viewing full detail for a specific past session — covered in UC: View Past Session Detail.

## Dependencies
- UC: Enforce Access Control on Team Content — access must be verified before any data is shown.
- Application: trend data must be computed and persisted after each session completes (see UC: Compute and Persist Trend Data After Session Completion).

## Notes
- A Facilitator has read access to the facilitated team's full historical trend data for the duration of the session they are running. This access is scoped to the active session and enables the facilitator to reference prior context during facilitation.
- The dashboard is the entry point to all other Trend Dashboard & Reporting use cases.

---

# Use Case: View Per-Topic Trend Chart

## Summary
**Actor:** Engineer | Facilitator | Engineering Manager

**Trigger:** The user views a per-topic trend chart on the team's trend dashboard.

**Goal:** As a user viewing the trend dashboard, I want to see a topic's score plotted across recent sessions so that I can understand whether that topic is improving, holding steady, or worsening over time.

---

## Preconditions
- The user is authenticated and authorized to view the team's trend dashboard.
- The team has at least one completed session in which the topic was active.
- The trend dashboard is loaded.

## Main Flow
1. The application renders a trend chart for each active topic on the team's topic list.
2. Each chart plots the topic's score on the vertical axis and sessions on the horizontal axis, ordered chronologically left to right.
3. The chart defaults to displaying the last six sessions in which this topic appeared.
4. Where sessions contain annotations, the annotation label is indicated on the chart at the corresponding point.
5. The user reads the chart to understand the topic's score trajectory.

## Alternate Flows
- **Topic was removed and later re-added:** A gap appears in the trend line at sessions where the topic was absent. The line resumes when the topic was re-added. Data points are not connected across the gap. (See UC: View Trend Chart with Topic Gap.)
- **Topic has appeared in fewer than six sessions:** The chart displays all sessions in which the topic appeared.
- **Topic was active in only one session:** The chart renders a single data point with no trend line.
- **Insufficient data to render the chart (no sessions, or topic has never been voted on):** The chart renders as a blank graph with the text "Insufficient data." No error state is shown.

## Postconditions
- **Success:** The user can read the topic's score trajectory across recent sessions, including any annotated moments and gaps from topic removal.
- **Failure:** The chart fails to render. The application displays an error in place of the chart; other charts on the dashboard are unaffected.

---

## Acceptance Criteria
- [ ] Each active topic on the team's list has a corresponding trend chart on the dashboard.
- [ ] The trend chart plots numeric scores per session in chronological order.
- [ ] The chart defaults to the last six sessions in which the topic was active.
- [ ] Sessions with annotations display the annotation label as a visible indicator on the chart.
- [ ] A topic removed and re-added renders a gap in the trend line, not a connected line across absent sessions.
- [ ] A chart failure does not prevent other charts from displaying.
- [ ] When insufficient data exists to render a chart, the chart area displays a blank graph with the text "Insufficient data." rather than an error or a blank/broken state.

## Out of Scope
- Expanding to full session history — covered in UC: Expand Topic Trend Chart to Full History.
- The Project Trend directional indicator — covered in UC: View Project Trend Indicator.

## Dependencies
- UC: View Team Trend Dashboard — charts are rendered as part of the dashboard.
- UC: Compute and Persist Trend Data After Session Completion — chart data depends on persisted session results.

## Notes
- The specification states "A score means something different depending on trajectory — the chart makes this visible." The chart design should emphasize direction (e.g., slope, color coding) and not just absolute value.
- The definition of "last six sessions" refers to sessions in which the topic appeared, not the last six sessions the team held overall. This distinction matters when topics have been removed and re-added.

---

# Use Case: Expand Topic Trend Chart to Full History

## Summary
**Actor:** Engineer | Facilitator | Engineering Manager

**Trigger:** The user chooses to expand a per-topic trend chart beyond the default six-session view to see the full session history for that topic.

**Goal:** As a user reviewing a topic's trend chart, I want to expand the chart to show all historical sessions so that I can understand long-term patterns and see context that predates the default window.

---

## Preconditions
- The user is authenticated and authorized to view the team's trend dashboard.
- The team has more than six completed sessions in which the topic was active.
- The trend dashboard is loaded and the per-topic chart is rendered in its default (six-session) view.

## Main Flow
1. The user selects the option to expand the chart to full history (e.g., a "View all sessions" control on the chart).
2. The application retrieves the complete session history for this topic.
3. The chart re-renders to display all sessions in which the topic appeared, in chronological order.
4. Gaps from topic removal are preserved in the full-history view.
5. Session annotations are visible at the sessions they label across the full history.
6. The user reviews the extended chart.

## Alternate Flows
- **Team has six or fewer sessions with this topic:** The expand control is not shown, or is disabled, because the default view already shows all available data.
- **Data retrieval fails:** The chart remains in its default six-session view. The application displays an error indicating the full history could not be loaded.

## Postconditions
- **Success:** The chart displays the complete history of the topic's scores across all sessions it appeared in.
- **Failure:** The chart remains in the default view. The user is informed that the full history is temporarily unavailable.

---

## Acceptance Criteria
- [ ] A control to expand to full history is available on each per-topic chart when more than six sessions of data exist.
- [ ] Activating the control re-renders the chart to include all historical sessions for that topic.
- [ ] Gaps from topic removal are preserved in the expanded view.
- [ ] Session annotations are visible in the expanded view.
- [ ] The expand control is absent or disabled when the default view already shows all available data.
- [ ] A failure to load full history does not disrupt the default chart view.

## Out of Scope
- Filtering or searching within the full history — not in scope for this feature set.
- Exporting chart data — not described in the feature set.

## Dependencies
- UC: View Per-Topic Trend Chart — the full-history view is an extension of the default chart.

## Notes
- The application should ensure that rendering a large number of sessions in the full-history view remains legible. The chart may need to adjust its layout or scale when many sessions are present. This is an implementation concern.

---

# Use Case: View Project Trend Indicator

## Summary
**Actor:** Engineer | Facilitator | Engineering Manager

**Trigger:** The user views the team's trend dashboard and observes the Project Trend section.

**Goal:** As a user reviewing the trend dashboard, I want to see the Project Trend directional indicator so that I can understand the overall direction of the team's engineering health without interpreting a numeric chart.

---

## Preconditions
- The user is authenticated and authorized to view the team's trend dashboard.
- The team has sufficient session history for the application to determine a Project Trend direction.
- The trend dashboard is loaded.

## Main Flow
1. The application renders the Project Trend indicator separately from the per-topic numeric charts.
2. The indicator displays one of three values: up, steady, or down.
3. The user reads the directional indicator as a high-level signal of overall project health trajectory.

## Alternate Flows
- **Insufficient history to determine a trend direction:** The application renders the Project Trend section as a blank graph with the text "Insufficient data."

## Postconditions
- **Success:** The user sees a clear directional indicator (up / steady / down) representing the team's overall engineering health trajectory.
- **Failure:** The indicator fails to render. The application displays an error in the Project Trend section; the rest of the dashboard is unaffected.

---

## Acceptance Criteria
- [ ] The Project Trend indicator is rendered separately from all per-topic numeric trend charts.
- [ ] The indicator displays exactly one of three values: up, steady, or down.
- [ ] When insufficient session history exists to compute a direction, the indicator renders a blank graph with the text "Insufficient data." rather than displaying a misleading value.
- [ ] A failure to render the Project Trend indicator does not prevent the rest of the dashboard from loading.

## Out of Scope
- How the Project Trend direction is computed — that is an application behavior defined in UC: Compute and Persist Trend Data After Session Completion.
- Per-topic numeric trend charts — covered in UC: View Per-Topic Trend Chart.

## Dependencies
- UC: View Team Trend Dashboard — the Project Trend indicator is a component of the dashboard.
- UC: Compute and Persist Trend Data After Session Completion — the direction value must be computed and stored before it can be displayed.

## Notes
- The Project Trend uses a Modified Roman scale (up / steady / down) and is explicitly not a numeric value. The UI must not represent it as a number or score.
- The algorithm for computing the Project Trend direction (e.g., comparing aggregate scores across the most recent N sessions) is not defined here and should be specified separately.

---

# Use Case: View Past Session Detail

## Summary
**Actor:** Engineer | Facilitator | Engineering Manager

**Trigger:** The user selects a specific completed session from the session history list on the trend dashboard.

**Goal:** As a user viewing the trend dashboard, I want to see the full detail for a specific past session so that I can review who participated, what votes were cast, which topics prompted discussion, and what action items were created.

---

## Preconditions
- The user is authenticated and authorized to view the team's data.
- The team has at least one completed session.
- The trend dashboard is loaded and the session history list is visible.

## Main Flow
1. The user selects a past session from the session history list.
2. The application retrieves the full detail record for that session.
3. The application renders the session detail view, including:
   - The session date and any annotation label.
   - The list of participants (who was present and voted).
   - Per-topic vote results: the scores submitted by each participant.
   - Which topics triggered discussion (outlier flags).
   - The action items created during the session, including owner and status at the time.
4. The user reviews the session detail.

## Alternate Flows
- **Session detail fails to load:** The application displays an error. The user is returned to the trend dashboard.
- **User navigates back:** The application returns the user to the trend dashboard without modifying any session data.

## Postconditions
- **Success:** The user can see the full historical record for the selected session: participants, votes, outlier topics, and action items.
- **Failure:** The session detail is not displayed. The user is shown an error and the dashboard state is preserved.

---

## Acceptance Criteria
- [ ] Selecting a past session from the session history displays a detail view for that session.
- [ ] The detail view includes the list of participants present in the session.
- [ ] The detail view includes per-topic vote results showing each participant's score.
- [ ] Topics that triggered discussion are indicated as such in the detail view.
- [ ] Action items created in the session are listed, with owner and status.
- [ ] Any session annotation label is displayed prominently in the detail view.
- [ ] The user can navigate back to the trend dashboard without data loss.
- [ ] Access control is enforced: only authorized users can view session detail.

## Out of Scope
- Modifying historical session data — past session records are read-only.
- Updating action item status from this view — action item management belongs to the Pre-Session Action Item Review and Session Wrap-up feature sets.

## Dependencies
- UC: View Team Trend Dashboard — the session history list is the entry point to this use case.
- UC: Enforce Access Control on Team Content — authorization must be verified before session detail is served.

## Notes
- Individual participant vote scores are visible in the session detail. For Engineering Managers, it should be confirmed whether individual-level vote attribution is appropriate or whether only aggregate results should be shown. This is an open question.
- The action items shown reflect their state at the time of the session or their current state — this should be clarified. Showing current status is likely more useful.

---

# Use Case: Annotate a Session

## Summary
**Actor:** Facilitator

**Trigger:** The facilitator wants to add a brief label to a completed session to make a significant moment legible in the trend view.

**Goal:** As a Facilitator, I want to annotate a completed session with a short label so that the team can understand what was happening during that session when they review the trend history later.

---

## Preconditions
- The user is authenticated and authorized to interact with the team's data.
- The session to be annotated has been completed.
- The session either has no existing annotation or the user intends to replace it.

## Main Flow
1. The user accesses the annotation option for a past session (from the session history list or session detail view).
2. The application presents an input field for a brief annotation label.
3. The user enters the annotation text (e.g., "post-launch cleanup sprint").
4. The user submits the annotation.
5. The application validates the annotation (non-empty, within character limit).
6. The application saves the annotation associated with the session.
7. The annotation is now visible in the trend dashboard and session detail view wherever that session appears.

## Alternate Flows
- **Annotation exceeds character limit:** The application rejects the submission and prompts the user to shorten the text. The existing annotation (if any) is unchanged.
- **Annotation is empty:** The application rejects the submission. An empty string does not overwrite an existing annotation.
- **Save fails due to a system error:** The application displays an error. The annotation is not saved. The user may retry.
- **Updating an existing annotation:** The user follows the same flow. The new annotation replaces the previous one upon successful save.

## Postconditions
- **Success:** The annotation is saved and associated with the session. It is visible in the trend dashboard and session detail view.
- **Failure:** The annotation is not saved. The session's previous annotation state is preserved.

---

## Acceptance Criteria
- [ ] Only a Facilitator can add or modify an annotation on a completed session.
- [ ] The annotation is displayed in the session history list on the trend dashboard.
- [ ] The annotation is displayed in the session detail view.
- [ ] The annotation is indicated at the corresponding point on per-topic trend charts.
- [ ] Submitting an empty annotation is rejected; it does not clear an existing annotation.
- [ ] An annotation that exceeds the character limit is rejected with a clear error.
- [ ] An existing annotation can be replaced by submitting a new one.
- [ ] Engineers and Engineering Managers cannot add or modify annotations.

## Out of Scope
- Deleting an annotation without replacing it — whether a "clear annotation" action is needed is not specified and should be confirmed.
- Annotations on sessions that have not yet been completed.

## Dependencies
- UC: View Team Trend Dashboard — annotations are surfaced on the dashboard.
- UC: View Past Session Detail — annotations are displayed in the session detail view.

## Notes
- The feature specification does not define a character limit for annotations. One should be established to keep labels concise and legible on charts (e.g., 60 characters).
- Only Facilitators can add or modify session annotations. Engineers and Engineering Managers have read-only access to annotations.

---

# Use Case: View Trend Chart with Topic Gap

## Summary
**Actor:** Application

**Trigger:** The application renders a per-topic trend chart for a topic that was removed from the team's topic list and later re-added.

**Goal:** As the application, I want to render a visual gap in a topic's trend line for sessions in which the topic was absent so that users can correctly interpret the discontinuity in the topic's history rather than reading through-the-gap data as continuous.

---

## Preconditions
- The team's topic list has a topic that was active, then removed, then re-added.
- There is at least one completed session in which the topic was absent between the removal and re-addition.
- A user with appropriate access is viewing the trend dashboard.

## Main Flow
1. The application retrieves the session history for the topic, noting sessions in which the topic was present and sessions in which it was absent.
2. The application renders the trend chart with data points for sessions in which the topic was active.
3. For sessions in which the topic was absent, the application renders a visible gap in the trend line rather than connecting the surrounding data points.
4. The chart clearly communicates the gap as an intentional absence, not a missing data error.
5. The user reads the chart and understands that the topic was not evaluated during the gap period.

## Alternate Flows
- **Topic has been removed but not re-added:** The trend chart shows the history of sessions in which the topic was present, ending at the last session before removal. No trailing gap is shown.
- **Topic has multiple removal/re-addition cycles:** Each removal period produces a corresponding gap in the trend line.

## Postconditions
- **Success:** The trend chart accurately represents the topic's history with visible gaps where the topic was absent, allowing users to interpret the data correctly.
- **Failure:** The chart fails to render. An error is shown for that chart; other charts are unaffected.

---

## Acceptance Criteria
- [ ] A topic that was removed and re-added shows a visible gap in its trend line for sessions during which it was absent.
- [ ] The trend line does not connect data points across the gap, creating a false impression of continuity.
- [ ] The gap is visually distinguishable from a normal trend line segment.
- [ ] Multiple removal/re-addition cycles produce multiple gaps.
- [ ] A topic removed but not re-added shows its available history up to the point of removal without a trailing gap artifact.
- [ ] The gap rendering applies consistently in both the default six-session view and the expanded full-history view.

## Out of Scope
- Why a topic was removed or re-added — topic management belongs to the Session Setup feature set.
- Interpolating or estimating scores across a gap — gap periods must remain empty, not estimated.

## Dependencies
- UC: View Per-Topic Trend Chart — gap rendering is a behavior of the per-topic chart.
- UC: Expand Topic Trend Chart to Full History — gap rendering must behave consistently in the expanded view.

## Notes
- The application needs to store, for each topic score, the session it corresponds to and whether the topic was active in that session. The data model must support querying sessions in which a topic was absent, not just sessions in which it was present.
- A design decision is needed for how to visually represent the gap: a dashed line, a shaded region labeled "not evaluated," or simply no line between points. This is an implementation concern.

---

# Use Case: Compute and Persist Trend Data After Session Completion

## Summary
**Actor:** Application

**Trigger:** A session is marked as complete.

**Goal:** As the application, I want to compute and persist trend data for all active topics and the overall Project Trend after each session completes so that the trend dashboard reflects up-to-date information without requiring manual calculation.

---

## Preconditions
- A session has been marked as complete (the session wrap-up flow has concluded).
- Vote results for all topics in the session are finalized and locked.

## Main Flow
1. The application detects that a session has been marked complete.
2. The application retrieves the finalized vote results for each topic in the session.
3. For each topic, the application appends the session's result to the topic's historical score series.
4. The application computes the updated Project Trend directional value (up / steady / down) based on the team's current session history.
5. The application persists the updated trend data.
6. The trend dashboard now reflects the newly completed session's data when any authorized user loads it.

## Alternate Flows
- **Persistence fails:** The application logs the error and retries. If retries are exhausted, the trend data for this session is not persisted. The session results themselves are not affected. An operator alert is raised.
- **Topic was not active in this session:** The topic receives no new data point for this session. A gap is recorded in the topic's history for this session.

## Postconditions
- **Success:** Trend data for all active topics and the Project Trend are updated and persisted. The trend dashboard reflects the new session.
- **Failure:** Trend data is not updated for this session. Session results are preserved. The trend dashboard does not reflect the new session until the failure is resolved.

---

## Acceptance Criteria
- [ ] Trend data is updated automatically when a session is marked complete — no manual trigger is required.
- [ ] Each active topic's historical score series is updated with the session's result.
- [ ] The Project Trend directional value is recomputed after each session.
- [ ] Topics not active in the session receive no new data point and their gap is recorded.
- [ ] Persistence failures do not corrupt existing trend data.
- [ ] The trend dashboard reflects updated data the next time an authorized user loads it after session completion.

## Out of Scope
- Session wrap-up flow itself — that belongs to the Session Wrap-up feature set.
- Displaying the trend data — covered in the dashboard and chart use cases.

## Dependencies
- Session Wrap-up feature set — session completion is the trigger for this use case.
- UC: View Per-Topic Trend Chart — consumes the persisted data.
- UC: View Project Trend Indicator — consumes the persisted Project Trend value.

## Notes
- The algorithm for computing the Project Trend directional value (up / steady / down) needs to be defined. It likely involves comparing aggregate topic scores across recent sessions, but the exact method is not specified in the feature description.
- Trend computation should be treated as an idempotent operation so that it can be safely retried in the event of a failure.

---

# Use Case: Engineering Manager Views Team Trend Dashboard

## Summary
**Actor:** Engineering Manager

**Trigger:** An Engineering Manager navigates to a team dashboard for one of the teams they manage.

**Goal:** As an Engineering Manager, I want to view a team's session history and trend data so that I can monitor the team's engineering health over time and identify areas that may need organizational support.

---

## Preconditions
- The Engineering Manager is authenticated.
- The Engineering Manager has been associated with the team (the manager/team relationship has been established).
- The team has at least one completed session.

## Main Flow
1. The Engineering Manager navigates to the trend dashboard for a team they manage.
2. The application verifies the manager/team relationship.
3. The application grants read-only access to the team's session history and trend data.
4. The dashboard renders identically to the view an Engineer would see: per-topic trend charts (defaulting to last six sessions), the Project Trend indicator, session history, and session annotations.
5. The Engineering Manager reviews the dashboard in read-only mode.

## Alternate Flows
- **Engineering Manager attempts to access a team they do not manage:** The application denies access and displays an error. No data from that team is disclosed.
- **Team has no completed sessions:** The dashboard renders with a blank graph and the text "Insufficient data." in place of any chart that cannot be rendered.
- **Manager/team relationship has been removed:** The application denies access as if no relationship exists.

## Postconditions
- **Success:** The Engineering Manager can view the team's trend dashboard, session history, and trend charts in read-only mode.
- **Failure:** Access is denied. No team data is disclosed.

---

## Acceptance Criteria
- [ ] An Engineering Manager can view the trend dashboard for each team they are associated with.
- [ ] The Engineering Manager's view is read-only; no action that modifies data is available.
- [ ] An Engineering Manager cannot view the dashboard for a team they do not manage.
- [ ] The dashboard rendered for the Engineering Manager includes per-topic trend charts, the Project Trend indicator, session history, and annotations.
- [ ] The Engineering Manager cannot participate in sessions, modify topics, or update action items from this view.

## Out of Scope
- Engineering Manager navigating between multiple teams — covered in UC: Engineering Manager Navigates Between Teams.
- Establishing the manager/team relationship — covered in UC: Establish a Manager/Team Relationship (Identity & Access).

## Dependencies
- UC: Establish a Manager/Team Relationship — access depends on a pre-established relationship.
- UC: Enforce Access Control on Team Content — authorization is enforced before data is served.
- UC: View Team Trend Dashboard — the Engineering Manager sees the same dashboard as Engineers, with read-only constraints.

## Notes
- The feature specification states the Engineering Manager has read-only access to "session history, trend data, and action items." Action items are surfaced in session detail; the dashboard itself shows trends and history.
- It should be confirmed whether individual participant vote attribution is visible to Engineering Managers in session detail, or whether only aggregated results are shown.

---

# Use Case: Engineering Manager Navigates Between Teams

## Summary
**Actor:** Engineering Manager

**Trigger:** An Engineering Manager who manages more than one team wants to switch from viewing one team's dashboard to another team's dashboard.

**Goal:** As an Engineering Manager who manages multiple teams, I want to navigate between the dashboards of my teams so that I can review each team's health without leaving the application or re-authenticating.

---

## Preconditions
- The Engineering Manager is authenticated.
- The Engineering Manager has been associated with two or more teams.
- The Engineering Manager is viewing one team's trend dashboard.

## Main Flow
1. The Engineering Manager selects a team-switching control (e.g., a team selector, navigation menu, or list of managed teams).
2. The application retrieves the list of teams the Engineering Manager is associated with.
3. The Engineering Manager selects a different team from the list.
4. The application verifies the manager/team relationship for the selected team.
5. The application loads and renders the trend dashboard for the selected team.
6. The Engineering Manager reviews the newly selected team's dashboard.

## Alternate Flows
- **Engineering Manager manages only one team:** No team-switching control is displayed, or only one team appears in the list. Navigation between teams is not applicable.
- **Selected team's data fails to load:** The application displays an error for the selected team's dashboard. The Engineering Manager can navigate back to their previous team or select another.
- **Manager/team relationship for the selected team has been removed since the list was rendered:** The application denies access when the selection is confirmed and refreshes the list of accessible teams.

## Postconditions
- **Success:** The Engineering Manager is viewing the trend dashboard for the selected team.
- **Failure:** The dashboard for the selected team does not load. The Engineering Manager remains on the previous team's dashboard or receives an error.

---

## Acceptance Criteria
- [ ] An Engineering Manager associated with more than one team can navigate between each team's trend dashboard within the application.
- [ ] The list of navigable teams contains only teams the Engineering Manager is explicitly associated with.
- [ ] Switching teams loads the correct team's dashboard.
- [ ] Data from one team is not visible on another team's dashboard after switching.
- [ ] If a manager/team relationship is revoked, the revoked team no longer appears in the navigation list on the next access check.

## Out of Scope
- Comparing data across multiple teams simultaneously — the dashboard is per-team.
- Establishing or modifying manager/team relationships — covered in UC: Establish a Manager/Team Relationship (Identity & Access).

## Dependencies
- UC: Engineering Manager Views Team Trend Dashboard — this use case extends the single-team view to a multi-team context.
- UC: Enforce Access Control on Team Content — authorization is re-verified on each team switch.

## Notes
- The UI pattern for team switching (e.g., dropdown, sidebar list, breadcrumb) is an implementation concern, but it should be discoverable for managers with multiple teams.
- The list of teams should reflect the current state of manager/team relationships, not a cached snapshot, to prevent access to recently de-associated teams.

---

# Use Case: Unauthorized User Attempts to View a Team Dashboard

## Summary
**Actor:** Application

**Trigger:** An authenticated user attempts to access the trend dashboard for a team they have no authorized relationship with.

**Goal:** As the application, I want to deny access to a team's trend dashboard for any user who is not a team member, the team's Engineering Manager, or the team's current facilitator so that session data and trend history remain private to authorized parties.

---

## Preconditions
- The user is authenticated.
- The user is attempting to access the trend dashboard for a specific team.
- The user has no authorized relationship with that team (not a member, not the Engineering Manager, not the active facilitator).

## Main Flow
1. The user navigates to a team's trend dashboard URL (e.g., by guessing a URL, following an old link, or attempting to access another team's data).
2. The application checks the user's relationship to the team.
3. No authorized relationship is found.
4. The application denies access.
5. The application displays an error indicating the user does not have access. The error does not confirm whether the team exists or what data it may contain.
6. The user is offered navigation back to their own team(s) or the application home.

## Alternate Flows
- **User is unauthenticated:** The application redirects to sign-in before evaluating access. After authentication, access control is re-evaluated and access is denied if no relationship exists.
- **User is an Engineer from a different team:** Access is denied. The engineer's lack of team membership is the disqualifying condition.
- **User is an Engineering Manager for a different team:** Access is denied. The manager can only access teams they explicitly manage.

## Postconditions
- **Success (of enforcement):** The user is denied access. No team data is disclosed. The denial cannot be exploited to enumerate team IDs or confirm team existence.
- **Failure (of enforcement):** Team data is improperly disclosed. This is a security failure requiring immediate investigation.

---

## Acceptance Criteria
- [ ] Any authenticated user with no authorized relationship to a team receives an access-denied response when attempting to view that team's dashboard.
- [ ] The error message does not reveal whether the team exists, what sessions it has, or any other team data.
- [ ] Access control is enforced server-side; it is not dependent solely on URL obscurity or UI visibility.
- [ ] Engineers can only access the dashboards of teams they are members of.
- [ ] Engineering Managers can only access dashboards for teams they explicitly manage.
- [ ] A Facilitator who is actively facilitating a session for the team can access that team's historical trend data.
- [ ] A Facilitator who is not actively facilitating a session for the team cannot access historical trend data for that team.
- [ ] An unauthenticated user who attempts to access a team dashboard is redirected to sign-in; after signing in, access control is re-evaluated.

## Out of Scope
- General authentication enforcement — covered in UC: Sign In and UC: Enforce Access Control on Team Content (Identity & Access).
- Logging or alerting on repeated unauthorized access attempts — that is an operational/security monitoring concern.

## Dependencies
- UC: Enforce Access Control on Team Content — this use case is a specific application of that general policy in the trend dashboard context.
- UC: Sign In — unauthenticated requests are redirected here first.

## Notes
- Access control must be enforced at the API and data layer, not only in the navigation UI. A user who knows or guesses a team dashboard URL must not be able to retrieve data by calling the underlying API directly.
- A facilitator's access to historical trend data is scoped to the duration of an active session they are running for that team. Outside of an active session, a facilitator has no access to that team's historical data.
