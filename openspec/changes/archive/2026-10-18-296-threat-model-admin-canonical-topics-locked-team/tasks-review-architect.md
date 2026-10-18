# Tasks review: Solution Architect (Ingrid Sollenberger)

Scope: task ordering and dependencies in `tasks.md`, read against `design.md` and `proposal.md`. Content and wording choices are not reviewed here.

## Verdict

Approve with required changes. The overall shape (confirm claims, then draft, then sweep, then sign off) is right. Three ordering defects and a handful of numbering and cross-reference errors need fixing before implementation.

## Blocking findings (ordering and dependency)

**B1. Section 3 (test-citation verification) is after drafting but is a pre-drafting check.**
Section 3 verifies that the HLA sentences match the tests. Section 2 writes those sentences and 2.3 already says "re-confirm five from the test body", which is task 3.1 done early. Verifying claims after writing the text that cites them is the inverse of the stated principle.
Fix: move section 3 into section 1 (as 1.9 to 1.12, or a "1B" block) so the implementer drafts from verified facts. Reword each item from "HLA sentence matches" to "record the confirmed assertion". Delete the duplicate "re-confirm five" in 2.3 and point to the recorded 3.1 result. Keep one after-the-fact line in section 4 ("text as written still matches the recorded claims").

**B2. 2.3a is a second drafting pass over text that 2.1 to 2.3 have already produced.**
2.1 says the controls cell is "per design.md". 2.2 says items (a) to (h) are "per proposal D3 and design.md". 2.3a then applies the `design.md` wording: the controls cell split, the caveat bullets, the content additions to (a) to (e), and the reopen triggers. That is the same content written twice, and an implementer who follows 2.1 and 2.2 literally produces text 2.3a then rewrites.
It also lets two sources compete. 2.2 points at proposal D3, which is the minimum list. 2.3a points at design.md, which is the final wording.
Fix: merge 2.3a into 2.1 and 2.2. State once that design.md is the only wording source and proposal D3 is the acceptance minimum. Remove the "2.3a" label (see N1).

**B3. The wording sweeps are not clearly last, and their search scope is undefined.**
- 4.2, 4.8 and 4.9 grep "over the added text only". No task says how to isolate it. A grep over the whole HLA will hit existing prose (URLs, "safe", "cannot"). Specify one command, for example `git diff -U0 main -- "requirements/High-Level Architecture.md" | grep '^+'`, and use it in 4.2, 4.8 and 4.9.
- 4.1 may name a contradiction and trigger an HLA edit. 4.1 comes first in the list, which is correct. State explicitly that 4.2, 4.8 and 4.9 run after any 4.1 edit and are re-run if any of them forces a text change. Structural checks (4.3 to 4.7) should run last, since a wording fix can move hunks.
- 4.3 (diff scope) does not account for a 4.1 edit outside the HLA. D1 allows that case ("unless the contradiction grep names a line"). Add that allowance to 4.3.
- 4.9 requires "not 'accepted' for #208". The added text will legitimately contain "Accepted on locked and unlocked teams" (item (a)) and probably "accepted trusted role". A bare grep for "accepted" will false-fail. Narrow it to the sentence that cites #208 and the chained path.
- 4.2 greps "prevent". The controls cell and item (e) use "Preventive" and "not preventive" by design. Say that hits in those two places are expected and satisfied by the code references.
Proposed order of section 4: 4.1, then 4.2 / 4.8 / 4.9 (wording, one pass), then 4.6 / 4.7 / 4.5 (structure), then 4.4 / 4.3 (diff scope, last).

## Required fixes (dependencies and missing steps)

**R1. `pr-notes.md` is written to by 1.2, 1.4, 1.5, 1.7, 6.1 and 5.1, but no task creates it.**
Add a first task: create `pr-notes.md` with headed stubs (confirmed-claims table, findings for the user, follow-up drafts, sign-off log). Give section 1 a single output, the confirmed-claims table. Section 2 then drafts from that table. This also gives a concrete mechanism for "drop any control that fails to confirm", which is currently a per-task instruction with no checkpoint. Add an explicit gate: "Do not start section 2 until every row in the table is marked confirmed, dropped, or raised."

**R2. 1.3 and 1.7 duplicate each other.**
1.3 confirms the `topic.default_*` template-write operations. 1.7 "confirms the template-write operations (1.3) are audited". That is one check split across two tasks, and 1.7's remaining items (session posture, limiter store-error behavior, suppression marker) are unrelated to template audit.
Fix: fold the audit confirmation into 1.3 and keep a single caveat rule there. Move "limiter on store error is 503 fail-closed; suppression marker is a log line" into 1.1 (controls and operations group), since the controls cell and caveat bullet depend on it. Keep the session-posture check as a small separate pr-notes-only item, or drop it, since it does not enter the HLA.

**R3. 1.8 bundles two unrelated checks (#131 status, `docs/deployment.md` wording).**
Split them. They have different failure outcomes: #131 changes the rating sentence, while the deployment wording changes the "expected count" caveat. The deployment wording also belongs next to 1.5, which is the same claim (expected affected count).

**R4. Tasks 2.1 and 2.2 assume things not yet checked.**
- 2.1 says the existing seven rows are byte-identical, but no task confirms that there are seven rows today. Add that to section 1 (a one-line count) so the 4.4 comparison has a baseline.
- 2.2 requires "define carve-out on first use; `first_session` once". Nothing confirms `first_session` is the design-state name in current code or the lock use case. Add it to 1.1 or drop the mention.
- 5.1 issue (1) cites "#216 S-B, N-A, N-D". Nothing confirms those labels exist in the #216 archive. Add a single-line check, or word the draft as "per the #216 security review" and cite the file.

**R5. 2.4 is a constraint, not a task.**
"Plain issue references only..." describes how to write 2.1 and 2.2 and is verified by 4.8. Move it into 2.2 as a drafting rule. A separate checkbox invites ticking it without any action.

**R6. Landing-day drift.**
Section 1 is titled "on the day of landing" but runs before drafting. If drafting spans days, the confirmations can go stale. Add one line at the start of section 4: re-run the 1.1 greps and the five-count against the final tree, and record "no drift" or the change.

**R7. 6.1 timing.**
Sign-off requests should be sent after 4.x passes, not merely after 4.1. If 4.2 or 4.9 force a text change, the reviewers will have confirmed stale wording. Change "after the 4.1 outcome is recorded" to "after section 4 passes".
Also move the user question in 5.1 ("file these follow-ups now?") to follow 6.1, so there is one end-of-change handoff to the user. The drafting in 5.1 can stay where it is, since it has no dependencies.

## Splits, merges and reorders (summary)

| Action | Tasks | Reason |
|---|---|---|
| Move | 3.1 to 3.4 into section 1 | Verify before drafting (B1) |
| Merge | 2.3a into 2.1 / 2.2 | Duplicate drafting pass (B2) |
| Merge | 1.7 (audit part) into 1.3 | Same check (R2) |
| Move | 1.7 (limiter, suppression) into 1.1 | Belongs with control identifiers |
| Split | 1.8 into #131 check and deployment-wording check | Different outcomes (R3) |
| Merge | 2.4 into 2.2 | Constraint, not task (R5) |
| Add | `pr-notes.md` creation and claims-table gate before 1.1 | Missing prerequisite (R1) |
| Add | Re-run of landing-day greps at the start of 4 | Drift (R6) |
| Reorder | Section 4: 4.1, wording sweeps, structure, diff scope last | B3 |
| Move | 5.1 user question after 6.1 | Single handoff (R7) |

## Numbering and cross-reference errors

**N1. 2.3a and the stray 4.9.** 2.3a is a patch label, not a task number (see B2). 4.9 sits above 4.8 in the file, after a blank line break between 4.5 and 4.6. Order is 4.1 to 4.5, 4.6, 4.7, 4.9, 4.8. Renumber sequentially after the reorder in B3. There should be no gaps and no letter suffixes.

**N2. External references to task numbers will break on renumbering.** Current references:
- `proposal.md` "tasks 4.6 to 4.8" (verification of D3, D4, D8). It already omits 4.9 and will be wrong again after any renumber.
- `proposal.md` "task 1.1", "task 1.2", "task 4.1", and "task 2.2(f), 3.4".
- `design.md` "task 1.3", "1.4", "1.5", "1.6", "tasks 1.2 to 1.7", and "4.9" (as the merge-gate wording check), and "tasks section 1", "section 3".
- `tasks.md` itself: 4.2 refers to "task 1.2", 2.3 to the test body, 1.7 to "(1.3)".
Fix: after renumbering, update every reference in one pass. Prefer section references ("tasks section 1") over individual numbers in proposal and design, since those are stable under the merges above. Note that "1.4 renumbered to 1.8" is not reflected consistently: nothing in the three files still points to the old 1.4 as the #131 check, and `design.md` uses 1.4 for template text validation (which matches the current 1.4), so the current numbering is internally consistent but the intended renumber must be completed and confirmed with one grep for `task 1\.[0-9]` across the change directory.

**N3. Sign-off inconsistencies across the three files.**
- `proposal.md` D9 says a Security timeout leads to "requested, no reply, proceeded as proposed". `design.md` and tasks 6.1 say Security non-reply is "requested, not reviewed" with the merge decision left to the user. The tasks and design agree; the proposal does not. Amend the proposal.
- `design.md` calls "Marcus" the engineer reviewer ("Engineer review (Marcus)"). The proposal and 6.1 call Marcus the BA. If both roles are intended, name them separately. Otherwise a reader cannot tell who owns the terminology confirmation.

## What is already well ordered

- 1.1 (identifiers exist) precedes 1.2 (handler behavior), which precedes the claims that rest on it. The stop-and-raise rule on archived rows (1.2) fires before any text is drafted.
- 1.3 before 1.4 (template write path found before its validation is asked), and 1.6 before the item (c) provisioning sentence, are correct.
- 4.1 before the over-claim sweep is correct, and 6.1 is correctly a merge gate that does not block drafting.
- Documentation-only scope with no assumed built artefacts: no task depends on code that does not exist.

## Required before implementation

1. Move section 3 into section 1 and reword it as "record the confirmed assertion" (B1).
2. Merge 2.3a into 2.1 / 2.2 (B2).
3. Define the added-text extraction command and the section 4 order (B3).
4. Create `pr-notes.md` and the claims-table gate as the first tasks (R1).
5. Merge / split 1.3, 1.7 and 1.8 as in the table (R2, R3).
6. Renumber, then fix all cross-references in proposal.md, design.md and tasks.md, and align the Security timeout in proposal D9 (N1 to N3).
