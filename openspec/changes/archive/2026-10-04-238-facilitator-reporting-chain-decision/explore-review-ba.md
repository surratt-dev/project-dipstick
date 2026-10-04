# Explore Review: Business Analyst (Marcus Delgado)

**Reviewing:** `exploration-notes.md` (Devon Calloway, 2026-10-04)
**Lens:** Can each idea be written as a requirement someone can build and test without coming back to me? Decision-log rows 1–4 are binding and are not reopened here.
**Spot-checked against source:** `facilitator-sessions.ts:318` (global-role 403), `:1290-1300` (roster excludes on `u.global_role` and `tm.role`), `sessions.ts:150` (dual EM check), `team-content-access-helper.ts:169` (dual check → `team.access_grant_mismatch`), `middleware.ts:34` (90-minute absolute lifetime), #235 `proposal.md` Follow-up 2 and the S4 note, #235 `design.md` D3, #235 `docs/deployment.md` warning, #235 decision-log rows 7, 9, 12, 13. All the citations I checked are accurate.

## Overall

This is a strong exploration. §3 (the resolution rule and its table) is already at requirement grade, and §2 gives a reason for the EM resolution that is grounded in code and that the user's rationale did not include. The weak spots are the places where the notes say "surfaced", "visible", "incident" or "met when applied" and stop there. Each of those words needs a test condition before it goes into a proposal. I also found one edge case the notes miss: sessions created during the interim window (C1 below).

---

## A. Clarifications needed (answer before the propose stage)

| # | Question | Why it matters | My recommendation |
|---|---|---|---|
| C1 | **What happens to sessions a manager created during the interim window?** Between #235 merging and #238 landing, an EM+facilitator user resolves to `facilitator` and can create sessions for skip-level and sibling teams. #235 Decision 12 says an existing session stays with its facilitator after the role changes. So when #238 lands, a person now resolved to EM still controls those sessions. The notes don't mention this (§6.6 covers new sessions only). | This is exactly the outcome the decision exists to prevent, and it survives the fix. | The implementation issue includes a one-time **detection query**: draft or active sessions whose `facilitator_user_id` now has `global_role = 'engineering_manager'`, or has a conflict row. Its output goes to the deploying operator. Reassigning or cancelling them is a human action, so no code is needed. If the user prefers, accept the risk explicitly in the record. Either way the record has to say which. |
| C2 | **Does "surfaced" in row 3 require a user-facing signal?** Open item 2 offers "audit and log only" as an option. If row 3's "surfaced" means *surfaced to the user*, that option breaks a binding decision. If it means *surfaced to administrators*, the log already does it. | The answer decides whether the user notice is required scope or optional polish. Without it, the implementation issue can't be sized. | Ask the user for a one-line ruling. My reading: "surfaced" = the user is told (with the §4 notice as default) and "audited" = administrators can find it. That is two separate obligations, and the record should state both. |
| C3 | **Does the implementation issue inherit the first-team-launch gate?** (open item 1, §6.6) | If it doesn't, #238 closes "met" while the behaviour #235 Follow-up 2 was worried about ships unchanged. That is a traceability failure. | **Yes.** I own Follow-up 2 jointly with the VP, so this needs Rachel's acknowledgment and not just mine. The record's Status line should name the gate and the issue number. |
| C4 | **Who is recorded as the decider?** §7 proposes "Owner: BA with VP", but rows 1–4 were decided by the user. Follow-up 2 assigned the decision to BA + VP. | A record whose listed owner didn't make the decision doesn't hold up when someone challenges it later. | Status line: "Decided 2026-10-04 by the user (product owner), decision-log rows 1–4. Follow-on owner: Marcus Delgado (BA). VP of Engineering acknowledgment: _pending_ / _date_." Don't close #238 until that field is filled. |
| C5 | **How does AC 1 ("linked from #235's proposal Follow-up 2") get closed?** §8 says "met when the amendment is applied" but names nobody and no trigger. | An AC with no owner and no trigger stays open forever, or someone ticks it without checking. | See rewrite R6. Name the person who applies it and the event that triggers it, and decide whether #238 can close before the link exists. My preference is that it can't close until then; otherwise the PR description must say plainly that AC 1 is partially met. |
| C6 | **Record location:** confirm 01c plus a pointer under `Summary.md:12` (open item 4). | `Summary.md` is the source concept document. Editing it is a precedent decision, not a formatting choice. | Accept option A. For the pointer, use a footnote marker on line 12 plus one footnote line at the end of the file. Leave the sentence itself unchanged. Adding 01b and 01c to the README index is in scope because it's traceability housekeeping. |
| C7 | **Alerting** (open item 3). | Leaving it open means the docs can't be written. | Same as #235 Decision 9. The docs name the event and say "suitable for an operator alert". The app does not configure an alert. This can be settled at propose. It doesn't need the user. |

---

## B. Vague areas (with suggested acceptance conditions)

**V1. §1, "the misconfiguration that most often puts a manager in the facilitator's chair."** We have no data on which misconfiguration is most common. §6.1 (replace rather than add) is just as plausible. An unsupported frequency claim in a decision record invites "prove it".
→ Rewrite: *"the only reporting-chain violation the application can detect from data it already receives."*

**V2. §4, "the conflict is visible to the user."** Visible where, when, and for how long? The notes rule out in-session display, but "one notice after sign-in" leaves open whether it shows on every sign-in or once, and whether it can be dismissed.
→ Acceptance condition (implementation issue): *Given a sign-in whose claim produces a role conflict, when the user's first page after sign-in renders, then a non-blocking notice naming both roles and the action "ask your IdP administrator" is shown. It is shown again on every sign-in while the conflict persists. It is never rendered on a live-session (voting/reveal) view. A sign-in without a conflict shows no notice.* The exact copy is for the implementation issue, with Priya's review, and is not part of the decision record.

**V3. §4, "fire on every sign-in while the conflict persists."** This is fine, but the notes don't count the total audit rows per sign-in. A conflicted user now produces `role_claim_mapped` (EM is a non-default role, #235 Decision 4/8) **plus** the conflict row, and on the first conflicted sign-in after #235 the `facilitator → engineering_manager` transition as well.
→ Acceptance condition: *A sign-in with claim `["engineering_manager","facilitator"]` writes exactly one `role_claim_mapped` row (globalRole `engineering_manager`) and exactly one conflict row, both in the same transaction. If the conflict-row insert fails, the sign-in fails and neither row persists.* Also add the line about the volume being bounded by the 90-minute lifetime. Strictly, the 90 minutes bounds how *often* a user is forced to sign in, not how many rows they produce, so phrase it as "one row per sign-in".

**V4. §3, "detection happens after allowlist filtering."** This needs a negative case in the table: `["Facilitator","engineering_manager"]` (case mismatch) → `engineering_manager`, **no** conflict, allowlist warning only. Without it, someone will "helpfully" case-fold to detect conflicts.
→ Add that row. Also add `engineering_manager` only → EM, no conflict, so the table covers the baseline.

**V5. §5, "the docs warning is confirmed as the standing control."** Confirmed when, and as what text? The current #235 sentence ("treats them as facilitator only") is **true until** the implementation lands and false afterwards. The record has to say both halves.
→ Acceptance conditions:
- Decision record: *"Until #NNN ships, the #235 warning text stands unchanged and is the only control for this pair, together with the D3 log line."*
- Implementation issue: *"`docs/deployment.md` warning: the sentence 'If a user is sent both … facilitator only.' is replaced with the following verbatim text, and the #235 docs SHALL is amended to match: 'If a user is sent both `engineering_manager` and `facilitator`, the application signs them in as **engineering manager**, records `<event name>` in the audit log and tells the user. Fix the assignment in your IdP.' The sentence 'Do not assign `facilitator` to anyone who manages people.' is kept verbatim. The sentence starting 'From then on…' is removed, because it no longer applies to this pair."* The "Keep those memberships accurate" sentence stays, because residual gaps 1 and 3 still depend on it.

**V6. §6.2, "Control: docs warning, plus IdP group hygiene."** "Hygiene" isn't a control anyone can verify. A docs warning on its own is passive.
→ Suggest (not a reopening; it makes the confirmed standing control checkable): add one item to the first-team launch checklist. *"The IdP administrator confirms in writing that no current holder of `facilitator` has line-management responsibility for anyone in a team using the app."* If there's no launch checklist, drop this and leave the docs warning as the control, but then say "docs warning" only and delete "hygiene".

**V7. §7, "Revisit if … the residual gaps produce a real incident."** Nothing in the app detects gaps 1, 2 or 4, so an "incident" can only come from a human report.
→ Rewrite: *"Revisit if a participant, facilitator or EM reports (in a retro, to the BA, or to the VP) that a person with line authority over a team's participants facilitated that team's session."* Keep the other two triggers. They are concrete already.

**V8. §6.5, peer interpretation.** I agree with the reading, and as requirements owner I'll take it. The record should state it as an **interpretation owned by the BA**, not a finding: *"'Not in the team's reporting chain' means not holding line authority over any participant (directly or through a skip level). A peer who shares a manager with the team is not in its reporting chain."* One caveat for Priya rather than the record: a sibling-team facilitator who shares the participants' manager could carry candid comments back to that manager. That's a facilitation-ethics matter, not an access rule, and it doesn't need code.

**V9. §4, "I hold that line for the facilitator-from-another-team constraint in general: hard block preferred, never silent."** This is a personal principle and doesn't bind this decision. If it gets copied into the record, someone will cite it later as a requirement. Leave it out of the propose stage.

**V10. §9 is a scope sketch with no acceptance criteria**, and AC 2 is "a follow-up implementation issue is filed". An issue with no ACs meets the letter of that and fails its intent.
→ See R5 for a minimum AC set the filed issue must contain.

**V11. Traceability.** The notes cite `Summary.md:12` but not the BRD requirement IDs the record touches.
→ The record's header should trace to: `Summary.md:12` (intent), BRD FR-2.1 [HARD] and FR-2.2 [HARD] (what's enforced today), the no-manager participation rule (cite its BRD ID at propose), #235 Decisions 7 and 9, D3, and Security S4.

---

## C. Suggested rewrites

**R1. Decision statement (for 01c).**
> **Decision (2026-10-04).** The application does not model reporting lines. Instead, an IdP role claim that contains both `engineering_manager` and `facilitator` is a **role conflict**. The application drops `facilitator`, applies #235 precedence to the rest, records the conflict in the audit log on every such sign-in, and tells the user. This supersedes #235 Decision 7 for this pair only. Everything else about the #235 precedence order is unchanged.

**R2. Resolution rule.** Keep §3's wording and table verbatim, and add the V4 rows. That table should be the normative core of both the record and the implementation spec.

**R3. "Error" glossary line.** Put this near the top of the record, because the issue and row 1 both say "raise an error":
> In this decision, "error" means *the conflict is never silent*. It does **not** mean a failed sign-in. The user signs in as Engineering Manager.

**R4. AC disposition paragraph** (from §5, tightened):
> #238 AC 2 offers two branches. This decision meets both. **No reporting-chain model is chosen**, so the #235 deployment-docs warning is confirmed as the standing control for residual gaps 1–4. **A narrow code rule is chosen**, so implementation issue #NNN is filed. It is blocked by #235 and gates first-team launch (C3).

**R5. Minimum AC set for the follow-up implementation issue** (the issue body must contain these before AC 2 counts as met):
1. Every row of the §3 table (plus the V4 rows) is a passing test against the resolver.
2. Duplicate elements produce one conflict. A string claim never produces a conflict.
3. V3 holds: one `role_claim_mapped` row plus one conflict row, same transaction, and a failed conflict insert fails the sign-in.
4. Conflict-row metadata is limited to the fixed fields in §4. A test asserts that a non-allowlisted element (for example `superuser`) and its count are absent from the audit row and from the structured log.
5. With `application_admin` present, the D3 warn and the conflict row both fire. Without admin, D3 does not fire.
6. First access with a conflicting claim writes `auth.first_access_created` and the conflict row.
7. The V2 user-notice condition (subject to C2).
8. The #235 `oidc-auth` precedence spec, the `auth-error-handling` spec and the verbatim docs SHALL are amended per V5.
9. The C1 detection query ships, with its disposition, or the record states the accepted risk.
10. The simulator has a persona that sends both roles.

**R6. Cross-branch link (§8).**
> AC 1 is met when #235's `proposal.md` Follow-up 2 contains a link to `requirements/use cases/01c - …`. The exact replacement text is kept in this change as `followup-2-amendment.md`, with a before and after of the Follow-up 2 paragraph and of the Decision 7 annotation. **Who applies it:** whoever merges second, #235 or #238. If that's #238, the #238 PR applies the edit to #235's file once #235 is on main. **Until it's applied:** GitHub comments on #235 and #238 point to the record, and the #238 PR description says "AC 1: pending amendment on #235". #238 is not closed.

(If writing a second file into the change directory breaks the single-record constraint, put the before/after text in an appendix of the proposal instead.)

---

## D. Not a concern

- §2's claim that #235 precedence breaks real EM access is correct (`team-content-access-helper.ts:169`). It is the strongest argument in the notes. Lead with it in "Why", ahead of "safer".
- Answering S4 with a dedicated row rather than `outrankedRoles` is the right call. It's purpose-built, and it doesn't widen `role_claim_mapped`.
- Record placement (01c, modelled on 01b) is consistent with the existing pattern.
