## Why

One of the properties I asked for in the original proposal was **topic flexibility within guardrails**: a team can adapt its topic set, but the defaults stay visible and easy to get back to. Today the Topic Management screen keeps only half of that promise. A team can remove, restore, reorder, and annotate the canonical twelve, but it cannot add the one topic that is specific to its own context (the on-call rotation, the legacy system, the partner integration) without someone calling `POST /api/v1/teams/:teamId/topics` by hand. In practice that means nobody will, and the ritual quietly stops fitting the team.

The second gap is smaller but it is the same promise. When a team's active list is empty the screen says "No active topics." and stops. The use case ("Team has no active topics") wants a way back. More importantly, exploration found that one way to reach that state is a provisioning configuration error with **no in-app recovery at all**, so the copy has to be honest about who can fix it rather than point at a button that doesn't exist.

This is issue #55, re-scoped after #51–#54 built the rest of the screen. Exploration (`exploration-notes.md`, revision 2) was reviewed by Priya Nair (Facilitator) and Marcus Delgado (BA); every fork they raised is settled there, and this proposal carries those decisions forward without reopening them.

The form is a **between-sessions handoff tool**. The trigger for a new topic is a live moment ("the thing that's actually killing us is the partner integration"), but the topic is typed in days later, often by a different facilitator. That is why a slightly richer form (vote-type explanations, a duplicate check) costs nothing in the room, and why its copy has to be scrupulously honest about what participants will and won't see.

What must not loosen:

1. **First-session lock.** No add affordance at all on a locked team: no disabled button, no teaser. A greyed-out button is a standing invitation to ask for an exception. The server still answers `409` regardless.
2. **Facilitator from another team.** TOPIC-003's `FACILITATOR_IS_TEAM_MEMBER` rejection stands; the form surfaces a `403` exactly as the definition editor does and never works around it.
3. **No-manager rule and engineers can't add.** TOPIC-002 already rejects engineers and EMs before the screen renders, so the use case AC "engineers cannot add topics" is met by the existing route guard and its existing authorization test. This change adds no surface they can reach.
4. **Defaults stay visible and restorable.** Custom topics are visibly marked "Custom". The empty state points back to Archived before it offers "add your own". The duplicate check points a facilitator to an archived topic before letting them recreate it and split its trend history.
5. **The app fades into the background.** A dirty-but-idle add form locks nothing else on the page. Only *submitting* gates other controls.

## What Changes

- **Inline "Add custom topic" form** on the Topic Management screen, rendered **if and only if** `isCustomizationLocked === false && canAddTopics === true`. The trigger sits in the Active Topics heading row; the form opens inline under the heading (no modal, no route change), one at a time.
  - Fields: **Name** (required, ≤100), **Prompt** (required, ≤500), **Vote type** (required radio group with **no default selection**, an inline explanation per option, and the up-front note that vote type can't be changed later), **Description** (optional, ≤500, labelled "Description (optional, shown on this screen only)" with helper text that promises no in-session display). Exact copy is in the delta spec.
  - Client-side required-field validation with per-field messages and focus on the first failure; a character counter from 80% of each limit; no rule that name and prompt must differ (the use case's "distinct from the name" means a separate field).
  - **Duplicate check on submit**: exact match on trimmed, case-folded name **or** prompt against active and archived topics. Non-blocking. An archived match offers "Show it in Archived topics" first, because restoring keeps one trend.
  - Server `422` `error.field` mapped onto the field; values kept on every failure that leaves the form open, with Submit and fields re-enabled. `403 NOT_A_FACILITATOR` / `FACILITATOR_IS_TEAM_MEMBER` and `404 TEAM_NOT_FOUND` keep the form open with a form-level alert; `409 TOPIC_CUSTOMIZATION_LOCKED` closes the form, shows a fixed alert, and quietly refetches so the lock notice appears and the control disappears; network/`5xx` keeps values for retry.
  - On `201`: form closes, quiet refetch, `role="status"` line "Added '<name>' to the end of the list. Use the move buttons to change where it falls.", focus to the new row. If the refetch fails after a `201`, the message says the topic **was** added so nobody resubmits a duplicate.
  - Messages that outlive the form share one screen message region under the Active Topics heading, with stated roles and an enumerated lifetime.
  - Cancel on a dirty form asks inline "Discard this topic?"; a dirty form arms the existing `beforeunload` guard.
- **Interlocks** per the exploration matrix: Submit is disabled while the reorder draft is dirty/saving (otherwise the new topic would be invisible and the next order save would go stale), while a definition is dirty/saving, and while a Remove/Restore dialog is open, each with the existing reason string. While the add request is in flight, moves, Save order, Remove, Restore, and definition edit are disabled with one new reason, "Wait for the new topic to finish saving." A dirty add form locks nothing.
- **Quiet refetch after Remove and Restore.** Their success paths move from `loadTopics()` (whose failure replaces the whole screen) to the existing `fetchAllTopics()` helper with an inline alert on failure. This is two call sites, and it is what makes "a dirty add form locks nothing" safe: no post-write refetch can destroy typed text. `loadTopics()` remains for the initial load and team change only.
- **"Custom" tag** on every active and archived row where `isDefault === false`, as text in the row's accessible name. Default rows carry no tag.
- **Active count in the heading:** "Active Topics (n)", matching "Archived Topics (n)".
- **Empty active-topics state**, derived from `isCustomizationLocked`, `archived.length`, and `canAddTopics` (five-row decision table with exact copy in the delta spec). The locked row uses **neutral copy that names no specific support channel** (H1): "This team has no active topics, so its sessions can't run. Topics can't be assigned from this screen. Ask the people who run this application for your organization to restore this team's default topics." No row names a role or a button that doesn't exist.
- **`canAddTopics` flag on TOPIC-002** (`GET /api/v1/teams/:teamId/topics/all`): `true` for a standing facilitator, **`false` for an application administrator as a temporary consequence of BRD FR-8.2 defect #176**. The spec text itself says "temporary" and "#176" so archiving does not turn a known bug into a product rule.
- **Shared types** `AddCustomTopicRequest` / `AddCustomTopicResponse` in `packages/shared/src/types/topic.ts`, and `canAddTopics` on `GetAllTopicsResponse`.
- **The screen does not read `defaultTopicsNotActive`.** Its name-based join is wrong when a custom topic shares a default's name (handoff below), and its fallback `topicId` can point at the template team.

No **BREAKING** changes. The only API change adds one response field.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `topic-management-screen`: adds the add-custom-topic form, its validation, duplicate check, outcomes and interlocks; the "Custom" tag; the active-topic count; the empty-state decision table; and quiet (non-destructive) refetch on the Remove and Restore success paths.
- `topic-customization-lock`: `GET /api/v1/teams/:teamId/topics/all` gains the top-level `canAddTopics` flag (temporarily `false` for administrators pending #176).

`add-custom-topic` (TOPIC-003) is unchanged: this change is its first UI consumer, not a change to its contract.

## Impact

**Code:**
- `packages/frontend/src/pages/TopicManagementPage.tsx`: add form, empty state, Custom tag, heading count, interlock wiring, Remove/Restore success paths switched to `fetchAllTopics()`. No new dependencies.
- `packages/backend/src/routes/content.ts`: TOPIC-002 returns `canAddTopics` (beside the existing `canEditAnnotations`).
- `packages/shared/src/types/topic.ts`: `AddCustomTopicRequest`, `AddCustomTopicResponse`, `GetAllTopicsResponse.canAddTopics`.
- After design review (design.md Decision 10–11): the form's pure logic and presentation are extracted to `packages/frontend/src/pages/addCustomTopic.ts` and `packages/frontend/src/components/AddCustomTopicForm.tsx` (with `ActiveTopicsEmptyState`), and `App.tsx` keys the screen on `teamId`. Structure and hardening only; no added behaviour.
- Tests: `content.test.ts` (including the `canAddTopics` parity test), `addCustomTopic.test.ts`, `TopicManagementPage*.test.tsx` (new `.add` and `.empty` files).

**Known deviations from the use case (stated plainly):**
- *"It will appear in the next session run for this team"* (Add Custom Topic postcondition) is blocked for **every** topic on #175 (`session_topics` never populated). The form's copy says nothing about sessions. Until #175 is closed, this change is not described as an adoption win in release notes or status updates (Executive condition 1): a custom topic today is one nobody can vote on.
- *"A description is shown in session if it exists"* (View Topics During a Live Session, step 5) can never hold for a custom topic: descriptions are sent only in a team's first session, and a custom topic can only exist after it. The description field is labelled honestly instead. Tracked as a defect in the handoffs below.
- *"Team has no active topics (all have been removed)"*: the UI can't reach this (the last-active-topic guard). The real causes are the #184 archive race, a provisioning gap that copies zero default topics, and manual data fixes. All five empty-state rows are covered by component tests against a mocked TOPIC-002 response; that is the test approach, not an omission.
- **BRD FR-8.2 [HARD]** ("the facilitator or Application Administrator shall be able to add, remove, or reorder topics"): administrators can see the screen but cannot add topics until #176 is fixed. Outside the empty state they see no add control and no explanation (an explanation would only invite a duplicate report against #176); the empty state's row 5 ("Topics can't be added from this account yet.") is the one place they are told. Rows 3 and 5 are removed when #176 is fixed.
- **BRD FR-8.6 [HARD]** ("the canonical default topic set must remain visible and restorable for any team at any time"): not met for a team with zero archived topics (empty-state rows 1, 4 and 5 when nothing is archived, which is the provisioning-gap case). Such a team has no in-app way to see or restore the defaults, and this change deliberately does not read `defaultTopicsNotActive` or add a restore-defaults action. Tracked by `handoffs/zero-topic-team-recovery-path.md` and `handoffs/default-topics-not-active-name-join.md`.

**Out of scope:** #176, #184, #187, #188, #175; editing an existing topic (especially its vote type, which would break trend continuity); a "restore the default set" endpoint; fuzzy duplicate matching; a global topic library.

**Handoffs (drafts for the human to file; issue numbers TBD, H2).** These remain drafts in this change directory. No agent files them. The in-session description gap must be filed before this proposal is approved (Marcus C1), and the zero-topic recovery path is filed alongside it (Rachel, condition 2). The other four are hygiene: filed, but not ship-gating and not needing sponsor attention:
- `handoffs/custom-topic-description-never-shown-in-session.md`: defect against UC step 5.
- `handoffs/custom-topic-first-appearance-orientation.md`: the real fix, treating a custom topic's first appearance as its own first session.
- `handoffs/default-topics-not-active-name-join.md`: sibling to #184; the `defaultTopicsNotActive` name join.
- `handoffs/zero-topic-team-recovery-path.md`: team provisioning that silently copies zero topics, and the missing recovery action.
- `handoffs/custom-topic-creator-attribution.md`: who added a custom topic and when (needs a migration).
- `handoffs/use-case-empty-state-trigger-wording.md`: correct the use case's "all have been removed" trigger.

**Pre-ship check (H3, not an implementation task):** before this ships, Priya runs a 15-minute hands-on check on a test team: add one fresh custom topic, and attempt one that collides with an archived default. Scheduling it is a human item. It is not a task an agent performs and it does not gate task completion; it gates the ship decision.

**Copy review:** Priya reviews the final form, duplicate-warning, outcome, and empty-state strings before the delta specs are approved (exploration review Q1). Marcus owns the description-field wording (C1).

**Not touched:** the no-manager rule, simultaneous reveal, the facilitator-from-another-team rule, TOPIC-003's contract and authorization, every shipped reorder/definition interlock (none is relaxed), and session payloads.

## Review disposition

Reviewed at proposal stage by Marcus Delgado (BA, implementable with targeted fixes) and Rachel Okonkwo (VP Engineering, approve with conditions). Every BA gap was closed by **specifying behaviour that already had to exist**, not by adding features; Rachel's "no scope growth" condition holds. No new control, endpoint, or empty-state row was added. The one new requirement ("Screen-level outcome messages share one region under the Active Topics heading") only says where and for how long messages that were already in the spec appear.

**Accepted into the delta specs (and design.md where it carried the decision):**
- **O1.** On `409 TOPIC_CUSTOMIZATION_LOCKED` the form closes and its values are discarded, focus goes to the Active Topics heading, the gating rule applies to whatever the refetch reports (locked or, after a race, unlocked), and a failed refetch keeps the screen and adds "Reload the page to see the current state." Scenario added.
- **O2, O3.** One screen message region directly under the Active Topics heading for the add success messages, the `201`+refetch-failure message, the 409 message, and the Remove/Restore refetch-failure messages. `role="status"` for success, `role="alert"` otherwise; at most one message, newest wins. Lifetime is an enumerated list of events, and focusing a field does not count.
- **O4.** 403 codes named: `NOT_A_FACILITATOR`, `FACILITATOR_IS_TEAM_MEMBER` (and `404 TEAM_NOT_FOUND`).
- **O5.** Every failure that leaves the form open restores "Submit", enabled subject only to the interlocks, with editable fields.
- **O6, O7.** "Added '<name>'." scenario from the empty state; focus falls back to the Active Topics heading when the new id isn't in the refreshed list, and after a `201` whose refetch fails.
- **D1–D6.** First match in display order is named and focused; an "Add anyway" override persists until Name or Prompt is edited (retry scenario); editing either field dismisses the warning; case folding is `toLowerCase()` with no locale, and internal whitespace is not normalised (scenario); the check is a hint against the loaded lists; the focus target is the archived row's heading.
- **I1, I2.** Sending an add closes a clean open definition editor (scenario), and "Wait for the new topic to finish saving." takes precedence while in flight. The duplicate warning's "Add anyway" actions are gated exactly like Submit, which closes the same hole from the other side.
- **F1.** After a failed Remove/Restore refetch the lists stay as last loaded; a stale second Remove surfaces the server's `422` through the existing Remove failure handling (scenario).
- **T1–T3.** Focus returns to the control that opened the form; opened from the empty state, the form takes the place of the empty-state actions under the message. Counter reads "n / limit", is not a live region, and is in `aria-describedby`. "Active Topics (0)" asserted in an empty-state scenario.
- **G1.** `canAddTopics` is `true` for every facilitator TOPIC-002 admits; the flag computes no membership.
- **Traceability.** FR-8.2 cited by number; FR-8.6 added as a stated deviation for zero-archive teams, tracked by the two existing handoffs; AC7 points at the existing scenario "An ineligible caller sees an access-denied state, not the topic list".
- **§4.** The admin sentence now says "outside the empty state". The spec says rows 3 and 5 are removed in the same change that fixes #176.

**Accepted with modification:**
- **I3.** No MODIFIED blocks. Restating two long living requirements to change one rationale clause each is weight without behaviour; design.md Decision 2 records that the interlocks stay deliberately because a successful refetch still replaces the lists under a dirty draft. The archive step can reword the rationale if the sync reviewer wants it.

**Checked, no change:**
- **F2.** `openspec/specs/remove-topic`, `restore-topic`, and `topic-management-screen` contain no statement that the Remove/Restore refetch uses the full-screen path; ADDED is correct.
- **G2, gate 2 (description wording).** Approved as written by the BA.

**Executive conditions:**
- **C2 / condition 4 (scope).** Held. The fixes above are behaviour statements on existing controls and messages. No illustration, onboarding, restore-defaults action, new empty-state row, or new handoff was added. Task count grows only by tests for the newly stated edges, folded into existing tasks.
- **Condition 1 (#175 sequencing, no adoption framing)**, **condition 2 (file the zero-topic handoff with the description defect)**, **condition 3 (#176 target date)**, **BA gate 1 (file the description handoff and record its number)**, and **Priya's copy review** are human actions. They are recorded in this proposal and in the tasks' pre-ship list. No agent performs them, and the proposal text is not blocked on them.
- **C2 "should the screen get simpler?"** Noted for the next topic-management proposal; not actioned here.
