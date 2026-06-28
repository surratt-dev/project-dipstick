# Topic Management — Use Cases

---

# Use Case: Assign Default Topic Set to New Team

## Summary
**Actor:** Application

**Trigger:** A new team is created in the application (as part of session setup).

**Goal:** As the Application, I want to automatically assign the default topic set to every newly created team so that the team's first session can begin without any manual configuration.

---

## Preconditions
- A new team record has just been created (triggered by the Facilitator during session setup).
- The application has a defined default topic set with all topics, prompts, vote types, and ordering configured.

## Main Flow
1. The Application receives the new team creation event.
2. The Application retrieves the canonical default topic set.
3. The Application creates a topic configuration record for the new team, copying all default topics in their defined order with their prompts, vote types, and descriptions.
4. The Application marks each copied topic as a default topic (not custom).
5. The Application marks the team's topic configuration as locked (not yet customizable).
6. The Application confirms the assignment and the session setup flow continues.

## Alternate Flows
- **Default topic set is unavailable due to a data or configuration error:** The Application logs the error and surfaces a failure state to the session creation flow. The team is created but the session cannot proceed until the topic configuration is resolved.

## Postconditions
- **Success:** The new team has a complete topic configuration containing all default topics in their canonical order. The configuration is locked pending the team's first session completion. No custom topics exist yet.
- **Failure:** The team record exists but has no topic configuration. The session cannot be started until the configuration is resolved.

---

## Acceptance Criteria
- [ ] Every newly created team is automatically assigned the full default topic set without any Facilitator action.
- [ ] The default topic set contains all twelve topics: "How easy is it to add features to production code?" (Finger), "How easy is it to reason about production code?" (Finger), "How would you rate the code under active development?" (Finger), "How would you rate the code for the entirety of the project?" (Finger), "Is the test suite effective?" (Finger), "Is the test suite consistent?" (Roman), "How would you rate the tests under active development?" (Finger), "How would you rate the tests for the entirety of the project?" (Finger), "Confidence in the pipeline" (Finger), "Are you comfortable with the technology stack?" (Roman), "How effective is pairing?" (Finger), and "Project Trend" (Modified Roman — up/steady/down).
- [ ] Topics are assigned in the canonical default order.
- [ ] Each topic carries its prompt, vote type, and default description.
- [ ] The topic configuration is marked locked until the first session is complete.
- [ ] No session can be started for the team if its topic configuration is missing or incomplete.

## Out of Scope
- Allowing the Facilitator to modify the default topic set during team creation or first session setup.
- Choosing a different starting topic set per team (all teams start with the same defaults).

## Dependencies
- Use Case: Create Session for New Team — team creation is the triggering event.
- The application must maintain a canonical default topic set as a system-level configuration.

## Notes
- The default topic set is a system-level constant. If the canonical defaults change in a future application version, existing teams retain their assigned configuration and are not automatically updated.
- Each team owns its own copy of the topic configuration — changes to one team's topics do not affect others.

---

---

# Use Case: Enforce Topic Customization Lock for First Session

## Summary
**Actor:** Application

**Trigger:** A Facilitator or any actor attempts to access topic management for a team that has not yet completed its first session.

**Goal:** As the Application, I want to prevent topic customization before a team's first session is complete so that the first session always uses the standard default topic set.

---

## Preconditions
- The team exists in the application and has been assigned the default topic set.
- The team has not yet completed its first session (either no session has been run, or one is in progress but not marked complete).

## Main Flow
1. The Facilitator navigates to the topic management area for the team.
2. The Application checks whether the team has at least one completed session on record.
3. The Application determines that no completed session exists.
4. The Application displays the team's topic list in a read-only view.
5. The Application displays an explanatory message indicating that topic customization is available after the team's first session is complete.
6. Add, remove, reorder, and annotate controls are not available.

## Alternate Flows
- **Facilitator bypasses the UI and submits a topic modification request directly (e.g., via API):** The Application validates the lock server-side and rejects the request with an authorization error. No topic configuration change is made.
- **First session completes while the Facilitator is viewing the locked topic management screen:** The Application unlocks customization. The Facilitator must reload or navigate away and back to access the editing controls (real-time unlock is a nice-to-have, not a requirement).

## Postconditions
- **Success (lock enforced):** The team's topic configuration is unchanged. The Facilitator sees a clear explanation of why editing is unavailable.
- **Failure (lock not enforced):** A topic modification is applied before the first session, resulting in a first session that does not use the default topic set — this is the failure state the use case exists to prevent.

---

## Acceptance Criteria
- [ ] The topic management UI shows all controls as read-only for teams without a completed session.
- [ ] A clear, plain-language explanation is displayed stating that customization is available after the first session.
- [ ] Server-side validation rejects any topic modification request for a team without a completed session, regardless of how the request is submitted.
- [ ] After the team's first session is marked complete, the topic management controls become available without requiring a page reload (or at minimum, become available on next navigation to the screen).

## Out of Scope
- Providing a bypass or override mechanism for the customization lock (no exceptions are defined).
- Allowing Engineers to view or interact with topic management in any state.

## Dependencies
- Use Case: Assign Default Topic Set to New Team — the lock is set at team creation.
- Use Case: Session Wrap-up / Mark Session Complete — completion of the first session triggers the unlock.

## Notes
- The lock is based on session completion, not session creation or participation. A session that was started but abandoned does not count.
- The lock applies to all forms of topic modification: adding, removing, reordering, and annotating.

---

---

# Use Case: Add Custom Topic

## Summary
**Actor:** Facilitator

**Trigger:** The Facilitator decides the default topic set is missing a topic relevant to the team's context and wants to add it.

**Goal:** As a Facilitator, I want to add a custom topic with a prompt, vote type, and description so that the team's sessions cover areas specific to their context.

---

## Preconditions
- The Facilitator is authenticated.
- The team has at least one completed session (topic customization is unlocked).
- The Facilitator is accessing the topic management area for the team they are facilitating.

## Main Flow
1. The Facilitator navigates to the topic management screen for the team.
2. The Facilitator selects the option to add a new topic.
3. The Application presents a form with fields for: topic prompt (required), vote type (required — Finger, Roman, or Modified Roman), and topic description (optional).
4. The Facilitator enters the topic prompt, selects a vote type, and optionally enters a description.
5. The Facilitator submits the form.
6. The Application validates that the prompt is not empty and a vote type has been selected.
7. The Application creates the new topic record associated with the team, marked as a custom topic.
8. The Application appends the new topic to the end of the team's topic order.
9. The Application displays the updated topic list with the new topic visible.

## Alternate Flows
- **Facilitator submits without a prompt:** The Application displays a validation error and does not save. The form remains open with the entered values preserved.
- **Facilitator submits without selecting a vote type:** The Application displays a validation error and does not save.
- **The Facilitator adds a topic with a prompt identical to an existing topic:** The Application does not enforce uniqueness of prompts. The duplicate is saved as a distinct topic. (A warning may be appropriate — see Notes.)
- **Save fails due to a system error:** The Application displays an error. No topic is created. The Facilitator can retry.

## Postconditions
- **Success:** A new custom topic exists in the team's topic configuration, appended at the end of the current order, with the specified prompt, vote type, and description. It will appear in the next session run for this team.
- **Failure:** No topic is created. The team's topic configuration is unchanged.

---

## Acceptance Criteria
- [ ] The add topic form requires a non-empty prompt and a vote type selection before allowing submission.
- [ ] All three vote types (Finger, Roman, Modified Roman) are available for selection.
- [ ] A successfully added topic appears in the team's topic list immediately after saving.
- [ ] A newly added topic is appended to the end of the topic order by default.
- [ ] The new topic is marked as a custom topic (distinguishable from default topics in the UI).
- [ ] Topic customization controls are only available after the team's first session is complete.
- [ ] The add topic action is available only to the Facilitator, not to Engineers.

## Out of Scope
- Adding topics that are available across all teams (global topic library is not part of this feature).
- Importing topics from another team's configuration.
- Setting a topic as inactive without removing it.

## Dependencies
- Use Case: Enforce Topic Customization Lock for First Session — customization must be unlocked.
- Vote type definitions must be available in the application.

## Notes
- Whether the application should warn when a prompt closely resembles an existing topic is an open question. A simple duplicate-prompt warning could prevent accidental near-duplicates.
- The description field is distinct from the team annotation (see Use Case: Annotate Topic with Shared Team Definition). The description is set at creation; the annotation is a living team-owned definition that can be updated over time.

---

---

# Use Case: Remove a Topic

## Summary
**Actor:** Facilitator

**Trigger:** The Facilitator determines that a topic (default or custom) does not apply to the team's context and wants to remove it from future sessions.

**Goal:** As a Facilitator, I want to remove a topic from the team's active topic set so that sessions focus only on areas relevant to the team.

---

## Preconditions
- The Facilitator is authenticated.
- The team has at least one completed session (topic customization is unlocked).
- The topic to be removed exists in the team's topic configuration (either default or custom).

## Main Flow
1. The Facilitator navigates to the topic management screen for the team.
2. The Facilitator locates the topic to remove in the topic list.
3. The Facilitator selects the remove action for that topic.
4. The Application presents a confirmation prompt, noting that the topic's historical data will be retained.
5. The Facilitator confirms the removal.
6. The Application marks the topic as removed in the team's configuration. It is no longer active.
7. The Application removes the topic from the displayed topic order.
8. The Application retains all historical vote data for the topic across past sessions.
9. The Application confirms the removal and refreshes the topic list.

## Alternate Flows
- **Facilitator cancels the confirmation prompt:** No change is made. The topic remains active.
- **Facilitator attempts to remove the last remaining topic:** The Application prevents the removal and displays a message that at least one topic must remain in the session. (Or this is not enforced — see Notes.)
- **Remove fails due to a system error:** The Application displays an error. The topic remains active. The Facilitator can retry.

## Postconditions
- **Success:** The topic is marked as removed and will not appear in future sessions. Its historical vote data is preserved. The topic order is updated to reflect the removal.
- **Failure:** The topic remains active. The team's configuration is unchanged.

---

## Acceptance Criteria
- [ ] A remove action is available for each topic in the topic management list.
- [ ] The Facilitator is shown a confirmation before the removal is applied.
- [ ] The confirmation message clearly states that historical data for the topic is retained.
- [ ] After removal, the topic no longer appears in the active topic list.
- [ ] Historical session data for the removed topic is accessible in the trend dashboard (it is not deleted).
- [ ] The topic's removal is reflected in the next session — it does not appear in the session flow.
- [ ] Both default and custom topics can be removed using the same mechanism.

## Out of Scope
- Permanently deleting a topic's historical data.
- Removing topics from past sessions retroactively (historical session records are immutable).
- Archiving topics in a way that differs from removal (no archive state is defined).

## Dependencies
- Use Case: Enforce Topic Customization Lock for First Session — customization must be unlocked.
- Use Case: Re-Add a Previously Removed Topic — the inverse of this action.
- Trend Dashboard: must handle gaps in topic data for removed topics.

## Notes
- Whether the application enforces a minimum topic count (preventing removal of the last topic) is an open question. In practice, a session with zero topics cannot proceed, but this may be handled at session start rather than at topic removal time.
- Removal does not affect in-progress sessions. If a session is currently active, the removed topic will not be excluded from it until the next session begins. This edge case may need a decision.

---

---

# Use Case: Reorder Topics

## Summary
**Actor:** Facilitator

**Trigger:** The Facilitator wants to change the sequence in which topics appear during a session to better match the team's preferred flow.

**Goal:** As a Facilitator, I want to reorder the team's topics so that sessions progress through topics in the most effective order for the team.

---

## Preconditions
- The Facilitator is authenticated.
- The team has at least one completed session (topic customization is unlocked).
- The team's topic configuration contains at least two active topics.

## Main Flow
1. The Facilitator navigates to the topic management screen for the team.
2. The Application displays the current topic list in its current order.
3. The Facilitator drags a topic to a new position in the list (or uses an equivalent reorder control).
4. The Application updates the displayed order in real time to reflect the new position.
5. The Facilitator repeats steps 3–4 as needed to achieve the desired order.
6. The Facilitator saves the new order.
7. The Application persists the new topic order for the team's configuration.
8. The Application confirms the save.

## Alternate Flows
- **Facilitator reorders but does not save before navigating away:** The Application discards the unsaved order change and reverts to the previously saved order. A warning may be shown before discard (see Notes).
- **Save fails due to a system error:** The Application displays an error. The previously saved order is retained. The Facilitator can retry.
- **Only one topic exists:** Reorder controls are not shown or are disabled, as there is nothing to reorder.

## Postconditions
- **Success:** The team's topic configuration reflects the new order. All future sessions will present topics in the updated sequence.
- **Failure:** The topic order is unchanged from the last saved state.

---

## Acceptance Criteria
- [ ] The topic management screen displays topics in their current order.
- [ ] The Facilitator can change the position of any active topic relative to any other.
- [ ] The new order is visually reflected immediately when the Facilitator moves a topic.
- [ ] The new order is not applied until the Facilitator explicitly saves it.
- [ ] After saving, the new order is used in all subsequent sessions.
- [ ] Reordering is not available when only one topic exists.
- [ ] Reorder controls are only available to the Facilitator, not to Engineers.

## Out of Scope
- Automatically reordering topics based on any criteria (reordering is always manual).
- Reordering topics within an in-progress session (topic order is fixed at session start).

## Dependencies
- Use Case: Enforce Topic Customization Lock for First Session — customization must be unlocked.

## Notes
- Whether the application warns the Facilitator before discarding unsaved reorder changes (e.g., on navigation away) is a UX decision that should be made during implementation.
- The reorder interaction should be usable on both desktop and tablet. A drag-and-drop control alone may not be sufficient for non-pointer devices; an alternative (move up/move down controls) may be needed.

---

---

# Use Case: Annotate Topic with Shared Team Definition

## Summary
**Actor:** Facilitator

**Trigger:** The Facilitator (or the team during a session) agrees on what a topic means specifically to their team and wants to capture that definition to prevent interpretation drift in future sessions.

**Goal:** As a Facilitator, I want to annotate a topic with the team's shared definition so that all future facilitators and participants interpret the topic consistently.

---

## Preconditions
- The Facilitator is authenticated.
- The team has at least one completed session (topic customization is unlocked).
- The topic to be annotated exists in the team's active topic configuration.

## Main Flow
1. The Facilitator navigates to the topic management screen for the team.
2. The Facilitator selects the annotate or edit option for a specific topic.
3. The Application presents an editable text field pre-populated with the existing annotation (empty if none exists yet).
4. The Facilitator enters or updates the team's shared definition for this topic.
5. The Facilitator saves the annotation.
6. The Application persists the annotation text against the topic in the team's configuration.
7. The Application confirms the save.
8. During future sessions, the Application displays the annotation alongside the topic prompt so all participants can see the team's agreed definition.

## Alternate Flows
- **Facilitator saves an empty annotation:** The Application clears the existing annotation. The topic displays without a team annotation in future sessions. A confirmation may be appropriate before clearing (see Notes).
- **Save fails due to a system error:** The Application displays an error. The previous annotation (or lack of one) is retained. The Facilitator can retry.
- **Annotation is excessively long:** The Application enforces a reasonable character limit and displays a validation message if exceeded.

## Postconditions
- **Success:** The topic's annotation reflects the Facilitator's input. The annotation is displayed to all session participants (Engineers and Facilitators) during future sessions when the topic is active.
- **Failure:** The annotation is unchanged from its previous state.

---

## Acceptance Criteria
- [ ] Each topic in the topic management screen has an option to add or edit a team annotation.
- [ ] The annotation field accepts free-form text up to a defined character limit.
- [ ] Saving an annotation updates it immediately in the topic management view.
- [ ] The annotation is displayed alongside the topic prompt during sessions (visible to all participants).
- [ ] Topics with no annotation display no annotation field during sessions (the absence is handled gracefully).
- [ ] Clearing an annotation (saving empty text) removes the annotation from session display.
- [ ] Annotation editing is available only to the Facilitator.

## Out of Scope
- Engineers editing or proposing annotations during or between sessions.
- Version history for annotations (overwriting the annotation does not create a revision trail).
- Annotations on the application's default topic descriptions (only the team-specific annotation is editable).

## Dependencies
- Use Case: Enforce Topic Customization Lock for First Session — customization must be unlocked.
- Live Voting — the annotation must be surfaced to participants during the voting phase for each topic.

## Notes
- The annotation is the team's definition of what the topic means to them, distinct from the topic's description (which is set at creation and is more of a prompt explanation). Both may be displayed during a session, but they serve different purposes.
- Whether a facilitator can annotate default topics (not just custom ones) should be confirmed — the feature description implies all topics can be annotated, default or custom.
- The first session may be an appropriate moment to capture initial annotations, but the customization lock means annotations can only be added after the first session completes.

---

---

# Use Case: Re-Add a Previously Removed Topic

## Summary
**Actor:** Facilitator

**Trigger:** The Facilitator decides to reinstate a topic that was previously removed from the team's active topic set.

**Goal:** As a Facilitator, I want to re-add a removed topic so that the team can resume tracking that area, with historical data preserved and the gap in tracking reflected in trend views.

---

## Preconditions
- The Facilitator is authenticated.
- The team has at least one completed session (topic customization is unlocked).
- At least one topic is in a removed state in the team's topic configuration (default or custom).

## Main Flow
1. The Facilitator navigates to the topic management screen for the team.
2. The Application displays the active topic list and provides access to the list of removed topics.
3. The Facilitator views the removed topics list and locates the topic to reinstate.
4. The Facilitator selects the re-add action for that topic.
5. The Application presents a confirmation, noting that existing historical data for the topic will be restored and the gap in sessions will be reflected in trend views.
6. The Facilitator confirms.
7. The Application marks the topic as active in the team's configuration.
8. The Application appends the topic to the end of the active topic order (or restores its prior position — see Notes).
9. The Application confirms the re-addition and displays the updated active topic list.

## Alternate Flows
- **No removed topics exist:** The removed topics list is empty. The option to re-add is not shown, or the empty state is communicated clearly.
- **Facilitator cancels the confirmation:** No change is made. The topic remains removed.
- **Re-add fails due to a system error:** The Application displays an error. The topic remains removed. The Facilitator can retry.

## Postconditions
- **Success:** The topic is active again in the team's configuration. It will appear in the next session. Its historical vote data (from before it was removed) is accessible in trend views, and the gap in sessions where it was absent is visible in the trend chart.
- **Failure:** The topic remains removed. No configuration change is made.

---

## Acceptance Criteria
- [ ] The topic management screen provides access to the list of previously removed topics.
- [ ] Each removed topic can be individually reinstated by the Facilitator.
- [ ] A confirmation step is shown before reinstating, describing the history preservation behavior.
- [ ] After reinstatement, the topic appears in the active topic list and is included in the next session.
- [ ] Historical vote data for the topic from before its removal is preserved and accessible in trend views.
- [ ] The trend view for the reinstated topic reflects the gap in sessions where it was absent, rather than interpolating through the gap or resetting history.
- [ ] The re-added topic can be reordered within the active list after reinstatement.

## Out of Scope
- Retroactively adding the topic to sessions that occurred while it was removed.
- Merging data from two separate topic records (re-adding restores the original topic, not a duplicate).

## Dependencies
- Use Case: Remove a Topic — the inverse of this action.
- Trend Dashboard: must correctly render gaps in topic history when a topic was absent for one or more sessions.

## Notes
- Whether a reinstated topic is placed at the end of the topic order or restored to its prior position is a product decision. Appending to the end is simpler; restoring prior position may feel more natural but requires storing the original position.
- The trend view treatment of the gap (e.g., a break in the line vs. a label indicating removed/reinstated) should be designed in conjunction with the Trend Dashboard feature set.

---

---

# Use Case: View Active Topic Configuration

## Summary
**Actor:** Facilitator

**Trigger:** The Facilitator wants to review the team's current topic set before running a session or making changes.

**Goal:** As a Facilitator, I want to view the team's full active topic list, including prompts, vote types, annotations, and order, so that I can understand the current configuration and decide whether any changes are needed.

---

## Preconditions
- The Facilitator is authenticated.
- The team exists and has a topic configuration (assigned at team creation).

## Main Flow
1. The Facilitator navigates to the topic management screen for the team.
2. The Application displays the list of active topics in their current order.
3. For each topic, the Application displays: the topic prompt, vote type, description, and team annotation (if any).
4. If the team has not yet completed its first session, the Application displays the list in read-only mode with an explanatory lock notice.
5. If customization is unlocked, the Application displays editing controls alongside each topic and options to add topics or access the removed topics list.

## Alternate Flows
- **Team has no active topics (all have been removed):** The Application displays an empty state with a prompt to re-add topics or add a custom one.
- **Facilitator does not have access to this team's configuration:** The Application displays an access error. (Access rules for topic management outside a live session should be defined — see Notes.)

## Postconditions
- **Success:** The Facilitator has an accurate view of the team's topic configuration. No data is changed by viewing.
- **Failure:** The topic configuration is unavailable or incorrectly displayed.

---

## Acceptance Criteria
- [ ] The topic management screen is accessible to the Facilitator for any team they are eligible to facilitate.
- [ ] All active topics are displayed in their current session order.
- [ ] Each topic shows its prompt, vote type, description, and team annotation (if present).
- [ ] The customization lock notice is visible and explanatory when the first session has not yet been completed.
- [ ] Editing controls are present only when customization is unlocked.
- [ ] Viewing the topic configuration does not alter any data.

## Out of Scope
- Engineers viewing the topic management screen (Engineers see topics only within the session room during live voting).
- Engineering Managers modifying or viewing topic management (they have read-only access to session history, not topic configuration).

## Dependencies
- Use Case: Assign Default Topic Set to New Team — every team must have a topic configuration to display.
- Use Case: Enforce Topic Customization Lock for First Session — determines the editing state of the screen.

## Notes
- Whether the Facilitator can access topic management for a team at any time, or only in the context of a session they are running, is an open question. This use case assumes topic management is accessible outside of a live session (e.g., between sessions), which is necessary for the feature to be useful.
- The topic management screen is not the same as the topic view engineers see during a session. Engineers see the prompt and vote type for the current topic only, not the full configuration.

---

---

# Use Case: View Topics During a Live Session (Engineer)

## Summary
**Actor:** Engineer

**Trigger:** The Facilitator advances the session to a topic, and the Application displays the topic to all participants.

**Goal:** As an Engineer, I want to see the current topic's prompt, vote type, and any team annotation so that I understand what I am being asked to assess before casting my vote.

---

## Preconditions
- A session is in progress and the Facilitator has advanced to a topic.
- The Engineer is an active participant in the session.
- The topic has been configured in the team's topic set (default or custom) and is active.

## Main Flow
1. The Facilitator advances the session to the next topic.
2. The Application displays the topic prompt to all participants simultaneously.
3. The Application displays the vote type (Finger, Roman, or Modified Roman) with appropriate UI controls for the Engineer to cast their vote.
4. If a team annotation exists for the topic, the Application displays it alongside the prompt.
5. If a description exists for the topic, the Application displays it (or makes it accessible) to provide additional context.
6. The Engineer reads the prompt, annotation, and description to orient their response.
7. The Engineer proceeds to cast their vote (this step is covered in Live Voting use cases).

## Alternate Flows
- **Topic has no annotation:** The Application displays the prompt and description without an annotation section. No placeholder or empty field is shown.
- **Topic has no description:** The Application displays the prompt and annotation (if any) without a description.
- **Engineer joins the session after the topic has been displayed:** The Application shows the current topic's prompt, vote type, annotation, and description to the late joiner immediately upon joining.

## Postconditions
- **Success:** The Engineer has seen the topic prompt, vote type, team annotation, and description. No data is changed by viewing.
- **Failure:** The Engineer cannot see the topic details, preventing them from casting an informed vote.

---

## Acceptance Criteria
- [ ] When the Facilitator advances to a topic, the topic prompt is displayed to all participants simultaneously.
- [ ] The vote type controls shown to the Engineer match the configured vote type for the topic (Finger = 1–4 scale; Roman = up/down; Modified Roman = up/steady/down).
- [ ] The team annotation, if present, is displayed alongside the prompt before the vote is cast.
- [ ] The topic description, if present, is accessible to the Engineer during the voting phase.
- [ ] Topics with no annotation show no annotation UI element.
- [ ] The topic display is read-only for Engineers — no editing controls are shown.

## Out of Scope
- Engineers editing the topic prompt, vote type, annotation, or description during a session.
- Engineers viewing the full list of remaining topics (the session topic sequence is controlled by the Facilitator).
- Vote mechanics (covered by Live Voting use cases).

## Dependencies
- Use Case: Assign Default Topic Set to New Team — topics must exist to be displayed.
- Use Case: Annotate Topic with Shared Team Definition — annotations must be stored to be displayed.
- Live Voting — the voting controls shown alongside the topic are part of the Live Voting feature.

## Notes
- Whether Engineers can see upcoming topics in the session queue (a "progress through the session" view) is a UX decision. This use case only covers the display of the current topic.
- The Engineering Manager does not participate in sessions and does not see topics in the live session view. Their access to topic context is through historical session records.
