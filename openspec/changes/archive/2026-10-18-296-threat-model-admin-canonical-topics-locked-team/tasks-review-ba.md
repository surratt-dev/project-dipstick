# Tasks review (Business Analyst, Marcus Delgado): #296

Scope: do the tasks, together, cover D1 to D9 and the proposal's capabilities and constraints, and is each acceptance condition verifiable by a task?

**Verdict: approve with required fixes (3 must-fix, 6 should-fix).** The structure is sound and most conditions are mechanically checkable. The gaps are mainly in D3 (the condition most at risk of being satisfied by empty labels), two internal contradictions between tasks and design, and a few proposal constraints that no task checks.

## Capabilities

The proposal declares no new or modified capabilities and no `specs/` delta. Nothing is lost here. 4.3 (diff scope) incidentally proves no `specs/` or code was added. No task needed.

## D1 to D9 coverage matrix

| Cond | Verifying task(s) | Status |
|---|---|---|
| D1 diff scope | 4.3 | Covered, but conflicts with D1's exception (see M2) |
| D2 table row | 2.1, 4.4, 4.5, 1.1 | Partial: 4.5 checks 3 cells and name words but not "description names the endpoint path" (S1) |
| D3 8.1.1 items a to h | 2.2, 2.3a, 4.6, 4.9 | Weak (see M1) |
| D4 one 8.2 bullet | 2.3, 4.7, 3.1 | Covered |
| D5 test citations | 3.1 to 3.4 | Covered, except "only one test file named in HLA" is never grepped (S2) |
| D6 over-claim sweep | 4.2 | Covered |
| D7 8.3, 8.4, SEC-31 untouched | 4.4 | Covered |
| D8 traceability | 4.8 | Covered, but conflicts with design (d) (M3) |
| D9 sign-off | 6.1 | Covered; timeout split (BA vs Security) correctly follows design |

## Must-fix

**M1. D3 is not actually verifiable item by item.** 4.6 says each of (a) to (h) is "present ... with the minimum content in proposal D3", but that is a human read, not a check, which is the exact failure the proposal's Review resolution says D3's content list was restored to prevent. The minimum content is spread across proposal D3, design "Content additions (a) to (e)", the caveat list, and the (g) and (h) text. Add a checklist task (or expand 4.6) with a concrete present/absent test per item, for example:
- (a) "carve-out" defined at first use; `first_session` occurs exactly once in the added text (`grep -c`); text says locked and unlocked; reachability clause.
- (b) "nothing caller-supplied" or equivalent; "no session, score or reveal data"; the three cannot-dos (unlock, alter an existing active set, touch in-progress `session_topics`); archived-rows clause matches the keep/drop recorded in `pr-notes.md`.
- (c) "including a member of the target team"; #208; "any team".
- (d) exact phrase "the bound is whatever the template holds"; #216; #215/#218 trust-anchor sentence; "degrades onboarding" or the 500 behavior.
- (e) "low", "detective, not preventive", "unmonitored (#131)", "conditional on #208" in one sentence.
- (f) nine caveat bullets from design, counted (the design lists nine; no task counts them).
- (g) exactly one sentence containing `NO_ACTIVE_TOPICS`, `application_admin`, wait/cost, and "pacing, reveal, readiness and outlier behavior".
- (h) each trigger in design present; recovery-speed sentence present. "Exactly as in design.md" is never diffed; add a comparison step.

**M2. 4.3 contradicts D1 and 4.1.** D1 allows changes to `docs/`, the BRD or `requirements/use cases/` "if the contradiction grep names a line". 4.1 allows editing a named contradiction. But 4.3 says the diff may list only the HLA and `openspec/changes/296-*/`. If 4.1 finds a contradiction, 4.3 fails by construction. Add the D1 exception to 4.3 (and note that 4.4's BRD SEC-31 exclusion still holds).

**M3. 4.9 "not 'accepted'" and 2.4/4.8 issue list conflict with required text.**
- 4.9 requires the text to contain "covered by" and not "accepted" for #208. But required D3(a) text says "accepted on locked and unlocked teams", and the proposal's rating basis says "already an accepted trusted role (#208)". A whole-text grep will false-positive, or an implementer will contort the wording. Scope the check to the chained-path sentence, and state that "accepted ... trusted role (#208)" is allowed; the prohibition is on "accepted by the product owner" for the chained path.
- 2.4 and 4.8 restrict issue references to #200, #208, #216, #271, #131, but design item (d) requires naming #215 and #218. Add them to the allowed list so the "plain references only" rule is not violated by the mandated content.

## Should-fix

**S1. D2 path check.** Add to 4.5: the description cell contains `POST /api/v1/teams/:teamId/topics/assign-defaults`, and the controls cell contains only mechanisms recorded as confirmed in task 1.1/1.6 (trace row text to recorded results).

**S2. D5/D8 negative greps missing.** Add a grep over the added text that exactly one `.test.ts` file name appears (`assign-defaults-lock-gate-source.test.ts`) and that the integration test files and the #271 test file are not named. Also grep that the HLA contains no pointer to `pr-notes`, "follow-up", or the unfiled issues, and no persona/first-person voice (stated in 2.2 and the proposal, never verified).

**S3. Evidence trail for section 1.** Only 1.2, 1.4, 1.5, 1.7 say what to record in `pr-notes.md`. 1.1, 1.3, 1.6, 1.8 produce decisions (drop a control, drop "re-read", drop provisioning text, cite #131 as open) with no recorded result. The reviewer of the PR (and the Security merge gate in 6.1) cannot trace text back to a confirmation. Add one line: record each section 1 outcome (confirmed/dropped, with the grep or file) in `pr-notes.md`, and add a final check that the controls cell and wording match those records. Also, `pr-notes.md` is referenced by 1.2, 1.4, 1.5, 1.7, 5.1, 6.1 but no task creates it; add a first task to create it.

**S4. Proposal constraints with no verifying task.**
- "Text must not recommend or imply recovery needs a second approver, ticket or step-up." 4.9 requires the word "step-up" to appear (in the single-admin caveat), so a keyword check cannot distinguish a caveat from a recommendation. Add a human read of every "step-up", "second approver", "approval" hit: each is a stated caveat or reopen trigger, none a recommendation.
- Advisory lock wording ("per-team advisory lock" only; no isolation claim; none about template edit during copy) is a design risk with no check. Add a grep for "isolat" and "advisory" over the added text.
- Terminology ("topic customization lock", "locked team", "zero active topics"): only the human BA check at 6.1. Add a grep for drift terms (for example "frozen", "empty team" as a defined term, "lockout") over the added text before requesting sign-off.
- Rating placement: 4.9 covers it. Good.

**S5. 4.1 grep is too narrow to establish "no contradiction".** The pattern `no bypass|bypass|cannot be (changed|added)|including admin` will miss contradictions phrased as "the lock applies to all roles", "admins cannot edit topics", or in the lock use case itself (the named terminology source, amended in #200). Since a "no contradiction found" outcome is what lets the BA sign off and what leaves D1/D7 intact, broaden to also search `requirements/` for "customization lock", "locked", and "admin" near "topic", and record the files searched (including `requirements/use cases/`).

**S6. Task 1.2 is not wired to the text.** If "archived rows left in place" is kept or dropped, nothing verifies the final HLA text matches the recorded decision (relevant to the topic-history-preservation requirement I care about). Include in the M1 (b) check.

## Minor / housekeeping

- Numbering and order: 2.3a and 4.9 are out of sequence (4.9 sits before 4.8). Renumber so the dependency 4.1 before 6.1 and the checklist order are clear.
- 2.3a duplicates content already specified in 2.1/2.2 ("as listed in design.md"). Fine as a pointer, but it creates two places to tick the same thing; fold it into 2.1/2.2.
- Proposal says "follow-up issue pair" while the same document, design and 5.1 describe three issues. Align the wording (tasks 5.1 is correct).
- 3.x "Record result here when done" has no place to record other than ticking the box; point results to `pr-notes.md` for consistency with section 1.
- 1.5 "documented as expected to be none; not measured by this change" unless a count was taken: good, and consistent with the zero-session/zero-topic concern I raised in discovery. Keep.

## Anything lost in translation?

Preserved well: D6 grep terms (including "safe"), the no-numbers/no-lines/no-URLs rule, the single test file in the HLA, the 8.2 "pins"/"five" wording with landing-day re-check, the stop-and-raise rule on archived rows, Security "not reviewed" handling, and unfiled follow-ups as a non-gate.

Lost or weakened: per-item D3 content (M1), the D1 contradiction-driven exception (M2), the #215/#218 references (M3), the "no recommendation of step-up" constraint, the advisory-lock wording rule, terminology consistency, and "reopen triggers exactly as design" (S4, M1).

Once M1 to M3 are addressed and S1 to S3 are folded in, I consider every D1 to D9 condition verifiable by a task.
