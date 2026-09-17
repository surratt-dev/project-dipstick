# BA Review: tasks.md — auth-destroy-regression-test

**Reviewer:** Marcus Delgado, Business Analyst
**Verdict:** Approve. Tasks fully cover the proposal's capabilities; one item is intentionally absent and should stay that way, but is worth naming explicitly so it isn't mistaken for an oversight.

## Coverage check against proposal.md

| Proposal item | Task coverage |
|---|---|
| Capture `mockDestroy`/`mockRegenerate` via `buildApp({ destroy, regenerate })` | 1.1 — matches `buildApp`'s existing override contract (`packages/backend/src/routes/__tests__/auth.test.ts:83`) exactly |
| Assert `regenerate()` ran (positive half) | 1.2 — `toHaveBeenCalledTimes(1)`, matching design.md's decision to assert exact count, not just "called" |
| Assert `destroy()` did not run (negative half) | 1.2 — `not.toHaveBeenCalled()` |
| No production code changes | 2.2 proves this isn't just an assertion but a real regression guard: temporarily reintroducing `destroy()` must fail the test, then the change is reverted — this is the task list actually testing the test, not just adding it |
| No regression to other tests in the file | 2.3, backed by the existing `vi.clearAllMocks()` isolation |
| Correct the "Session fixation prevention" scenario THEN clause; add the new mechanism-level scenario | **Not in tasks.md** — see note below |

I verified the line references against the current file rather than taking them on faith: the target test starts at line 323 and its closing `});` is at line 371 in `packages/backend/src/routes/__tests__/auth.test.ts` today — task 1.2's "~line 371" anchor is accurate. `auth.ts`'s `regenerate()`-alone call and its explanatory comment are exactly where the proposal says (lines ~252–261).

## Note: spec correction has no corresponding task — correctly so, but flag it

The proposal's "Modified Capabilities" section commits to two spec-level edits, and I confirmed both are already written in `openspec/changes/auth-destroy-regression-test/specs/oidc-auth/spec.md`: the stale "Session fixation prevention" THEN clause is corrected, and the new "uses regenerate() alone, not destroy() plus regenerate()" scenario is present and matches design.md's "exactly once" decision.

Neither edit appears as a task.md item. That's consistent with this project's convention (confirmed against the archived `fix-local-oidc-login` change): the delta spec under the change folder is authored at proposal/design time and synced into `openspec/specs/oidc-auth/spec.md` as a separate step, not as an implementation task. So this is not a gap in tasks.md — the capability isn't lost, it's just fulfilled by an artifact that already exists rather than by a task. I'm calling it out only so whoever runs the sync/archive step doesn't assume the spec correction still needs to be written — it's done, it just needs to be synced.

## Minor observations (non-blocking)

- Task 1.1's "~line 323" refers to the `it(...)` line, not the `buildApp()` call itself (which is at line 327) — harmless given the "~", but a reader scanning for the exact replacement line should know it's two lines down.
- No task explicitly says "confirm `git diff` touches only the test file," even though that's the change's entire risk story. Task 2.2's revert step gets you there implicitly. Optional to add; not required for approval.

## Bottom line

Taken together, tasks 1.1–1.2 and 2.1–2.3 fully build and prove the invariant described in the proposal's "What Changes" section, including the harder-to-spec requirement that the new test actually fails without the fix (2.2) — which is the difference between "added an assertion" and "added a regression test." The one capability without a task (the spec correction) is already satisfied by an existing artifact and picked up downstream, not lost.
