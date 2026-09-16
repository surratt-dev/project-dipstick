# Architecture Review: tasks.md — `fix-isnewuser-atomic-upsert`

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Scope:** Task ordering and internal consistency of `tasks.md` against the final (post-Stage-3) `design.md` and `proposal.md`. This is not a re-litigation of the design decisions themselves — those are settled — only a check that the task sequencing correctly implements them.

## Verdict

**No reordering required.** The task list is internally consistent, and every dependency I checked resolves in the direction it needs to. The three specific sequencing questions raised all come back clean:

## 1. Task 2.3a sequencing relative to 2.1–2.4

Correct. `2.3a` sits between `2.3` and `2.4`, which is the right slot:

- It depends on `2.1` (the `makeUserRow()` `is_new_user` field) — satisfied, `2.1` precedes it.
- It is explicitly excluded from `2.2`'s "migrate everything mechanically" sweep (`2.2`'s own text carves it out by name), so there's no double-handling or conflicting edit of the same test.
- It is handled as its own task rather than folded into `2.3` (the concurrency test), which is correct — they are different tests with different rewrite shapes (index move + params-shape rewrite vs. call-count + per-call derivation), and design.md treats them as two distinct special cases (Decision 2 and Decision 3's third case) for a reason. Collapsing them into one task would have been the wrong move; keeping them separate but adjacent is right.
- It precedes `2.4`, so the grep safety net runs after this special case has already been fixed by hand, not before.

## 2. Grep/safety-net task (2.4) ordering

Correct — it comes last among the fix tasks, after `2.1`, `2.2`, `2.3`, and `2.3a`, and before `2.5` (full suite run). A grep that ran before the fixes it's meant to verify would be checking nothing; a grep that ran concurrently with `2.3a` specifically would risk exactly the false-negative the proposal calls out (a `calls[1]`-only grep missing `2.3a`'s `calls[2]` reference). Sequencing it last, with the task text itself noting the `calls[2]` blind spot, means the safety net is actually a net at the point it runs, not decoration. `2.5` correctly follows it as the final gate.

## 3. Closeout (Group 4) vs. its dependencies

Correct. `4.1` (close issue #8) is the sole item in Group 4 and sits after Groups 1–3. Closing the issue is a claim that the guardrail condition has been resolved in code, verified in tests, and reflected in the spec — so it must not be able to land ahead of any of those. Nothing in Groups 1–3 references or depends on the issue being closed first, so there's no circular dependency either.

## Other ordering checks (not specifically asked, but part of "no task assumes something unbuilt")

- **1.1 → 1.2 → 1.3 → 1.4**: correct. `1.2`'s destructuring change depends on `1.1`'s `RETURNING` clause existing first. `1.4` (confirm `auth.ts` zero diff) is a verification task and correctly sits last in the group, after all the changes it's verifying didn't leak.
- **Group 1 before Group 2**: correct. The test migration's mock shapes and `makeUserRow()` semantics are dictated by the implementation change; sequencing tests first would mean writing tests against a mechanism that doesn't exist yet.
- **2.1 before 2.2/2.3/2.3a**: correct. All three later test tasks consume the `is_new_user` field `2.1` adds to the helper.
- **Group 2 before Group 3**: no hard dependency either direction (spec prose doesn't require passing tests to be written), but doc updates describing a mechanism as shipped/closed reads better after the mechanism is actually verified. No issue.
- **3.1/3.2/3.3 internal order**: these touch different sections of the same file (requirement deltas, Known Limitations, Open Issues) with no cross-dependency. Order among them is immaterial; no change needed.

## Minor, non-blocking observation

The `2.3a` letter-suffix numbering (vs. renumbering the grep/run-suite tasks to `2.4`/`2.5`→`2.5`/`2.6`) is a little unusual but is the right call here: it makes clear in the task list itself that this test was a late addition slotted into an already-reviewed sequence, which matches its provenance (added in the design review pass, not part of the original mechanical-migration plan). I'd leave it as-is rather than renumber for cosmetic tidiness — renumbering existing tasks mid-review has its own cost (breaks any external references to task IDs) for zero architectural benefit.

## Coverage check against design.md / proposal.md

Cross-referencing the Migration Plan's own summary ("swap the query, update the TS mapping, update tests, update the comment, update the spec, close issue #8") and the Risks section's three mitigations against tasks.md: all six items and all three mitigations map to an explicit task (query swap → 1.1/1.2, comment → 1.3, tests → 2.x, spec → 3.1–3.3, issue closure → 4.1; partial-migration risk → 2.4, concurrency-test-weakening risk → 2.3's explicit assertion requirement, comment/spec drift risk → 1.3/3.2/3.3). Nothing in the design or proposal implies a task that's missing from the list.

No changes requested.
