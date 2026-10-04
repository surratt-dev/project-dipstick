# Tasks Review — Business Analyst (Marcus Delgado)

**Change:** 238-facilitator-reporting-chain-decision (#238)
**Artifact reviewed:** `tasks.md`
**Read against:** `proposal.md` (What Changes, Impact, Appendices A–C), `design.md` (D1, D5), `decision-log.md` rows 1–19 (binding), `exploration-notes.md` §5, and GitHub issue #238 (body fetched via REST).
**Verdict:** **Approve with conditions.** The decision record tasks (§1) are close to complete. The gaps are in (a) how accurately rows 14, 15, 17 and 19 reach 01c, and (b) the #238 acceptance criteria. AC 1, the link from #235 Follow-up 2, has no task that applies it. AC 2 has no task that checks the filed issue body. Both are fixable by adding tasks, and no decision needs reopening.

---

## 1. Coverage: decision-log rows → tasks

| Row | What 01c must reflect | Task(s) | Status |
|---|---|---|---|
| 1 | Conflict rule instead of reporting-chain model | 1.2, 1.6 (Rejected (a)) | Covered |
| 2 | Decision record only; implementation deferred until #235 | 1.7 (dependency) | Covered |
| 3 | Sign in as EM + flag; **supersedes #235 Decision 7 for this pair only** | 1.2 | **Partial.** See C3 |
| 4 | Admin wins, still flag | 1.2 (table rows 5–7) | Covered |
| 5–7 | Process / environment | n/a (correctly omitted from Status) | OK |
| 8 | First-team-launch gate | 1.7 | Covered |
| 9 | User is told *and* audited | 1.4, 1.6 (Rejected (d)) | Covered |
| 10 | Pre-launch items live in #NNN; no checklist doc | 1.7, 3.2 | Covered |
| 11 | Drafts blocked; past-room-open sessions stay via `facilitator_id` | 1.5 | Covered (the "recreate" half is superseded by row 14) |
| 12 | Persona review is not VP sign-off | 1.1 | Covered in substance. Row not cited in Status. See S2 |
| 13 | Row-10 attestation only; gaps 1–2 accepted risk | 1.6 | Covered |
| 14 | Takeover: **confirmation prompt + audit event**; drafts still can't be opened by a non-facilitator creator | 1.5 | **Partial.** See C1 |
| 15 | **Any draft**; taker passes live-`facilitator` + non-member checks | 1.5 | **Missing.** See C1 |
| 16 | Separate issue #MMM | 1.5, 3.3 | Covered |
| 17 | No gate; **pre-launch draft check covers the interim** + audited operator step | 1.5 (operator step only) | **Partial.** See C1 |
| 18 | Live-role check on draft-based team-content access (+ test) | 1.5, 3.2 (AC 12) | Covered |
| 19 | Operator records **own app user id** (needs an app account); notice contact = `APPLICATION_ADMIN_CONTACT_EMAIL` | none in §1. 1.8 hints at the contact sentence | **Missing.** See C2 |

---

## 2. Conditions (must fix before apply)

### C1. Rows 14, 15 and 17 are thinned out in task 1.5
Task 1.5 tells the writer only that "another facilitator takes the draft over (#MMM…)". The decided details of takeover are left out. Design D5 has them, but the task doesn't carry them through. 01c is the place a later reader goes to learn what was *decided*. If these details exist only in Appendix C, they will drift once #MMM's design review starts reopening things. Add to 1.5:
- takeover requires a **confirmation prompt** and writes an **audit event** (row 14);
- **any draft** can be taken over, not only stranded ones (row 15);
- the taker must pass the usual checks: live `facilitator` role and no active membership on the team (row 15). The draft's own creator can't take it over;
- until #MMM ships, the **pre-launch draft check (row 10) covers drafts that exist at launch**, and the operator step covers drafts stranded after launch (row 17). The task currently names only the operator step.

Add checks: `grep -in 'confirmation' "$RECORD"`, `grep -in 'any draft' "$RECORD"`, `grep -in 'pre-launch draft check' "$RECORD"`.

### C2. Row 19 is not recorded anywhere in the tasks
Row 19 is binding (a pipeline default the user may override), and the Status block in 1.1 cites "rows 1–4, 8–11 and 13–18", which leaves 19 out. The same is true of the proposal header ("rows 1–18") and its "decided it" sentence. 01c should carry two facts from row 19:
- The interim operator step records the **operator's own app user id** as `actor_user_id`, so **the operator must have an app account**. This is a real operational prerequisite for row 17's interim path. If the record leaves it out, the first operator without an account finds out in the middle of an incident.
- The notice's contact text is the existing `APPLICATION_ADMIN_CONTACT_EMAIL`, and it is display text, not behaviour. Task 1.8's check already allows the sentence "contact text is display text, not behaviour", but **no task tells the writer to include it**. Put it in 1.4.

Also fix the Status line: cite row 19 as "(pipeline default, accepted; user may override)". Watch for a trap here. Task 1.8's check `grep -in '…override'` fails if the record quotes row 19's "user may override". Either word it as "subject to change by the product owner", or relax the 1.8 check. Also update the proposal header and line 28 to say rows 1–19, so the record and proposal agree. Task 5.1 already edits proposal.md, so this fits naturally there or in a new 1.x verify step.

### C3. "For this pair only" is not required in 01c
Row 3 says the rule **supersedes #235 Decision 7 for this pair only**. Appendix A.1 and A.2 say so too, but task 1.2 asks only for the decision and the table. A reader of 01c alone could conclude that precedence as a whole changed. Add to 1.2: state that #235 precedence is otherwise unchanged, with check `grep -n 'pair only\|otherwise unchanged' "$RECORD"`.

### C4. #238 AC 1 ("linked from #235's proposal Follow-up 2") has no task that achieves it
Tasks 3.1 and 5.2 only *verify* that the A.1 "Before" text matches and *note* that the AC is pending. The proposal assigns the A.1/A.2 edit to "whoever merges second" and lists "GitHub comments on #235 and #238 pointing to the record" as a human action. Neither appears as a task, so AC 1 can be forgotten. Add a §6 (or extend §5):
- **6.1 (conditional)** If #235 is on `main` when this PR is ready, apply A.1 and A.2 to #235's `proposal.md` and `decision-log.md` in this PR. Check: `grep -F '01c%20-%20Facilitator%20Reporting%20Chain' openspec/changes/facilitator-role-claim-allowlist/proposal.md` hits, and the relative link resolves (extend 2.4's script). Otherwise, record in the #238 PR that #235's PR must apply them, and post a comment on #235 with A.1/A.2 inline.
- **6.2** Post the GitHub comments on #235 and #238 pointing to the record (orchestrator or human). Check: comment URLs recorded in the PR description.
- Task 3.1 verifies A.1 only. It should also verify that the A.2 target (row 7 of #235's decision log) exists on `origin/ccr-b594efa3-9zclgu`.

### C5. #238 AC 2 has no check that the filed issue bodies match the appendices
The proposal's Impact section says AC 2 is met "by the record plus the filed follow-up issue whose body contains Appendix B's minimum ACs". Task 5.1 only replaces placeholders. Add:
- **5.0** After filing, confirm that #NNN's body contains the launch gate, the 12 minimum ACs, the 2 pre-launch steps and the PR-review checkboxes, and that #MMM's body contains "Gates: none", the decided points and the ACs. Check with `gh api repos/surratt-dev/project-dipstick/issues/<n> --jq .body | grep -c …` (GraphQL `gh issue view` is blocked in this environment; use REST).
- The other AC 2 branch, "docs warning confirmed as the standing control", is covered by 1.6 and 1.7. Good.

---

## 3. Suggestions (should fix)

- **S1. "Can't be recreated" is too absolute, and its grep check makes it worse.** Under the interim operator step, the draft *is* abandoned and **another facilitator then creates a new draft** (Appendix B, design D5). So after the operator step, recreating the session in the app is exactly what happens. The accurate statement is "can't be recreated *while the stranded draft holds the slot*". Task 1.5's check ("`recreat` returns only the statement that drafts can't be recreated") would flag a correct description of the interim step. Reword the requirement and loosen the check to allow the interim-step sentence.
- **S2. Cite row 12 in the Status block.** Its substance is in 1.1, but the citation list skips it. Citing it shows the VP-pending wording is a logged decision, not editorial caution.
- **S3. Design D1 section 11, "Consequences for other documents", has no task.** Tasks 1.1–1.8 cover sections 0–10. Either add "write Consequences (Summary.md footnote, README index, 01 cross-ref, #235 A.1/A.2, docs warning via #NNN)" to 1.7, or drop section 11 from D1. Task 1.1's `## ` ≥ 10 check would pass either way, so it won't catch the omission.
- **S4. Standing-control scope: gaps 1–4 or 1–6?** Task 1.6 says "Residual gaps 1–6, with the docs warning as the standing control". The AC disposition (exploration §5, task 1.7) says the warning is the standing control for **gaps 1–4**. Gap 5 (the peer interpretation) is BA-owned, and gap 6 (the interim) is closed by row 8. Make 1.6 say "gaps 1–4" so the two paragraphs of 01c agree.
- **S5. Task 1.2: name the eleven rows' source.** "All 11 table rows from exploration §3" should say "identical to proposal Appendix B's rule table". If the two copies differ, the follow-up's resolver tests (AC 1) will test something other than what the record says. Add a diff check: extract the table rows from both and compare.
- **S6. Task 4.1 needs to accommodate C4.** If 6.1 applies A.1/A.2 in this PR, `openspec/changes/facilitator-role-claim-allowlist/` changes too. Add it to 4.1's allowed paths under that condition.

---

## 4. Lost in translation (summary)

1. **Takeover details** (confirmation prompt, any draft, taker checks) go from decided in rows 14–15 to unmentioned in 01c (C1).
2. **The pre-launch draft check's role in the interim** (row 17) drops out of the Sessions section (C1).
3. **Row 19 as a whole**, including the operator-must-have-an-app-account prerequisite (C2).
4. **"For this pair only"** (row 3) weakens to an implied scope (C3).
5. **#238 AC 1's actual link edit**, and **AC 2's filed-body verification**, go from proposal Impact and Human actions to having no task (C4, C5).

Everything else checks out: rows 8–13, 16 and 18, the rejected options, the audit-content rule, S4, the VP-pending wording, the launch gate and the no-checklist rule all trace to a task with a runnable check. The proposal's three constraints that the record must not violate (no toggle, hard team block, no raw claim values) are well guarded by 1.4 and 1.8.

— Marcus Delgado, Business Analyst
