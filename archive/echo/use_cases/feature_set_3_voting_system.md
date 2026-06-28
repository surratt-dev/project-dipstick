# Use Cases: Feature Set 3 - Voting System

---

# Use Case: Cast Finger Vote (1-4)

## Summary
**Actor:** Participant

**Trigger:** Facilitator announces finger voting phase for a topic

**Goal:** As a Participant, I want to cast a finger vote (1-4) so that I can honestly express my sentiment on a topic with a nuanced scale that forces me to commit to either positive or negative.

---

## Preconditions
- Participant is authenticated and joined the active Health Check session
- Facilitator has stated the question and announced finger voting (1-4)
- Facilitator has explained what "good" and "bad" mean for this specific question
- Voting phase is open (not yet locked by facilitator)
- Participant has seen the countdown signal

## Main Flow
1. Participant considers the topic and determines their sentiment (1=bad, 4=good)
2. Participant holds up 1, 2, 3, or 4 fingers simultaneously with other participants
3. System captures the vote in real-time
4. System displays visual confirmation of vote capture to the participant
5. Vote is transmitted to facilitator's view for recording

## Alternate Flows
- **If participant is not ready:** Participant shows closed fist; facilitator waits before initiating countdown
- **If participant joins late:** System displays current voting status; participant may be unable to vote if phase is locked
- **If network disruption occurs:** System attempts to reconnect; vote may be re-sent on reconnection

## Postconditions
- **Success:** Vote is captured and associated with the participant (for outlier identification)
- **Failure:** Vote is not captured; participant may request to re-vote if within open voting window

---

## Acceptance Criteria
- [ ] Participant can select 1, 2, 3, or 4 fingers as vote
- [ ] Vote is transmitted in real-time to facilitator view
- [ ] Participant receives confirmation their vote was captured
- [ ] Vote is tied to participant identity for outlier discussion
- [ ] Even number scale prevents neutral default selection

## Out of Scope
- Vote anonymity during live session (identity revealed only for outlier discussion)
- Historical vote comparison during voting phase

## Dependencies
- Use Case: Join Active Session
- Use Case: Simultaneous Voting Phase

## Notes
- Participant must commit to positive (3-4) or negative (1-2) side; no middle ground

---

# Use Case: Cast Roman Vote (Thumbs Up/Down)

## Summary
**Actor:** Participant

**Trigger:** Facilitator announces Roman voting phase for a binary topic

**Goal:** As a Participant, I want to cast a thumbs up or thumbs down vote so that I can indicate whether a binary condition is met or not met.

---

## Preconditions
- Participant is authenticated and joined the active Health Check session
- Facilitator has stated the binary question and announced Roman voting
- Facilitator has explained what "good" (thumbs up) and "bad" (thumbs down) mean for this specific question
- Voting phase is open
- Participant has seen the countdown signal

## Main Flow
1. Participant considers the binary condition (working/not working, present/absent)
2. Participant displays thumbs up (good) or thumbs down (bad) simultaneously
3. System captures the vote in real-time
4. System displays confirmation of vote capture
5. Vote is transmitted to facilitator's view

## Alternate Flows
- **If participant is uncertain:** Participant must still commit to up or down (no abstention)
- **If network disruption occurs:** System attempts reconnection; vote may be re-sent

## Postconditions
- **Success:** Vote is captured as binary value associated with participant
- **Failure:** Vote not captured; may retry if voting window still open

---

## Acceptance Criteria
- [ ] Participant can select thumbs up or thumbs down
- [ ] Vote is transmitted in real-time
- [ ] Vote is tied to participant identity for outlier identification
- [ ] Binary choice enforced (no neutral option)

## Out of Scope
- Multi-value voting (use finger vote or modified Roman)
- Abstaining from vote

## Dependencies
- Use Case: Join Active Session
- Use Case: Simultaneous Voting Phase

## Notes
- Use for yes/no questions, test suite consistency, technology comfort

---

# Use Case: Cast Modified Roman Vote (Up/Flat/Down)

## Summary
**Actor:** Participant

**Trigger:** Facilitator announces Modified Roman voting phase for a trend question

**Goal:** As a Participant, I want to cast a Modified Roman vote (thumbs up, flat hand, thumbs down) so that I can indicate whether a trend is positive, steady, or negative.

---

## Preconditions
- Participant is authenticated and joined the active Health Check session
- Facilitator has stated the trend question and announced Modified Roman voting
- Facilitator has explained what each position means for this specific question
- Voting phase is open
- Participant has seen the countdown signal

## Main Flow
1. Participant considers the trend direction (improving, stable, declining)
2. Participant displays thumbs up (positive), flat hand (steady), or thumbs down (negative)
3. System captures the vote in real-time
4. System displays confirmation of vote capture
5. Vote is transmitted to facilitator's view

## Alternate Flows
- **If participant shows fist horizontally:** System recognizes as flat/neutral position
- **If network disruption occurs:** System attempts reconnection; vote may be re-sent

## Postconditions
- **Success:** Vote is captured as three-state value associated with participant
- **Failure:** Vote not captured; may retry if voting window still open

---

## Acceptance Criteria
- [ ] Participant can select thumbs up, flat hand, or thumbs down
- [ ] Horizontal fist is recognized as flat/neutral position
- [ ] Vote is transmitted in real-time
- [ ] Vote is tied to participant identity for outlier identification

## Out of Scope
- Combining with finger voting on same question
- Numeric interpretation of trend strength

## Dependencies
- Use Case: Join Active Session
- Use Case: Simultaneous Voting Phase

## Notes
- Use for trend questions where direction matters more than absolute state

---

# Use Case: Initiate Simultaneous Voting Phase

## Summary
**Actor:** Facilitator

**Trigger:** Facilitator completes discussion on a topic and is ready to collect votes

**Goal:** As a Facilitator, I want to initiate a simultaneous voting phase so that all participants vote at the same time without seeing others' votes first, ensuring honest feedback.

---

## Preconditions
- Facilitator is authenticated and has started or joined an active Health Check session
- Current topic/question has been stated and discussed
- All participants are present and ready
- Session is in active state (not concluded)

## Main Flow
1. Facilitator announces the vote type (Finger, Roman, or Modified Roman)
2. Facilitator briefly explains what "good" and "bad" mean for this question
3. Facilitator instructs participants to prepare (consider their answer privately)
4. Participants signal readiness by showing closed fist
5. Facilitator observes all participants showing fists
6. Facilitator initiates countdown: "3... 2... 1... vote"
7. System locks in voting phase and enables vote capture
8. Participants simultaneously display their votes
9. System captures all votes in real-time
10. Facilitator records the results

## Alternate Flows
- **If participant not ready:** Facilitator waits; does not begin countdown
- **If participant displays vote early:** Facilitator reminds about simultaneous display; system may flag early votes
- **If technical issue prevents capture:** Facilitator may call for re-vote

## Postconditions
- **Success:** All votes are captured; voting phase is complete
- **Failure:** Some votes not captured; facilitator may re-initiate voting

---

## Acceptance Criteria
- [ ] Facilitator can select vote type before initiating
- [ ] Countdown is displayed/synchronized for all participants
- [ ] All participants see countdown and vote display prompt simultaneously
- [ ] Votes are captured only after countdown completes
- [ ] Early votes are identified or prevented

## Out of Scope
- Vote calculation and display (separate use case)
- Session time management

## Dependencies
- Use Case: Start Health Check Session
- Use Case: Manage Session Topics

## Notes
- Simultaneous voting prevents anchoring bias

---

# Use Case: Submit and Lock Votes

## Summary
**Actor:** Facilitator

**Trigger:** All participants have cast their votes during voting phase

**Goal:** As a Facilitator, I want to submit and lock the votes so that they cannot be changed and can be officially recorded.

---

## Preconditions
- Voting phase is active with votes being captured
- All participants have cast votes (or voting window has elapsed)
- Facilitator has observed the votes

## Main Flow
1. Facilitator confirms all votes have been displayed
2. Facilitator triggers vote submission
3. System locks the voting interface for all participants
4. System calculates and stores the vote results
5. System marks votes as finalized for the current topic
6. Results are displayed to facilitator and participants

## Alternate Flows
- **If participant has not voted:** Facilitator may wait or proceed with missing vote
- **If facilitator submits prematurely:** Lock may be reversible within brief window
- **If system error occurs:** Facilitator may re-open voting with confirmation

## Postconditions
- **Success:** Votes are locked; no further changes allowed for this topic
- [ ] Results are stored and associated with the topic
- **Failure:** Lock may not complete; votes may remain modifiable

---

## Acceptance Criteria
- [ ] Facilitator can explicitly submit and lock votes
- [ ] Voting interface is disabled after lock
- [ ] Vote data is persisted to database
- [ ] Timestamp of vote submission is recorded
- [ ] Participants cannot modify their vote after lock

## Out of Scope
- Re-opening a concluded session
- Modifying historical votes

## Dependencies
- Use Case: Cast Finger Vote / Cast Roman Vote / Cast Modified Roman Vote
- Use Case: Initiate Simultaneous Voting Phase

## Notes
- Locking ensures integrity of voting record for trend analysis

---

# Use Case: Calculate Voting Results

## Summary
**Actor:** System

**Trigger:** Votes are submitted and locked for a topic

**Goal:** As the System, I want to calculate voting results including averages, tallies, and statistics so that participants can understand the group's sentiment.

---

## Preconditions
- Votes have been locked for a specific topic
- Vote type is known (Finger, Roman, Modified Roman)
- All votes are associated with participant identities

## Main Flow
1. System receives vote lock signal
2. System retrieves all votes for the current topic
3. System calculates statistics based on vote type:
   - **Finger Vote:** Average, median, distribution (count per value 1-4)
   - **Roman Vote:** Percentage thumbs up vs thumbs down, tally counts
   - **Modified Roman Vote:** Distribution across three positions, percentages
4. System stores calculated results
5. System triggers outlier detection
6. Results are displayed to facilitator and participants

## Alternate Flows
- **If insufficient votes:** System handles single-vote scenario (no average possible)
- **If vote data corrupted:** System logs error; facilitator may re-vote
- **If calculation timeout:** System retries; partial results may be shown

## Postconditions
- **Success:** Results are calculated, stored, and displayed
- **Failure:** Error is logged; manual calculation may be needed

---

## Acceptance Criteria
- [ ] Finger vote calculates average (mean) and median
- [ ] Finger vote shows distribution count for each value (1-4)
- [ ] Roman vote shows percentage breakdown (up vs down)
- [ ] Modified Roman vote shows distribution across three positions
- [ ] Results are displayed in real-time to all connected clients
- [ ] Results are persisted for historical trend analysis

## Out of Scope
- Trend comparison across sessions (separate use case)
- Anomaly detection beyond outlier highlighting

## Dependencies
- Use Case: Submit and Lock Votes

## Notes
- Results should be displayed using appropriate visualizations

---

# Use Case: Detect and Highlight Outliers

## Summary
**Actor:** System

**Trigger:** Voting results have been calculated

**Goal:** As the System, I want to detect and highlight outliers so that the facilitator can identify participants whose votes significantly differ from the group consensus for follow-up discussion.

---

## Preconditions
- Voting results have been calculated
- Vote type is known
- Individual votes are associated with participant identities

## Main Flow
1. System completes result calculation
2. System applies outlier detection algorithm:
   - **Finger Vote:** Votes 2 or more points from the average are flagged
   - **Roman Vote:** Any vote opposite the majority (>50%) when minority is significant
   - **Modified Roman Vote:** Votes at extreme ends when group clusters in middle
3. System highlights outliers on facilitator's view
4. Outlier information is displayed with participant identity to facilitator only
5. Facilitator is notified of outlier count
6. Facilitator requests clarification from outlier voters

## Alternate Flows
- **If no outliers detected:** System indicates consensus reached
- **If all votes are outliers:** System warns facilitator (possible misunderstanding)
- **If facilitator hides outliers:** Option to collapse outlier section

## Postconditions
- **Success:** Outliers are identified and highlighted; facilitator can address
- **Failure:** Outliers not detected; discussion proceeds without outlier identification

---

## Acceptance Criteria
- [ ] Finger vote outliers detected when 2+ points from average
- [ ] Outliers are visually distinguished in facilitator view
- [ ] Participant identity is shown only to facilitator
- [ ] Outlier count is displayed
- [ ] System handles edge case of all votes being outliers

## Out of Scope
- Automatic removal or adjustment of outliers
- Predictive outlier detection

## Dependencies
- Use Case: Calculate Voting Results

## Notes
- Outlier discussion is about understanding, not convincing

---

# Use Case: View Voting Results as Participant

## Summary
**Actor:** Participant

**Trigger:** Facilitator has locked votes and results are calculated

**Goal:** As a Participant, I want to view the voting results after voting is complete so that I can understand the group's sentiment and discuss outliers.

---

## Preconditions
- Participant is authenticated and in the active session
- Votes have been submitted and locked
- Results have been calculated

## Main Flow
1. System displays results to all participants
2. Participant sees:
   - Average/median for finger votes
   - Distribution/tallies for all vote types
   - Visual representation (charts, bars, percentages)
3. Participant sees outlier indicators (without knowing who is outlier)
4. Facilitator leads discussion on outliers

## Alternate Flows
- **If participant temporarily disconnected:** Results are shown upon reconnection
- **If participant joined after results:** May not see results for that topic

## Postconditions
- **Success:** Participant sees results and can participate in discussion
- **Failure:** Participant may need to refresh or reconnect

---

## Acceptance Criteria
- [ ] Results are displayed in real-time after vote lock
- [ ] Average and distribution shown for finger votes
- [ ] Percentage breakdown shown for Roman and Modified Roman votes
- [ ] Visual representation is clear and accessible
- [ ] Participant can reference results during discussion

## Out of Scope
- Exporting results to external formats
- Comparing to previous session results

## Dependencies
- Use Case: Calculate Voting Results
- Use Case: Submit and Lock Votes

## Notes
- Outlier identities are not revealed to other participants

---

# Use Case: View Session Results as Engineering Manager

## Summary
**Actor:** Engineering Manager

**Trigger:** Health Check session has concluded

**Goal:** As an Engineering Manager, I want to view complete session results including individual votes after the session concludes so that I can understand team health metrics and make informed decisions.

---

## Preconditions
- Engineering Manager is authenticated
- Session has been concluded by facilitator
- Manager has been granted access to the team's session data

## Main Flow
1. Manager navigates to session history
2. Manager selects a concluded session
3. System displays:
   - All topics voted on
   - Vote results per topic (averages, distributions)
   - Outlier highlights and discussion notes
   - Action items created during session
4. Manager can filter by topic or date range
5. Manager can compare to previous sessions (trend view)

## Alternate Flows
- **If manager has no access:** System denies access with appropriate message
- **If session data unavailable:** System shows error; may indicate data retention policy
- **If concurrent session viewing:** Changes not shown until manager refreshes

## Postconditions
- **Success:** Manager can view all results and metrics
- **Failure:** Access denied or data unavailable

---

## Acceptance Criteria
- [ ] Manager can view all topics and vote results
- [ ] Individual votes are visible (not just aggregates)
- [ ] Outlier discussions are visible in notes
- [ ] Action items are displayed with assignees
- [ ] Manager cannot view live in-progress sessions
- [ ] Results are read-only (no modification)

## Out of Scope
- Participating in or influencing live sessions
- Modifying session data or action items

## Dependencies
- Use Case: Conclude Health Check Session
- Use Case: Calculate Voting Results

## Notes
- Manager intentionally excluded from live sessions to ensure psychological safety

---

# Use Case: Handle Simultaneous Real-Time Voting

## Summary
**Actor:** System

**Trigger:** Multiple participants cast votes during active voting phase

**Goal:** As the System, I want to handle simultaneous real-time voting so that all votes are captured accurately without race conditions or data loss.

---

## Preconditions
- Voting phase is active
- Multiple participants are connected
- Network connectivity is stable

## Main Flow
1. System receives vote events from multiple participants
2. System queues and processes votes in order received
3. System associates each vote with participant identity
4. System validates vote format against vote type
5. System stores votes in real-time database
6. System broadcasts vote capture confirmation to sender
7. System updates facilitator's live vote display
8. System prevents duplicate vote submissions

## Alternate Flows
- **If participant votes twice:** System accepts only first valid vote
- **If vote received after lock:** System rejects vote with notification
- **If network latency high:** System shows "pending" state until confirmed
- **If participant disconnects mid-vote:** System captures partial; shows disconnected status

## Postconditions
- **Success:** All votes captured accurately with correct identities
- **Failure:** Partial capture; system logs error for recovery

---

## Acceptance Criteria
- [ ] Votes from multiple participants captured without data loss
- [ ] Each vote correctly associated with participant identity
- [ ] Vote confirmation displayed to participant within 500ms
- [ ] Facilitator view updates in real-time
- [ ] Double-voting is prevented
- [ ] Votes after lock are rejected

## Out of Scope
- Offline voting (not supported)
- Proxy voting

## Dependencies
- Use Case: Initiate Simultaneous Voting Phase
- Use Case: Submit and Lock Votes

## Notes
- Real-time synchronization uses WebSocket or similar technology

---

# Use Case: Request Outlier Clarification

## Summary
**Actor:** Facilitator

**Trigger:** Outliers have been detected and highlighted in voting results

**Goal:** As a Facilitator, I want to request clarification from outlier voters so that we can understand their perspective without debate.

---

## Preconditions
- Voting results calculated with outliers identified
- Facilitator has identified which participants are outliers
- Session is still active

## Main Flow
1. System highlights outliers with participant names to facilitator
2. Facilitator addresses the group: "I notice we have some outliers"
3. Facilitator asks outlier participant to briefly describe their perspective
4. Participant provides brief explanation (30 seconds max)
5. Other participants listen without defending
6. Facilitator documents the perspective in session notes
7. Discussion moves on promptly

## Alternate Flows
- **If outlier declines to explain:** Facilitator accepts; notes "no elaboration"
- **If discussion becomes defensive:** Facilitator redirects; reminds of ground rules
- **If multiple outliers:** Facilitator addresses each briefly

## Postconditions
- **Success:** Outlier perspectives are captured in notes
- **Failure:** Notes not recorded; may impact follow-up

---

## Acceptance Criteria
- [ ] Facilitator sees outlier identities after results
- [ ] Ground rules for outlier discussion are accessible
- [ ] Notes field is available for facilitator to record perspectives
- [ ] Discussion time is visible to help keep within timebox
- [ ] No "Yes, but..." responses occur

## Out of Scope
- Resolving issues during session
- Long debate on outlier position

## Dependencies
- Use Case: Detect and Highlight Outliers
- Use Case: View Voting Results as Participant

## Notes
- Purpose is understanding, not convincing outlier to change vote

---

# Use Case: Re-Vote on Topic

## Summary
**Actor:** Facilitator

**Trigger:** Technical issue, facilitator error, or request from participants

**Goal:** As a Facilitator, I want to re-initiate voting on the current topic so that we can capture accurate votes if something went wrong.

---

## Preconditions
- Session is active
- Previous vote was cast on current topic
- Facilitator determines re-vote is necessary

## Main Flow
1. Facilitator announces need to re-vote
2. Facilitator resets voting state for current topic
3. System clears previous votes from display
4. Facilitator re-initiates voting phase
5. Participants cast new votes
6. New results replace previous results

## Alternate Flows
- **If some participants already left:** Facilitator proceeds with remaining participants
- **If system prevents reset:** Facilitator must conclude session; notes issue

## Postconditions
- **Success:** New votes captured; previous votes archived
- **Failure:** Cannot reset; must proceed with original results

---

## Acceptance Criteria
- [ ] Facilitator can reset current topic's voting state
- [ ] Previous votes are archived (not deleted)
- [ ] New votes are captured with new timestamp
- [ ] Participants are notified of re-vote

## Out of Scope
- Partial re-vote (only specific participants)
- Infinite re-votes (limit per topic)

## Dependencies
- Use Case: Initiate Simultaneous Voting Phase

## Notes
- Re-votes should be rare; excessive re-votes may indicate facilitation issues
