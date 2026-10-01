# Tasks Review: topic-annotation (Business Analyst)

**Reviewer:** Marcus Delgado, Senior Business Analyst
**Artifact reviewed:** `tasks.md`
**Checked against:** `proposal.md`, `design.md` (Decisions 3, 8, 11; Open Questions), all four delta specs, `requirements/use cases/08 - Topic Management - Use Cases.md`, `requirements/design/REST API Contract.md` (TOPIC-001 shape, line 609, access matrix at line 2963, OQ table at line 2999), `requirements/design/REST API Contract - Validation Report.md`, `requirements/BRD.md` FR-8.x
**Verdict:** **Approve with minor revisions.** Coverage is very good. Every capability in the proposal has an implementing task and, almost everywhere, a test task. I found one real lost-in-translation defect (the character rule and the message count), two documentation gaps, and a set of small test-coverage holes.

---

## 1. Coverage: proposal capability to tasks

| Proposal capability / change | Spec | Tasks | Status |
|---|---|---|---|
| Migration 19, four nullable columns, exact rollback | topic-annotation R1 | 1.1, 1.2 | Covered |
| TOPIC-007 Facilitator-only, admin `403` (FR-8.7) | topic-annotation R2 | 3.1, 3.2, 3.4 | Covered |
| Cascade order, timing floor, `no-store` | topic-annotation R3 | 3.2, 3.4, 11.2 | Covered (see T3) |
| First-session lock plus `write_denied_locked` audit | topic-annotation R4 | 3.2, 3.4 | Covered (see T1) |
| Body validation, normalization, 500 UTF-16 units | topic-annotation R5 | 3.3, 3.5 | Covered. **The proposal and 10.1 trail the spec (see F1)** |
| No-op, provenance, LWW, response shape | topic-annotation R6 | 4.1–4.3 | Covered |
| Audit without text | topic-annotation R7 | 4.4 | Covered, and the sentinel test is strong |
| Plain text | topic-annotation R8 | 4.5, 8.1, 8.7 | Covered |
| Archive/restore preservation, template isolation, seed isolation | topic-annotation R9 | 5.4, 7.1, 7.2 | Covered |
| TOPIC-001 does **not** return the annotation | topic-annotation R10 | 2.1, 5.2, 5.3, 9.5, 10.2, 11.4 | Covered and consistent (see section 2) |
| TOPIC-002 fields plus `canEditAnnotations`, admin read-only | topic-customization-lock | 2.1, 5.1, 5.3 | Covered |
| SESSION-005/012 from snapshot only, required negative test | session-topic-lifecycle R1 | 2.2, 6.1–6.4, 11.3 | Covered. 6.3 correctly refuses a mocked substitute |
| Snapshot-content requirement for #175 | session-topic-lifecycle R2 | 9.1 | Covered as a hand-off (see T6) |
| Management-screen editor (all six screen requirements) | topic-management-screen | 8.1–8.7 | Covered (see T4) |
| Usability check with Priya | (review condition) | 8.8 | Covered |
| #53 body correction (C3 draft) | proposal | 9.3 | Covered |
| Requirements docs: contract, access matrix, line 609, OQ-7, use case, FR-8.7 | proposal | 10.1–10.4 | Mostly covered (see F1, F2, F3) |
| Follow-ups list | proposal | 9.4, 9.5, 9.6 | **Partially covered** (see F4) |

Topic-history preservation, one of my standing concerns, is protected by 5.4 (archive then restore keeps the text and the original provenance) and by the read-only archived-row display (8.1). Good.

---

## 2. TOPIC-001 removal: consistency check

I checked every place the security resolution should show up.

- **proposal.md:** consistent. "Reads" says TOPIC-001 does not gain `teamAnnotation`. The capability list says "TOPIC-001 deliberately not returning the annotation". Impact says `content.ts` changes TOPIC-001 only by adding a negative test. "Not touched" files the EM defect as pre-existing.
- **specs:** consistent. topic-annotation's final requirement forbids the field and its provenance on TOPIC-001 and requires EMs to be denied before any future addition. session-topic-lifecycle R1 forbids TOPIC-001/002 as the in-session source. topic-customization-lock touches only TOPIC-002.
- **tasks:** consistent. 2.1 adds no TOPIC-001 type. 5.2 changes nothing but a comment. 5.3 asserts that all four keys (camel and snake) are absent. 9.5 drafts the EM/casing follow-up. 10.2 rewrites the contract's TOPIC-001 `teamAnnotation` line. 11.4 checks that TOPIC-001's SELECT, response, and authorization are untouched.

**Residual items (low):**

- **R-a. Stale supporting artifacts.** `exploration-notes.md` (lines 122 and 187) and `explore-review-ba.md` (C4, C7) still say TOPIC-001 returns `teamAnnotation` and that EMs get `403` there. The second claim was disproved at design review (B1: `content.test.ts:349` asserts EM `200`). Both files get archived with the change. Add a one-line "Superseded by design.md Decision 8" note at the top of each so a later reader does not resurrect the old plan. My own explore review is one of the sources of that error.
- **R-b. `Topic` domain interface.** Task 2.1 adds `teamAnnotation` and provenance to the shared `Topic` interface. Today no response type is `Topic[]`, so nothing leaks. If someone later types TOPIC-001's response as `Topic[]`, the compiler will expect the field. Add a short comment on the interface pointing to Decision 8, or say in 2.1 why the domain type is safe to extend.

---

## 3. Findings: lost in translation

### F1 (Medium): The disallowed-character rule and the third error message are missing from the proposal and from contract task 10.1

The spec (topic-annotation R5) and tasks 3.3 and 3.5 define **three** `INVALID_ANNOTATION` messages: the type message, "Team definition contains characters that can't be saved.", and the over-length message. They also reject U+0000, unpaired surrogates, C0 controls other than LF and TAB, U+007F, and bidi controls.

- The proposal's "What Changes" bullet for TOPIC-007 doesn't mention the character rule at all, and its Review Disposition (V8) still says "two exact messages."
- **Task 10.1** says the contract gets "`422 INVALID_ANNOTATION` and its two messages" and lists the body rules without the character rejection.

If 10.1 is done as written, the published contract will contradict the implementation, which is the exact drift this change is cleaning up. **Fix:** in 10.1, change "two messages" to "three messages" and add "rejected characters (U+0000, unpaired surrogates, C0 controls except `\n`/`\t`, U+007F, U+202A–U+202E, U+2066–U+2069), checked before length." Add one clause to the proposal's TOPIC-007 bullet and correct V8 to "three".

### F2 (Medium): Task 10.3 updates the Annotate use case but not "View Topics During a Live Session"

The proposal says the session-display ACs get marked "pending #175 and #56/#57". Task 10.3 is scoped to "(Annotate)" only. The in-session ACs mostly live in the **View Topics During a Live Session (Engineer)** use case: main-flow step 4, the late-joiner alternate flow, and the ACs "The team annotation, if present, is displayed alongside the prompt before the vote is cast" and "Topics with no annotation show no annotation UI element." If they aren't marked, the requirements will read as delivered when #53 is reported upward, which C3 is trying to prevent. **Fix:** widen 10.3 to mark those ACs "pending #175 and #56/#57". Add a pointer to the session payload (`currentTopic.topicAnnotation` from the snapshot) as the source, so #57 doesn't reach for TOPIC-001.

### F3 (Low): Use-case and OQ edits are slightly under-specified

- **Snapshot semantics in the use case.** Annotate main-flow step 8 says "During future sessions, the Application displays the annotation…". The screen's confirmation copy ("Sessions that already exist keep the previous definition.") and session-topic-lifecycle R2 make this more exact. 10.3 should reword step 8 to "sessions created after the save".
- **Clear-confirm alternate flow.** The Annotate alternate flow "Facilitator saves an empty annotation" says "A confirmation may…". The spec now requires an inline confirm. 10.3 should resolve that "may".
- **OQ-7 is shared.** Contract line 2999's OQ-7 covers both TOPIC-007 **and SESSION-011** (60-character session annotations). 10.2's "Close OQ-7 for topic annotations" is right. Make it explicit that the row is split or partly resolved, not deleted. OQ-7 also appears in `REST API Contract - Validation Report.md` line 198. Note the resolution there too, or say why not.
- **Access matrix.** The line 2963 row "TOPIC-002 to TOPIC-007" is also wrong for TOPIC-003, which is already facilitator-only. 10.2 fixes TOPIC-007 only. That's acceptable, but if the row gets split anyway, splitting out TOPIC-003 costs nothing. Otherwise, mention it in the 9.4 or 9.5 drafts.

### F4 (Low–Medium): Several proposal follow-ups have no drafting task

The proposal lists follow-ups. Tasks 9.4–9.6 prepare drafts for the template-team guard, the TOPIC-001 EM/casing defect, data retention, and CSP. These have **no task**:

1. EM/facilitator session-history display of the snapshotted definition.
2. The post-session capture prompt on a future wrap-up screen (Executive C2 asks the human to file it, and a prepared draft makes that likely to happen).
3. Display copy that promises session visibility once #57 ships.
4. Facilitator onboarding guidance repeating "not about people" (Executive risk 3).

From a traceability standpoint, a follow-up that exists only as a proposal bullet gets lost at archive. **Fix:** add a 9.7 to prepare short issue drafts (or one combined note) for these four, handed to the team lead like the others.

---

## 4. Findings: spec scenarios without an explicit test

These are small. Each is a spec SHALL or scenario with no named assertion in the tasks. Most fit into existing test tasks with one more line.

- **T1.** Spec R2 "admin is rejected **and** annotation and provenance are unchanged", and R4 "409 **and** no annotation is stored". 3.4 checks the status codes only. Add the unchanged-state assertions.
- **T2.** Spec R3 requires every non-2xx to use the envelope `{ category, code, message, correlationId }`, plus `field` on the `422`. No task asserts the envelope shape or `field` on the `422`. Add this to 3.4/3.5.
- **T3.** Spec R3: `401` from the shared auth layer, malformed JSON, and a non-UUID `teamId` follow the siblings. No test task covers them. One test each (or a note that the existing shared-layer tests cover them) would close the gap.
- **T4.** topic-management-screen:
  - The "Saved." message lifetime has no test (it clears on the next action on that row or the next successful save, with no timeout).
  - "A clean editor closes when a **Restore** confirmation opens" has no test. 8.7 covers Remove and move only.
  - "Saved text and provenance visible while editing" (8.3) has no test.
  - 8.7 lists "second editor blocked" twice. Merge the duplicates.
- **T5.** Spec R5 "Unknown top-level keys SHALL be ignored" is tested in 3.5, which is fine. The `field: "annotation"` on every body failure isn't explicit in 3.5's "exact `code`/`message`". Add `field`.
- **T6.** Task 9.1 says to "Add the pending snapshot-content requirement to `session-topic-lifecycle`". That delta already exists in this change. Reword it to "Verify…" or tick the first half, so it isn't counted as outstanding work. Also, at archive time, check that the requirement's **"Status: pending (#175)"** marker survives the merge into the living spec, so it doesn't read as delivered.

---

## 5. What I'd leave alone

- The scope line (management half only, #53 left open) is carried through faithfully. Nothing in the tasks quietly widens into session-screen work.
- The required negative test (6.3), the SQL-text guard (6.4), and the integration-run confirmation (11.6) together make the snapshot rule hard to lose. That is the property that keeps trend data meaningful across facilitator rotation.
- The FR-8.7 wording in design.md states both the capability and the admin exclusion, and 10.4 carries the "does not contradict FR-8.2" rationale. Traceability from BRD to endpoint is intact.

## Summary of requested changes

| ID | Severity | Change |
|---|---|---|
| F1 | Medium | 10.1 and the proposal: three messages, plus the disallowed-character rule |
| F2 | Medium | 10.3: also mark the "View Topics During a Live Session" ACs and late-joiner flow as pending |
| F4 | Low–Med | Add 9.7 to draft the four untracked follow-ups |
| F3 | Low | Use-case step 8 snapshot wording, resolve "a confirmation may", OQ-7 partial close plus Validation Report |
| R-a/R-b | Low | Superseded note on exploration artifacts; comment on the `Topic` interface |
| T1–T6 | Low | Add the listed assertions to 3.4, 3.5, and 8.7; reword 9.1; keep the pending marker at archive |
