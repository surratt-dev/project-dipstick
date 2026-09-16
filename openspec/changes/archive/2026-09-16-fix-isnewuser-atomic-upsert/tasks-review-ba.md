# Business Analyst Review — tasks.md (fix-isnewuser-atomic-upsert)

**Reviewer:** Marcus Delgado, Senior Business Analyst
**Scope:** `tasks.md` checked against the revised `proposal.md` and `design.md` for coverage, translation fidelity, and the two specific re-verification points raised: the audit-event behavior wording, and the 2.3a / closeout revisions.

## Verdict: Approved

The tasks, taken together, cover every capability the proposal commits to. I traced each proposal bullet and each design decision to a task and found no gap and no drift.

## Coverage check (proposal → tasks)

- Replace SELECT-then-upsert with single upsert + `xmax`-derived flag → 1.1, 1.2 (line numbers 123-129 and the `RETURNING` clause both verified current against `account-resolver.ts`)
- Rewrite the concurrency test to prove derivation, not call count → 2.3, matches design.md Decision 2's required assertion shape
- Update the ~12 remaining tests for single-query mock shape, extend `makeUserRow()` → 2.1, 2.2
- Replace stale "HARD CONSTRAINT" comment → 1.3 (correctly scoped shorter than `teams.ts`'s block, since no partial-index or atomicity note applies here)
- Confirm zero diff to `auth.ts` → 1.4
- Update `first-access/spec.md` (Known Limitations, Open Issues, and the two MODIFIED requirements) → 3.1, 3.2, 3.3
- Close issue #8 → 4.1

Nothing in the proposal's "What Changes" or "Impact" sections is unaccounted for, and nothing in tasks.md introduces work the proposal didn't ask for.

## Re-verification 1: audit-event behavior wording in the race scenario

Proposal.md's Modified Capabilities section now states explicitly that the race scenario's duplicate-firing behavior is *eliminated by design* — "post-fix, exactly one racing callback observes `isNewUser = true` and emits the event... called out explicitly rather than folded into a blanket no-behavior-change claim." I confirmed the blanket claim is gone from proposal.md (grepped for it — the phrase now only appears in design.md, referencing "the corresponding proposal.md wording").

Tasks.md does not need a standalone task to capture this, and I don't think one is missing: the requirement-level carrier for this behavior is the spec delta itself, not a test or a prose aside. The delta's "Concurrent First Access handling" requirement text — which task 3.1 applies verbatim to the live spec — already states "at most one of the two racing callbacks can observe `isNewUser = true` for a given identity." The existing (unchanged) Security Properties note in the live spec, "This event is emitted only when `user.isNewUser` is true," was already correct before this change and remains correct after — the frequency change is a downstream consequence of the `isNewUser` guarantee, not a separate factual claim that needs its own edit. Task 3.1's scope (the two named requirements only) is consistent with the proposal's own Impact section, which names only Known Limitations and Open Issues as the doc touch points beyond the requirement deltas.

Task 2.3's test rewrite doesn't need to assert on `auth.first_access_created` emission — that event is emitted by the caller in `auth.ts`, which is explicitly out of scope (task 1.4, design.md Non-Goals). Testing `isNewUser` derivation at the `account-resolver.ts` level is the correct and sufficient boundary; asserting event emission here would be testing a different unit than this test file owns.

**Conclusion: no task update needed here.** The wording is carried correctly and completely.

## Re-verification 2: task 2.3a and the closeout task for issue #8

**2.3a** matches design.md Decision 3's third special case exactly: the AC-2 test's two assertions move from `calls[0]`/`calls[2]` to `calls[0]`/`calls[1]`, and the content changes from 2-element SELECT params to the corresponding slice of the 5-element upsert params. I checked the live test file (`account-resolver.test.ts:122-154`) — the current assertions are indeed `mockQuery.mock.calls[0]` and `mockQuery.mock.calls[2]` checking `[sub, iss]`, so 2.3a's before-state description is accurate, and its after-state matches design.md word for word. Task 2.4's grep instruction correctly calls out that a plain `calls[1]` search would miss 2.3a's `calls[2]` reference — this is the right kind of explicit guardrail given Marcus O.'s design-review concern about this test being silently mishandled as a mechanical bump.

**Closeout (4.1)** now reads as a concrete commitment either way: close via `Closes #8` if the repo uses that convention, or add a *named-owner* manual post-merge closure step if it doesn't. Both branches result in an actual closure action — the task explicitly forecloses the failure mode of "leaving the closure unstated," which is the right instinct for something Marcus (BA) would otherwise have to chase down after the fact as an orphaned tracking item. This satisfies proposal.md's "Close issue #8 as part of landing this change" and the Impact section's "Issue #8 closed on merge" without depending on an assumption about this repo's PR/commit conventions that tasks.md can't verify for itself.

## Minor observations (non-blocking)

- Task 1.3's instruction to keep the new comment shorter than the 19-line block it replaces is a good concrete acceptance bar rather than a vague "keep it brief" — I'd flag it as a positive pattern worth repeating in future task lists, not a defect here.
- I did not find any requirement or scenario in the proposal that lacks a corresponding task, nor any task that implies functionality the proposal doesn't describe. Traceability from requirement to task holds in both directions.

No changes requested.
