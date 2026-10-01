# BA Review: Topic Annotation Exploration (TOPIC-007, #53)

> **Superseded in part (task review, 2026-09-30):** statements here that TOPIC-001 returns `teamAnnotation`, or that engineering managers get `403` on TOPIC-001, are superseded by design.md Decision 8. TOPIC-001 does not return the annotation, and today's handler answers EMs `200` (`content.test.ts:349`; follow-up drafted in task 9.5). Do not revive the old plan from this file.

**Reviewer:** Marcus Delgado (Business Analyst)
**Date:** 2026-09-30
**Reviewed:** `exploration-notes.md` (Devon Calloway)
**Question:** Are these ideas specific enough to become requirements?

---

## Overall verdict

The *why* is solid and traceable: Web Application Proposal line 159 ("prevents drift in interpretation across facilitators") → Feature Sets line 66 → use case "Annotate Topic with Shared Team Definition" → TOPIC-007. The snapshot recommendation (§3a) and the "no annotation text in audit" call (§3e) are ready to become requirements as written.

The *what* has gaps. Several items are directional ("light confirm", "visually secondary", "lean yes") and won't survive into a proposal without a pass/fail condition. The scope section is right in spirit, but it still lists use-case acceptance criteria that this change can't satisfy, so a checkbox reviewer will either fail it or sign it off wrongly. I also found one factual error (§4 Q9) and one contract contradiction that the notes don't mention (admin authorization).

---

## 1. Scope boundary for #53 (requested)

### The problem

Four of the seven acceptance criteria in the use case can't be verified by any user while #175 (snapshot population) and #57/#56 (session screens) are open:

| Use-case AC | Verifiable in this change? |
|---|---|
| Option to add/edit on management screen | Yes |
| Free text up to a defined limit | Yes |
| Save updates the management view immediately | Yes |
| Displayed alongside prompt during sessions | **No.** No screen, and no populated data |
| No annotation → no element during sessions | **No.** Same reason |
| Clearing removes it from session display | **Partially.** API level only |
| Editing only by Facilitator | Yes (but see Clarification C1) |

### Proposed boundary (testable)

**#53 is DONE when all of the following pass:**

1. **Persistence.** Migration 19 adds `topics.team_annotation text NULL` and `session_topics.topic_annotation text NULL`. Existing rows read back as NULL. Rollback drops both columns and nothing else.
2. **Write.** `PUT .../topics/:topicId/annotation` sets, replaces, and clears per §3 below. Each error row in the cascade table has an integration test.
3. **Read: configuration.** TOPIC-002 returns the stored `teamAnnotation` (not hard-coded `null`) for active topics. TOPIC-001 returns `teamAnnotation` per the contract (see C4 for the caveat).
4. **Read: session payloads, against fixtures.** With a `session_topics` fixture row whose `topic_annotation = 'X'`, SESSION-004 and SESSION-012 return `topicAnnotation: 'X'`. With NULL, they return `topicAnnotation: null`. **Required negative test:** update `topics.team_annotation` to `'Y'` after the fixture exists. Both endpoints still return `'X'`. This test is what proves we chose the snapshot model, so it must not be dropped.
5. **Hand-off pinned in spec.** The `session-topic-lifecycle` spec gains a requirement with a scenario: *"WHEN a session is created, THEN each `session_topics.topic_annotation` equals the source topic's `team_annotation` at that instant."* #175 gets a comment linking to that requirement. It is marked pending (not implemented) in this change.
6. **Seed isolation.** A test sets `team_annotation` on a template-team row (`00000000-…-0001`), creates a new team, and asserts every new team topic has `team_annotation IS NULL`.
7. **Management UI.** The edit, clear-confirm, counter, helper copy, and lock read-only state behave as in §4 below, with component tests.
8. **Documentation.** The contract, use case, and BRD edits listed in §5 are merged in the same PR.

**Explicitly NOT done by #53, and reassigned:**

| Use-case AC / behavior | Moves to | Action |
|---|---|---|
| "Displayed alongside the topic prompt during sessions" | #57 (vote prompt), #56 (advance) | Add an AC to #57: "renders `topicAnnotation` from the SESSION-004/012 payload; renders no element when null" |
| Late joiner sees annotation immediately | #57 | Add to #57's reconnect AC. Do not widen the WS snapshot here |
| Snapshot actually written at session creation | #175 | Covered by item 5 |
| Shown after reveal / during discussion | #62 / #57 | Needs a decision there (see C6) |

**Known Limitation (verbatim for the proposal):**
> "No participant will see an annotation in a live session until both #175 (session_topics population) and #57 (participant vote-prompt screen) are delivered. This change delivers storage, the write endpoint, the management-screen editor, and annotation-bearing session payloads verified against fixtures."

**Issue hygiene:** #53's body says the live-session topic view "otherwise already works." That is false. It should be corrected on the issue so nobody re-reads it as a regression later.

---

## 2. Character limit recommendation (requested; closes Contract OQ-7)

**Recommendation: 500 characters. Count after trimming leading and trailing whitespace. Use the same counting unit as `prompt` (JavaScript `.length`, i.e. UTF-16 code units).**

Rationale:
- **Consistency.** `prompt` and `firstSessionDescription` are both capped at 500 in `validateAddCustomTopicBody` (`topics.ts:290`, `:312`). A team definition that can't be at least as long as a custom prompt would be an odd asymmetry to explain.
- **Fit to purpose.** The longest default `first_session_description` is about 220 characters. A team definition that also carves out scope ("for us this excludes legacy billing…") realistically needs 200 to 400. Anything over 500 is an essay, and that's where vote-steering and people-notes creep in.
- **Unit choice.** The browser's `<textarea maxlength>` also counts UTF-16 code units. Using `.length` on both sides means the counter, the input cap, and the server can never disagree. Under this rule an emoji counts as 2. That's acceptable, and it should be stated in the contract rather than discovered.

**Acceptance conditions:**
- Trimmed length of 500 → `200`.
- Trimmed length of 501 → `422`, `code: "VALIDATION"` (or the sibling equivalent), `field: "annotation"`. Stored value unchanged.
- 500 non-space characters plus surrounding whitespace → `200` (trim happens before counting).
- 250 emoji (500 code units) → `200`. 251 emoji → `422`.
- The UI counter shows `n / 500` using the same unit and blocks input beyond 500.
- Optional DB backstop: `CHECK (char_length(team_annotation) <= 500)` only if `prompt` gets the same. Note that Postgres `char_length` counts code points, not UTF-16 units, so a CHECK would be *looser* than the handler. That's fine as a backstop, but it must not be described as "the same rule."

`session_topics.topic_annotation` gets **no** length check. A snapshot must accept whatever the source held.

---

## 3. Write-endpoint rules that need to be pinned (vague → concrete)

| Exploration says | Suggested requirement |
|---|---|
| "Recommend trim, then empty → NULL" | The server trims the input. If the trimmed result is empty, `team_annotation` is set to NULL and the response returns `teamAnnotation: null`. Otherwise the trimmed text is stored. Interior whitespace and line breaks are preserved. `\r\n` is normalized to `\n`. |
| (unstated) body validation | Missing `annotation`, `null`, or a non-string value → `422`, `field: "annotation"`. `null` is **not** an alias for clear. Empty string is the one way to clear, as the contract says. |
| (unstated) unchanged value | If the normalized value equals the stored value (including NULL → empty), return `200` with the current state, **write no audit row, and leave provenance unchanged.** Otherwise, re-saving the same text would bump "last edited by" and pollute the audit log. |
| "404 or 422" for archived | Use the sibling codes: topic not on this team → `404 TOPIC_NOT_FOUND`; topic archived → `422 TOPIC_ALREADY_ARCHIVED`. Update the contract. |
| Response shape | The contract returns `annotation`, but every read uses `teamAnnotation`. **Rename the response field to `teamAnnotation`** so the frontend has one name. Proposed response: `{ topicId, teamAnnotation: string \| null, annotationUpdatedAt: string \| null }`. |
| Audit | `operation: "topic.annotation_updated"`, `metadata: { topic_id, action: "set" \| "cleared", length }`. The text is never stored. A test asserts that the metadata contains no key holding the text. |
| Concurrency | **State it:** last-writer-wins, no precondition token. Same as Reorder. Write it as an explicit decision so it isn't read as an oversight. |
| Rendering safety | The annotation is plain text everywhere. No Markdown, no HTML. It is rendered escaped, with line breaks preserved. Add a test where `<script>` round-trips as literal text. |

---

## 4. Management-screen behavior (vague → concrete)

| Exploration says | Suggested acceptance condition |
|---|---|
| "light confirm on clear, not on edit" | A confirmation dialog appears **only** when the save would change a non-null annotation to null (empty or whitespace-only input). Its copy states the action is permanent and the previous text can't be recovered. Edits that leave text non-empty save without a confirm. Clearing an already-empty annotation shows no dialog (it's a no-op per §3). |
| "One line of helper text" | Proposed copy: *"The team's shared meaning of this topic. Shown to everyone during future sessions. Not for notes about individuals or how to vote."* Priya to approve the wording. The requirement is just that the helper text is visible whenever the editor is open. |
| "lock-state read-only" | When `isCustomizationLocked = true`, no edit control is rendered (consistent with Move/Remove). Since no annotation can exist before unlock, the locked screen also shows no annotation text. Test both. |
| "inline edit with counter" | Saving updates the row's displayed annotation without a full page reload. On error, the editor stays open with the user's text intact and an error message. The stored value is unchanged (use-case alternate flow). |
| Display on management row | When `teamAnnotation` is non-null, the active row shows it, labeled distinctly from "Description" (the use case says the two serve different purposes). When null, the row shows no annotation text, only the add control. |
| Provenance "lean yes" | **Decide now.** Option A: store `annotation_updated_by`/`_at` and display "Last edited {date} by {name}". Option B: store only, no display. Option C: neither. I recommend **A** because it gives the rotating facilitator the context Devon describes. If Priya rejects the display, fall back to B. The columns are cheap and the precedent exists. |

### Correction: §4 Q9 misreads `topicActionsLockedByDraft`

That flag (`TopicManagementPage.tsx:606`) is `isDirty || isSaving` for an **unsaved reorder draft**. It has nothing to do with a draft *session*. It exists because Remove and Restore refetch on success, and that refetch would overwrite the unsaved order (Task 6.7(a)).

An annotation save that refetches the topic list has exactly the same hazard. So the question isn't "should we disable for a draft session" (answer: no, the snapshot model covers it). It is:

> **Requirement:** While a reorder draft is dirty or saving, the annotation edit control is disabled with the same `LOCKED_BY_DRAFT_REASON`, **or** the annotation save updates only that row in local state without refetching the list. Engineer picks one. Either way, a test asserts that an unsaved reorder survives an annotation save.

---

## 5. Clarifications needed (decision owner in brackets)

- **C1. Admin authorization: the contract contradicts itself. [Marcus + VP Eng]** TOPIC-002's authorization note (contract line 609) says the admin-inclusive model is shared by "`TOPIC-003` through `TOPIC-007`." TOPIC-007's own section says facilitator only. FR-8.2 lists add/remove/reorder for "facilitator or Application Administrator" and leaves annotate out. **My position:** facilitator only, for the reasons in Devon's Q1 (team-owned words, admins denied session content). I will (a) add **FR-8.7 [HARD]**: *"After a team's first session, a facilitator who is not a member of the team shall be able to set, replace, or clear a team-specific annotation on any active topic (default or custom). Application Administrators are deliberately excluded."* and (b) correct line 609 to say "TOPIC-003 through TOPIC-006." design.md must record this as a decision, with a test that an admin gets `403`.
- **C2. Default vs. custom topics. [resolved, record it]** Both can be annotated. Close the use-case note. Add a scenario: annotating a team's copy of a default topic leaves the template-team row unchanged (FR-8.6).
- **C3. Use-case Out-of-Scope wording.** "Annotations on the application's default topic descriptions" reads as if default topics can't be annotated. Rewrite: *"Editing the canonical default topic set's description or prompt. The annotation is always stored on the team's own topic row."*
- **C4. TOPIC-001 exposes the *live* annotation to participants.** TOPIC-001 is readable by team participants and returns the current `teamAnnotation`. If #57 renders the in-session annotation from TOPIC-001 instead of the SESSION-004/012 payload, the snapshot model is silently bypassed. **Requirement for the #57 hand-off:** "In-session annotation display reads only from the session payload (`session_topics` snapshot), never from TOPIC-001/002."
- **C5. Template-team targeting. [Engineer, sibling-wide]** If TOPIC-004/005/006 don't block `teamId = 00000000-…-0001`, annotation inherits the gap. Out of scope to fix here, but file an issue and reference it as a Known Limitation, so the decision is visible rather than lost.
- **C6. Post-reveal visibility. [Priya / #62 owner]** The use case says "voting phase." Devon wants it through discussion. I agree, but this is #57/#62's decision. Record it as an open question in their issue, not here.
- **C7. EM history display. [out]** Confirm out of scope. TOPIC-001 already excludes `engineering_manager`, so nothing in this change exposes annotations to EMs. Add a test asserting EM → `403` on TOPIC-001 still holds after the field is added.
- **C8. First-session behavior.** Make this an explicit scenario, not a side effect: "A team's first session never carries an annotation, because annotation writes are rejected (`409`) until a session has completed." This is testable via the lock-gate test.
- **C9. Archive/restore preserve annotation. [ready]** Scenario: archive a topic with annotation 'X', then restore it. TOPIC-002 returns `teamAnnotation: 'X'`. Also state that archived entries in TOPIC-002 don't return the annotation (or do). Pick one and write it down. I suggest returning it, for a single read shape.

---

## 6. Areas too vague to carry forward as written

1. **"Visually secondary… not styled as a banner"** (§2). This can't be tested in this change because there's no session screen. Move it verbatim into #57's AC as: "rendered after the prompt, at body text size or smaller, not collapsed, no background or border treatment, no element when null."
2. **"Optional provenance"** (§3b). "Optional" is not a requirement. Decide per §4 (recommend A).
3. **"Engineer's call" on the DB CHECK.** This is fine to leave to engineering, but the proposal must say which way it went and how it compares to `prompt` (see §2 about code-point semantics).
4. **"Per-team advisory lock probably not needed."** Fine as an engineer call. Have design.md state it, with the LWW decision.
5. **"Helps the next facilitator"** for provenance. That's the rationale, not a requirement. The requirement is the display rule in §4.

---

## 7. Traceability additions

- BRD: add FR-8.7 (C1). There is currently **no** BRD requirement for annotation. That's a traceability gap I own.
- Contract: close OQ-7 for topic annotations (500, trimmed, UTF-16 units). Rewrite TOPIC-007's authorization, error table (409 lock, 404/422 topic, envelope, cascade order), response field name, audit, and `Cache-Control: no-store`.
- Use case: update lock-related wording to 409, close the default/custom note, rewrite Out-of-Scope line (C3), and annotate the session-display ACs with "delivered via #57/#175."
