# BA Review: Exploration Notes for topic-add-form-and-empty-state (#55)

**Reviewer:** Marcus Delgado (Senior Business Analyst)
**Date:** 2026-10-01
**Reviewed:** `exploration-notes.md` (Devon Calloway)
**Focus:** Are the ideas specific enough to become requirements? What is too vague to carry into a proposal?

---

## Overall read

This is a strong exploration. Most of the hard findings are concrete and traceable to code or to the use case: the description semantics (2.1), the admin dead-end (2.3), the reorder-draft invisibility hazard (2.4 #1), and the name-join defect (2.6). Those can go into a proposal nearly as written.

The vagueness sits in three places:
1. **Client-side form behaviour.** The notes cover server 422 mapping well, but the use case's acceptance criteria are about what the form does *before* it submits. Those are mostly unspecified.
2. **Copy.** Several items say "something like" or "e.g." for text that will become the user's only explanation of a rule (the empty state, the description label, warnings). A proposal needs exact strings, or a named owner and a deadline for them.
3. **Open forks with no default.** Five of the seven open questions have a stated lean but no decision rule. A proposal can't carry "strict or loose" into specs.

Below: clarifications needed, then vague areas with suggested rewrites in acceptance-condition form.

---

## 1. Clarifications needed (decisions, not wording)

| # | Question | Why it blocks a requirement | My recommendation |
|---|---|---|---|
| C1 | **Description label and helper text (Q1).** Who decides? | Form copy and the in-session gap both depend on it. | I'll take this one; it's a requirements meaning question, not a product one. Go with option 1 plus the option 2 hint. Exact strings in V3 below. File the in-session gap as its own issue *before* the proposal is approved, and reference the issue number in the spec, so the gap is a tracked defect against "View Topics During a Live Session" step 5, not a note. |
| C2 | **Admin gating (Q2).** | Changes whether this is frontend-only or touches the TOPIC-002 contract. | Agree with B (`canAddTopics` on TOPIC-002). The spec must state the truth table *and* say the admin row is temporary pending #176. See V5. |
| C3 | **Dirty add-form policy (Q3).** Strict or loose? | Changes the interlock matrix and the test matrix. "Quiet refetch everywhere, else strict" is two different specs. | Decide before the proposal. My recommendation: **strict**, unless the design author can show that moving *all* existing post-write refetches to the quiet path is in scope and testable in this change. Strict is one more row in a matrix we already test; "quiet refetch everywhere" quietly rewrites the failure handling of four shipped flows. |
| C4 | **Duplicate warning (Q4).** Name, prompt, both? Exact or normalised match? Blocking or not? Does it offer "Restore instead"? | "Warn on a name that matches" is untestable until "matches" is defined. | Name only, exact match after trimming and case-folding, against active and archived topics. Non-blocking. When the match is archived, offer a link that expands Archived and focuses that row (no new restore path). Prompt-duplicate warning: **defer**. The use case leaves it open, and a near-duplicate check is a different feature. Record it as deferred, not dropped. See V7. |
| C5 | **`defaultTopicsNotActive` join fix (Q5).** | Nothing in this change consumes it if V9 is accepted. | Out of scope. File it as a sibling issue under #184 so it isn't lost. The proposal should say explicitly "this change does not read `defaultTopicsNotActive`". |
| C6 | **Locked/empty recovery path (Q7).** Who can fix a team with no topics? | The empty-state copy for case 2 promises a recovery path. If nobody can actually fix it, the copy is a lie. | Needs an answer from engineering/ops before copy is final. If there is no admin tool today, the copy should say "Contact support" (or whatever the real channel is), not "Contact an application administrator". Don't name a role that has no button. |
| C7 | **Who sees the add control: Engineers?** The use case AC says "available only to the Facilitator, not to Engineers." | The notes cover admins and EMs, not Engineers. | Confirm in the proposal that Engineers can't reach TOPIC-002 at all, so the AC is met by the existing route guard. One sentence plus a test reference is enough. |
| C8 | **403 `FACILITATOR_IS_TEAM_MEMBER` in the form.** | TOPIC-002 already rejects team members, so this only happens if membership changes while the page is open. "Shows the server message verbatim" doesn't say *where* or what the form state is afterwards. | Mirror the existing definition-save 403 handling in the screen spec (~L281). Name it as the precedent rather than inventing a new pattern. See V6. |

---

## 2. Vague areas and suggested rewrites

### V1. Client-side validation is unspecified (use case AC 1, alternate flows)

**Notes say:** 422 `error.field` mapping, values preserved.
**Gap:** The AC says the form "requires a non-empty name, a non-empty prompt, and a vote type selection **before allowing submission**." The notes never say whether the client validates, whether Submit is disabled or shows errors on click, or how the 100/500 limits show up.

**Suggested acceptance conditions:**
- Name, Prompt and Vote type are marked required. Description is marked optional.
- Activating Submit with a blank name or prompt (whitespace-only counts as blank) sends **no request**. It shows an inline error on each failing field ("Enter a topic name." / "Enter a prompt."), moves focus to the first failing field, and keeps all entered values.
- Name input enforces 100 characters, prompt and description 500, via `maxLength`. A visible counter appears from 80% of the limit. (Or pick a different rule, but pick one.)
- A server 422 with `error.field` in {`name`, `prompt`, `voteType`, `firstSessionDescription`} shows `error.message` on that field and focuses it. A 422 with no field, or an unknown field, shows the message at form level. All values are kept in both cases.
- **No** rule requires the name and prompt to differ (2.2). State this as a negative requirement so nobody adds one.

### V2. Vote type default is unstated

**Gap:** The use case has an alternate flow for "submits without selecting a vote type", which implies there's no preselected value. The notes are silent. A preselected default is how teams end up with a scale they never chose, and that breaks trend comparability (the notes' own point in 2.2).

**Suggested condition:** The vote type control has **no default selection** when the form opens. Submitting without one sends no request and shows "Choose a vote type." Each option shows its label from `VOTE_TYPE_LABELS` and a one-line explanation. The proposal must list the exact three explanation strings, not "Finger = 1–4" shorthand.

### V3. Description label: "e.g." is not a requirement

**Notes say:** "Description (shown on this screen)", or "Notes for facilitators".
**Suggested rewrite (pending C1 sign-off):**
- Field label: **"Description (optional, shown on this screen only)"**
- Helper text: **"Engineers won't see this during sessions. To explain this topic in sessions, add a team definition after you create it."**
- Leading and trailing whitespace is trimmed. A value that is empty after trimming is sent as `null`.
- The existing row rendering doesn't render a description that is whitespace-only. This is a defensive condition for rows already stored with whitespace.

### V4. "Keep the form small", "the app should fade into the background"

These are principles, not requirements. Either convert them or drop them from the proposal.

**Suggested conditions:**
- The form opens inline, between the active list (or empty state) and the Archived section. There is no modal and no route change.
- At most one add form is open at a time. The "Add custom topic" control is hidden while the form is open.
- Cancel closes the form. If any field has content, Cancel asks for confirmation ("Discard this topic?"). If all fields are empty, it closes without asking. *(Clarify: do we want this confirm? The definition editor precedent doesn't confirm on cancel. Pick one and say which precedent it follows.)*
- On open, focus moves to the Name field. On Cancel, focus returns to the "Add custom topic" control.

### V5. Gating truth table must be exact

**Suggested rewrite:** The add control is rendered if and only if `isCustomizationLocked === false` **and** `canAddTopics === true`. There is no disabled or teaser variant on locked teams (state this as a negative scenario).

| Caller reaching TOPIC-002 | `canAddTopics` (this change) | After #176 |
|---|---|---|
| Standing facilitator, not a team member | true | true |
| Application admin | **false (temporary, FR-8.2 defect #176)** | true |

The spec text must include the words "temporary" and "#176" in the requirement itself, not only in design.md. Otherwise the archive step will merge it into the living spec as a product rule.

### V6. Submit-time states are named but not fully specified

**Suggested conditions:**
- While the request is in flight, Submit is disabled and reads "Adding…". Fields are read-only. Every control marked ✱ in the 2.4 matrix is disabled.
- **201:** the form closes and is reset. A `role="status"` message reads exactly **"Added '<name>' to the end of the list. It will be included in sessions created from now on."** Focus moves to the new row's heading. The message stays until the next action on the screen, with no timer (this matches "Order saved.").
- **403** (either code), **409 `TOPIC_CUSTOMIZATION_LOCKED`**, **404**, network or 5xx: the form stays open with values kept. A form-level `role="alert"` shows the server message (403/404) or a fixed string for 409 and system errors. Submit is re-enabled so the user can retry (use case: "The Facilitator can retry"). Be specific for 409: should the page also refetch so the lock notice appears? I recommend yes.
- **Refetch failure after a 201:** the topic *was* created. The message must say so, e.g. "Added '<name>', but the list couldn't be refreshed. Reload to see it." It must not show a generic error that invites a duplicate resubmit. **The notes miss this case, and it's the one most likely to create duplicate custom topics.**

### V7. Duplicate-name warning: define "match" and the interaction

**Suggested conditions (pending C4):**
- On submit, if the trimmed, case-folded name equals the name of any active or archived topic on this team, the form doesn't send. It shows an inline warning: "A topic named '<existing name>' already exists (active|archived)." with a "Add anyway" button. If the match is archived, it also shows a "Show it in Archived topics" link.
- "Add anyway" sends the request unchanged. Names are not unique and the server doesn't enforce uniqueness.
- "Show it in Archived topics" expands the Archived section and focuses that row. The add form stays open with its values.
- Decide whether this check runs on submit or on blur. Submit is simpler and testable. Blur is friendlier. I'd pick submit.

### V8. Interlock matrix has an unresolved row and an implied column

**Gaps:**
- "add form dirty ✱ → ?": resolve via C3.
- The matrix is missing the **reverse** of "add submitting": what does an *open but clean* add form disable? I assume nothing. Say so.
- "Dirty" must be defined for the add form. Suggested: any field differs from its initial empty value (Name, Prompt or Description non-empty after trimming, or a vote type selected).
- `beforeunload`: arm when the add form is dirty (same definition). In-app navigation is not intercepted, consistent with the screen's existing guard (spec ~L236).
- Disabled-reason copy: name the exact strings. Reuse `LOCKED_BY_DRAFT_REASON` where the reason is the same, and add one new constant per new reason. Don't let each control invent its own.

**Suggested rewrite:** Replace the ASCII matrix with a spec table where every cell is ✕ or –, with no "?". Add one scenario per ✕ cell that involves the add control (both directions). That's roughly 8 to 10 scenarios. It's the cost of a fourth busy state, and it's the regression risk in section 4.

### V9. Empty state: three cases need three exact outputs

The derivation in 3.1 is right. "Derive from flags, don't assume" (case 3) isn't a requirement, though. Turn the table into a decision table on observable flags only:

| `isCustomizationLocked` | `archived.length` | `canAddTopics` | Empty-state content |
|---|---|---|---|
| true | any | any | "This team has no active topics. Sessions can't start until topics are assigned. <recovery path per C6>." No actions. |
| false | > 0 | true | "This team has no active topics." + [Show archived topics (n)] + [Add custom topic] |
| false | > 0 | false | "This team has no active topics." + [Show archived topics (n)] |
| false | 0 | true | "This team has no active topics." + [Add custom topic] |
| false | 0 | false | "This team has no active topics. <recovery path per C6>." No actions. |

Conditions:
- "Show archived topics (n)" expands the existing Archived section (if collapsed) and moves focus to its heading. It doesn't render restore buttons inline.
- "Add custom topic" in the empty state opens **the same** form as the list-level control. The list-level control isn't shown separately while the empty state is shown, so there is one entry point on screen.
- The empty state doesn't read `defaultTopicsNotActive` (C5).
- After a successful restore or add, the empty state is replaced by the list without a full-screen reload.
- Note: on a locked team the existing lock notice is also showing. Confirm the two messages don't contradict each other. Row 1 copy should not repeat the "after first session" explanation, because a team with no topics *can't* complete a first session.

### V10. Testability of "rare" states

Case 1 (race) and case 2 (provisioning failure) can't be reached through the UI. The proposal should say how they're tested: component tests with a mocked TOPIC-002 response are fine. Otherwise, "keep it small" turns into "untested".

### V11. Shared types (Q6)

Not vague, just undecided. Recommend **in scope**: `AddCustomTopicRequest` / `AddCustomTopicResponse` in `packages/shared/src/types/topic.ts`. It's cheap, and the form is its first consumer. The response type should document that it doesn't include `firstSessionDescription`.

### V12. "Custom" tag: make it testable

**Suggested conditions:** Active and archived rows where `isDefault === false` show a text tag reading exactly "Custom", exposed to assistive tech as part of the row's accessible name (not colour or icon only). Rows where `isDefault === true` show no tag. Also state that this applies on locked teams (read-only view). A team can't *have* custom topics while locked, but this keeps the rule unconditional.

---

## 3. Traceability check

| Use case item (Add Custom Topic / View Active Topics) | Covered by | Status |
|---|---|---|
| Form fields + required/optional | 2, V1, V2, V3 | Needs V1/V2 |
| Validation errors keep values | 2, V1 | OK after V1 |
| Prompt duplicate: not enforced, warning optional | 2.6, C4 | Decision needed; prompt warning deferred |
| System error → retry | — | **Missing**, see V6 |
| Appended at end, visible immediately | 2.4 #6 | OK |
| Marked custom in UI | 2.5, V12 | OK after V12 |
| Only after first session | §1 table, V5 | OK |
| Facilitator only, not Engineers | — | **Missing**, see C7 |
| Postcondition "appears in next session run" | 2.7 (#175) | Reworded to "sessions created from now on". Record as a known deviation, blocked on #175. |
| Empty active state "re-add or add custom" | 3, V9 | OK after V9. Note that the use case trigger "all have been removed" can't be reached via UI. Propose a use case wording fix. |
| Description shown in session (live session UC step 5) | 2.1, C1 | **Known gap.** Must be a filed issue, not just a note |

---

## Summary

- Findings 2.1, 2.3, 2.4 #1 and 2.6 are concrete and ready to become requirements. The exploration is sound.
- Biggest gap: **client-side form behaviour** (validation before submit, vote type default, length limits). The use case ACs depend on it and the notes only cover server 422s (V1, V2).
- **Missing failure case:** a 201 followed by a refetch failure must not invite a duplicate resubmit (V6).
- Decisions needed before the proposal: dirty-form policy (C3, I recommend strict), duplicate-name match rule (C4), and the real recovery path for a locked, empty team (C6).
- Replace every "e.g." or "something like" string with exact copy, especially the description label (V3) and the empty-state table (V9).
- `canAddTopics=false` for admins must say "temporary, #176" in the spec text itself (V5).
- File issues for the in-session description gap and the `defaultTopicsNotActive` join before approval, so they're tracked and not just noted.
- Add explicit coverage for the "Engineers can't add" AC (C7) and a test approach for unreachable empty states (V10).
