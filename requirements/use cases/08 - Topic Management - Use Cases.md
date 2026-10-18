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
- **Default topic set is unavailable due to a data or configuration error:** The Application logs the error and surfaces a failure state to the session creation flow. Because the new team's first session opens its room at creation, and room open requires at least one active topic, the whole request is rolled back: no team or session is created until the topic configuration is resolved (#175).

## Postconditions
- **Success:** The new team has a complete topic configuration containing all default topics in their canonical order. The configuration is locked pending the team's first session completion. No custom topics exist yet.
- **Failure:** No team or session is created; a team that nonetheless has zero active topics is recovered through Recover Zero-Topic Team.

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
- The default topic set is a system-level constant. If the canonical defaults change in a future application version, existing teams retain their assigned configuration and are not automatically updated. The one exception is a team recovered through Recover Zero-Topic Team, which receives the *current* template, not the template of its creation date; that is intended. An Application Administrator can change that template (Maintain Default Topic Set); an edit changes what *future* teams and recovered teams receive, and never an existing team's topics.
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
- **Facilitator bypasses the UI and submits a topic modification request directly (e.g., via API):** The Application validates the lock server-side and rejects the request with a `409 Conflict` state-precondition response — the lock is a fact about the team's session history, not about the caller's identity or role, so it is distinguished from an authorization failure at the API boundary. No topic configuration change is made. (Corrected per `topic-customization-lock-and-add-custom-topic` design.md Decision 2: an actor-identity/role failure, e.g. a caller who is not a facilitator, still receives a `403 Forbidden`, evaluated and returned before the lock check ever runs.)
- **First session completes while the Facilitator is viewing the locked topic management screen:** The Application unlocks customization. The Facilitator must reload or navigate away and back to access the editing controls (real-time unlock is a nice-to-have, not a requirement).

## Postconditions
- **Success (lock enforced):** The team's topic configuration is unchanged. The Facilitator sees a clear explanation of why editing is unavailable.
- **Failure (lock not enforced):** A topic modification is applied before the first session, resulting in a first session that does not use the default topic set — this is the failure state the use case exists to prevent. (Assigning the canonical default set to a team with zero active topics is not a lock failure; see Recover Zero-Topic Team.)

---

## Acceptance Criteria
- [ ] The topic management UI shows all controls as read-only for teams without a completed session.
- [ ] A clear, plain-language explanation is displayed stating that customization is available after the first session.
- [ ] Server-side validation rejects any topic modification request for a team without a completed session, regardless of how the request is submitted.
- [ ] After the team's first session is marked complete, the topic management controls become available without requiring a page reload (or at minimum, become available on next navigation to the screen).

## Out of Scope
- The lock can be released for a team only by completing a first session, except that an application administrator may assign the canonical default set to a team with zero active topics (see Recover Zero-Topic Team). This does not permit customization. Any further exception requires explicit product owner sign-off.
- Allowing Engineers to view or interact with topic management in any state.

## Dependencies
- Use Case: Assign Default Topic Set to New Team — the lock is set at team creation.
- Use Case: Session Wrap-up / Mark Session Complete — completion of the first session triggers the unlock.

## Notes
- The lock is based on session completion, not session creation or participation. A session that was started but abandoned does not count. (The one exception is Recover Zero-Topic Team, which assigns the canonical defaults to a team with zero active topics and does not unlock the team.)
- The lock applies to all forms of topic modification: adding, removing, reordering, and annotating.

---

---

# Use Case: Recover Zero-Topic Team

*(Added by `zero-topic-team-recovery`, #200. Traceable to FR-8.6 [HARD], **zero-active-topics case only** (status: partially met; partial restore and a "visible" canonical set on a customized team remain open), and to FR-8.2.)*

## Summary
**Actor:** Application Administrator (any membership on the target team, or none, per FR-8.2 / #208)

**Trigger:** A facilitator reports being blocked at room open ("This team has no active topics..."), or the administrator opens Topic Management for a team and sees the locked, zero-topic empty state, or an operator's diagnostic query lists the team.

**Goal:** As an Application Administrator, I want to give a team that has no active topics the canonical default topic set so that its facilitator can open a room and complete a first session. The team is otherwise left exactly as it was.

---

## Preconditions
- The team exists; it is not the template team; it has zero ACTIVE topics (any number may be archived).
- The actor's `global_role` is `application_admin`.

## Main Flow
1. The administrator opens Topic Management for the team and sees "This team has no active topics, so its sessions can't run. Assign the default topics to restore the standard set." with "Assign default topics".
2. The administrator activates the button. No confirmation is asked.
3. The Application, in one transaction under the team's topic lock, re-checks that the team has zero active topics, copies the template's active topics (name, prompt, vote type, description; marked default; numbered 1..n in template order, no annotations), writes one `topic.defaults_assigned` audit row, and commits.
4. The screen refetches and shows the topics and "{n} default topic(s) assigned."
5. The facilitator, told by the administrator or on retry, opens the room from the same draft session; the session snapshots the assigned topics.

## Alternate Flows
- **A. Actor is not an application admin:** 403 `NOT_AN_ADMIN`, a denial audit row, nothing changes.
- **B. Target is the template team:** 404, template-denial audit, never a target.
- **C. Team does not exist:** 404 `TEAM_NOT_FOUND` (non-admins get 403 first).
- **D. Team already has active topics (double click, second admin, stale view):** 409 `TEAM_HAS_ACTIVE_TOPICS`, no change; the screen refetches.
- **E. The template has no active topics:** 500 `DEFAULT_TOPICS_UNAVAILABLE`, rollback, a fail-open `topic.defaults_assign_failed` audit row and a log line; the administrator is pointed at the runbook "Zero-topic teams" section.
- **F. Rate limited, or any other failure:** the screen's generic failure message; the button stays.
- **G. Unlocked zero-topic team:** the normal Add / restore path applies; the Assign button is not shown (the endpoint would still accept).

## Postconditions
- **Success:** The team has the template's current active topics (not the template of its creation date), is still `first_session`-locked, has zero sessions, and is indistinguishable from a new team; archived rows are unchanged; one audit row.
- **Failure:** Nothing changed.

---

## Acceptance Criteria
- [ ] Only an Application Administrator can assign the defaults; every other caller is refused with `403 NOT_AN_ADMIN`.
- [ ] Assignment succeeds only for a team with zero active topics, and is refused with `409` otherwise.
- [ ] The result is identical to a freshly created team's topic set, and no other team or the template changes.
- [ ] The customization lock is unchanged afterwards.
- [ ] A blocked facilitator can open the room from the same draft session after the assignment.

## Out of Scope
- Any customization; partial top-up for teams with some defaults; notification; undo; a directory of administrators; editing the template.

## Dependencies
- Use Case: Assign Default Topic Set to New Team; Enforce Topic Customization Lock for First Session (this is its single exception).

## Notes
- The last active topic cannot be archived (`TOPIC_LAST_ACTIVE`), so a zero-topic team arises only from legacy data or a data fault; the expected count for the diagnostic query is 0.
- The template this recovery copies is whatever it is **at the moment of recovery**: an administrator edit through Maintain Default Topic Set changes what a recovered team receives, so a team recovered after an edit gets the edited wording.

---

---

# Use Case: Maintain Default Topic Set

*(Added by `admin-default-topic-maintenance`, #216. Traceable to FR-8.1 [HARD] and FR-8.6 [HARD] ("canonical" here means the template as currently maintained, not a fixed factory list), and to BRD 6.4 (copy-on-create). Status: **API only**; the Topic Management template screen is a follow-up (#308 read-only view and history, #309 editing), so FR-8.1 is "partially met, API only", not administrator self-service.)*

## Summary
**Actor:** Application Administrator (`users.global_role = application_admin`; no team membership is involved)

**Trigger:** The administrator decides the starting topics that every new team receives should change: add a topic, reword one, retire one, bring one back, or reorder them.

**Goal:** As an Application Administrator, I want to maintain the default topic set without a database migration so that teams created from now on start with the topics we currently believe are right, with a trail of who changed what.

---

## Preconditions
- The actor is signed in and their live `global_role` is `application_admin`. The IdP role-claim mapping that grants it is part of this control.
- The template (the system-level default topic set) exists with at least one active default.

## Main Flow
1. The administrator reads the template (`GET /api/v1/admin/default-topics`): every default including archived ones, each with its status, position, and who last changed it and when.
2. The administrator makes a change: **add** a default (name, prompt, vote type, first-session description); **edit** a default's name, prompt or description (the vote type is fixed at creation); **archive** a default (it stops being copied to new teams; it is never deleted); **restore** an archived default (it returns at the end of the list); or **reorder** the active defaults (the whole list).
3. The Application validates the change against the fixed limits (1 to 15 active defaults; name 60, prompt 400, description 800 characters; plain text; active names unique ignoring case and spacing), applies it in one transaction, writes one audit row holding the full before and after values, and returns the refreshed list together with the statement "Applies to teams created from now on. Existing teams keep their current topics."
4. Teams created after the change receive the new set. The administrator can read the change history (`GET .../history`) and, to undo a change, edits the value back from the before-value in the history.

## Alternate Flows
- **A. Last active default:** archiving it is refused (`409 LAST_ACTIVE_DEFAULT`); at least one default always stays active.
- **B. Duplicate name:** a name equal to another active default's name (ignoring case and surrounding spaces) is refused (`409 DEFAULT_NAME_DUPLICATE`); restoring a default whose name now collides names the conflicting active default so the administrator can rename or archive it first.
- **C. Capacity reached:** adding or restoring a sixteenth active default is refused (`409 TEMPLATE_AT_CAPACITY`); archive one first.
- **D. Concurrent edit:** a reorder whose list no longer matches the active defaults is refused with the current list (`409 REORDER_ID_MISMATCH`) and a plain-language "reload and try again"; a stale reorder of the same defaults is accepted and the last write wins (the audit row keeps the overwritten order). A change made while another maintenance change holds the template lock for more than three seconds answers `503 DEFAULT_MAINTENANCE_BUSY`.
- **E. Non-admin:** a facilitator, engineering manager, senior engineer, or anyone else gets `403 DEFAULT_MAINTENANCE_ADMIN_ONLY`; the refusal is audited (bounded) and nothing changes.
- **F. Validation failure:** an empty, over-long or non-plain-text field (HTML, entities, links, invisible or control characters), an unknown vote type, or an attempt to change the vote type is refused with `422` and the field name; nothing changes and the error never echoes the rejected text.
- **G. No change:** an edit or reorder that changes nothing returns success with `unchanged: true` and writes no audit row.

## Postconditions
- **Success:** The template reflects the change; positions of the active defaults are exactly 1 to N; one audit row records who, when, which default, and the before and after values. Teams created from now on receive the new set; **no existing team, session, session snapshot or open room changes**.
- **Failure:** The template and the audit trail are unchanged.

---

## Acceptance Criteria
- [ ] Only an Application Administrator can use the maintenance routes; membership on any team is irrelevant.
- [ ] Add, edit, archive, restore and reorder each work, with no migration, and every write response states that it applies to teams created from now on.
- [ ] A team created after an edit receives the edited set; a team created before it keeps its own; a zero-topic team recovered after an edit receives the current template.
- [ ] No existing team's topics, no session and no session snapshot is read or changed by any maintenance operation.
- [ ] An edit can never break team creation: at least one and at most fifteen active defaults, positions 1 to N, valid text, unique active names.
- [ ] Every effective write commits exactly one audit row in the same transaction; a failed audit write rolls the change back; a no-op or rejected request writes none.
- [ ] A change can be undone by editing the previous value back, using the history.
- [ ] Prompts are guided to address the team and the work, never individuals (documented in the runbook and the API contract).

## Out of Scope
- Propagating a change to existing teams or to open sessions; resetting to a factory set; an undo or revert operation (undo is editing the value back); a draft or publish state; notifying facilitators; a semantic filter on prompt content; a two-person approval; the administrator screen (follow-up, #308 and #309).

## Dependencies
- Use Case: Assign Default Topic Set to New Team (consumes the template at team creation); Use Case: Recover Zero-Topic Team (consumes the template at recovery).
- The template is the `__default_topics__` system team's topic rows; the team-scoped topic routes keep refusing it (`404 TEAM_NOT_FOUND`).

## Notes
- **Existing teams keep their copy.** The copy-on-create rule (BRD 6.4) is unchanged: an edit changes what future teams, and teams recovered from zero topics, receive. A team created before an edit and still locked before its first session keeps the set it was created with.
- **Accepted consequences, documented.** A rename is not propagated, and name-based matching for existing teams (restore, bulk restore, the `defaultTopicsNotActive` list) stops pairing them with the renamed default; restoring a default on a team returns that team's own superseded wording; teams created at different times can show different wording for the "same" topic.
- **Single administrator control.** A change needs one administrator and no approver; it is detected (a structured log event per write) rather than prevented. Reopen if the number of administrators grows beyond a handful or after an incident.
- Operational detail (audit queries, retention, redaction, alerting) is in `docs/deployment.md`, "Default topic maintenance".

---

---

# Use Case: Add Custom Topic

## Summary
**Actor:** Facilitator (or Application Administrator, per FR-8.2)

**Trigger:** The Facilitator decides the default topic set is missing a topic relevant to the team's context and wants to add it.

**Goal:** As a Facilitator, I want to add a custom topic with a prompt, vote type, and description so that the team's sessions cover areas specific to their context.

An Application Administrator follows the same flow with the same validation and lock rules.

---

## Preconditions
- The Facilitator is authenticated, or the actor is an Application Administrator (any team, regardless of membership).
- The team has at least one completed session (topic customization is unlocked).
- The Facilitator is eligible to facilitate any team they are not an active member of — the standing, org-wide facilitator model. (Corrected per `topic-customization-lock-and-add-custom-topic` design.md Decision 3: no prior facilitation relationship with this specific team is required. This aligns with Use Case: View Active Topic Configuration's "any team they are eligible to facilitate" phrasing rather than implying an existing facilitation relationship with the specific team.) Or the actor is an Application Administrator (any team, regardless of membership).

## Main Flow
1. The Facilitator navigates to the topic management screen for the team.
2. The Facilitator selects the option to add a new topic.
3. The Application presents a form with fields for: topic name (required), topic prompt (required, distinct from the name), vote type (required — Finger, Roman, or Modified Roman), and topic description (optional). (Clarified per `topic-add-form-and-empty-state`: "distinct from the name" means the prompt is a separate field; the name and prompt may hold the same text. For a custom topic the description is shown on the Topic Management screen only — it is not shown to participants during sessions; see #198, with the proposed fix in #199.)
4. The Facilitator enters the topic name, enters the topic prompt, selects a vote type, and optionally enters a description.
5. The Facilitator submits the form.
6. The Application validates that the name is not empty, the prompt is not empty, and a vote type has been selected.
7. The Application creates the new topic record associated with the team, marked as a custom topic.
8. The Application appends the new topic to the end of the team's topic order.
9. The Application displays the updated topic list with the new topic visible.

## Alternate Flows
- **Facilitator submits without a name:** The Application displays a validation error and does not save. The form remains open with the entered values preserved.
- **Facilitator submits without a prompt:** The Application displays a validation error and does not save. The form remains open with the entered values preserved.
- **Facilitator submits without selecting a vote type:** The Application displays a validation error and does not save.
- **The Facilitator adds a topic with a prompt identical to an existing topic:** The Application does not enforce uniqueness of prompts. The duplicate is saved as a distinct topic. (A warning may be appropriate — see Notes.)
- **Duplicate name (#299):** The submitted name, after trimming and lowercasing, equals the name of an ACTIVE topic of the team. The Application does not save, shows "An active topic with this name already exists" naming that topic at the Name field, and keeps the entered values; Submit stays unavailable until Name is edited. There is no override, for a Facilitator or an Application Administrator. A name matching only an archived topic is not blocked (the screen offers to show the archived topic or add anyway); a matching prompt alone is not blocked. If the screen's list was stale, the server rejects with the same message and the list is refreshed.
- **Save fails due to a system error:** The Application displays an error. No topic is created. The Facilitator can retry.

## Postconditions
- **Success:** A new custom topic exists in the team's topic configuration, appended at the end of the current order, with the specified name, prompt, vote type, and description. It will appear in the next session run for this team, that is, in the next session whose room is opened after it was added. (Delivered by #175, which snapshots the active topics at room open. Note per `topic-add-form-and-empty-state`: the Topic Management screen does not promise in-session display.)
- **Failure:** No topic is created. The team's topic configuration is unchanged. This includes the duplicate-name rejection above.

---

## Acceptance Criteria
- [ ] A name equal (trimmed, case-insensitive) to an active topic's name is rejected on the screen and by the server, with no override (#299).
- [ ] The add topic form requires a non-empty name, a non-empty prompt, and a vote type selection before allowing submission.
- [ ] All three vote types (Finger, Roman, Modified Roman) are available for selection.
- [ ] A successfully added topic appears in the team's topic list immediately after saving.
- [ ] A newly added topic is appended to the end of the topic order by default.
- [ ] The new topic is marked as a custom topic (distinguishable from default topics in the UI).
- [ ] Topic customization controls are only available after the team's first session is complete.
- [ ] The add topic action is available to a standing Facilitator (non-member) and an Application Administrator, not to Engineers, Engineering Managers, or a member-Facilitator.

## Out of Scope
- Adding topics that are available across all teams (global topic library is not part of this feature).
- Importing topics from another team's configuration.
- Setting a topic as inactive without removing it.

## Dependencies
- Use Case: Enforce Topic Customization Lock for First Session — customization must be unlocked.
- Vote type definitions must be available in the application.

## Notes
- Whether the application should warn when a prompt closely resembles an existing topic is an open question. A simple duplicate-prompt warning could prevent accidental near-duplicates. (Resolved for the Topic Management screen by `topic-add-form-and-empty-state`: an exact match — trimmed, case-insensitive — of the name or prompt against the team's active and archived topics shows a non-blocking warning before the request; no fuzzy matching. The server does not enforce prompt uniqueness. Since #299 the server and the screen block a name that duplicates an ACTIVE topic; archived-name and prompt matches stay non-blocking.)
- **Known limitations (#299, PROPOSED, pending Product Owner confirmation):** look-alike names are not caught: names differing only in internal whitespace, Unicode normalization form (NFC vs NFD) or accents ("Equipe" vs "Équipe") are treated as different. Existing duplicate active names are not modified or rejected; archiving one is still allowed, and restoring it later is blocked while the other is active.
- The description field is distinct from the team annotation (see Use Case: Annotate Topic with Shared Team Definition). The description is set at creation; the annotation is a living team-owned definition that can be updated over time.
- Engineering Managers are excluded from topic writes; FR-8.2 names only the facilitator and the Application Administrator.

---

---

# Use Case: Remove a Topic

**Terminology note, corrected (`remove-topic` design.md, shipped `TOPIC-004`):** this use case's "remove"/"removed" vocabulary is superseded by the shipped archive/restore model — `topics.status` transitions between `'active'` and `'archived'`, tracked with `archivedAt`/`archivedBy`, not a `removed` flag. The Main Flow, Postconditions, and Acceptance Criteria below describe the same user-facing behavior this use case always specified; only the underlying state name has changed from what this document originally drafted.

## Summary
**Actor:** Facilitator (or Application Administrator, per FR-8.2)

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
- **Facilitator attempts to remove the last remaining topic:** **Resolved (`remove-topic` design.md Decision 3):** this is a hard block, not a soft warning. The Application rejects the request and displays a message that at least one active topic must remain; the topic is not modified.
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
- [ ] **Added (`remove-topic` design.md Decision 6, Task 10.7):** the archived-topics view shows, for each removed topic, who archived it and when (`archivedBy`/`archivedAt`) — visible directly on the screen, without requiring the Facilitator to consult the audit log or ask a colleague.

## Out of Scope
- Permanently deleting a topic's historical data.
- Removing topics from past sessions retroactively (historical session records are immutable).
- **Corrected (`remove-topic` design.md Decision 6, Task 10.5):** this line originally read "Archiving topics in a way that differs from removal (no archive state is defined)." That is factually superseded — the shipped schema (`topics.status`, `archivedAt`, `archivedBy`) and `TOPIC-004`'s contract define exactly this archive state; "removal," in this document's original vocabulary, always meant this same soft-delete/archive transition, never a hard delete.

## Dependencies
- Use Case: Enforce Topic Customization Lock for First Session — customization must be unlocked.
- Use Case: Re-Add a Previously Removed Topic — the inverse of this action.
- Trend Dashboard: must handle gaps in topic data for removed topics.

## Notes
- **Resolved (`remove-topic` design.md Decision 3):** the application enforces a minimum topic count. Archiving a team's last remaining active topic is rejected with a hard `409` block (`TOPIC_LAST_ACTIVE`), serialized against concurrent requests per team — this is no longer an open question.
- **Resolved (`remove-topic` design.md Context, `specs/remove-topic/spec.md`'s "An in-progress session is unaffected by a concurrent archive" scenario):** removal does not affect in-progress sessions. A session's topic sequence is snapshotted into `session_topics` at room open (#175), independent of `topics.status` — archiving a topic while a session that already includes it is in progress leaves that session's topic sequence unchanged, and the archived topic still appears normally for the remainder of that session. This is no longer an open edge case needing a decision.

---

---

# Use Case: Reorder Topics

## Summary
**Actor:** Facilitator (or Application Administrator, per FR-8.2)

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
- **Success:** The team's topic configuration reflects the new order. Sessions created after the save present topics in the updated sequence; sessions already created keep their order.
- **Failure:** The topic order is unchanged from the last saved state.

---

## Acceptance Criteria
- [ ] The topic management screen displays topics in their current order.
- [ ] The Facilitator can change the position of any active topic relative to any other.
- [ ] The new order is visually reflected immediately when the Facilitator moves a topic.
- [ ] The new order is not applied until the Facilitator explicitly saves it.
- [x] After saving, the new order is used in all subsequent sessions. (Delivered by #175: every session snapshots the team's active topics into `session_topics` at room open, so a session whose room is opened after the save uses the new order, including a draft that was created before the save.)
- [ ] Reordering is not available when only one topic exists.
- [ ] Reorder controls are only available to the Facilitator or an Application Administrator, not to Engineers. (The screen's access rule is inherited from the existing `topic-management-screen` access-denied requirement.)

## Out of Scope
- Automatically reordering topics based on any criteria (reordering is always manual).
- Reordering topics within an in-progress session (topic order is fixed at room open).

## Dependencies
- Use Case: Enforce Topic Customization Lock for First Session — customization must be unlocked.
- BRD FR-2.7 — setting a session's topic order before the session is created, via the team configuration.

## Notes
- Unsaved reorder changes: closing or refreshing the tab triggers the browser's `beforeunload` prompt. In-app navigation, including browser Back/Forward, is not intercepted in v1 and discards the draft per the "reorders but does not save before navigating away" alternate flow (`reorder-topics` design.md Decision 8).
- The reorder interaction is Move to top / Move up / Move down / Move to bottom buttons on each row, usable on desktop and tablet. Drag-and-drop is not provided in v1 (deferred to #181, `reorder-topics` design.md Decision 11).

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
- The team has at least one completed session (topic customization is unlocked). Before then, a save is rejected with `409 TOPIC_CUSTOMIZATION_LOCKED` and audited, the same as every other topic modification (see Use Case: Enforce Topic Customization Lock for First Session).
- The Facilitator is a standing facilitator who is not an active member of the team. Application Administrators cannot annotate (`403`; BRD FR-8.7).
- The topic to be annotated exists in the team's active topic configuration. Default and custom topics are both annotatable.

## Main Flow
1. The Facilitator navigates to the topic management screen for the team.
2. The Facilitator selects the annotate or edit option for a specific topic.
3. The Application presents an editable text field pre-populated with the existing annotation (empty if none exists yet).
4. The Facilitator enters or updates the team's shared definition for this topic.
5. The Facilitator saves the annotation.
6. The Application persists the annotation text against the topic in the team's configuration.
7. The Application confirms the save.
8. In sessions whose room is opened after the save, the Application displays the annotation alongside the topic prompt so all participants can see the team's agreed definition. (Each session snapshots the definition with its topics at room open (#175), so sessions whose room is already open keep the previous one. Session display is pending #56/#57.)

## Alternate Flows
- **Facilitator saves an empty annotation:** Before clearing an existing annotation, the Application shows an inline confirmation ("Remove this team's definition? This can't be undone.") and sends nothing until the Facilitator confirms. On confirmation the Application clears the annotation, and the topic displays without a team annotation in sessions whose room is opened afterwards. Overwriting an annotation with different text does not ask for confirmation. Saving text that is unchanged after trimming sends nothing.
- **Save fails due to a system error:** The Application displays an error. The previous annotation (or lack of one) is retained. The Facilitator can retry.
- **Annotation is excessively long:** The limit is 500 characters (UTF-16 code units, after trimming). The editor's field enforces it and announces "500 character limit reached."; the server rejects a longer value with `422`.

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
- [ ] Annotation editing is available only to the Facilitator (Application Administrators see annotations read-only; BRD FR-8.7).

## Out of Scope
- Engineers, Engineering Managers, or Application Administrators editing or proposing annotations during or between sessions. Only a standing Facilitator (not a member of the team) edits the team's definition (BRD FR-8.7).
- Version history for annotations (overwriting the annotation does not create a revision trail).
- Annotations on the application's default topic descriptions (only the team-specific annotation is editable).

## Dependencies
- Use Case: Enforce Topic Customization Lock for First Session — customization must be unlocked.
- Live Voting — the annotation must be surfaced to participants during the voting phase for each topic.

## Notes
- The annotation is the team's definition of what the topic means to them, distinct from the topic's description (which is set at creation and is more of a prompt explanation). Both may be displayed during a session, but they serve different purposes.
- **Resolved (`topic-annotation`):** both default and custom topics can be annotated. Annotating a team's copy of a default topic never changes the template or any other team.
- The first session may be an appropriate moment to capture initial annotations, but the customization lock means annotations can only be added after the first session completes (a save before then is a `409`). As a result, every team's first session runs the canonical baseline with no annotation.
- The on-screen label is "Our team's definition". "Annotation" is the code/API name.

---

---

# Use Case: Re-Add a Previously Removed Topic

## Summary
**Actor:** Facilitator (or Application Administrator, per FR-8.2)

**Trigger:** The Facilitator decides to reinstate a topic that was previously removed from the team's active topic set.

**Goal:** As a Facilitator, I want to re-add a removed topic so that the team can resume tracking that area, with historical data preserved. (The gap in tracking becoming visible in trend views is scoped to a separate follow-up change — see Notes.)

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
5. The Application presents a confirmation, noting that existing historical data for the topic will be restored.
6. The Facilitator confirms.
7. The Application marks the topic as active in the team's configuration.
8. The Application appends the topic to the end of the active topic order (resolved — see Notes).
9. The Application confirms the re-addition and displays the updated active topic list.

## Alternate Flows
- **No removed topics exist:** The removed topics list is empty. The option to re-add is not shown, or the empty state is communicated clearly.
- **Facilitator cancels the confirmation:** No change is made. The topic remains removed.
- **Re-add fails due to a system error:** The Application displays an error. The topic remains removed. The Facilitator can retry.
- **Duplicate name (#299):** An active topic of the team already has the same name (trimmed, case-insensitive). The Application does not reinstate the topic, shows at the row "Not restored. An active topic with this name already exists: ... Nothing was changed. Archive the active topic first if you want to restore this one.", and the topic stays archived. There is no override, for a Facilitator or an Application Administrator. **Swap path:** the Facilitator archives the active topic, then reinstates the archived one. Bulk "Restore default topics" keeps skip-and-report for the same collision. This reverses the earlier behaviour (#218) in which single restore ignored the duplicate rule.

## Postconditions
- **Success:** The topic is active again in the team's configuration. It will appear in the next session. Its historical vote data (from before it was removed) is accessible in trend views. (A marker for the gap in sessions where it was absent is scoped to a separate follow-up change — see Notes; it is not part of this use case's shipped behavior.)
- **Failure:** The topic remains removed. No configuration change is made. This includes the duplicate-name rejection above.

---

## Acceptance Criteria
- [ ] The topic management screen provides access to the list of previously removed topics.
- [ ] Each removed topic can be individually reinstated by the Facilitator.
- [ ] A confirmation step is shown before reinstating, describing the history preservation behavior.
- [x] After reinstatement, the topic appears in the active topic list and is included in the next session. (Delivered by #175: the next session whose room is opened snapshots every active topic, restored or otherwise, with no restore-specific handling.)
- [ ] Historical vote data for the topic from before its removal is preserved and accessible in trend views.
- [ ] The archived-topics view shows who restored a topic and when, mirroring the existing archive-provenance display (`re-add-removed-topic` design.md Decision 4).
- [ ] The re-added topic can be reordered within the active list after reinstatement.
- [ ] Reinstating a topic whose name equals an active topic's name is rejected with the row message and no change, until the active topic is archived (#299).

## Out of Scope
- Retroactively adding the topic to sessions that occurred while it was removed.
- Merging data from two separate topic records (re-adding restores the original topic, not a duplicate).
- A marker in the EM trend view indicating a topic was intentionally absent for a stretch of sessions (the "trend-gap signal") — scoped to a separate follow-up change coordinated with Trend Dashboard ownership (`re-add-removed-topic` proposal.md "Scope Decision"), not part of this use case's shipped behavior.

## Dependencies
- Use Case: Remove a Topic — the inverse of this action.
- Trend Dashboard: must correctly render gaps in topic history when a topic was absent for one or more sessions. (Applies to the trend-gap-signal follow-up change described in Notes, not to this use case's shipped scope.)

## Notes
- **Resolved:** a reinstated topic is appended to the end of the active topic order, not restored to its prior position (`re-add-removed-topic` design.md Decision 3). Archiving a topic never has to renumber the remaining active topics because `display_order` is unique only among a team's active topics (partial unique index `topics_team_active_order`, migration 18, `reorder-topics` design.md Decision 1; this replaced the original `topics_team_order UNIQUE (team_id, display_order, status)` constraint); restoring to the prior position would require deciding what happens if an active topic has since taken that slot, which appending avoids needing entirely.
- **Resolved, deferred:** the trend view treatment of the gap (e.g., a break in the line vs. a label indicating removed/reinstated) is not built as part of this use case. Executive review split it into its own follow-up change, coordinated with Trend Dashboard ownership, since restore has no dependency on it in either direction. The derivation approach explored for it (based on `session_topics` absence) is preserved in `re-add-removed-topic` proposal.md's "Scope Decision" section for that follow-up to pick up.

---

---

# Use Case: Restore Default Topics (bulk) — extension of Re-Add a Previously Removed Topic

## Summary
**Actor:** Facilitator who is not a member of the team, or Application Administrator (same rule as single restore, FR-8.2, #208)

**Trigger:** Before a session, the Facilitator sees that several of the team's default topics were archived and wants them back without restoring each one separately.

**Goal:** As a Facilitator, I want to restore all of the team's archived default topics in one step, so that the team's shared baseline is back quickly and I can then reorder if I want to. (Traceability: GitHub #218; BRD FR-8.6 [HARD], which stays partially met.)

## Preconditions
- The Facilitator is authenticated and may act on the team (not a member of it, or an administrator).
- The team has completed at least one session (customization is unlocked).
- At least one archived default topic exists whose name does not match an active topic.

## Main Flow
1. The Facilitator opens the topic management screen. A "Restore default topics" control is shown only when something is restorable.
2. The Facilitator activates it. A confirmation lists the topics that will be added, in the order shown, and states that they go to the end of the list and that custom topics, the current order and annotations are not changed. Any default skipped because a topic with the same name is already in the list is listed as "Not restored".
3. The Facilitator confirms. One request is sent.
4. The Application reactivates the original rows (history preserved), appends them after the current last topic in their prior relative order, records who restored them and when, and writes one audit entry.
5. The Application shows how many topics came back and where they are, and any skipped topics, then refreshes the lists.

## Alternate Flows
- **Nothing restorable:** The control is not shown. If the server finds nothing to restore (for example another facilitator restored them first), it answers success with "Nothing to restore." and changes nothing.
- **A name became active after the dialog opened:** The topic is skipped and reported; the result says "Restored A of P topics. The list changed after you opened this dialog."
- **Facilitator cancels:** No change.
- **Unsaved edit on the screen:** The control is disabled with "Save or discard your edit first."
- **Team is locked, role no longer allowed, team not found, rate limit, or system error:** The dialog closes, a message is shown, and nothing is changed.
- **Restoring only some topics:** Not offered here; restore them one at a time from the archived list.

## Postconditions
- **Success:** Every restorable archived default is active again at the end of the list, with its history. Sessions whose room is already open are unchanged.
- **Failure:** No topic changes (one transaction).

## Acceptance Criteria
- [ ] The control appears only for a caller who can act, on an unlocked team, when at least one archived default would be restored.
- [ ] One confirmation and one request restore any number of archived defaults.
- [ ] The confirmation names the topics to be added in restore order, the end-of-list placement, and what is not changed.
- [ ] An archived default whose name matches an active topic (trim, case-insensitive) is skipped, reported, and left archived.
- [ ] Restored topics keep their ids and history and are placed after the current last topic in their prior relative order.
- [ ] The result states the actual number restored and the skipped topics, and reports a difference from the preview.
- [ ] A team with no active topics and a restorable default is offered "Restore default topics" first and "Assign default topics" (administrators) second.
- [ ] The restore is recorded once in the audit log without topic names, and per topic in the restored-by and restored-at columns.
- [ ] Nothing about the restore appears to participants or in any session view, and open sessions are unchanged.
- [ ] Neither the dialog nor the result mentions reset, canonical wording, trends or lost history.

## FR-8.6 traceability
| Clause | Before | After |
|---|---|---|
| "restorable" for archived default rows | One at a time | In one step |
| "restorable" for a team with zero active topics | Met by assign-defaults (#200, administrator only) | Unchanged; bulk restore is the preferred first step when restorable archived defaults exist |
| "visible" for teams whose default rows were edited, deleted, or never existed | Open | Still open |
| Partial or selective restore | Single restore only | Still single restore |
| Canonical wording on restore | Not met (the original row returns with team edits) | Still not met; an edited default returns under its edited name and the copy does not promise otherwise |

## Notes
- Customs first, defaults last: restored defaults are appended, so a tailored team's baseline ends up at the bottom. Reset-to-canonical-order is a separate, later issue.

---

# Use Case: View Active Topic Configuration

## Summary
**Actor:** Facilitator (or Application Administrator, per FR-8.2)

**Secondary Actor:** Application Administrator (read-only definitions; FR-8.7)

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
- **Team has no active topics (for example after a data error):** The Application displays an empty state. Removing the last active topic is blocked (`409 TOPIC_LAST_ACTIVE`), so this state cannot be reached by removing topics through the UI; it arises from a concurrent-archive race (#184), a team created with zero default topics (#200), or a manual data fix. What the empty state offers depends on whether the team is locked, whether archived topics exist, and whether the caller can add topics: it offers re-adding from the archived list and/or adding a custom topic only where those actions can succeed, and no actions otherwise (see the `topic-management-screen` spec, added by `topic-add-form-and-empty-state`).
- **Facilitator does not have access to this team's configuration:** The Application displays an access error. (Access rules for topic management outside a live session should be defined — see Notes. For the Application Administrator arm, see the `topic-customization-lock` spec.)

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
- [ ] An Application Administrator can view the screen for any team, whatever their membership on it; team definitions are shown read-only.
- [ ] Every administrator view is recorded in the audit log, without topic names or definition text.

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
4. If a team annotation exists for the topic, the Application displays it alongside the prompt. *(Pending #56/#57; the per-session snapshot it reads is written at room open by #175. The source is the session payload's `currentTopic.topicAnnotation`, the per-session snapshot, never TOPIC-001.)*
5. If a description exists for the topic, the Application displays it (or makes it accessible) to provide additional context.
6. The Engineer reads the prompt, annotation, and description to orient their response.
7. The Engineer proceeds to cast their vote (this step is covered in Live Voting use cases).

## Alternate Flows
- **Topic has no annotation:** The Application displays the prompt and description without an annotation section. No placeholder or empty field is shown.
- **Topic has no description:** The Application displays the prompt and annotation (if any) without a description.
- **Engineer joins the session after the topic has been displayed:** The Application shows the current topic's prompt, vote type, annotation, and description to the late joiner immediately upon joining. *(Annotation part pending #56/#57. #175 writes `session_topics.topic_annotation` at room open; the reconnect snapshot does not yet carry it and must carry that session snapshot value.)*

## Postconditions
- **Success:** The Engineer has seen the topic prompt, vote type, team annotation, and description. No data is changed by viewing.
- **Failure:** The Engineer cannot see the topic details, preventing them from casting an informed vote.

---

## Acceptance Criteria
- [ ] When the Facilitator advances to a topic, the topic prompt is displayed to all participants simultaneously.
- [ ] The vote type controls shown to the Engineer match the configured vote type for the topic (Finger = 1–4 scale; Roman = up/down; Modified Roman = up/steady/down).
- [ ] The team annotation, if present, is displayed alongside the prompt before the vote is cast. *(Pending #56/#57; the snapshot is written at room open by #175. Source: `currentTopic.topicAnnotation` from the session payload, the snapshot, not TOPIC-001.)*
- [ ] The topic description, if present, is accessible to the Engineer during the voting phase.
- [ ] Topics with no annotation show no annotation UI element. *(Pending #56/#57.)*
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
