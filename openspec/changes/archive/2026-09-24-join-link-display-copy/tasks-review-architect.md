# Architect Task-Sequencing Review — join-link-display-copy

Reviewer: Ingrid Sollenberger (Solution Architect)

## Overall

Dependency chain is sound: hook (§1) → shared URL + live-readiness-view (§2) → draft-control-view (§3) → tests (§4) → verification (§5). No task assumes UI or state that a later section builds. The newer items (stacking guard, unmount cleanup, testid pinning, computed-once URL) are interleaved into their natural sections rather than appended at the end — that's the right shape and I have no reordering to demand.

## Observations

1. **§2.1 (compute-once join URL) is a shared prerequisite housed under a branch-specific heading.** It's not "live-readiness-view" work — it's setup both §2 and §3 depend on (§3.1 explicitly cites "the shared join URL from §2.1"). Ordering is technically correct only because §2 happens to precede §3 in the file; nothing marks it as a cross-section dependency. Given `draft-control-view`'s join-link block already exists today, an implementer skimming for "the smaller, already-half-built piece" could plausibly start with §3 and miss that §2.1 must land first. Low risk since tasks.md is meant to be worked top-to-bottom, but I'd rename §2's heading to something like "2. Shared join URL + live-readiness-view" or pull 2.1 into §1 as "1.13 Compute join URL once in `DraftSessionHost`" — either makes the dependency explicit rather than implicit, which is the failure mode I always flag.

2. **§1.12's "consuming component" has no referent yet.** At the point §1 is executed, no branch in `DraftSessionHost` has been touched (that's §2/§3). The unmount test must therefore use a synthetic test harness/wrapper, not the real page. Worth a one-line clarification in the task so whoever implements it doesn't go looking for `DraftSessionHost` integration at this stage.

3. **Gap, not an ordering defect:** the unmount-cleanup fix (§1.7) is motivated in design.md specifically by "`DraftSessionHost` sits on a real route a Facilitator can navigate away from mid-timer" — but the only test for it (§1.12) is at the isolated-hook level with a synthetic wrapper. Nothing in §4 re-verifies unmount safety against the actual `DraftSessionHost` render. Not blocking for a change this size, but worth naming so it isn't assumed to be covered end-to-end.

4. §4 and §5 are correctly sequenced after both view branches exist (§4 tests reference elements from both §2 and §3; §5.2's manual walkthrough exercises the `draft`→`lobby` transition, which requires both).

## Verdict

No reordering or splitting required to implement safely. Recommend the two small clarifications above (rename/relocate §2.1, clarify §1.12's harness) before implementation starts, to remove the only two places where a dependency is implicit rather than stated.
