# BA review of proposal (#296) - Marcus Delgado

Verdict: approve with required changes. The proposal is much tighter than the exploration notes. Decisions are made (one row, no deployment.md pointer, S-B/N-A/N-D deferred, chained-path wording fixed). An implementer can mostly build from it. But D1 to D9 were carried in compressed, and some compression lost testable content. Several tasks cannot be verified because no check step exists. There are a few vague or over-claiming phrases. None of this is large, but I want the first group fixed before implementation.

Checked against: `explore-review-ba.md` (my D1-D9, sections C, E, G), `exploration-notes.md` sections 6 to 8, `requirements/High-Level Architecture.md` section 8 (8.1 table ends at "Dependency vulnerability"; 8.2 API Authorization has 3 bullets; no 8.1.1 exists).

## 1. D1 to D9 fidelity

| D | Carried faithfully? | Note |
|---|---|---|
| D1 | Yes | Wording matches. One gap: the change directory will also hold `pr-notes.md` (task 5.1, 6.1). That is covered by `openspec/changes/296-*/`. Fine. |
| D2 | Yes | The "pick and state" position is stated (after "Dependency vulnerability"). |
| D3 | **Weakened** | See 1.1. |
| D4 | Mostly | "Exactly one bullet" is stated, but see 2.1 on its wording. |
| D5 | Yes | The three files are listed in tasks section 3 with claims. |
| D6 | **Weakened** | See 1.2. |
| D7 | Yes | Tasks 4.4. |
| D8 | Yes, with a gap | See 1.3. |
| D9 | Ambiguous | See 1.4. |

**1.1 D3 lost its per-item content.** My original D3 required each item to contain specific things (a: states "accepted on locked and unlocked"; b: both what it can write and what it cannot do; d: the phrase "the bound is whatever the template holds"; f: the full caveat list; reopen triggers verbatim as a list). The proposal's D3 says only "exists and contains items a to h". That is satisfiable by eight empty labels. The detail does exist in tasks 2.2, but acceptance conditions are what a reviewer checks, and tasks are not acceptance. Required: restate D3 in the proposal as "each of a to h is present as a separate labelled line or bullet, and contains the content listed in tasks 2.2", or copy the minimum content per item into D3. Also the item lettering changed from my review (reopen triggers were g, now h; operator paragraph is new as g). That is fine, but say once that the letters follow exploration-notes section 6 item 2, so the thread from my D3 to this one is not broken.

**1.2 D6 grep list.** The grep covers `prevent|cannot|impossible|guarantee`. The "nothing calls the carve-out safe" condition appears in my D6 and in the notes, but the proposal's D6 dropped it (it survives only in "Constraints preserved" and task 4.2). Add `safe` to the grep in D6 and 4.2, or restate the sentence. Note also that task 2.2(b) wording "cannot do" will itself hit the grep. That is acceptable if each hit is justified, but say so: "hits in the 'cannot do' item are supported by the handler reads in task 1.2".

**1.3 D8 out-of-scope list.** The proposal's list is good. The original D8 also wanted the S-B/N-A/N-D follow-up named in the list. It is (as "Denial-audit sampling in general, sentinel-lock blast radius..."). OK. However, the proposal says issue references are "plain issue references (no URLs)", but there is no verification task. See 2.2.

**1.4 D9 sign-off vs task 6.1.** D9 is listed as an acceptance condition ("Tomas confirms"), but task 6.1 says "Do not wait on replies to finish drafting." Which is it? Either the change is accepted only after the confirmations (then D9 is a merge gate and tasks must say so), or confirmations are requested and recorded but not gating (then D9 should be reworded to "requested and recorded in pr-notes.md"). Pick one and state it. My preference: gating for merge, non-gating for drafting. Say exactly that.

## 2. Specificity gaps (implementer would have to guess)

**2.1 8.2 bullet wording vs the "no stronger than assertions" rule.** The proposal says "worded no stronger than its assertions". Tasks 2.3 give literal text: "a dedicated admin-only endpoint and not a flag". Neither "admin-only" nor "not a flag" is asserted by `assign-defaults-lock-gate-source.test.ts` as I read the earlier review (it asserts which routes call the gate). Only the second sentence is test-backed. The first sentence is a design statement. Required: either move the design statement to 8.1.1 (where code references can support it, `isApplicationAdmin`) and keep the 8.2 bullet to what the test asserts, or mark it explicitly as an architecture statement and cite `isApplicationAdmin` in the bullet. Also, "the five lock-gated writes" differs from my earlier read of "four"; design.md says seven routes and five gated (add, archive, restore, reorder, restore-defaults). Task 3.1 must record the actual route list from the test body, and the bullet must change if the number differs. Say in 2.3 "re-confirm the number at landing".

**2.2 Missing verification tasks for D3, D4 and D8.** Section 4 has checks for D1, D2, D5, D6, D7, but none for:
- D3: presence of 8.1.1 and items a to h (a grep for the heading and for each label).
- D4: exactly one new bullet in 8.2 and no other 8.2 hunk.
- D8: `grep -n "http" ` over the added text returns nothing; #200, #208, #216, #271, #131 each appear in 8.1.1.
- "No line numbers, no numeric limits" (constraint): no check. Suggest a grep for `line [0-9]|:[0-9]{2,}` and for `[0-9]+ ?(/|per) ?(min|day|hour)` over the added text.
Add them as 4.6 to 4.8 so every D has a task.

**2.3 Content source is inconsistent.** The proposal says exploration-notes sections 6 and 8 are the live position. Tasks and design cite "sections 2 to 7" as content source and "section 6 item 2 verbatim" for the reopen triggers. The notes' section 8 is only a disposition log, so it is not a content source, and sections 2 to 5 contain superseded drafts (for example, the two-row table). Tell the implementer which sections win on conflict. Better: inline the final reopen-trigger list and the row text in tasks (or in design.md) so the HLA does not depend on notes that are labelled history. "Verbatim from" a file that is not in the final change set will rot.

**2.4 Row text.** Task 2.1 says "controls cell per exploration-notes section 6 item 1 (only confirmed mechanisms, 'tests listed in 8.2')". The notes' row lists "per-actor topic-write limiter" and "success audit row written in the same transaction". Neither is in the identifier list of task 1.1 as a verification target (the same-transaction claim in particular). Add "same-transaction audit write" and "advisory lock" to task 1.2's confirm list; if not confirmed, the row must drop them. Also "tests listed in 8.2" is slightly off: 8.2 will name only one test file (the source test). The other two tests are cited in 8.1.1 or not at all. Say where the concurrency test and the zero-topic test are cited, or drop "listed in 8.2" from the row. As written, D5 and D2 pull in different directions.

**2.5 Task 2.2(f), "no participant-visible trace" via #271.** The notes claim this from the #271 reader inventory test (every audit_log reader inventoried and filtered by exact operation). That supports "no reader outside the inventory exposes it", which is not quite "no participant-visible trace". Word it as the test asserts, or add the test to section 3 verification. Same over-claim risk as D6, but the grep would not catch it.

**2.6 Task 2.2(a), "accepted on locked and unlocked zero-topic teams".** This is in tasks but not in the proposal's D3 or Constraints. It is a load-bearing precondition (my earlier item 8). Task 1.2 does not list it as a confirmation item; it should (handler does not require locked state).

**2.7 Task 2.2(d), "plus onboarding impact of an emptied or edited template".** The notes (section 7) say an emptied template makes team creation roll back. That is a behavior claim about #215/#216 code that is not in task 1.3's verification list. Add it, or limit the sentence to "degrades onboarding" without the rollback claim.

**2.8 Task 2.2(g), "2 to 3 lines".** A line budget is the same smell I flagged before (B1). Replace with content checks: names the first-noticer (facilitator, via `NO_ACTIVE_TOPICS`), the recovery path (admin calls assign-defaults), that no facilitator self-service exists and its cost (wait before a scheduled session), and that pacing/reveal/readiness/outlier behavior is unaffected. Length cap may stay as guidance, not as the condition.

**2.9 "Expected affected count none, citing docs/deployment.md 'Zero-topic teams', no number."** Good, but the cite should be by section name only (it is) and must be re-confirmed at landing (the section still says expected 0). Add to task 1 list.

**2.10 Archived rows.** Design D5 handles the conditional clause. Good. Make the outcome recordable: task 1.2 should say "record keep or drop in pr-notes.md" so the sign-off can see which version landed. This is the topic-history-preservation edge case I care about; if dropped, say so in pr-notes so it is a conscious drop and not a silent one.

## 3. Vague language to tighten

- "Genuine" wording in proposal Why: "I also do not want to be the person who explains this carve-out to each new reviewer." This is first-person motivation in a proposal that will be read as a record. Harmless, but the persona voice ("I care that it stays structural") should be dropped from anything that gets copied into the HLA. Confirm none of it is carried into the HLA text (it is not in the tasks, so this is just a caution).
- "legitimate revisit" and "pre-production reviewer will actually read": fine in the proposal, not for the HLA.
- "Only confirmed mechanisms" appears in D2 and 2.1 without a defined "confirmed" bar. Define it once: confirmed means found by grep in non-test source on the landing day (task 1.1 already says this; reference it).
- "Residual caveats" (f): seven sub-items joined by semicolons in a task bullet. Fine to implement, but state that each is a separate bullet in the HLA so they are individually reviewable.
- "Reopen decision must weigh recovery speed": tasks 2.2(h) says "ending with the recovery-speed weighing sentence". The sentence text is only in the notes. Inline it (see 2.3).

## 4. Check against requirements/

- Terminology (D9, E1): the proposal commits to "topic customization lock", "locked team", "zero active topics" and `first_session` once. I did not re-run the grep; task 4.1 owns it. But the proposal never states which document is the terminology source. Name it: the lock use case (the one amended in #200) and BRD wording. Without that, my D9 sign-off has no baseline.
- HLA 8.1 table has three columns (`Threat Category | Description | Primary Controls`); proposal D2 matches.
- HLA 8.2 "API Authorization" exists with three bullets; proposal matches.
- BRD SEC-31 and HLA 8.4: untouched, and the Why correctly frames #296 as an input to the 8.4 revisit rather than an edit of it.
- The persona concern "edge cases discovered late become scope disputes ... around topic management" is well served by the reopen triggers. The "zero sessions" state concern is not affected by this change.
- Topic history preservation (a persona hard requirement): the carve-out inserts only if task 1.2 confirms it. This is the one place the change could contradict the requirement if the handler were found to delete or reuse archived rows. Task 1.2 should say "if the handler deletes or modifies archived rows, stop and raise to BA" rather than just "keep or drop the clause". That is a requirements conflict, not a wording question.

## 5. Required changes (before implementation)

1. Restore per-item content to D3 (1.1).
2. Resolve D9 gating vs "do not wait" (1.4).
3. Fix the 8.2 bullet so every clause is test-backed, or relocate the design clause (2.1); re-confirm the "five" number.
4. Add verification tasks for D3, D4, D8, and the no-URL/no-line-number/no-number constraints (2.2).
5. Inline the row text, reopen-trigger list and recovery-speed sentence, or declare which notes sections win (2.3).
6. Add the missing confirmation items to section 1: same-transaction audit, advisory lock, locked/unlocked acceptance, template-failure rollback, deployment.md wording (2.4, 2.6, 2.7, 2.9).
7. Add `safe` to the D6 grep (1.2).

## 6. Suggestions (not blocking)

- Replace the "2 to 3 lines" budget in (g) with the content checks (2.8).
- Add a stop-and-raise rule if the handler touches archived rows (section 4).
- Record keep/drop of the archived-rows clause in pr-notes.md (2.10).
- Name the terminology source document for D9 (section 4).
- Reword the 2.2(f) "no participant-visible trace" claim to what the #271 test asserts (2.5).

## 7. Sign-off position

I will confirm D9 (terminology) once the HLA text exists and task 4.1's grep outcome is recorded. I am not blocking the proposal on anything in section 6.
