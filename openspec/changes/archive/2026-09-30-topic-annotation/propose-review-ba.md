# BA Review: Topic Annotation Proposal (TOPIC-007, #53)

**Reviewer:** Marcus Delgado (Business Analyst)
**Date:** 2026-09-30
**Reviewed:** `proposal.md`, `specs/topic-annotation`, `specs/topic-customization-lock`, `specs/topic-management-screen`, `specs/session-topic-lifecycle` (design.md and tasks.md skimmed for cross-reference)
**Checked against:** `requirements/use cases/08 - Topic Management - Use Cases.md` (Annotate Topic, View Active Topic Configuration, View Topic During Session), `requirements/BRD.md` FR-8.x, `requirements/design/REST API Contract.md` TOPIC-001/002/007, `REST API Contract - Validation Report.md` OQ-7
**Settled, not reviewed:** management-half scope (H3), Facilitator-only with admin `403` (H1).

---

## Verdict

**Approve with minor revisions.** This is the most implementable proposal I've reviewed on this project. Almost every requirement has a WHEN/THEN with a concrete value, exact copy is given for the important strings, the API cascade is fully ordered, and the exploration-round gaps I raised are closed: the scope boundary, the Known Limitation, the SESSION-005 numbering, the negative snapshot test, seed isolation, the 500-unit limit (OQ-7), and the FR-8.7 wording (design.md line 135).

What remains is mostly at the **UI interaction edges**, where the screen now has three kinds of draft that can interact (reorder draft, definition draft, remove/restore actions), and a few places where the wording is still directional. None of it blocks the proposal. All of it should be settled before tasks are finalized, because each item changes a test.

---

## 1. Traceability to the use case

| Use-case AC (Annotate Topic) | Covered by | Status |
|---|---|---|
| Option to add or edit on each topic in the management screen | management-screen "add, edit, or clear inline" | Covered. "Each topic" is satisfied for active topics only. See B3 for archived topics. |
| Free-form text up to a defined limit | topic-annotation "500 UTF-16 code units" | Covered. The limit is now defined, so OQ-7 is closed. |
| Saving updates the management view immediately | "on success the row shows the new definition … without a full page reload" | Covered |
| Displayed alongside the prompt during sessions | session-topic-lifecycle (payload only) | Deferred to #175 and #56/#57, as agreed. The proposal says the use case will be marked "pending". Good. |
| No annotation → no element during sessions | payload returns `null` | Deferred (display). API half covered. |
| Clearing removes it from session display | Whitespace-only clears to NULL, and the snapshot copies NULL | API half covered, display deferred |
| Editing only by the Facilitator | Facilitator-only, with `403` tests for admin, member-facilitator, and engineer/EM | Covered |

| Use-case alternate flow | Covered by | Status |
|---|---|---|
| Empty save clears, "a confirmation may be appropriate" | Inline clear-confirm with exact copy | Covered and resolved |
| System error keeps previous annotation, allows retry | "A failed save keeps the facilitator's text" | Covered |
| Excessively long → validation message | Server `422`, client `maxlength` | **Partially covered.** See B5. With `maxlength`, a user who pastes too much text is silently truncated rather than shown a message. |

View Active Topic Configuration AC "each topic shows … team annotation (if present)" is covered for active rows.

**Use-case Notes line 369** ("confirm whether default topics can be annotated") is answered by "Default and custom topics SHALL both be annotatable." Make sure task 10.x marks that note resolved. The proposal says it does.

**BRD:** FR-8.2 lists "add, remove, or reorder" for "facilitator or Application Administrator" and does not mention annotation. So FR-8.7 *adds* a rule and does not contradict FR-8.2. I'd say that in the FR-8.7 rationale, so no future reader sees a conflict that isn't there.

---

## 2. Findings: blocking-before-tasks (should fix in spec)

### B1. Reverse interaction: definition draft vs. reorder (gap)
The spec covers only one direction: "While the reorder draft is dirty or saving, definition editing SHALL be disabled." It doesn't say what happens when a definition editor is **open with unsaved text** and the facilitator starts dragging/moving topics. Once the order becomes dirty, the rule above says editing is "disabled", but the editor is already open. Does it close (and lose the text)? Freeze? Stay usable?

**Proposed condition:**
> While any definition editor holds unsaved changes, reorder controls SHALL be disabled with the reason "Save or cancel your definition changes first." An open editor with no unsaved changes SHALL close when a reorder begins.
>
> Scenario: WHEN a facilitator has unsaved text in a definition editor, THEN the move controls are disabled with that reason, AND the editor text is unchanged.

### B2. Remove (archive) while a definition editor is open on that row (gap)
Remove is an existing row action. If the facilitator removes a topic whose editor holds unsaved text, the row moves to Archived and the text is lost without any `beforeunload`-equivalent warning. The spec says reorder drafts are "never lost because of a definition action", but it gives definition drafts no matching protection.

**Proposed condition:**
> The Remove control on a row whose definition editor holds unsaved changes SHALL be disabled with the reason "Save or cancel your definition changes first."

(Or make the spec say plainly that the editor closes and the text is discarded. Either is fine as long as it is written down and tested.)

### B3. Archived topics: API exposes the annotation, the screen spec doesn't show it (inconsistency)
The `topic-customization-lock` delta adds `teamAnnotation` + provenance to `archived[]` entries, with the stated reason "so the facilitator can see what will return on restore." But `topic-management-screen` requires display only on **active** rows. As written, that reason is never delivered, and a tester can't tell whether showing the definition on archived rows is required, forbidden, or optional.

**Proposed condition (pick one and write it down):**
- (a) *Archived rows SHALL show "Our team's definition" and its provenance read-only, with no edit control.* Scenario: an archived topic annotated "X" shows "X" under the label and no "Edit"/"Add team definition" control.
- (b) Archived rows SHALL NOT show the definition. Then drop the "so the facilitator can see" rationale from the lock spec, though the field can stay for future use.

I recommend (a), because it is what the rationale promises, and the restore confirmation is the moment a facilitator wants to know what comes back.

### B4. Unchanged non-empty save is unspecified
The spec covers "empty → empty: no confirmation, send no change". It doesn't cover "X → X" (an editor opened and saved without edits, or edited back to the original). The server treats that as a no-op `200`, but the UI behaviour is undefined: is a request sent? Is "Saved. Sessions that already exist keep the previous definition." shown? That message would be misleading, because nothing changed. Also, "send no change" is ambiguous: does it mean no request, or a request that changes nothing?

**Proposed condition:**
> When the editor's trimmed text equals the saved value (treating empty as equal to null), Save SHALL close the editor without sending a request and without showing the saved confirmation.

This also implies the client applies the **same normalization as the server** (CRLF→LF, trim) before comparing and before deciding whether to show the clear-confirm. State that once, because the clear-confirm trigger "would change a non-null definition to empty" depends on it (for example, a field of only spaces).

### B5. Over-length paste is silently truncated
`<textarea maxlength=500>` truncates pasted text without telling the user. The use case asks for "displays a validation message if exceeded." The server `422` path is only reachable by non-UI clients.

**Proposed condition (minimal):**
> When the counter reaches 500, it SHALL be visually distinguished and accompanied by "500 character limit reached." (announced via `aria-live="polite"`).

Alternative: drop `maxlength`, let the counter go over (e.g. `512 / 500`), disable Save, and show the message. Either satisfies the use case. The current spec satisfies neither.

---

## 3. Findings: vague language to tighten

| # | Where | Current wording | Problem | Suggested concrete wording |
|---|---|---|---|---|
| V1 | management-screen, lock | "the existing lock notice SHALL add one sentence stating that team definitions become available after the team's first session" | Every other piece of user-facing copy in this change is exact. This one is paraphrased, so tests will pin whatever the implementer types. | Give exact copy, e.g. *"Team definitions can be added after the first session."* Add a scenario asserting the full notice text. |
| V2 | management-screen, save | "A successful save SHALL show the confirmation …" | Where, for how long, and how is it announced? Untestable for persistence and accessibility. | "…in the row, in a `role="status"` element, until the next action on that row or 5 s, whichever is first." (Pick the rule the reorder "saved" message already uses, for consistency.) |
| V3 | management-screen, one-editor | "the second does not open" | The user gets no feedback, and a click that does nothing reads as a bug. | "…and focus moves to the open editor" or "…and the open editor shows 'Save or cancel this definition first.'" |
| V4 | management-screen, clear-confirm | Confirm copy given. Cancel of the confirm is not. | What does the confirm's Cancel do: return to the editor with the empty text, or restore the saved text? | "Choosing Cancel on the confirmation SHALL return to the editor with its current (empty) text; no request is sent." |
| V5 | management-screen, provenance | "Last edited {date} by {displayName}" in "the archived/restored metadata style" | Acceptable *if* that style defines the date format. If it doesn't, the format is unspecified. | Name the formatter the archived rows use (or the format, e.g. `MMM d, yyyy`) in the requirement. |
| V6 | management-screen, provenance | A null `teamAnnotation` shows no provenance line. | After a **clear**, provenance records who cleared it, but the screen never shows it, so "who removed our definition?" can't be answered from the UI. That may be intended. | State it explicitly: "After a clear, no provenance line is shown; clear provenance is retained in the API response and audit log only." Otherwise someone will file it as a bug. |
| V7 | management-screen, provenance | Not covered: non-null `teamAnnotation` with null `annotationUpdatedBy` (user row removed or nulled, or direct DB write). | Edge case without a defined rendering. | "If `annotationUpdatedBy` is null, the line reads 'Last edited {date}'. If `annotationUpdatedAt` is also null, no line is shown." |
| V8 | topic-annotation, cascade | "SHALL use the standard error envelope where applicable" | "Where applicable" is a hedge. | "Every non-2xx response SHALL use `{ error: { category, code, message, correlationId } }`." Also state the `422` body codes: what `code` accompanies `field: "annotation"` (e.g. `INVALID_ANNOTATION` vs `ANNOTATION_TOO_LONG`)? The frontend shows `error.message`, so also say whether the message differs between "missing/null/non-string" and "too long". |
| V9 | topic-annotation, cascade | Step (1) "identity/role → 403" | `401` (no session) isn't in the cascade. The old contract lists it. | Add "(0) unauthenticated → `401`" for completeness, or say it is handled by the shared auth middleware before the cascade. |
| V10 | topic-annotation, body | Not covered: malformed JSON, non-object body (e.g. a bare string or an array), non-UUID path params. | Fastify likely returns `400` for malformed JSON before the handler runs, which sits outside the "fixed order". | One sentence: "Malformed JSON and non-UUID path parameters follow the sibling endpoints' existing behaviour (TOPIC-004/005/006)." Name the status if siblings have a test for it. |
| V11 | topic-annotation, provenance | "`annotation_updated_at` to the commit time" | In Postgres, `now()` is transaction-start time, not commit time. That's harmless, but a strict test can't assert "commit time". | "…to the transaction timestamp (`now()`)." |
| V12 | session-topic-lifecycle | "the write SHALL occur before any participant can see the session" | "See" is undefined, since sessions are visible in lists before they are joinable. | "…before the session's first `SESSION-005` (begin-voting) call can succeed." This is the observable boundary that #175 can test. |
| V13 | proposal, What Changes | "The editor states plainly what the field is for." | Directional, though the spec fixes it with exact helper text. | No change needed. Spec governs. Noting that the proposal prose is not the AC. |

---

## 4. Findings: questions for the proposer (non-blocking)

- **Q1. Stale screen after another facilitator's edit (last-writer-wins).** The UI overwrites whatever is stored without showing that it changed underneath. That is accepted, but is it acceptable that facilitator A's open editor shows text that is stale relative to B's save? If yes, add a Known Limitation line next to the existing "overwrites are irreversible" one. If no, the minimal mitigation is to refetch TOPIC-002 after any save, so the row shows the server's current provenance.
- **Q2. `404 TOPIC_NOT_FOUND` / `422 TOPIC_ALREADY_ARCHIVED` mid-edit.** Another facilitator archives the topic while I'm editing. The spec keeps my text and shows the error (good), but the row still appears as active. Should those two codes trigger a list refresh? I'd add: "On `404 TOPIC_NOT_FOUND` or `422 TOPIC_ALREADY_ARCHIVED`, the screen SHALL keep the editor text and refresh the topic lists."
- **Q3. `canEditAnnotations` for a member-facilitator.** TOPIC-002 already `403`s a facilitator who is a team member, so `canEditAnnotations: false` would be reachable only by an admin. Confirm that this is the full truth table: facilitator→true, admin→false, all others never reach the endpoint. If so, write it as a 2-row table in the requirement.
- **Q4. Accessibility of the counter and editor label.** No requirement says the textarea is programmatically labelled "Our team's definition" or that the helper text is linked by `aria-describedby`. One line would make the label testable with `getByLabelText`.

---

## 5. Things done well (keep them)

- The required negative snapshot test (edit `topics.team_annotation` after the fixture, payload unchanged) is written as a scenario, not as prose.
- Exact numbers in scenarios: 500 and 501, 250 and 251 emoji, `length = 30` (verified: "Pipeline speed and reliability" is 30 units).
- `null` ≠ clear is explicit, which removes a classic ambiguity.
- Cascade ordering has priority scenarios (`409` over `422`, `422` over `404`) and doesn't only list the steps.
- The audit-without-text rule is phrased as a testable negative ("no metadata value contains the submitted text").
- The Known Limitation is written for a stakeholder, not an engineer. Good. That is the sentence #53's readers need.
- Seed isolation scenario uses a non-null template annotation, so it actually proves something.

---

## 6. Summary of requested changes

| ID | Type | Change |
|---|---|---|
| B1 | Gap | Disable reorder while a definition editor is dirty, plus a scenario |
| B2 | Gap | Disable Remove on a row with a dirty editor (or spec that the text is discarded), plus a scenario |
| B3 | Inconsistency | Decide whether archived rows show the definition. I recommend read-only display. |
| B4 | Gap | Unchanged save sends nothing and shows no confirmation. The client uses server normalization. |
| B5 | Use-case gap | Visible "limit reached" message (or over-limit counter with Save disabled) |
| V1–V12 | Vague | Exact lock-notice copy, success-message persistence, one-editor feedback, confirm-cancel, date format, post-clear and null-user provenance, error envelope and codes, 401/400 handling, `now()`, snapshot boundary |
| Q1–Q4 | Questions | Stale-view limitation, refresh on 404/archived, `canEditAnnotations` truth table, editor labelling |
