## Architecture Review — Task Ordering — Ingrid Sollenberger (Solution Architect)

**Scope of this review:** task sequencing and dependency validity in `tasks.md` only. I want to flag up front that this change carries no architectural surface for me to review substantively — no new boundary, no change to the auth model, the realtime layer, or the Redis/PostgreSQL split. `design.md` says as much, and I agree: this is test-only, and I have no opinion on the domain content of the assertions themselves. What follows is purely "does the task list build on things that exist, in an order that could actually be executed."

### Primary ask: does verification come last with nothing depending on it?

Yes. Task group 4 (4.1 full-suite run, 4.2 zero-production-diff confirmation, 4.3 issue reference) is correctly sequenced after groups 1–3, and nothing in groups 1–3 depends on group 4 having run first. Specifically:

- 4.1 (full suite green, including the three new tests) can only succeed once 1.1, 2.1, and 3.1 exist — correct dependency direction.
- 4.2 (no production-file diff) is a backstop for task 1.2's manual revert step (see below) — it belongs after, not before, that revert.
- 4.3 (issue reference) presupposes a PR exists to reference — inherently last.

No earlier task assumes 4.x has happened. Ordering is sound.

### Finding: task group 2 is missing the regression-verification step that group 1 has

Task 1.2 does something the others don't: it proves the new assertion is actually load-bearing, by temporarily breaking the predicate it's supposed to protect, confirming the new test fails, and reverting. That's the only thing in this task list that empirically demonstrates the assertion would catch a future accidental removal — everything else is "the text is present," which is necessary but not sufficient to show the test *fails when it should*.

Task group 2 (draft-session `removed_at IS NULL` predicate) has no equivalent. 2.2 confirms the `.find()` predicate uniquely isolates the right query call — a different and narrower claim (correct targeting, not regression sensitivity). Nothing in group 2 comments out `AND tm.removed_at IS NULL` in `facilitator-sessions.ts`, reruns, confirms failure, and reverts.

This is the same category of guarantee `design.md`'s Risks/Trade-offs section accepts as a known limitation of query-text assertions generally — but 1.2 is precisely the mitigation the task list applies to close that gap for one predicate and not the other. Since both predicates are described in the proposal as equally security-sensitive (this is the load-bearing cross-team constraint), I'd expect the same mitigation applied symmetrically.

**Recommendation:** add a task 2.3, mirroring 1.2's shape: temporarily remove `AND tm.removed_at IS NULL` from the draft-session actor query in `facilitator-sessions.ts`, confirm test 2.1 fails, revert, confirm reverted. This is additive and doesn't require reordering anything else — it slots in before group 4 like 1.2 does.

### Minor: 2.2 reads as implementation rationale embedded in the checklist, not a separate action

1.1/1.2 and 3.1's steps are each things an engineer *does*. 2.2, by contrast, is mostly justification ("confirm it uniquely isolates... no other query in this describe block's mocked sequences contains...") for a predicate choice that's really part of implementing 2.1. It isn't wrong to keep it as its own checkbox, but I'd flag it as a candidate for folding into 2.1 rather than standing alone — it doesn't depend on 2.1 finishing first, nor does anything depend on it finishing before 2.1; the two are really one unit of work split for narration purposes. Not a sequencing defect, just a granularity note.

### Groups 1–3 relative to each other

Groups 1, 2, and 3 touch independent `describe` blocks in the same file and don't depend on each other's output — they could be done in any relative order, or in parallel by different engineers, with no risk. Group 3's own task (3.1) correctly establishes its own `beforeEach(() => vi.clearAllMocks())` before asserting on `mockDbQuery.mock.calls`, consistent with the file's existing convention, so it isn't exposed to ordering-dependent mock pollution from whichever block runs before it. No issue there.

3.2 (verify the spec scenario matches the test's behavior exactly) is correctly sequenced after 3.1 — you need the test's actual asserted behavior in hand before you can verify a scenario "matches it exactly."

### Summary

| Check | Result |
|---|---|
| Verification (group 4) comes last | Yes |
| Nothing earlier depends on group 4 | Yes |
| Groups 1–3 depend only on things already built (PR #153) | Yes |
| Internal ordering within each group is buildable | Yes |
| Symmetric rigor across groups 1 and 2 | **No — recommend adding task 2.3** |

No blocking issues. One recommended addition (2.3) before this is ready to implement; everything else is sequenced correctly.
