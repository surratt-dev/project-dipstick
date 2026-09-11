# Task Ordering Review — `facilitator-error-states-e2e`

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Scope:** `tasks.md` sequencing and inter-task dependencies only. I wrote `design.md` and the first pass of `tasks.md`; this is a fresh pass checking whether the task list, as sequenced, ever asks an implementer to build something before its prerequisite exists. Design decisions (D1–D7) are not re-opened here.

## Summary

Three of the four items I was asked to check are correctly ordered. One is not: **the audit_log cleanup instruction for Group 4 (task 4.6) is sequenced after the tests that depend on it (4.2, 4.3), inconsistent with how Group 2 handles the identical concern.** I'm also flagging a fifth issue I found while checking these: **task 1.1's file-placement decision asks for information that task 4.1 is the actual source of.** Neither is a design defect — both are tasks.md sequencing choices that can be fixed without touching design.md.

## 1. Task 1.5 (Error State 2 dedicated file) vs. harness setup — correctly ordered

1.5 sits at the end of Section 1, after 1.1–1.4 establish the infra-probe pattern on the main file. It creates the second file and copies the same probe pattern into it, but stops short of the restricted-role mechanics — those are correctly deferred to 3.1, which explicitly says "in the dedicated file created in task 1.5." That's the right split: 1.5 gives 3.1 a file and a working `describe.skipIf` gate to write into; 3.1 doesn't have to also invent the gate. No task before 1.5 assumes the dedicated file exists, and no task before 3.1 assumes the restricted-role logic exists. **No change needed.**

One dependency worth naming explicitly since it isn't currently: 1.5 places the dedicated file "alongside" the main file, whose own location isn't fixed until 1.1 resolves the Open Question. If 1.1's placement is revisited later (see item 5 below), 1.5's "alongside" is only as stable as 1.1's answer. Not a defect in 1.5 — it inherits 1.1's risk.

## 2. audit_log cleanup (2.1 / 4.6) — covered, but inconsistently sequenced

Checking every task group that triggers `reveal`/`topics/advance`/`complete` (the three actions design.md D4 identifies as writing real `audit_log` rows):

- **Group 2** (reveal, advance): 2.1 states the cleanup rule — "every `finally` block for a test in this group that calls `reveal` or `topics/advance` must explicitly `DELETE`..." — *before* 2.2–2.6, the tests it governs. An implementer reading the group in order sees the rule before writing the first test's `finally` block. Correct order.
- **Group 3** (GET-only content endpoints): 3.1's own step 5 explicitly notes no audit cleanup is needed here because the test only calls `GET`. 3.2/3.3 are also GET-only and don't write audit rows. Correctly excluded, correctly explained inline. No gap.
- **Group 4** (advance wrap-up-entry, complete): the cleanup rule is stated in **4.6**, which appears *after* 4.2 and 4.3 — the two tests that actually need it — and after 4.4 and 4.5 as well. 4.2 and 4.3's own task text say nothing about audit cleanup; nothing in Group 4 tells an implementer working through 4.2 first that its `finally` block needs an `audit_log` delete until they reach 4.6, three items later.

Content-wise, every group that writes audit rows is covered somewhere in the file. But Group 4's sequencing means an implementer following the list top-to-bottom will write 4.2's and 4.3's `finally` blocks without the cleanup requirement in front of them, then have to go back and retrofit both once they reach 4.6. That's exactly the "task assumes something not yet established" pattern I'm checking for, just inverted — here a later task supplies a constraint an earlier task needed at write-time.

**Recommendation:** Move 4.6's content to immediately follow 4.1 (harness reuse) and precede 4.2, mirroring 2.1's position relative to its group. Alternatively, fold the cleanup instruction directly into 4.1 as an explicit callout, since 4.1 already establishes the shared subscriber-harness setup both 4.2 and 4.3 build on. Either fix is a reorder/merge, not new content — the sentence in 4.6 doesn't need to change, only its position.

## 3. Task 4.3's participant-subscriber note — correctly placed

The caveat ("this is not a literal repeat of 4.2's subscriber setup... must register a participant subscriber instead") lives inside 4.3 itself, as the task's own instruction, not in a later task or a footnote after 4.3. Nothing between 4.1 and 4.3 tells an implementer to reuse 4.2's facilitator-subscriber setup verbatim for the `/complete` case — 4.2 scopes its own facilitator-subscriber instruction to "this variant" — so there's no earlier task an implementer would follow down the wrong path before reaching 4.3's warning. The note arrives before the implementer would write the wrong code, not after. **No change needed.**

## 4. Additional finding: task 1.1's placement decision precedes its own evidence

Design.md's Open Question frames the main file's placement as resolved "based on which existing helpers... end up doing more of the work for the Error State 3 assertion" — that evidence is what task 4.1 (WS-subscriber harness reuse) produces. But task 1.1 asks for the placement decision — and file creation — as the very first task in the list, before Groups 2–4 exist in any form. This is a schedule inversion baked into tasks.md's translation of the open question: the task that most informs the decision (4.1) runs last among the relevant groups, while the task that needs the answer (1.1) runs first.

In practice this is a low-cost risk — moving a test file after the fact is cheap, and Groups 2–3's tests don't care which directory they live in as long as imports resolve. But tasks.md currently gives no signal that 1.1's decision is provisional or names any checkpoint to revisit it. An implementer who locks in `routes/__tests__/` at 1.1, then discovers at 4.1 that `realtime/__tests__/`'s neighbors would have saved real duplication, has no task telling them that's an expected, acceptable outcome rather than a mistake to have avoided.

**Recommendation:** Either (a) add a one-line checkpoint task at the start of Group 4 — "confirm the Section 1 placement decision still holds now that the WS-subscriber harness needs are known; move the file if not" — so the possibility is named rather than silently absorbed, or (b) sequence a brief look at `ws-pubsub-integration.test.ts`'s harness shape before 1.1 is finalized, rather than after all of Groups 2–3 are already written into a location that might move. I'd lean toward (a): it's cheaper and matches this change's existing bias (per D2) against over-engineering a two-call-site decision.

## Verdict

Items 1 and 3 (the ones most likely to have caused a real build-order violation) check out — nothing in this task list asks an implementer to write against a mechanism that isn't built yet in either of those two spots. Item 2 is a real sequencing defect, cheap to fix (reorder, don't rewrite). Item 4 is a softer risk inherited from the design's own open question, worth a one-line mitigation but not a blocker. I'd want 4.6 moved before signing off on task ordering; item 4's checkpoint is a strong recommendation, not a blocker.
