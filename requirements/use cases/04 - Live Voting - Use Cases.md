# Live Voting — Use Cases

---

# Use Case: Advance to Next Topic

## Summary
**Actor:** Facilitator

**Trigger:** The facilitator decides the session is ready to move to the next topic (either at session start or after completing the prior topic's reveal and any discussion).

**Goal:** As a Facilitator, I want to advance the session to the next topic so that participants can begin voting on it.

---

## Preconditions
- The facilitator is authenticated and recognized as the active facilitator for this session.
- A session is in progress.
- Either: this is the start of the first topic, or the prior topic's reveal has been triggered and the facilitator has chosen to move on.
- At least one topic remains in the session queue.

## Main Flow
1. The facilitator clicks the "Next Topic" button on their control view.
2. The application marks the current topic (if any) as complete and advances the session state to the next topic.
3. The application broadcasts the new topic's prompt and vote type to all connected participants simultaneously.
4. The participant view updates to display the prompt, the vote type label, and the available vote options — with no votes selected and the lock-in control inactive.
5. The facilitator view displays the new topic's prompt, vote type, and an empty readiness grid showing all current participants in a "not yet" state.
6. The facilitator view's "Trigger Reveal" button is disabled until at least one participant locks in.

## Alternate Flows
- **No topics remain:** The "Next Topic" button is replaced by a "Wrap Up Session" action. This use case does not apply; see Session Wrap-up.
- **Participant joins mid-topic (late join):** Late joins are permitted at any point during a session. The late joiner receives the current topic state immediately on connection. They see the prompt and vote options and may vote normally. Any votes already cast by others remain hidden until the reveal. Their vote, if submitted before the reveal, is included in the results. Results are calculated from votes actually submitted, not from total participants.
- **Facilitator connection drops and reconnects:** The session is not ended or paused automatically. The facilitator can reconnect and re-authenticate to rejoin the session they created and resume as facilitator. On reconnection, the facilitator view is restored to the current topic's state, including the current readiness grid.

## Postconditions
- **Success:** All connected participants see the new topic's prompt and vote interface. The session state reflects the new active topic. No votes have been cast.
- **Failure:** If the broadcast fails, the application retries. If the topic cannot be advanced, the session remains on the current topic and an error is surfaced to the facilitator.

---

## Acceptance Criteria
- [ ] Clicking "Next Topic" causes the new prompt and vote type to appear on all connected participant screens within 1 second.
- [ ] The facilitator readiness grid shows all currently connected participants in a "not yet" state when a new topic loads.
- [ ] The "Trigger Reveal" button is disabled when no participants have locked in.
- [ ] The participant vote interface shows no selection and accepts input from the moment the topic loads.
- [ ] The vote type label displayed to participants matches the vote type configured for the topic (Finger, Roman, or Modified Roman).

## Out of Scope
- Reordering or skipping topics during a live session (see Topic Management).
- Outlier detection and discussion prompting after reveal (see Outlier Detection and Discussion Prompts).
- Session wrap-up and action item capture (see Session Wrap-up).

## Dependencies
- Session Setup: A session must exist with participants joined and topics queued.
- Real-time broadcast layer capable of pushing state changes to all connected clients simultaneously.

## Notes
- The facilitator has full discretion over when to advance. The application does not impose a timer or auto-advance.
- Topics are presented in their configured order; the facilitator cannot reorder them mid-session.

---

# Use Case: View Topic Prompt and Vote Options

## Summary
**Actor:** Engineer

**Trigger:** The facilitator advances the session to a new topic, causing the topic to appear on the participant's screen.

**Goal:** As an Engineer, I want to see the current topic's prompt and vote options so that I can understand what I am being asked to assess before casting my vote.

---

## Preconditions
- The engineer is authenticated and connected to an active session as a participant.
- The facilitator has advanced to a topic.
- The engineer has not yet voted on this topic.

## Main Flow
1. The application pushes the new topic's prompt, vote type, and available options to the engineer's screen.
2. The engineer's view updates to display:
   - The topic prompt text.
   - The vote type label (e.g., "Finger Vote — 1 to 4").
   - The available vote options appropriate to the vote type, each clearly labeled.
   - A disabled or inactive lock-in control (the engineer cannot lock in without first selecting a vote).
3. The engineer reads the prompt and available options at their own pace before selecting.

## Alternate Flows
- **Engineer is disconnected when the topic is advanced:** On reconnection, the application delivers the current topic state immediately, provided the reveal has not yet been triggered.
- **Engineer reconnects after the reveal has already been triggered:** The engineer sees the revealed vote results for the topic. They are shown as having not voted. See the connection loss use case.
- **Vote type is Modified Roman (Project Trend):** The UI renders three options (Up / Steady / Down) and labels them as direction of travel, not quality. The prompt explicitly names this as the Project Trend topic.

## Postconditions
- **Success:** The engineer sees the current topic prompt and all valid vote options. The session state records that the topic is in the voting phase for this participant.
- **Failure:** If the broadcast is not received, the engineer's screen does not update. The application detects the stale state and re-pushes the topic on reconnection.

---

## Acceptance Criteria
- [ ] The prompt text and vote type are displayed correctly for Finger Vote (1–4), Roman Vote (Up/Down), and Modified Roman (Up/Steady/Down) topics.
- [ ] Vote options for Finger Vote are labeled: 1 — Poor, 2 — Below average, 3 — Above average, 4 — Very good (or equivalent scale anchors at minimum).
- [ ] Vote options for Roman Vote are labeled: Up — Good, Down — Bad.
- [ ] Vote options for Modified Roman are labeled: Up — Trending positive, Steady — No significant change, Down — Trending negative.
- [ ] The lock-in control is inactive until the engineer selects a vote option.
- [ ] The engineer's view does not display any other participant's vote or selection at any point before the reveal.

## Out of Scope
- Displaying historical trend data or prior results to participants during the voting phase.
- Allowing the engineer to view or change the topic order.

## Dependencies
- Advance to Next Topic: This use case is triggered by the Facilitator advancing the session.
- Real-time broadcast layer.

## Notes
- Participants are assumed to understand the process before joining. The UI should be self-explanatory for the vote type, but does not need to explain the broader Engineering Health Check ritual.
- The facilitator may verbally recap vote option meanings before triggering the round; the application does not replicate this verbally.

---

# Use Case: Select a Vote

## Summary
**Actor:** Engineer

**Trigger:** The engineer decides which option to vote for on the current topic.

**Goal:** As an Engineer, I want to select my vote so that I can indicate my position before committing to it.

---

## Preconditions
- The engineer is viewing a topic prompt with vote options displayed.
- The engineer has not yet locked in a vote for this topic.
- The reveal has not yet been triggered for this topic.

## Main Flow
1. The engineer taps or clicks one of the available vote options.
2. The application highlights the selected option on the engineer's screen, providing clear visual feedback that the option is selected.
3. The lock-in control becomes active, indicating the engineer may now commit.
4. The engineer may change their selection at any point before locking in by tapping or clicking a different option; the highlight moves to the newly selected option.
5. The readiness grid on the facilitator's view does not change — the facilitator cannot see which option the engineer has selected, only whether they have locked in.

## Alternate Flows
- **Engineer selects, then deselects before locking in:** Clicking the already-selected option does not deselect it (there is no "unselected" state after a selection is made; the engineer must select a different option). The lock-in control remains active.
- **Engineer does not select before the facilitator triggers the reveal:** The engineer's vote is recorded as absent. See the facilitator triggers reveal use case.
- **Topic advances before the engineer selects:** If the facilitator somehow advances the session before the reveal (not a normal flow), the engineer's selection is discarded.

## Postconditions
- **Success:** The engineer's selected option is highlighted on their screen. The selection is held client-side pending lock-in. No other participant or the facilitator can see the selection.
- **Failure:** If the UI fails to register the selection, the engineer sees no highlight and the lock-in control remains inactive. The engineer can retry the selection.

---

## Acceptance Criteria
- [ ] Selecting a vote option produces an immediate, visible highlight or state change on the engineer's screen.
- [ ] Only one option can be selected at a time; selecting a second option deselects the first.
- [ ] The lock-in control is inactive before any option is selected and becomes active after a selection is made.
- [ ] The facilitator's readiness grid does not change when an engineer selects (but does not lock in) a vote.
- [ ] No other participant's screen reflects the engineer's selection at any point.

## Out of Scope
- Submitting or persisting the vote (see Lock In Vote).
- Any confirmation or warning before selection (confirmation occurs at lock-in, not selection).

## Dependencies
- View Topic Prompt and Vote Options: The engineer must be viewing the topic and vote interface.

## Notes
- The selection is ephemeral until lock-in. If the browser is refreshed before lock-in, the selection is lost and the engineer must re-select.

---

# Use Case: Lock In Vote

## Summary
**Actor:** Engineer

**Trigger:** The engineer decides they are ready to commit to their selected vote and activates the lock-in control.

**Goal:** As an Engineer, I want to lock in my vote so that my position is committed and I signal to the facilitator that I am ready.

---

## Preconditions
- The engineer has selected a vote option on the current topic.
- The engineer has not previously locked in on this topic.
- The reveal has not yet been triggered for this topic.

## Main Flow
1. The engineer clicks the "Lock In" button (or equivalent deliberate commit control).
2. The application presents a brief confirmation — either a confirmation prompt ("Lock in your vote? This cannot be changed.") or a clearly labeled, irreversible commit control — to ensure the action is intentional.
3. The engineer confirms the lock-in.
4. The application persists the engineer's vote for this topic server-side, associated with the current session and topic.
5. The engineer's view updates to reflect a locked-in state: the selected vote is shown, all other options are visually disabled, and the lock-in control is replaced by a "Locked in" indicator.
6. The application updates the facilitator's readiness grid, changing this engineer's status from "not yet" to "ready" (a closed fist icon or equivalent). The facilitator does not see the vote value.
7. The application does not reveal the locked-in vote to any other participant.

## Alternate Flows
- **Engineer attempts to change vote after locking in:** The vote options are non-interactive after lock-in. No action is taken. See the attempt to change locked-in vote use case.
- **Engineer locks in as the last participant:** The facilitator's readiness grid reflects a full "ready" state. The application may surface a visual cue to the facilitator that all participants are ready, but does not auto-trigger the reveal.
- **Lock-in request fails (network error):** The engineer's UI returns to the pre-lock-in state (selection still shown, lock-in control still active). An error message advises the engineer to retry. The vote is not persisted until the server confirms.
- **Engineer disconnects immediately after lock-in:** If the lock-in was confirmed server-side before disconnection, the vote is retained. The facilitator's readiness grid continues to reflect this engineer as "ready."

## Postconditions
- **Success:** The engineer's vote is persisted server-side. Their status in the facilitator's readiness grid is "ready." The engineer's UI is locked; no further vote changes are possible for this topic.
- **Failure:** The vote is not persisted. The engineer's status remains "not yet" in the facilitator's readiness grid. The engineer can retry.

---

## Acceptance Criteria
- [ ] The lock-in control requires a deliberate action (not a passive auto-submit on selection).
- [ ] The application communicates clearly before or during lock-in that the action is irreversible.
- [ ] After successful lock-in, all vote options are non-interactive on the engineer's screen.
- [ ] The facilitator's readiness grid updates within 1 second of a successful lock-in, changing the engineer's status to "ready."
- [ ] The facilitator's readiness grid does not display the engineer's vote value — only their readiness status.
- [ ] If the lock-in request fails, the engineer's UI returns to the selectable state and an error message is shown.
- [ ] A locked-in vote persists through a page refresh by the engineer.

## Out of Scope
- Triggering the reveal (facilitator action, see Trigger Vote Reveal).
- Displaying vote results (see Simultaneous Vote Reveal).

## Dependencies
- Select a Vote: The engineer must have a selection before locking in.
- Server-side vote persistence layer.
- Real-time update to facilitator's readiness grid.

## Notes
- The irreversibility of lock-in mirrors the in-person experience where a hand signal cannot be retracted after the countdown. This is a deliberate design constraint, not a technical limitation.
- The confirmation step (step 2) should be lightweight — a clearly labeled button is preferable to a modal dialog that adds friction without adding clarity.

---

# Use Case: Attempt to Change Vote After Lock-In

## Summary
**Actor:** Engineer

**Trigger:** An engineer who has already locked in a vote attempts to change their selection.

**Goal:** As a Engineer, I want to understand why I cannot change my vote so that I accept the irreversibility and do not feel the application has malfunctioned.

---

## Preconditions
- The engineer has successfully locked in a vote for the current topic.
- The reveal has not yet been triggered.

## Main Flow
1. The engineer attempts to interact with a vote option (tap, click, or keyboard action).
2. The application does not register the interaction as a selection change.
3. The vote options remain visually disabled or non-interactive.
4. The engineer's previously locked-in vote remains highlighted or indicated as their committed choice.
5. Optionally, the application displays a static message such as "Your vote is locked in and cannot be changed."

## Alternate Flows
- **Engineer attempts to use browser navigation to reload and re-vote:** On reload, the application restores the locked-in state. The engineer sees their locked-in vote and cannot re-select.

## Postconditions
- **Success:** The engineer's locked-in vote is unchanged. The engineer understands the action is irreversible.
- **Failure:** There is no failure path that results in a vote change. The vote remains locked regardless of engineer action.

---

## Acceptance Criteria
- [ ] Vote option controls are non-interactive after lock-in; click/tap events produce no state change.
- [ ] Reloading the page after lock-in does not allow the engineer to re-select a vote.
- [ ] The engineer's locked-in selection remains visually indicated after any attempted interaction.
- [ ] No error message is shown as if the application has failed — the behavior should feel intentional and clear.

## Out of Scope
- A facilitator override or administrative unlock of a vote (not supported).
- Engineer-initiated vote reset (not supported in any scenario).

## Dependencies
- Lock In Vote: This use case can only occur after a successful lock-in.

## Notes
- The application should make vote irreversibility clear before lock-in (during the lock-in flow), so that reaching this state does not come as a surprise.

---

# Use Case: View Facilitator Readiness Grid

## Summary
**Actor:** Facilitator

**Trigger:** The facilitator is monitoring participant lock-in status during the voting phase of a topic.

**Goal:** As a Facilitator, I want to see which participants have locked in their votes so that I can decide when to trigger the reveal without seeing what anyone voted.

---

## Preconditions
- The facilitator is authenticated and active as the session facilitator.
- A topic is in the voting phase (prompt has been distributed; reveal has not been triggered).
- At least one participant is connected to the session.

## Main Flow
1. The facilitator's control view displays a readiness grid containing one entry per connected participant.
2. Each entry shows the participant's name and a readiness indicator:
   - "Not yet" state (e.g., open silhouette, thinking icon) — participant has not locked in.
   - "Ready" state (e.g., closed fist icon, checkmark) — participant has locked in.
3. As each participant locks in, their entry in the grid transitions from "not yet" to "ready" in real time, without a page reload.
4. The facilitator observes the grid to gauge overall readiness. At no point does any entry display the participant's vote or selected option.
5. When all participants have locked in, the grid reflects a fully "ready" state. The application may surface a visual cue (e.g., a subtle notification or color change on the "Trigger Reveal" button) but does not auto-trigger the reveal.
6. The facilitator decides independently when to trigger the reveal.

## Alternate Flows
- **A participant disconnects during voting:** Their entry in the readiness grid is marked as disconnected (distinct from "not yet" and "ready"). If they had already locked in before disconnecting, their status remains "ready."
- **A participant joins the session after the topic has started:** Their entry is added to the readiness grid in the "not yet" state.
- **No participants have locked in yet:** The grid shows all participants in the "not yet" state. The "Trigger Reveal" button remains disabled.

## Postconditions
- **Success:** The facilitator has an accurate, real-time view of which participants are ready. No vote values have been disclosed.
- **Failure:** If real-time updates fail, the grid may show a stale state. The application should surface a connectivity indicator so the facilitator is aware the view may not be current.

---

## Acceptance Criteria
- [ ] The readiness grid displays every connected participant by name.
- [ ] The grid updates within 1 second of a participant locking in, transitioning their status to "ready."
- [ ] The readiness grid never displays a vote value or vote selection for any participant.
- [ ] A participant who has locked in and then disconnected continues to show as "ready," not "not yet" or "disconnected."
- [ ] A participant who has not locked in and disconnects is visually distinguished from participants who are connected and thinking.
- [ ] The "Trigger Reveal" button is disabled until at least one participant has locked in (or per configurable threshold — see Notes).

## Out of Scope
- Showing the facilitator any vote values or distributions before the reveal.
- Allowing the facilitator to remove or substitute participants from the grid.
- Forcing participants to vote within a time limit.

## Dependencies
- Lock In Vote: Readiness grid updates are driven by lock-in events.
- Real-time broadcast layer (WebSocket or equivalent).

## Notes
- The "Trigger Reveal" button becoming available when all participants are ready is a convenience cue, not a constraint. The facilitator may trigger the reveal at any point once the button is enabled, regardless of whether all participants have locked in.
- An open question: should there be a configurable quorum threshold (e.g., "reveal available once 80% have locked in") to handle sessions where one participant is persistently slow? This is not yet decided.

---

# Use Case: Trigger Vote Reveal

## Summary
**Actor:** Facilitator

**Trigger:** The facilitator decides that enough participants have locked in and activates the reveal.

**Goal:** As a Facilitator, I want to trigger the simultaneous reveal so that all votes become visible to everyone at the same instant.

---

## Preconditions
- The facilitator is authenticated and active as the session facilitator.
- A topic is in the voting phase.
- At least one participant has locked in a vote (the "Trigger Reveal" button is enabled).

## Main Flow
1. The facilitator clicks the "Trigger Reveal" button on their control view.
2. The application immediately changes the topic's state from "voting" to "revealed" server-side.
3. The application broadcasts the reveal event to all connected clients simultaneously.
4. All connected participants' screens transition to the revealed state at the same time (see Simultaneous Vote Reveal).
5. The facilitator's view also transitions to the post-reveal state, displaying the full vote distribution and any flagged outliers.
6. The "Trigger Reveal" button is replaced by the "Next Topic" and any discussion-management controls.

## Alternate Flows
- **Facilitator triggers reveal before all participants have locked in:** The reveal proceeds. Participants who have not locked in do not have a vote recorded for this topic. Their absence is reflected in the post-reveal display. Results are calculated from votes actually submitted — not from the total number of participants or team members.
- **A participant locks in at the exact moment the reveal is triggered:** If the lock-in is received server-side before the state transitions to "revealed," the vote is included. If the transition occurs first, the vote is not included.
- **Facilitator's connection drops immediately before triggering:** The session is not ended or paused. The facilitator can reconnect and re-authenticate to rejoin the session they created and resume as facilitator. The reveal is not triggered until the facilitator reconnects and clicks the button. The session remains in the voting phase in the interim.
- **The broadcast to some participants fails:** Those participants do not see the reveal. The application retries delivery. Participants who receive the reveal event cannot un-see it; the session state remains "revealed."

## Postconditions
- **Success:** The topic state is "revealed." All connected clients display the full vote results simultaneously. No further votes can be cast for this topic.
- **Failure:** If the server-side state transition fails, the topic remains in "voting" state. The facilitator sees an error and can retry.

---

## Acceptance Criteria
- [ ] Clicking "Trigger Reveal" transitions the topic state to "revealed" server-side before any client receives the reveal event.
- [ ] The reveal event is delivered to all connected clients within 15 seconds of the facilitator triggering it. This is the infrastructure SLA bound — the intent is that all clients receive the event near-simultaneously, not that delivery may be staggered over the full 15-second window. The reveal event includes a server-side timestamp; clients calculate observed latency against that timestamp for monitoring purposes.
- [ ] Participants who had not locked in do not have a vote recorded for this topic.
- [ ] Results (averages, tallies) are calculated from votes actually submitted, not from the total number of session participants or team members.
- [ ] After triggering the reveal, the facilitator cannot trigger a second reveal for the same topic.
- [ ] The "Trigger Reveal" button is replaced by post-reveal controls immediately upon the facilitator's own screen transitioning.

## Out of Scope
- The visual presentation of the reveal (see Simultaneous Vote Reveal).
- Outlier detection and flagging (see Outlier Detection and Discussion Prompts — a separate feature set).
- Auto-triggering the reveal without facilitator action.

## Dependencies
- View Facilitator Readiness Grid: The button becomes available based on readiness state.
- Simultaneous Vote Reveal: This use case initiates that one.
- Server-side session state machine that enforces valid transitions (voting → revealed).

## Notes
- The reveal is a one-way, irreversible state transition. There is no "un-reveal."
- The facilitator does not need all participants to be locked in before triggering. This is by design: a facilitator may call the reveal if a participant is unresponsive or the session is running long.

---

# Use Case: Simultaneous Vote Reveal

## Summary
**Actor:** Application

**Trigger:** The facilitator triggers the reveal, causing the application to deliver all votes to all clients at the same instant.

**Goal:** As the Application, I want to display all votes simultaneously to all participants so that the reveal feels like a shared event rather than a page refresh or staggered disclosure.

---

## Preconditions
- The topic is in the voting phase.
- The facilitator has triggered the reveal (see Trigger Vote Reveal).
- The server has transitioned the topic state to "revealed" and holds all locked-in votes.

## Main Flow
1. The application broadcasts a single reveal event payload to all connected clients. The payload contains all locked-in votes for the topic, associated with participant identifiers.
2. On each connected client (participant and facilitator), the vote interface animates to the revealed state. All vote values appear at the same instant — the animation begins simultaneously on all screens, not sequentially.
3. The visual presentation of the reveal conveys the social weight of the moment: vote cards appear face-up (e.g., a brief card-flip or fade-in animation) rather than as a static instant update.
4. Following the animation, the aggregate result is displayed — either the mean (for finger votes) or the tally (for Roman and Modified Roman votes).
5. All vote values remain visible. Participants can see every other participant's vote and their own vote in the context of the group.
6. The facilitator's view additionally shows any outlier flags surfaced by the application (handled by the Outlier Detection feature set).

## Alternate Flows
- **A participant is disconnected at the moment of reveal:** On reconnection, they receive the reveal state for the current topic immediately. They do not see the animation (the moment has passed); they see the static post-reveal results.
- **A participant had not locked in before the reveal:** Their vote is shown as absent (e.g., a blank card or "Did not vote" indicator). They can see all other votes.
- **Animation is disabled (reduced motion / accessibility preference):** Votes appear immediately without animation. The simultaneity is preserved; only the visual effect is omitted.

## Postconditions
- **Success:** All connected participants and the facilitator see the complete vote results simultaneously. The topic is in the "revealed" state. No further votes can be cast for this topic.
- **Failure:** If a client does not receive the broadcast, they remain in the voting-phase view. The application retries delivery; on reconnection, they receive the current state.

---

## Acceptance Criteria
- [ ] All connected clients begin rendering vote results within 15 seconds of each other as an infrastructure SLA bound. The goal remains simultaneous display — votes must not be staggered; the 15-second figure is the outer delivery window for infrastructure reliability purposes, not a license to display votes sequentially. The reveal event includes a server-side timestamp; clients calculate observed latency against that timestamp.
- [ ] Vote values are not transmitted to clients before the reveal event is broadcast (votes must not be visible in network traffic before the reveal).
- [ ] Each participant's vote is attributed to that participant by name in the results display.
- [ ] Participants who did not lock in are represented as absent rather than omitted silently.
- [ ] The aggregate result (mean for finger votes; tally for Roman and Modified Roman) is calculated from votes actually submitted, not from the total number of participants in the session or members of the team.
- [ ] The aggregate result is displayed alongside individual votes.
- [ ] A participant reconnecting after the reveal sees the full results immediately, without animation.
- [ ] The application respects reduced-motion accessibility preferences by skipping animation while preserving simultaneous display.

## Out of Scope
- Outlier flagging and discussion prompts (see Outlier Detection and Discussion Prompts).
- Persisting the session record (handled as part of session state transitions).
- Facilitator controls for managing post-reveal discussion (see Advance to Next Topic After Reveal).

## Dependencies
- Trigger Vote Reveal: This use case is initiated by that one.
- Real-time broadcast layer capable of fan-out delivery to all connected clients.
- Vote persistence: votes must be stored server-side before the reveal can be sent.

## Notes
- The simultaneity of the reveal is the most important mechanic in the entire application. Any implementation that allows some participants to see votes before others defeats the purpose of the feature.
- The reveal payload should be prepared server-side before the broadcast begins, so that all clients receive the same data in one event rather than the server fetching and sending per-client.
- Vote data must not be exposed through the API or WebSocket channel to participants in the voting phase — e.g., polling the vote endpoint before the reveal should not return values.

---

# Use Case: Participant Loses Connection During Voting

## Summary
**Actor:** Application

**Trigger:** A participant's connection to the session is interrupted while a topic is in the voting phase.

**Goal:** As the Application, I want to handle a participant's connection loss gracefully so that the session can continue and the participant can rejoin without corrupting the session state.

---

## Preconditions
- A session is in progress and a topic is in the voting phase.
- A participant loses their network connection (browser close, network drop, device sleep, etc.).

## Main Flow
1. The application detects the participant's disconnection (WebSocket close or heartbeat timeout).
2. The application updates the facilitator's readiness grid to reflect the participant as "disconnected," visually distinguished from "not yet" and "ready."
3. The session continues without the disconnected participant. Other participants may continue to lock in.
4. The participant reconnects (same session, same identity).
5. The application delivers the current topic state to the reconnected participant:
   - If the topic is still in the voting phase and the participant had not locked in: they see the prompt and vote options and may vote normally.
   - If the topic is still in the voting phase and the participant had locked in: they see their locked-in state restored.
   - If the reveal has already been triggered: they see the post-reveal results (without the reveal animation).
6. The facilitator's readiness grid updates to reflect the participant's restored status.

## Alternate Flows
- **Participant does not reconnect before the reveal is triggered:** The participant is absent from the results. Their absence is noted in the results display (not silently omitted). When they reconnect later, they see the revealed results for the current topic.
- **Participant does not reconnect for the remainder of the session:** Their locked-in votes (if any, from prior topics) are retained. They appear as absent for any topics where they had not voted before disconnecting.
- **Participant's session token expires during disconnection:** On reconnection attempt, the application requires re-authentication. After authentication, they rejoin the session if it is still active.
- **Multiple participants disconnect simultaneously:** Each is handled independently. The session continues as long as the facilitator is connected.

## Postconditions
- **Success:** The reconnected participant is restored to the correct session state for the current topic. The facilitator's readiness grid accurately reflects the participant's status. Session integrity is maintained.
- **Failure (no reconnection):** The session proceeds without the participant. Their data for topics they voted on before disconnecting is preserved.

---

## Acceptance Criteria
- [ ] The application detects participant disconnection within 10 seconds (or configurable heartbeat threshold).
- [ ] A disconnected participant is shown distinctly in the facilitator's readiness grid — not as "not yet" and not as "ready."
- [ ] A participant who reconnects during the voting phase and had not yet locked in can vote normally.
- [ ] A participant who reconnects during the voting phase and had already locked in sees their locked-in state restored; they cannot re-vote.
- [ ] A participant who reconnects after the reveal sees the post-reveal results, not the voting interface.
- [ ] Votes locked in before disconnection are not lost due to the disconnection.
- [ ] A participant absent at the time of reveal is shown as "Did not vote" in the results display.

## Out of Scope
- Facilitator disconnection and reconnection (a separate and higher-severity scenario — the session cannot proceed without the facilitator).
- Notifying other participants of a disconnection event.

## Dependencies
- Lock In Vote: Lock-in persistence is what allows the application to restore a participant's state on reconnection.
- Real-time connection layer with heartbeat and reconnection handling.

## Notes
- The application should attempt automatic reconnection on the participant's behalf before surfacing an error state.
- The session join link (distributed out-of-band) also serves as the reconnection URL — a participant simply reloads or revisits the link to rejoin.
- If the participant's session cookie or token is valid, they should not be required to re-authenticate on a simple network drop and reconnect.

---

# Use Case: Advance to Next Topic After Reveal

## Summary
**Actor:** Facilitator

**Trigger:** After the reveal and any discussion, the facilitator decides to move the session forward to the next topic.

**Goal:** As a Facilitator, I want to advance past the current revealed topic so that the session continues to the next topic without the revealed results carrying over into the next voting round.

---

## Preconditions
- The facilitator is authenticated and active as the session facilitator.
- The current topic is in the "revealed" state — votes are visible to all participants.
- The facilitator has decided (with or without discussion) to move on.

## Main Flow
1. The facilitator clicks the "Next Topic" button on their post-reveal control view.
2. The application marks the current topic as complete and records the final state (votes, reveal timestamp).
3. If there are topics remaining in the queue, the application advances to the next topic (see Advance to Next Topic).
4. All participant screens clear the reveal results and transition to the new topic's prompt and vote interface.
5. The facilitator's view transitions to the new topic's readiness grid and controls.

## Alternate Flows
- **Facilitator marks the topic for discussion before advancing:** The topic is flagged in the session sidebar for reference. The facilitator may then advance; the flag persists but does not block progression.
- **No topics remain:** The "Next Topic" button is replaced by "Wrap Up Session." Clicking it initiates the session wrap-up flow (separate feature set).
- **Participant objects to moving on:** The application has no mechanism for participants to block the facilitator's advance. The facilitator controls session pace entirely.

## Postconditions
- **Success:** The current topic is marked complete with votes recorded. The session advances to the next topic. All participants see the new prompt.
- **Failure:** If the state transition fails, the session remains on the revealed topic. The facilitator sees an error and can retry.

---

## Acceptance Criteria
- [ ] Clicking "Next Topic" in the post-reveal state marks the current topic complete and initiates the next topic flow.
- [ ] All participant screens clear the revealed vote results and display the new topic prompt within 1 second.
- [ ] The completed topic's votes and state are persisted before the session advances.
- [ ] Topics marked for discussion during the session are retained in the facilitator's sidebar and are not cleared when advancing.
- [ ] If no topics remain, "Next Topic" is not available; "Wrap Up Session" is shown instead.

## Out of Scope
- Session wrap-up and action item confirmation (see Session Wrap-up).
- Modifying or annotating discussion notes mid-session (see Session Wrap-up).

## Dependencies
- Simultaneous Vote Reveal: This use case follows that one.
- Advance to Next Topic: Advancing after reveal reuses the same topic-advance mechanics.
- Session state machine: valid transition from "revealed" to "voting" (next topic) or "wrap-up."

## Notes
- The facilitator may advance immediately after reveal, or may allow extended discussion. There is no enforced minimum dwell time on the revealed state.
- Discussion notes and action items captured during discussion are associated with the current topic and retained regardless of when the facilitator advances.
