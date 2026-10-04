# Propose Review (BA): 238-facilitator-reporting-chain-decision

*Reviewer: Marcus Delgado (Senior Business Analyst). Scope: `proposal.md` including Appendix A and
Appendix B. Checked against `decision-log.md` rows 1–11 (binding, not reopened),
`requirements/Summary.md:12`, `requirements/BRD.md` FR-2.1 / FR-2.2, GitHub #238's AC, and #235's
unmerged artifacts (read-only extract).*

## Verdict

**Approve with required changes (R1–R4).** The decision is recorded the way I'd want it: there's a
traceability header, the rejected options are named, the residual gaps are listed, and the
row-11 session rules are stated as decisions. Both of #238's AC are addressed. The problems are
in Appendix B. One pre-launch item asserts more than the user decided (R1). One pre-launch query
contradicts row 11 (R2). A few acceptance criteria rely on terms nobody has defined, so an
implementer would have to come back and ask (R3, R4).

---

## 1. #238 acceptance criteria

| #238 AC | Where the proposal meets it | Status |
|---|---|---|
| (1) Decision recorded in `requirements/` with rationale | 01c record, What Changes item 1. The rationale is in "Why `engineering_manager`" and "Rejected options" | Met once tasks 1.1–1.7 land |
| (1) …and linked from #235's proposal Follow-up 2 | Appendix A.1, applied by whichever PR merges second | **Pending.** The proposal says so honestly (Impact, AC 1) and keeps #238 open. Acceptable |
| (2) Model chosen → follow-up issue filed; else docs warning confirmed as standing control | Both branches: no model, so the warning is the standing control for residual gaps; a narrow code rule, so #NNN is filed (Appendix B) | Met, provided 01c states **both** branches explicitly (exploration §5 wording). See S5 |

Requirements trace: `Summary.md:12` ("not in the team's reporting chain") → FR-2.1 / FR-2.2
(only membership is enforced) → the conflict rule plus residual gaps. The chain is complete. FR-2.2
stays a hard block, and the Constraints section says so.

## 2. Appendix B traceability to the decision log

| Appendix B item | Traces to | Finding |
|---|---|---|
| Blocked by #235; gates first-team launch | Rows 2, 8 | OK |
| Rule (normative) + 11-row table | Rows 1, 3, 4 | OK. Matches row 4: admin wins and the conflict is still flagged |
| Conflict audit row + structured log, fixed metadata | Row 3 ("audited"), row 9; #235 Security S4 | OK. The source is S4/Constraints, not a log row. Cite it |
| Failed conflict insert fails the sign-in (Scenario 3, AC 3) | **No row.** Inherits #235 `auth-error-handling` transactional coupling | See S1. This can be read as conflicting with rejected option (c) |
| User notice (placement, frequency, copy rules) | Row 9 (the user is told) | The rule traces. The detail comes from the Facilitator review (O2, O5, suggestions 1–5). Fine, but vague in places (R3) |
| Room-open 403 with conflict copy; draft stays blocked; recreate | Row 11 | OK |
| Sessions past room-open stay with their facilitator | Row 11, #235 Decision 12 | OK |
| Specs/docs: apply A.3 | #235 VP SHALL (verbatim warning) | OK |
| Simulator persona | No row (exploration §9) | OK as scope |
| **Pre-launch: IdP attestation** | **Row 10**: "IdP attestation **that no one holds both roles**" | **Does not match. R1** |
| **Pre-launch: one-time read-only interim check** | **Row 10**: "one-time read-only check for **drafts** by now-conflicted users" | **Broader than row 10 and contradicts row 11. R2** |
| Pre-launch: Priya usability walk-through | **No row.** Facilitator suggestion 11, exploration §9 | Fine to keep, but the heading says "#238 row 10", which misattributes it. See R2 (last bullet) |

---

## Required changes

### R1. The IdP attestation must match decision-log row 10

Row 10 records the user's decision as the pre-launch "IdP attestation **that no one holds both
roles**". Appendix B (pre-launch step 1) says something different:

> …confirms in writing … that no current holder of `facilitator` has line-management
> responsibility for anyone in a team using the app. This is the only control that touches
> residual gaps 1 and 2.

This is the broader BA V6 wording from exploration §6, which was "accepted conditionally" *before*
the user answered row 10. It is not what the user decided. It also changes what the control is
for. The draft presents the attestation as covering residual gaps 1 and 2 (facilitator-only
managers, skip-levels). Row 10's attestation covers the pair the rule is about, at the moment of
launch. It does **not** cover gaps 1 and 2, and the decision record must not claim that it does.
Those gaps keep the docs warning as their only standing control (the proposal's own Residual-gaps
item and A.1 say this).

**Replace with:**

> - [ ] **IdP attestation.** The IdP administrator confirms in writing (recorded on this issue,
>   with name and date) that, at the time of attestation, no user is assigned both
>   `engineering_manager` and `facilitator` in the IdP. (#238 decision-log row 10.)

Delete "This is the only control that touches residual gaps 1 and 2." Make the matching edits
elsewhere:
- 01c "Residual gaps" (task 1.6): gap 2's control is "the docs warning" only. Remove any
  "plus the launch-checklist attestation" carried over from exploration §6 item 2.
- `design.md` D4 is already neutral ("the IdP attestation"). No change.

If the team believes the broader line-management attestation is worth having, that is a **new
question for the user**. Add it to Open items. Don't draft it into the issue.

**Check:** `grep -n "line-management" proposal.md` returns nothing, and
`grep -n "both .engineering_manager. and .facilitator." proposal.md` hits the attestation line.

### R2. The interim check must cover drafts only, and must be able to find the users

Row 10 says "drafts by now-conflicted users". The draft query is "`draft` **or `active`**
sessions…". Including `active` contradicts row 11 and #235 Decision 12: a session past room-open
**stays with its facilitator**. An operator who finds an `active` hit and "recreates it under a
proper facilitator" would be doing exactly what row 11 forbids.

There is also a detection gap. `users.global_role` changes only when the user next signs in after
#NNN is deployed, and a conflict row exists only after that sign-in. A both-roles facilitator who
created a draft during the interim and hasn't signed in since still reads as `facilitator`, so the
query misses them. That is the "first team's first session" case the exploration notes give as
the reason to run the check at all.

**Replace with:**

> - [ ] **One-time read-only draft check.** After #NNN is deployed and after the IdP attestation
>   above, the deploying operator runs one read-only query: sessions in `draft` whose
>   `facilitator_id` belongs to a user who (a) has `global_role = 'engineering_manager'`, or
>   (b) has any `<conflict audit operation>` row, or (c) appears on the IdP administrator's list of
>   users who held both roles at any time since #235 was deployed. A human arranges for another
>   facilitator to recreate each hit (row 11; no reassignment). Sessions past room-open are out of
>   scope (row 11, #235 Decision 12). Record the operator, date, environment, query and result on
>   this issue. This is not shipped code. (#238 decision-log row 10.)

- Move the Priya walk-through out from under the "(#238 row 10)" heading. Either retitle the
  section "Pre-launch steps (row 10, plus Facilitator review suggestion 11)", or tag the
  walk-through item with its own source. Task 3.2's count of 3 `- [ ]` items stays valid.

### R3. Notice criteria: define the terms the ACs depend on

As written, these can't be implemented without asking someone:

| Vague term | Where | Concrete condition to use |
|---|---|---|
| "first non-session page" vs. "landing page" | Scenario 1 vs. AC 7 | Pick one. Suggested: "the first page rendered after sign-in that is **not** a live-session route. Live-session routes are the lobby, pre-session, active, reveal and wrap-up routes (list their paths in the issue)." AC 7 then tests the landing page **and** one other non-session route |
| "sign-in" (for frequency/dismissal) | Notice, Frequency | "A completed OIDC callback that runs account resolution." State whether a mid-session re-auth counts. Suggested: it does, and the notice is deferred to the next non-session page |
| "Mentions the promotion case" | Copy rules | "Copy includes a sentence telling the user that if they have recently become a manager, this is expected" (exploration §4 / Facilitator O2) |
| "Says which role goes, what still works" | Copy rules | "Names Facilitator as the role not applied; states that Engineering Manager access to their team(s) still works; states that they can't open or run new sessions" |
| "Admin-specific copy" | Notice, AC 7 | "States that administrator access is unaffected and that the Facilitator/Engineering Manager assignment still needs fixing" |
| "Lists … drafts (team and date)" | Notice | "Every session with `state = 'draft'` and `facilitator_id` = the user, showing team name and scheduled date (not created date). Show all, with no cap, or state the cap" |
| "non-blocking, never a modal" | Placement | Not tested in AC 7. Add: "the notice is dismissible and doesn't block navigation (no modal or overlay)" |
| "Contact text … generic fallback" | Copy rules | Not tested anywhere. Add an AC: "with no contact text configured, the notice renders the generic fallback. With it configured, it renders the configured text verbatim as plain text (not HTML)" |
| "Copy is reviewed by Priya Nair" | Notice | Make it a checkbox on the issue with name and date, so "reviewed" is verifiable |

### R4. First-access vs. returning sign-in: ACs 3 and 6 and Scenario 1 conflict

Under #235 D5 (`shouldRecordRoleClaimMapped`), a **new** user gets `auth.first_access_created`
and **no** `auth.role_claim_mapped`. Scenario 1 ("same transaction as the
`auth.role_claim_mapped` row") and AC 3 ("one `role_claim_mapped` row plus one conflict row")
are therefore false on first access, while AC 6 says first access writes
`first_access_created` + conflict. Scope them:

- Scenario 1 / AC 3: "On a **returning** sign-in, one `auth.role_claim_mapped` row and one
  conflict row are written in the same transaction."
- AC 6: "On **first access**, one `auth.first_access_created` row and one conflict row are written
  in the same transaction. The conflict row's `previousRole` is `null`."

---

## Suggestions (non-blocking)

- **S1. Say why a failed audit insert fails the sign-in.** Rejected option (c) is "failing the
  sign-in". Scenario 3 fails the sign-in when the conflict-row insert fails. These aren't in
  conflict: the second is #235's transactional-audit rule (`auth-error-handling`, `AuditWriteError`).
  The next reader will still ask. Add one line to 01c and to Appendix B: "a failed conflict-row
  insert fails the sign-in as any transactional audit-write failure does (#235
  `auth-error-handling`). This is not rejected option (c), which is about the conflict itself."
- **S2. Add an AC for the "never silent" glossary line.** Suggested: "No code path applies
  `engineering_manager` because of the pair without writing the conflict row." AC 1 plus AC 3
  nearly cover this, but no single test states it.
- **S3. AC 4 log assertion.** Name the structured-log field set as well as the audit row, and make
  it equal to the metadata set, so the two can't drift (the same lesson as #235 D5).
- **S4. Room-open 403 copy.** AC 8 should state the condition it checks: "the 403 response body or
  page copy contains the conflict-specific message **only** when the user's last sign-in recorded
  a conflict, and the generic 403 copy otherwise".
- **S5. 01c AC-disposition paragraph.** Use the exploration §5 sentence that names both #238 AC
  (2) branches explicitly ("no model is chosen, so the warning is the standing control for
  residual gaps 1–4; a narrow code rule is chosen, so #NNN is filed"). Reviewers will check AC 2
  against that sentence.
- **S6. Revisit-if trigger 2** ("is reported to have facilitated") needs an owner and a channel.
  Suggested: "reported to the BA or the VP of Engineering", so a report has somewhere to go.
- **S7. Task 3.2 check.** After R1/R2, add `grep -c "row 10" proposal.md` ≥ 2 so the attestation
  and the draft check each keep their citation.

## What's good (keep)

- "Error" is defined in the glossary as "never silent, not a failed sign-in". That heads off the
  most likely misreading.
- The row-11 session rules are stated as decisions and pinned by a test, so later hardening won't
  undo them.
- There's no `specs/` delta for unbuilt behaviour (D2), and Appendix A.3 puts the verbatim-SHALL
  edits in the same PR as the code.
- The Constraints section protects the ritual. The notice never appears on live-session routes,
  and there's no toggle on the no-manager rule.
