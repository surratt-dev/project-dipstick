# BA Review — Proposal Stage (reauth-required-copy-and-visual-signoff)

**Reviewer:** Marcus Delgado (BA persona), Stage 2 review
**Verified against:** proposal.md, design.md, tasks.md, specs/websocket-staleness-signal/spec.md (delta), exploration-notes.md, my own Stage 1 review (explore-review-ba.md), the archived main spec at `openspec/specs/websocket-staleness-signal/spec.md`.

**Bottom line:** this is buildable as written. All three items I raised at Stage 1 carried through faithfully — none got lost, softened, or half-applied. The #142/#143 exclusion is airtight across all four artifacts; I could not find a task, decision, or spec line that implicitly leans on the live usability test. The spec delta's SHALL text is verified byte-identical to the archived baseline. One real gap remains (task 4's "conditions met" trigger is underspecified) and one small precision note on the diagram framing. Neither blocks implementation.

---

## 1. Did D5 (mechanical/felt split) and D4 (fixed sign-off template) carry through faithfully from my Stage 1 review?

**Yes, both — cleanly, with attribution.**

- **D4 item split (design.md D5):** My Stage 1 review asked for D4's checklist item 4 to be split into "4a. No 'error'/'!' literal (mechanical)" and "4b. Reads as assertive-but-not-alarming (felt, deferred to sign-off)." design.md's D5 does exactly this, using nearly my own language, and explicitly carries the split forward into the sign-off artifacts themselves ("#141's sign-off evaluates the felt half explicitly... rather than letting a checklist row imply a felt call was already made"). tasks.md task 3.3 operationalizes it as a required, separated section. Nothing was lost.
- **Fixed sign-off template (design.md D4):** My Stage 1 review asked for a concrete, ordered template so "produce an honest verdict" wasn't left to be re-invented per run. design.md's D4 adopts the five-part structure verbatim from exploration §3a (which itself incorporated my suggestion): per-bound verdict with cited evidence → no-animation constraint cited not asserted → separated felt-judgment section → one of three closing verdict strings → unparaphrased standing disclaimer. tasks.md tasks 2.1–2.6 and 3.1–3.6 implement this template item-for-item, in the same order, for both #140 and #141. Nothing was lost or reordered.

One thing I'll note as a faithful *extension* rather than a drift: design.md's D6 (host-pairing) and D8 (status-narration-only spec updates) weren't things I asked for at Stage 1 — they came from Priya's review and from the exploration itself — but they're consistent with, not in tension with, the rigor I was pushing for. No concern there.

## 2. Is the #142/#143 exclusion airtight across all four artifacts?

**Yes.** I checked each artifact specifically for language that could be read as requiring, assuming, or partially satisfying the live usability test:

- **proposal.md:** states the exclusion in its own paragraph ("Explicitly out of scope... Neither is attempted here, simulated, or partially satisfied by the sign-off artifacts above. A clean #140/#141-equivalent pass is not evidence toward #142 and must not be read as such by any later stage.") — unambiguous.
- **design.md:** Non-Goals section names #142/#143 first, with the same "not attempted, simulated, or partially satisfied" language, and D4's risk table ("A clean #140/#141 pass is not evidence toward #142") reinforces it a second time in Risks/Trade-offs. No task group, Decision, or Migration Plan line references #142 as a dependency or precondition for anything in this change's own scope.
- **tasks.md:** the scope note at the top of the file states the exclusion before any task group begins. I checked every group (1 through 6) for an implicit lean on #142 — none exists. Group 6's "Regression Confirmation" is purely about existing test suites (digit-pattern, host-parity, ARIA, persistence, CTA), not usability. Group 5's spec sync depends only on Groups 2–4.
- **spec delta:** the new second scenario states plainly that the `reauth-required` live usability test "remains open unconditionally, is not satisfiable by any static or simulated review, and is not predicted by a positive mock/copy-in-layout sign-off outcome." This is the strongest of the four statements and matches the other three.

No artifact treats a clean #140/#141 pass as evidence toward #142, and no task requires #142 to be attempted, referenced, or waited on. This holds.

## 3. Are tasks.md's task groups concrete enough to execute without further judgment calls?

**Mostly yes. Group 4's condition has one soft edge worth naming before implementation starts.**

Task 4's header reads: "Depends on: Groups 2 and 3 both closing as `Signed off` or `Signed off with conditions` with conditions met. If either is `Withheld`, skip 4.1–4.2 and do only 4.3."

The `Signed off` branch and the `Withheld` branch are unambiguous. The `Signed off with conditions` branch is not fully specified: the task says cleanup proceeds once conditions are "met," but no task in Group 2, 3, or 4 says who verifies that a stated condition has actually been met, or when. If Group 2 closes as "Signed off with conditions — icon must be swapped for X" and the implementer swaps the icon, there's no explicit re-check step before Group 4 treats the condition as satisfied and proceeds to comment cleanup. In practice this is probably self-evident to whoever executes the run (the same agent that reads the condition, makes the fix, and then proceeds), but "self-evident to the executor" is exactly the kind of implicit judgment call my persona exists to flag before it becomes a scope dispute later. This mirrors — in miniature — the same discipline design.md D8 and tasks.md 5.1 already apply to the spec-status text ("don't presuppose the outcome, verify it").

**Suggested concrete fix:** add one line to task 4 (or a 4.0) stating explicitly: "If either Group 2 or Group 3 closed 'Signed off with conditions,' record in this task's completion note how each stated condition was verified met (cite the specific change made) before proceeding to 4.1/4.2." This costs one line and closes the only place in the task list where "conditions met" is asserted rather than checked — the same standard D4's evidence-citation rule already applies everywhere else in this document.

Every other group is concrete: Group 1's acceptance criteria are checkable (renders through both hosts, no animation, tests green); Group 2/3 inherit the fixed template's explicit verdict vocabulary; Group 5 and 6 have clear, narrow dependencies and no open judgment calls.

## 4. Does the spec delta's normative SHALL text stay unchanged as claimed?

**Confirmed, verified by direct text comparison against the archived baseline, not just by the proposal's own claim.**

I diffed the delta against `openspec/specs/websocket-staleness-signal/spec.md` (the current archived spec) line-by-line for both SHALL-bearing statements:

- The requirement's own normative sentence ("This capability SHALL NOT be used for a real pilot team's first live session until all of the following are complete: ... This capability MAY be deployed to a non-pilot or staging environment before this gate closes.") is byte-identical between baseline (line 297) and delta (line 5).
- The first scenario's THEN clause ("the session SHALL NOT proceed with this capability enabled unless the `unknown-reconnecting` copy sign-off, the grid-marker visual-register mock sign-off, the `reauth-required` copy sign-off, the `reauth-required` visual-register mock sign-off, and both usability tests are all complete") is byte-identical between baseline (line 306) and delta (line 14).

What changed is exactly what the proposal claims: the "Current status" descriptive paragraph (rewritten to describe this change's outcome instead of `reauth-required-client-prompt`'s), and the second scenario (retitled and rewritten from "The gate is partially, not fully, closed as of the initial build" to "The gate remains open pending the live usability tests..."). Neither the old nor the new version of that second scenario contains a SHALL/SHALL NOT clause — both are status narration, consistent with how this requirement's second scenario has always functioned. The proposal's claim holds exactly as stated: normative bar unchanged, only descriptive status narration delta'd.

One thing worth flagging as a strength, not a gap: the new status paragraph deliberately avoids asserting an outcome in advance ("this note is not restated here as a fixed verdict because a withheld or conditional outcome is treated as an equally valid result"), and tasks.md 5.1 explicitly requires re-verifying this text against Groups 2–3's *actual* final verdicts before archive. That closes the loop D8 sets up — the delta as written is a template for the true outcome, not a presupposed clean pass, and there's a task that enforces the check.

## 5. Minor precision note (not blocking)

exploration-notes.md §3's ASCII diagram and proposal.md's framing both describe #142/#143 as sitting cleanly "below the line" from #137–#141. That's accurate for *this pipeline run's* scope, but issue #136's own body tracks #142/#143 as part of its overall scope (I confirmed this independently at Stage 1 via `gh issue view`). Neither proposal.md nor design.md restates my Stage 1 suggested rewrite ("out of scope for this pipeline run, not for issue #136 overall") verbatim — the substance is preserved (Impact section: "does not unlock a real pilot session by itself — #142 still stands"), but a reader skimming only the "What Changes" header could still momentarily read "explicitly out of scope" as "not tracked anywhere." Not worth a task; flagging for awareness only, since the fuller Impact-section language already resolves it for anyone who reads past the header.

## Summary for implementation

Nothing here blocks moving forward. One concrete addition worth making before or during Group 4's execution:

1. Add an explicit verification step to task 4 (or a new 4.0) for the "Signed off with conditions" branch — cite how each condition was actually met before proceeding to comment cleanup, rather than treating "conditions met" as self-evident.

Everything else — the D4/D5 carryover, the #142/#143 boundary, the SHALL-text stability, and every other task group's concreteness — checks out against source, not just against the artifacts' own claims about themselves.
