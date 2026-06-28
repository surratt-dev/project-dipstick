# Session Setup — Use Cases

---

# Use Case: Create Session for Existing Team

## Summary
**Actor:** Facilitator

**Trigger:** The Facilitator decides to run an Engineering Health Check session for a team they do not belong to, and that team already exists in the application.

**Goal:** As a Facilitator, I want to create a new session for an existing team so that I can generate a join link and prepare the session room for participants.

---

## Preconditions
- The Facilitator is authenticated via the Identity Provider.
- The Facilitator is recognized by the application as a member of at least one team.
- The target team exists in the application and has at least one member.
- The Facilitator is not a member of the target team.
- No other session is currently active for the target team (or the application permits concurrent sessions — this is an open question; see Notes).

## Main Flow
1. The Facilitator navigates to the session creation screen.
2. The application displays a list of teams available to facilitate (teams the Facilitator is not a member of).
3. The Facilitator selects an existing team from the list.
4. The application displays a confirmation screen showing the selected team name and the Facilitator's name.
5. The Facilitator confirms and submits the session creation request.
6. The application creates a new session record associated with the selected team and the Facilitator.
7. The application generates a unique join link for the session.
8. The application displays the session room, including the join link and the participant readiness view (initially empty).

## Alternate Flows
- **Facilitator has no eligible teams to facilitate:** The application displays a message explaining that no teams are available (either all teams include the Facilitator as a member, or no teams exist). No session is created.
- **Facilitator selects a team they belong to:** The application prevents selection and displays an error: the Facilitator must be from a different team than the one being facilitated (see also: Use Case — Facilitator Team Membership Constraint Violation).
- **Session creation fails due to a system error:** The application displays an error message. No session record is created. The Facilitator can retry.

## Postconditions
- **Success:** A session record exists for the target team, associated with the Facilitator. A unique join link has been generated. The session is in a "waiting for participants" state.
- **Failure:** No session record is created. The application state is unchanged.

---

## Acceptance Criteria
- [ ] The team selection list excludes all teams the authenticated Facilitator belongs to.
- [ ] Selecting a team and confirming creates a session record with status "waiting for participants."
- [ ] A unique join link is generated and displayed immediately after session creation.
- [ ] The session is associated with the correct team and Facilitator.
- [ ] The Facilitator sees the session room (participant readiness view) after creation.

## Out of Scope
- Inviting participants in-app (notifications and invitations are out of scope; the Facilitator shares the link manually).
- Scheduling or calendar integration.
- Selecting or customizing topics at session creation time (topic management is a separate feature set).

## Dependencies
- Identity & Access: Facilitator must be authenticated and their team membership must be resolvable.
- Team data must exist in the application.

## Notes
- Whether two sessions for the same team can be active simultaneously is an open question. This use case assumes the application does not prevent it, but an explicit constraint may be needed.
- The Facilitator's team membership is determined by application-managed data, not the Identity Provider.

---

---

# Use Case: Create Session for a New Team

## Summary
**Actor:** Facilitator

**Trigger:** The Facilitator wants to run a session for a team that does not yet exist in the application and creates the team as part of session setup.

**Goal:** As a Facilitator, I want to create a new team and immediately start a session for it so that a team that has never used the application can participate in their first Engineering Health Check.

---

## Preconditions
- The Facilitator is authenticated via the Identity Provider.
- The team the Facilitator intends to facilitate does not exist in the application.
- The Facilitator is not creating a session for their own team (the new team they are creating must be distinct from any team they belong to).

## Main Flow
1. The Facilitator navigates to the session creation screen.
2. The Facilitator selects the option to create a new team rather than selecting an existing one.
3. The application presents a team creation form requesting a team name.
4. The Facilitator enters a team name and submits the form.
5. The application validates that the team name is not already in use.
6. The application creates the new team record.
7. The application creates a new session record associated with the new team and the Facilitator.
8. The application generates a unique join link for the session.
9. The application assigns the default topic set to the new team.
10. The application displays the session room, including the join link and the participant readiness view (initially empty).

## Alternate Flows
- **Team name already exists:** The application displays an inline validation error and prompts the Facilitator to enter a different name. No team or session is created until a unique name is provided.
- **Facilitator submits an empty team name:** The application displays a validation error and does not proceed.
- **Session or team creation fails due to a system error:** The application displays an error message. No team or session record is created. The Facilitator can retry.

## Postconditions
- **Success:** A new team record exists with the provided name and the default topic set assigned. A session record exists for that team, associated with the Facilitator, in a "waiting for participants" state. A unique join link has been generated.
- **Failure:** No team or session record is created. The application state is unchanged.

---

## Acceptance Criteria
- [ ] The Facilitator can initiate new team creation from the session creation screen without navigating away.
- [ ] Team name uniqueness is validated before the team is created.
- [ ] The new team is automatically assigned the application's default topic set.
- [ ] A session is created and associated with the new team and Facilitator in a single flow.
- [ ] A unique join link is generated and displayed immediately.
- [ ] The Facilitator cannot create a team that they themselves are a member of and then use it as the session target (the new team is inherently not the Facilitator's own team since they did not exist in it prior).

## Out of Scope
- Adding team members during session setup (members join via the join link).
- Assigning an Engineering Manager to the team at creation time.
- Customizing the default topic set during session creation.

## Dependencies
- Identity & Access: Facilitator must be authenticated.
- Default topic set must exist in the application.
- Use Case: Create Session for Existing Team (shares the session creation postconditions).

## Notes
- Because team creation is implicit in session setup, there is no standalone "create team" screen. Teams come into existence only when a session is being created for them.
- The Facilitator who creates the new team is not added as a member of that team. Team membership is established when engineers join via the join link (see Use Case: Join Session via Link).
- What makes someone a "member" of the new team vs. just a participant in one session is an open question that may affect how team membership is assigned at join time.

---

---

# Use Case: Copy Session Join Link

## Summary
**Actor:** Facilitator

**Trigger:** The Facilitator wants to distribute the session join link to participants and copies it from the session room.

**Goal:** As a Facilitator, I want to copy the session join link so that I can share it with participants through an external channel (e.g., Slack, email, or a meeting chat).

---

## Preconditions
- A session has been created and is in a "waiting for participants" state.
- The Facilitator is viewing the session room.
- A join link has been generated and is displayed in the session room.

## Main Flow
1. The Facilitator views the session room, where the join link is displayed.
2. The Facilitator clicks or activates the copy button adjacent to the join link.
3. The application copies the join link URL to the Facilitator's clipboard.
4. The application displays a brief confirmation (e.g., "Link copied") to acknowledge the action.
5. The Facilitator pastes and shares the link via an out-of-band channel.

## Alternate Flows
- **Clipboard API unavailable (browser or OS restriction):** The application falls back to displaying the join link as selectable text so the Facilitator can copy it manually. No confirmation of successful copy is shown.
- **Facilitator manually selects and copies the link text:** The application does not interfere. The link is visible and selectable at all times.

## Postconditions
- **Success:** The join link URL is on the Facilitator's clipboard. The session state is unchanged.
- **Failure:** The Facilitator has not been able to copy the link via the button, but the link remains visible and can be copied manually. No session state change occurs.

---

## Acceptance Criteria
- [ ] The join link is displayed prominently in the session room at all times before the session begins.
- [ ] A copy button is present adjacent to the join link.
- [ ] Activating the copy button places the full join link URL on the system clipboard.
- [ ] A visible confirmation is shown after a successful copy.
- [ ] The join link remains visible and manually copyable regardless of clipboard API availability.

## Out of Scope
- Sending the link directly to participants within the application (notifications are out of scope).
- Generating QR codes or other alternate link formats.
- Expiring the link after it is copied (link expiry is governed by session state, not copy events).

## Dependencies
- Use Case: Create Session for Existing Team or Create Session for New Team (a session and join link must exist first).

## Notes
- The join link must be a stable, fully-formed URL that works when pasted into any browser without requiring additional context.
- The application does not track whether or how the Facilitator shares the link.

---

---

# Use Case: Join Session via Link

## Summary
**Actor:** Engineer (participant)

**Trigger:** An Engineer receives the session join link from the Facilitator and navigates to it in their browser.

**Goal:** As an Engineer, I want to join the session room via the join link so that I can participate in the Engineering Health Check session.

---

## Preconditions
- A session has been created and is in a "waiting for participants" state.
- A valid join link for the session exists and has been shared with the Engineer.
- The Engineer has access to the link (received it out-of-band from the Facilitator).

## Main Flow
1. The Engineer navigates to the join link URL in their browser.
2. If the Engineer is not authenticated, the application redirects them to the Identity Provider for authentication.
3. The Identity Provider authenticates the Engineer and returns a verified identity to the application.
4. The application resolves the Engineer's identity and confirms the link is valid and the session is open.
5. The application places the Engineer in the session room as a participant.
6. The application updates the participant readiness view to show the Engineer as present (not yet ready).
7. The Engineer sees the session waiting screen, indicating the session has not yet begun.
8. The Facilitator's readiness view updates to reflect the new participant.

## Alternate Flows
- **Engineer is already authenticated:** Steps 2–3 are skipped. The application proceeds directly to link validation and session entry.
- **Join link is invalid (malformed or does not correspond to any session):** The application displays an error page explaining the link is invalid. The Engineer is not placed in any session (see also: Use Case — Join with Invalid or Expired Link).
- **Session has already started (is in a "live voting" or later state):** Late joins are permitted. The joining engineer is placed into the session room and sees the current topic. They may vote on any topic that has not yet been revealed. Topics already revealed are visible to them as completed results. They cannot vote on topics that have already been revealed.
- **Engineer is already in the session (navigates to the link again):** The application reconnects them to the session room without creating a duplicate participant entry.
- **Authentication fails or is cancelled:** The application returns the Engineer to an unauthenticated state. They are not admitted to the session.

## Postconditions
- **Success:** The Engineer is a recognized participant in the session. Their presence is reflected in the Facilitator's readiness view. The session remains in "waiting for participants" state until the Facilitator advances it.
- **Failure:** The Engineer is not added as a participant. The session state is unchanged.

---

## Acceptance Criteria
- [ ] Navigating to a valid join link while unauthenticated triggers an authentication redirect before granting session access.
- [ ] Navigating to a valid join link while authenticated admits the Engineer to the session room immediately.
- [ ] The Engineer appears in the Facilitator's participant readiness view upon joining.
- [ ] Navigating to the same join link a second time reconnects the Engineer without duplicating their participant entry.
- [ ] The Engineer sees a waiting state UI, not the live voting UI, if the session has not yet begun.

## Out of Scope
- Verifying that the Engineer is a member of the team being facilitated (any authenticated user who has the link may join — or this may be enforced; see Notes).
- Sending confirmation or notifications when an Engineer joins.

## Dependencies
- Identity & Access: Authentication via Identity Provider.
- Use Case: Create Session for Existing Team or Create Session for New Team (session and join link must exist).
- Use Case: Copy Session Join Link (describes how the Facilitator obtains and shares the link).

## Notes
- Whether the application restricts joining to members of the session's team, or allows any authenticated user with the link to join, is an open question. The current description implies the link is the sole access control mechanism.
- Late joins are permitted. A late-joining engineer may vote on any topic not yet revealed; revealed topics are shown as completed results. Vote results for each topic are calculated from votes actually submitted, not from total session participants or team size.
- If team membership is assigned at join time (for a new team), the mechanism for that assignment should be defined.

---

---

# Use Case: Join Session with Invalid or Expired Link

## Summary
**Actor:** Engineer (participant)

**Trigger:** An Engineer navigates to a session join link that is invalid, malformed, or corresponds to a session that is no longer joinable.

**Goal:** As an Engineer, I want to receive a clear explanation when a join link does not work so that I know why I cannot enter the session and what to do next.

---

## Preconditions
- The Engineer navigates to a URL that was intended to be a session join link.
- The link is one of the following: malformed (not a valid join link format), referencing a session that does not exist, or referencing a session that has ended or is in a state that does not accept new participants.

## Main Flow
1. The Engineer navigates to the join link URL.
2. If the Engineer is not authenticated, the application may redirect them to authenticate first, then return to the link validation step.
3. The application attempts to resolve the link to an active, joinable session.
4. The application determines the link is invalid or the session is not joinable.
5. The application displays an error page with a plain-language explanation of why the link did not work (e.g., "This session link is no longer valid," "This session has already ended," or "This link was not recognized").
6. The application offers no automatic recovery path. The Engineer must contact the Facilitator for a valid link.

## Alternate Flows
- **Link is malformed (does not match any join link pattern):** The application displays the error page without attempting session lookup.
- **Session exists but has ended:** The application displays a specific message indicating the session is complete and no longer accepting participants.
- **Session exists but has not yet started and the link has been administratively invalidated:** Display a generic "link is no longer valid" message (if link invalidation is supported — see Notes).

## Postconditions
- **Success (error correctly surfaced):** The Engineer sees a clear error message. No session state is changed. The Engineer is not added to any session.
- **Failure:** The Engineer sees a generic or unhelpful error, leaving them without actionable next steps.

---

## Acceptance Criteria
- [ ] Navigating to a malformed join link URL displays an error page rather than a broken or blank state.
- [ ] Navigating to a link for a session that does not exist displays a clear "link not recognized" message.
- [ ] Navigating to a link for a completed session displays a message indicating the session has ended.
- [ ] The error page does not expose internal session identifiers or system details.
- [ ] The error page provides guidance to contact the Facilitator for a new link.

## Out of Scope
- Automatically redirecting the Engineer to a correct session.
- Issuing a new join link to the Engineer from the error page.

## Dependencies
- Use Case: Join Session via Link (describes the success path this use case diverges from).

## Notes
- Whether join links expire on a time basis (e.g., after 24 hours) or only become invalid when the session ends is an open question that will affect the error messages shown.
- Whether the application supports link invalidation (a Facilitator deliberately revoking a link) is not specified and may need a decision.

---

---

# Use Case: Facilitator Team Membership Constraint Violation

## Summary
**Actor:** Facilitator

**Trigger:** An authenticated user attempts to create a session for a team they are a member of, violating the constraint that the Facilitator must be from a different team.

**Goal:** As the Application, I want to prevent a Facilitator from running a session for their own team so that the neutrality of the facilitation role is preserved.

---

## Preconditions
- The user is authenticated via the Identity Provider.
- The user is a member of at least one team in the application.
- The user attempts to create a session and selects (or otherwise specifies) a team they belong to as the target team.

## Main Flow
1. The user navigates to the session creation screen.
2. The application constructs the list of available teams to facilitate.
3. The application excludes all teams the user belongs to from the selectable list.
4. The user sees only teams they are eligible to facilitate.
5. If no eligible teams exist, the application displays a message explaining no teams are available to facilitate and does not offer a session creation path.

## Alternate Flows
- **User bypasses the UI and submits a session creation request for their own team directly (e.g., via API or manipulated request):** The application validates team membership server-side and rejects the request with an authorization error. No session is created.
- **User's team membership changes between page load and submission (race condition):** The application re-validates at submission time. If the user has since joined the target team, the request is rejected.

## Postconditions
- **Success (constraint enforced):** The user cannot create a session for a team they belong to. The team list excludes their own teams. Any direct submission attempt is rejected server-side.
- **Failure (constraint not enforced):** A session is created with the Facilitator as a member of the facilitated team — this is the failure state the use case exists to prevent.

---

## Acceptance Criteria
- [ ] The team selection list shown during session creation excludes all teams the authenticated user belongs to.
- [ ] If the user belongs to all teams in the application, the session creation screen shows no available teams and explains why.
- [ ] A server-side check prevents session creation for the user's own team regardless of how the request is submitted.
- [ ] The error message, if shown after a rejected submission, is clear and does not suggest a workaround.

## Out of Scope
- Removing the user from their own team to enable facilitation (team membership changes are a separate concern).
- Allowing any exception to the cross-team rule (no exceptions are defined).

## Dependencies
- Identity & Access: The application must be able to determine the authenticated user's team memberships.
- Use Case: Create Session for Existing Team (this use case defines the constraint that applies during that flow).

## Notes
- "Different team" means the Facilitator must not be listed as a member of the team being facilitated. If the Facilitator is listed as a member of multiple teams, they are excluded from facilitating any of those teams.
- This constraint applies at the time of session creation. If a Facilitator later joins the facilitated team, the historical session is not invalidated.

---

---

# Use Case: View Participant Readiness Before Session Begins

## Summary
**Actor:** Facilitator

**Trigger:** The Facilitator is in the session room waiting for participants to join, and wants to see who has joined and whether all expected participants are present.

**Goal:** As a Facilitator, I want to see the current list of participants who have joined the session so that I can determine when to begin the session.

---

## Preconditions
- A session has been created and is in a "waiting for participants" state.
- The Facilitator is viewing the session room.
- At least zero participants may have joined (the view must work when empty).

## Main Flow
1. The Facilitator views the session room after creating the session.
2. The application displays a participant readiness view showing all Engineers who have joined via the join link.
3. As each Engineer joins, the application updates the participant list in real time without requiring a page refresh.
4. Each participant entry shows the Engineer's name and a status indicating they are present but the session has not yet begun.
5. The Facilitator uses this view to confirm expected participants have arrived before starting the session.
6. When satisfied, the Facilitator advances the session (this action is covered in a separate feature set — Pre-Session Action Item Review or Live Voting).

## Alternate Flows
- **No participants have joined yet:** The application displays the participant readiness view in an empty state with a prompt indicating no one has joined yet. The join link is still displayed so the Facilitator can re-share it.
- **A participant joins and then loses connection:** The application reflects the disconnected state in the participant list (e.g., grayed out or marked as disconnected) in real time. Whether disconnected participants count toward quorum is an open question.
- **Facilitator refreshes the page:** The participant list is restored from the session record. No participants are lost.

## Postconditions
- **Success:** The Facilitator has an accurate, real-time view of who has joined the session. No session state changes occur in this use case.
- **Failure:** The participant list is stale or unavailable. The Facilitator cannot confirm readiness.

---

## Acceptance Criteria
- [ ] The participant readiness view is displayed immediately after session creation, before any participants join.
- [ ] Each participant who joins via the join link appears in the list in real time (no manual refresh required).
- [ ] Each participant entry displays the participant's name.
- [ ] The participant list persists across page refreshes for the Facilitator.
- [ ] The view is visible only to the Facilitator in this pre-session context (participants see a waiting screen, not each other's names — this should be confirmed; see Notes).

## Out of Scope
- Showing vote status or readiness indicators in the pre-session waiting state (that belongs to Live Voting).
- Allowing the Facilitator to remove a participant from the session.
- Quorum enforcement (no minimum participant count is enforced by the application).

## Dependencies
- Use Case: Create Session for Existing Team or Create Session for New Team (session must exist).
- Use Case: Join Session via Link (Engineers must join to appear in the list).

## Notes
- Whether participants can see the names of other participants who have joined in the pre-session waiting room is not specified. This may matter for privacy in some team contexts and warrants a decision.
- Whether a disconnected participant's slot is held (they can rejoin) or released is an open question relevant to the connection handling logic.
- Real-time updates to the participant list imply a WebSocket or server-sent event connection; this is an implementation detail but should be accounted for in the tech stack.
