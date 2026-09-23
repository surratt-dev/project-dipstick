# Architect Task-Ordering Review — reauth-required-copy-and-visual-signoff

**Reviewer:** Ingrid Sollenberger (Solution Architect persona)
**Scope:** tasks.md's group and task ordering against design.md and proposal.md, checking that no task assumes something not yet built and that the Stage 2/3 revisions (task 1.5, task 4.0, D3/D5) landed coherently.

This is a dependency-ordering review, not a content review — Marcus's engineer review and the earlier security review already cover implementability and correctness. I'm only looking at whether the sequence in which tasks.md asks these tasks to be executed is internally consistent with the dependencies design.md itself establishes.

## Verdict

**One real ordering defect, in Group 1 (task 1.5 vs. task 1.2), that should be fixed before implementation starts.** Group-level dependencies (2/3 on 1, 4 on 2+3, 5 on 2-4, 6 on all) are sound. Task 4.0's gating of 4.1/4.2 is coherent and consistent with D7 and the D4 evidence-citation discipline. No sign-off task can be attempted before Group 1 as a whole is complete — the one exception is the intra-group ordering below, which creates a narrower risk: a self-check inside Group 1 being satisfied by the exact ad hoc method D3 was revised to move away from.

## 1. Task 1.5 vs. task 1.2 — numbering contradicts the execution order design.md assumes

This is a real defect, not a nitpick.

Task 1.2 reads: *"Run the standing automated test added in 1.5 as part of this check."* Task 1.5 is the task that creates that test. In tasks.md's list, 1.2 appears **before** 1.5. Read top-to-bottom — which is the natural reading order for a numbered task list, and the order Group 1's other items (1.3, 1.4) are clearly meant to be read in — an implementer hits 1.2 and is told to run a test that, per the very next un-started items, doesn't exist yet.

Design.md's own D3 confirms this is a real sequencing assumption, not just sloppy task phrasing: *"Group 1's self-check (task 1.2) and Group 2's sign-off (task 2.2) both cite this test's passing result as their evidence, rather than an ad hoc grep performed only at sign-off time."* (design.md D3, line 45). The whole point of the Stage 3 revision that produced task 1.5 was to replace a one-time manual grep with a standing, re-runnable test — specifically so 1.2's self-check and 2.2's sign-off evidence are both citing the *same* mechanical artifact instead of each re-deriving their own. If 1.2 is executed while 1.5 doesn't yet exist, the implementer has exactly two options, both bad: block on 1.2 (correct instinct, but then the list order itself is actively misleading about what's ready to do next), or fall back to a manual grep to satisfy 1.2 "in spirit" — which is precisely the failure mode D3 was revised to close off. A task list that can be honestly satisfied by regressing to the thing the design decision explicitly rejected is a task-ordering defect, not a documentation nit.

**Fix:** reorder Group 1 so the test-creation step precedes the self-check step that depends on it. Concretely, resequence to: 1.1 (icon/register implementation) → [current 1.5's content, renumbered 1.2] (add the standing CI test) → [current 1.2's content, renumbered 1.3] (self-check, running that test) → [current 1.3, renumbered 1.4] (host-parity capture) → [current 1.4, renumbered 1.5] (regression confirm). This preserves every task's content unchanged and only fixes the sequence, so it doesn't require re-opening any decision — it's a pure reordering fix.

Note this doesn't affect Group 2: task 2.2 only requires that 1.5's test exists and passes by the time Group 2 starts, and Group 2's header already gates entry on "Group 1" as a whole being done, not on Group 1's internal task order. The defect is entirely intra-group — it only bites an implementer trying to execute Group 1 sequentially as numbered, which is exactly what a numbered list invites.

## 2. Task 4.0 vs. 4.1/4.2, and consistency with D3/D5

Task 4.0's placement and gating logic are correct.

- The Group 4 header already gates the whole group on Groups 2/3 closing `Signed off` or `Signed off with conditions` *with conditions met*, and explicitly routes a `Withheld` outcome to "skip 4.1–4.2, do only 4.3."
- Task 4.0 sits first within the group and only fires in the conditional sub-case (`Signed off with conditions`), requiring the verification evidence to be recorded *before* 4.1/4.2 execute. That's the right order — it prevents the exact failure mode named in D7 (comments getting updated to claim finality that isn't actually earned) from being satisfiable by treating "conditions met" as self-evident.
- Task 4.0's cited discipline is D4 ("the same evidence-citation discipline the sign-off template already applies elsewhere"), not D3/D5 directly — that's correct as written; D4 is the general evidence-over-assertion rule, D3 and D5 are specific instances of it (the standing test, and the mechanical/felt split). 4.0 doesn't need to re-cite D3/D5 by name because it's general-purpose: if a Group 2/3 condition happens to be D3-shaped (e.g., "signed off with conditions — fix a lingering `transition` property") or D5-shaped (e.g., "signed off with conditions — icon shape read as hourglass-adjacent, swap it"), 4.0's citation examples ("a diff, a re-inspected CSS property, a re-rendered screenshot") already cover both cases without needing separate language per originating decision. I don't see an inconsistency here.
- 4.3's symmetric handling of `Withheld` (explicitly not performing 4.1/4.2, and recording that withholding was intentional rather than an oversight) closes the loop D7 opens. Good.

No reordering needed in Group 4.

## 3. Any sign-off task (Group 2/3) reachable before Group 1 is actually done?

No, at the group level. Both Group 2 and Group 3 headers state an explicit `Depends on: Group 1` (Group 3 additionally depends on the already-shipped prior-change copy, which is a satisfied precondition, not an open one). Nothing in Groups 2 or 3 references a Group 1 task by number in a way that could be misread as "you can start once *that specific* Group 1 task lands" rather than "once Group 1 as a whole lands" — 2.2's citation of 1.5 is evidence-at-time-of-writing, not a partial-start trigger.

The one place this guarantee is *softer* than it looks: task 3.1 says the copy-in-layout artifact uses "the same template as Group 2." Read carelessly, that could be misread as Group 3 needing Group 2's artifact (2.1) to exist first, i.e., an undeclared Group-3-depends-on-Group-2 dependency that contradicts Group 3's own stated dependency line (Group 1 + prior-change copy only). It doesn't actually create that dependency — "the same template" refers to the fixed template design.md D4 already defines, which both groups pull from independently, not to Group 2's output artifact. I'd tighten the wording (e.g., "using the template defined in design.md D4, as Group 2 also does") so a reader executing Group 3 first — which the stated dependencies allow — doesn't second-guess whether they're missing a prerequisite. Wording clarity, not a real blocking dependency; not requiring a re-open of Group 3's ordering.

Groups 5 and 6's dependency lines (5 on 2-4, 6 on all prior groups) are both correct and sufficient as stated — no task within either group references anything not covered by those blanket dependencies.

## Summary

- **Fix required:** Group 1's internal order — task 1.5 (create the standing no-animation test) must execute before task 1.2 (self-check that runs it). As numbered today, the list invites exactly the ad hoc-grep regression D3's Stage 3 revision was written to prevent. Resequence within Group 1; no task content needs to change.
- **No fix required — task 4.0:** correctly gates 4.1/4.2 on conditions-met evidence, consistent with D7 and the general D4 discipline; its non-reference to D3/D5 by name is appropriate since it's a general-purpose gate that covers conditions of either shape.
- **No fix required — Groups 2-6 group-level dependencies:** all sound. One wording-only tightening suggested for task 3.1's "same template as Group 2" phrasing so it isn't misread as an undeclared Group 3 → Group 2 dependency, given Group 3's own header allows it to start independent of Group 2.
