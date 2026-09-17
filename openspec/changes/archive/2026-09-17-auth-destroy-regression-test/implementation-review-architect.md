# Implementation Review — Solution Architect

**Reviewer:** Ingrid Sollenberger
**Change:** auth-destroy-regression-test
**Date:** 2026-09-17

## Scope confirmed

- `git diff main -- packages/backend/src/routes/auth.ts` is empty. No production code changed, as the design requires.
- `git diff main -- packages/backend/src/routes/__tests__/auth.test.ts` is exactly the two hunks the design and tasks describe: mock capture (`mockDestroy`, `mockRegenerate`) passed through `buildApp`'s existing override mechanism, and two assertions appended to the existing happy-path test. Nothing else in the test file moved.
- The delta spec (`openspec/changes/auth-destroy-regression-test/specs/oidc-auth/spec.md`) corrects the stale "Session fixation prevention" THEN clause and adds the new mechanism-level scenario, matching the design's stated non-additive change to that requirement.

## Design conformance

This is architecturally unremarkable in the best sense: a documented invariant (code comment) is converted into an enforced one (test assertion), with zero new surface area. That's the right shape for this kind of gap — no new test file, no new fixture, no new convention. It reuses the `buildApp(sessionOverrides)` seam and the `mockSave`-capture precedent already established in the same file, so a future reader sees one idiom for "assert on a session-store call" instead of two competing ones. Boundary discipline is respected: the test does not reach into `auth.ts` internals, only observes behavior through the same mock surface every other test in the file uses.

The decision to assert both halves of the invariant (`regenerate` called once, `destroy` not called) rather than the negative half alone is correct and matches the spec's "exactly once" language precisely instead of a looser `toHaveBeenCalled()`. This closes the actual gap (a deleted `regenerate()` call would previously have passed) rather than a partial one that would look done while leaving the more serious regression unguarded.

Spec correction is the right move independent of this test: an executable check and a stale spec scenario that contradict each other is worse than either alone, since it leaves no ground truth for the next person to trust.

## Timeout-vs-clean-failure question

Verdict: **acceptable to merge as-is, but worth a one-line tightening before or shortly after merge — not a blocker.**

The regression-catching property holds: a future reintroduction of `destroy()` on this path still fails the test, full stop. That satisfies the change's actual goal. But the *mechanism* by which it fails here is an artifact of how the override was written, not an inherent property of the invariant being tested, and it's cheap to fix.

`buildApp`'s default session stub is `destroy: vi.fn((cb?: () => void) => cb?.())` — it always invokes its callback. This test's override, `const mockDestroy = vi.fn();`, drops that behavior and never invokes the callback argument. Production's logout path (`auth.ts` ~line 417) calls `destroy` in exactly the callback-wrapped-in-a-never-rejecting-Promise style: `await new Promise<void>((resolve) => { request.session.destroy(() => resolve()); })`. If a future regression reintroduced that same call shape on the callback success path (the realistic way `destroy()` would come back — copy-pasted from the logout path, not invented fresh), the awaited promise would hang forever, and only vitest's global test timeout would terminate it. That's what the implementer saw manually.

Two things follow from that:
1. This is a test-mock artifact, not a production risk — the real Redis-backed session store's `destroy()` does invoke its callback, so this failure mode only exists inside this test's own fixture, and only when destroy is called via the promise-wrapping pattern.
2. It's avoidable at no cost to the assertion's precision. Giving `mockDestroy` the same callback-invoking shape as the default stub — `vi.fn((cb?: () => void) => cb?.())` — preserves everything the test needs (call tracking for `not.toHaveBeenCalled()`) while ensuring any wrapping promise resolves immediately. The test would then fail on the assertion itself, synchronously and diagnostically, instead of via a 5-second CI stall with a generic timeout message.

Recommendation: change `const mockDestroy = vi.fn();` to `const mockDestroy = vi.fn((cb?: () => void) => cb?.());` in the test. This is a one-line, test-only tweak with no design or spec implications — I'd take it as a fast-follow if the team wants to ship this change now, but there's no reason not to fold it in before merge since it's already understood and touches the same line.

## Verdict

Approve. No architectural concerns — boundaries, patterns, and scope all match the design. One low-cost suggested tightening to the mock (above) for a cleaner CI failure signal; not a merge blocker.
