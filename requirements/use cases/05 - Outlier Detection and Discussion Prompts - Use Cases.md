# Outlier Detection & Discussion Prompts — Use Cases

---

# Use Case: Detect Individual Outlier After Reveal

## Summary
**Actor:** Application

**Trigger:** The facilitator triggers the simultaneous vote reveal for a topic.

**Goal:** As the Application, I want to automatically identify votes that diverge significantly from the group so that individual outliers are surfaced without requiring the facilitator to manually inspect every vote.

---

## Preconditions
- A session is in progress and a topic has been voted on.
- All participants have locked in their votes.
- The facilitator has triggered the reveal; all votes are now visible to all participants.
- The topic uses the finger vote type (1–4 scale), which is the only vote type for which an individual outlier threshold (more than 1.5 points from the group average) is applicable.
- At least two participants have cast votes (a single vote cannot produce an outlier).

## Main Flow
1. The facilitator triggers the vote reveal.
2. The application calculates the group average of all locked-in votes for the topic.
3. The application compares each individual vote against the group average.
4. For each vote that differs from the group average by more than 1.5 points, the application flags that vote as an individual outlier.
5. The application updates the facilitator's view to visually highlight any flagged votes and identifies which participant(s) cast them.
6. The application presents the facilitator with controls to open discussion or advance to the next topic.

## Alternate Flows
- **No vote exceeds the threshold:** No outlier flag is raised. The facilitator's view shows all votes without any outlier indicators. See "No Outlier Detected" use case.
- **Multiple votes exceed the threshold:** All qualifying votes are flagged simultaneously. See "Multiple Outliers in the Same Reveal" use case.
- **Vote type is Roman or Modified Roman:** Individual outlier detection does not apply to binary or three-state vote types. The application does not calculate a numeric average and does not raise individual outlier flags.

## Postconditions
- **Success:** All votes that exceed the individual outlier threshold are marked as flagged on the facilitator's view. The facilitator can act on the flags.
- **Failure:** If outlier detection cannot run (e.g., missing vote data), the reveal still completes and votes are displayed. No outlier flags are shown. The facilitator sees an undecorated results view.

---

## Acceptance Criteria
- [ ] After reveal, the application calculates the group average of all locked-in finger votes.
- [ ] Any vote more than 1.5 points from the group average is flagged as an individual outlier.
- [ ] Outlier flags are visible only on the facilitator's view, not on participants' views.
- [ ] The flagged participant(s) are identifiable to the facilitator from the outlier indicator.
- [ ] Outlier detection runs automatically without any facilitator action beyond triggering the reveal.
- [ ] Outlier detection does not run for Roman or Modified Roman vote types.
- [ ] When no votes exceed the threshold, no outlier indicators appear.

## Out of Scope
- The facilitator's decision about whether to open discussion (covered in "Facilitator Marks Topic for Discussion" and "Facilitator Skips Flagged Topic").
- Prompting the flagged participant to speak (covered in "Participant Prompted to Share Perspective").
- Trend outlier detection (covered in "Detect Trend Outlier After Reveal").

## Dependencies
- Live Voting — Vote Reveal use case: votes must be revealed before outlier detection runs.
- Vote data for the current topic must be complete (all participants locked in).

## Notes
- The outlier threshold is ±1.5 deviation from the session average for that topic, applied to finger votes (1–4 scale). This threshold is fixed, not configurable.
- Group average is calculated across all participants who cast a vote; participants who did not lock in before the reveal are excluded from the calculation.
- The outlier flag is advisory. The application raises it; the facilitator decides what to do with it.

---

---

# Use Case: Detect Trend Outlier After Reveal

> **OUT OF SCOPE:** Trend outlier detection is explicitly out of scope for the current build. This use case is retained for reference but should not be implemented. Individual outlier detection (±1.5 deviation from session average) is the only outlier detection mechanism in scope.

## Summary
**Actor:** Application

**Trigger:** The facilitator triggers the simultaneous vote reveal for a topic.

**Goal:** As the Application, I want to compare the current reveal result against the team's recent historical average for that topic so that a significant downward departure from the team's trend is surfaced automatically.

---

## Preconditions
- A session is in progress and a topic has been voted on.
- All participants have locked in their votes.
- The facilitator has triggered the reveal; all votes are now visible.
- The team has at least one prior completed session that included this topic, so that a trailing average can be computed. (With fewer than the configured lookback window of sessions, the average is computed from whatever history exists.)
- The topic uses the finger vote type (1–4 scale); trend outlier detection requires a numeric aggregate.

## Main Flow
1. The facilitator triggers the vote reveal.
2. The application computes the group average for the current reveal.
3. The application retrieves the team's historical session results for this topic, using the trailing 4-session average as the baseline.
4. The application compares the current group average against the trailing average.
5. If the current average is more than 1 point below the trailing average, the application flags the result as a trend outlier.
6. The application updates the facilitator's view to visually indicate the trend outlier, showing the current average alongside the trailing average for context.
7. The application presents the facilitator with controls to open discussion or advance.

## Alternate Flows
- **No prior session history for this topic:** The application cannot compute a trailing average. No trend outlier flag is raised. The facilitator's view displays the current result without a trend comparison.
- **Fewer than 4 prior sessions available:** The application computes the trailing average from available sessions (e.g., 2 or 3 sessions). Outlier detection proceeds with the available baseline and a note on the facilitator's view indicating the limited sample size.
- **Current result is at or above the trailing average, or less than 1 point below:** No trend outlier flag is raised.
- **Current result is above the trailing average by a significant margin (positive outlier):** The application does not flag positive departures as outliers. The result is displayed normally. A positive trend may be reflected in trend charts.
- **Individual outlier also detected in the same reveal:** Both flags may coexist. See "Multiple Outliers in the Same Reveal" use case.

## Postconditions
- **Success:** If the threshold is exceeded, the trend outlier is flagged on the facilitator's view with the current and trailing averages shown. The facilitator can act on the flag.
- **Failure:** If trend data cannot be retrieved, trend outlier detection is skipped silently. The reveal completes and individual outlier detection still runs.

---

## Acceptance Criteria
- [ ] After reveal, the application retrieves the trailing 4-session average for the topic from the team's history.
- [ ] If the current group average is more than 1 point below the trailing average, the result is flagged as a trend outlier on the facilitator's view.
- [ ] The facilitator's view displays both the current average and the trailing average when a trend outlier is flagged.
- [ ] When fewer than 4 prior sessions exist for the topic, the average is computed from available sessions and the facilitator's view notes the limited sample.
- [ ] When no prior session history exists, no trend outlier flag is raised and no error is shown to the facilitator.
- [ ] Trend outlier detection does not flag positive departures (current result above trailing average).
- [ ] Trend outlier flags are visible only on the facilitator's view.

## Out of Scope
- The facilitator's decision about whether to open discussion (covered in "Facilitator Marks Topic for Discussion" and "Facilitator Skips Flagged Topic").
- Displaying trend charts to participants during the session (covered in Trend Dashboard & Reporting feature set).
- Trend outlier detection for Roman and Modified Roman vote types.

## Dependencies
- Live Voting — Vote Reveal use case: reveal must occur before trend detection runs.
- Session Wrap-up use case: trend data is only available for sessions that have been marked complete and incorporated into history.
- Topic history data for the team must be accessible from the session context.

## Notes
- The 1-point threshold and 4-session lookback window should be configurable, not hard-coded.
- "Trailing average" means the mean group average across the last N completed sessions for this specific topic on this team.
- The trend outlier flag is advisory. It draws the facilitator's attention to a departure from the norm; it does not require discussion.
- Modified Roman votes (up/steady/down) are directional and not numeric; a separate mechanism for surfacing trend concerns on Modified Roman topics is outside this feature set.

---

---

# Use Case: No Outlier Detected After Reveal

## Summary
**Actor:** Application

**Trigger:** The facilitator triggers the simultaneous vote reveal for a topic.

**Goal:** As the Application, I want to complete outlier detection and confirm no flags are warranted so that the facilitator receives a clean signal and can advance the session without interruption.

---

## Preconditions
- A session is in progress and a topic has been voted on.
- All participants have locked in their votes.
- The facilitator has triggered the reveal; all votes are now visible.

## Main Flow
1. The facilitator triggers the vote reveal.
2. All votes become visible to all participants simultaneously.
3. The application runs individual outlier detection (if applicable to the vote type).
4. Trend outlier detection is out of scope and does not run.
5. Neither check produces a flag.
6. The facilitator's view shows all votes without any outlier indicators.
7. The facilitator sees the standard advance control to move to the next topic.

## Alternate Flows
- **Vote type is Roman or Modified Roman:** Individual outlier detection is skipped. The flow continues as described above from step 5.
- **No prior session history:** Individual outlier detection runs normally if applicable. Trend outlier detection is out of scope.

## Postconditions
- **Success:** No outlier flags are present on the facilitator's view. The session can advance immediately.
- **Failure:** Not applicable — this use case represents the absence of an outlier condition. If detection itself fails, see the failure postconditions in the detection use cases.

---

## Acceptance Criteria
- [ ] When no votes exceed the individual outlier threshold, no outlier indicators appear on any view.
- [ ] The facilitator's view presents the advance control without any outlier-related prompts or interruptions.
- [ ] Participants' views show the revealed votes with no outlier-related UI elements.

## Out of Scope
- Outlier detection logic itself (covered in the detection use cases).
- The facilitator advancing to the next topic (covered in "Facilitator Advances After Discussion").

## Dependencies
- Live Voting — Vote Reveal use case.
- Detect Individual Outlier After Reveal use case.

## Notes
- This is the expected path for the majority of topics in a healthy session. The experience should be frictionless: votes appear, no flags surface, the facilitator moves on.

---

---

# Use Case: Facilitator Marks Topic for Discussion

## Summary
**Actor:** Facilitator

**Trigger:** The facilitator sees one or more outlier flags on the reveal results and decides to open discussion.

**Goal:** As a Facilitator, I want to mark a topic for discussion so that the team can explore the divergence before moving on.

---

## Preconditions
- A session is in progress and votes for the current topic have been revealed.
- The application has flagged at least one individual or trend outlier on the facilitator's view.
- The facilitator is authenticated and recognized as the active facilitator for this session.

## Main Flow
1. The facilitator reviews the revealed votes and the outlier flags presented on their view.
2. The facilitator selects the option to open discussion for this topic.
3. The application marks the topic as "in discussion" for this session.
4. The application delivers a gentle prompt to the participant(s) whose vote(s) were flagged, visible on their individual views, inviting them to share their perspective. (See "Participant Prompted to Share Perspective" use case.)
5. The application displays a listening cue to all other participants, indicating that the flagged participant(s) will be sharing.
6. The facilitator's view updates to reflect that discussion is open, and presents a control to close discussion and advance.

## Alternate Flows
- **No outlier was flagged but the facilitator still wants to discuss:** The facilitator may open discussion on any topic regardless of outlier flags. The outlier flag is advisory; the facilitator is not restricted to only flagged topics. In this case, no participant is individually prompted; the facilitator opens the floor generally.
- **The facilitator declines to open discussion despite a flag:** See "Facilitator Skips Flagged Topic" use case.
- **The flagged participant has left the session:** The prompt is not delivered. The facilitator's view notes that the participant is no longer present. Discussion may still be opened for the remaining participants.

## Postconditions
- **Success:** The topic is marked as in discussion. Flagged participant(s) have received a perspective-sharing prompt. Other participants see a listening cue. The facilitator can moderate discussion and then advance.
- **Failure:** If the topic cannot be marked for discussion (e.g., session state error), the facilitator's view displays an error and the session remains on the reveal state. No prompts are sent to participants.

---

## Acceptance Criteria
- [ ] The facilitator can mark any revealed topic for discussion, whether or not it was flagged.
- [ ] When discussion is opened on a flagged topic, the application sends a perspective-sharing prompt to each participant whose vote was individually flagged.
- [ ] A listening cue is displayed to all non-flagged participants when discussion opens.
- [ ] The facilitator's view transitions to a "discussion open" state with a control to close and advance.
- [ ] The topic is recorded as discussed in session data for use in session wrap-up and history.
- [ ] Only the active facilitator for the session can trigger this action.

## Out of Scope
- The content of what is said during discussion — the application does not capture or transcribe spoken discussion.
- Action item creation (covered in Session Wrap-up feature set), though discussion during a topic may lead to action items being created later.
- Prompting the participant to share (covered in "Participant Prompted to Share Perspective").

## Dependencies
- Live Voting — Vote Reveal use case: the topic must be in the revealed state.
- Detect Individual Outlier After Reveal use case: outlier flags inform but do not gate this action.
- Participant Prompted to Share Perspective use case.

## Notes
- The decision to discuss is entirely the facilitator's. The application surfaces flags to inform the facilitator; it does not open discussion automatically or require it.
- The facilitator may open discussion on an unflagged topic if they observe something worth exploring (e.g., a vote that did not technically exceed the threshold but surprised them).

---

---

# Use Case: Facilitator Skips Flagged Topic

## Summary
**Actor:** Facilitator

**Trigger:** The facilitator sees one or more outlier flags on the reveal results and decides not to open discussion.

**Goal:** As a Facilitator, I want to skip a flagged topic and advance the session so that the session stays on time when a flag does not warrant further exploration.

---

## Preconditions
- A session is in progress and votes for the current topic have been revealed.
- The application has flagged at least one individual or trend outlier on the facilitator's view.
- The facilitator is authenticated and recognized as the active facilitator for this session.

## Main Flow
1. The facilitator reviews the revealed votes and the outlier flags.
2. The facilitator judges that discussion is not warranted (e.g., the reason for the divergence is already known, or time is constrained).
3. The facilitator selects the advance control to move to the next topic without opening discussion.
4. The application records that the topic was not discussed.
5. The application clears the current topic's view and advances to the next topic in the session queue.

## Alternate Flows
- **No next topic exists:** The application transitions to the session wrap-up phase rather than advancing to another topic.
- **Facilitator changes their mind and opens discussion before advancing:** The facilitator selects the discuss option instead. See "Facilitator Marks Topic for Discussion" use case.

## Postconditions
- **Success:** The topic is recorded as skipped (not discussed) despite the outlier flag. The session advances to the next topic or wrap-up. No participant receives a discussion prompt for this topic.
- **Failure:** If the session cannot advance (e.g., state error), the facilitator's view displays an error and remains on the current topic.

---

## Acceptance Criteria
- [ ] The facilitator can advance past any flagged topic without opening discussion.
- [ ] When a flagged topic is skipped, no perspective-sharing prompt is sent to any participant.
- [ ] The session records that the topic was not discussed, and this is reflected in session history.
- [ ] Advancing does not require the facilitator to explicitly acknowledge or dismiss the flag — the advance control is always available.
- [ ] Only the active facilitator for the session can advance the topic.

## Out of Scope
- Requiring the facilitator to justify skipping a flagged topic — no justification is captured.
- Any retroactive discussion of skipped topics after the session (outside the scope of this feature set).

## Dependencies
- Live Voting — Vote Reveal use case.
- Detect Individual Outlier After Reveal use case.

## Notes
- Skipping a flagged topic is a legitimate and common facilitator choice. The application must not make skipping feel like an error state or require extra steps to bypass the flag.
- Session time pressure is a real constraint; the facilitator targets 30 minutes. The experience should make skipping as easy as advancing on an unflagged topic.

---

---

# Use Case: Participant Prompted to Share Perspective

## Summary
**Actor:** Application

**Trigger:** The facilitator opens discussion on a topic where one or more votes have been individually flagged as outliers.

**Goal:** As the Application, I want to deliver a gentle, non-coercive prompt to the participant(s) whose vote was flagged so that they feel invited — not pressured — to share the reasoning behind their vote.

---

## Preconditions
- A session is in progress and votes for the current topic have been revealed.
- The application has flagged one or more individual outliers for this topic.
- The facilitator has selected the option to open discussion for this topic.
- The flagged participant(s) are still present in the session.

## Main Flow
1. The facilitator opens discussion on the flagged topic.
2. For each participant whose vote was individually flagged, the application delivers a prompt on their view: a brief, inviting message that acknowledges their vote stood out and invites them to share their perspective if they are comfortable doing so.
3. The application simultaneously displays a listening cue on all other participants' views, signaling that a teammate will be sharing.
4. The prompt remains visible on the flagged participant's view until discussion closes or the topic advances.
5. The flagged participant may choose to speak (facilitated verbally) or to remain silent — the application does not enforce participation.

## Alternate Flows
- **Flagged participant has left the session:** The application does not deliver the prompt. The facilitator's view notes that the participant is no longer present. Discussion proceeds without that participant.
- **Multiple participants are flagged:** Each flagged participant receives the prompt on their own view. The listening cue on non-flagged participants' views indicates that multiple teammates may share.
- **Only a trend outlier was flagged (no individual outlier):** No specific participant is associated with the trend outlier (it reflects the group aggregate). No individual participant prompt is sent. The facilitator may open the floor generally without the application targeting any individual.
- **Discussion closes before the participant speaks:** The prompt is dismissed when discussion closes or the topic advances. No record is kept of whether the participant spoke.

## Postconditions
- **Success:** The prompt is delivered to the flagged participant(s) and the listening cue is delivered to all others. The participant(s) have the opportunity to share.
- **Failure:** If the prompt cannot be delivered (e.g., the participant has disconnected), the facilitator's view notes the delivery failure. Discussion can still proceed.

---

## Acceptance Criteria
- [ ] When discussion opens on a topic with an individual outlier, each flagged participant receives a prompt on their view.
- [ ] The prompt language is inviting and non-coercive; it does not imply the participant is wrong or obligated to speak.
- [ ] All non-flagged participants receive a listening cue when discussion opens.
- [ ] If a flagged participant is no longer in the session, no prompt is delivered and the facilitator is notified.
- [ ] For trend-only outliers (no individual outlier), no individual participant is prompted.
- [ ] The prompt is dismissed automatically when the facilitator closes discussion or advances the topic.
- [ ] The application does not record whether the participant spoke or remained silent.

## Out of Scope
- Capturing spoken discussion content — the application does not transcribe or record audio.
- Allowing participants to type responses to the prompt in the application — verbal discussion is the intended medium.
- Penalizing or flagging participants who choose not to speak.

## Dependencies
- Facilitator Marks Topic for Discussion use case: this use case is triggered by the facilitator's decision, not automatically.
- Detect Individual Outlier After Reveal use case: the participant prompt is only relevant when an individual outlier has been identified.

## Notes
- The tone of the prompt matters. The experience should feel like a colleague saying "it looked like you had a different take — want to share?" not a spotlight or an interrogation.
- The application should use neutral, consistent language for the prompt. Customization of prompt wording is out of scope for now.
- Whether a participant engages verbally is entirely up to them and the facilitator; the application's only role is to deliver the invitation.

---

---

# Use Case: Multiple Outliers in the Same Reveal

## Summary
**Actor:** Application

**Trigger:** The facilitator triggers the simultaneous vote reveal for a topic, and the application's outlier detection identifies more than one outlier condition.

**Goal:** As the Application, I want to surface all outlier conditions present in a single reveal clearly and without overwhelming the facilitator so that they can make an informed decision about discussion.

---

## Preconditions
- A session is in progress and votes for the current topic have been revealed.
- All participants have locked in their votes.
- Outlier detection runs and identifies two or more individual outliers for the same reveal (trend outlier detection is out of scope).

## Main Flow
1. The facilitator triggers the vote reveal.
2. All votes become visible to all participants simultaneously.
3. The application runs individual outlier detection (trend outlier detection is out of scope).
4. The application identifies multiple individual outlier conditions (e.g., two or more participants whose votes exceed the ±1.5 threshold).
5. The application displays all individual outlier flags on the facilitator's view simultaneously.
6. The facilitator reviews the flagged conditions and decides whether to open discussion or advance.

## Alternate Flows
- **Facilitator opens discussion:** See "Facilitator Marks Topic for Discussion" use case. All individually flagged participants receive a prompt; other participants receive a listening cue.
- **Facilitator skips despite multiple flags:** See "Facilitator Skips Flagged Topic" use case. The behavior is identical to skipping a single-flag topic.

## Postconditions
- **Success:** All outlier conditions for the reveal are visually represented on the facilitator's view. The facilitator has the information needed to make a discussion decision.
- **Failure:** If outlier detection partially fails (e.g., trend data is unavailable), any flags that could be computed are shown and the partial failure is noted silently. The reveal still completes.

---

## Acceptance Criteria
- [ ] When multiple participants' votes exceed the individual outlier threshold, all are flagged simultaneously on the facilitator's view.
- [ ] When discussion is opened on a reveal with multiple individual outliers, each flagged participant receives the perspective-sharing prompt on their own view.
- [ ] The facilitator's controls (open discussion / advance) function identically regardless of how many outlier flags are present.
- [ ] Participants' views do not show other participants' outlier flags — only their own prompt if applicable.

## Out of Scope
- Prioritizing or ranking outlier flags by severity — all flags are presented equally.
- Limiting the number of prompts sent to participants — if three participants are flagged, all three receive a prompt.

## Dependencies
- Detect Individual Outlier After Reveal use case.
- Facilitator Marks Topic for Discussion use case.
- Participant Prompted to Share Perspective use case.

## Notes
- In practice, having multiple individual outliers on the same topic may indicate a genuinely polarized team rather than a single divergent voice. The facilitator should be able to read this signal from the display without the application making that interpretation for them.
- There is no cap on the number of individual outlier flags that can appear in a single reveal.

---

---

# Use Case: Facilitator Advances After Discussion Is Complete

## Summary
**Actor:** Facilitator

**Trigger:** Discussion of a flagged topic has concluded and the facilitator is ready to move to the next topic.

**Goal:** As a Facilitator, I want to close discussion and advance the session so that the team continues through remaining topics without losing momentum.

---

## Preconditions
- A session is in progress.
- The current topic has been revealed and the facilitator opened discussion.
- The discussion has run its course (the facilitator determines this — the application does not impose a time limit or require any spoken content).
- The facilitator is authenticated and recognized as the active facilitator for this session.

## Main Flow
1. The facilitator determines that discussion is complete.
2. The facilitator selects the control to close discussion and advance to the next topic.
3. The application records that the topic was discussed in this session.
4. The application dismisses the perspective-sharing prompt from flagged participant(s)' views and the listening cue from other participants' views.
5. The application advances to the next topic in the session queue, displaying the topic prompt and vote type to all participants.
6. All participants' views transition to the voting state for the next topic.

## Alternate Flows
- **No next topic exists:** After closing discussion, the application transitions to the session wrap-up phase rather than presenting another topic. All participants' views update accordingly.
- **Facilitator advances before a flagged participant has spoken:** This is permitted. The application does not require the flagged participant to speak before allowing the facilitator to advance. The prompt is dismissed when the topic advances.
- **Action item capture before advancing:** If the facilitator wants to capture an action item arising from discussion before advancing, that is handled via the action item creation flow (Session Wrap-up feature set). The facilitator may do this before or after closing discussion, depending on the application's interaction design.

## Postconditions
- **Success:** The current topic is recorded as discussed. All discussion-state UI elements are dismissed from all participant views. The session advances to the next topic (or wrap-up).
- **Failure:** If the application cannot advance the session state (e.g., connectivity error), the facilitator's view displays an error and remains in the discussion-open state. No state change is persisted.

---

## Acceptance Criteria
- [ ] The facilitator can close discussion and advance at any time once discussion has been opened.
- [ ] Closing discussion dismisses the perspective-sharing prompt from flagged participants' views.
- [ ] Closing discussion dismisses the listening cue from non-flagged participants' views.
- [ ] The topic is recorded as discussed in session history.
- [ ] After advancing, all participants' views display the next topic in the session queue in the voting state.
- [ ] If no next topic exists, the application transitions to session wrap-up after discussion closes.
- [ ] Only the active facilitator for the session can close discussion and advance.

## Out of Scope
- Enforcing a minimum discussion duration — the facilitator advances whenever they judge discussion is complete.
- Capturing a transcript or summary of what was discussed — verbal discussion content is not recorded.
- Action item creation (covered in Session Wrap-up feature set, though it may occur in conjunction with this use case).

## Dependencies
- Facilitator Marks Topic for Discussion use case: discussion must have been opened before it can be closed.
- Live Voting — Session Queue / Topic Advancement use case: advancing the topic is a shared concern with the live voting flow.
- Session Wrap-up use case: if no topics remain, the wrap-up flow begins.

## Notes
- The facilitator controls the pace of the session. The application must make advancing feel lightweight — one clear action, no confirmation dialogs.
- "Discussed" is recorded as a boolean flag on the topic result for the session; the application does not capture discussion quality, duration, or content.
