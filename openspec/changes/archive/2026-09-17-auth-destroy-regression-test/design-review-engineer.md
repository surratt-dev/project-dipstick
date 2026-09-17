# Engineer Design Review — auth-destroy-regression-test

**Reviewer:** Marcus Oyelaran, Full Stack Engineer
**Verdict:** Approve. Implementable as written, no changes requested.

## Verification against actual code

I checked every concrete claim in design.md/tasks.md against the live files rather than taking them on faith:

- `auth.ts:261` — confirmed `await request.session.regenerate();` runs alone, with the exact comment (lines 252-260) the design quotes. `destroy()` only appears in the logout handler (line 421), matching the stated non-goal.
- `auth.test.ts:83-104` — `buildApp(sessionOverrides)` spreads `sessionOverrides` last, so passing `{ destroy: mockDestroy, regenerate: mockRegenerate }` cleanly overrides the default `destroy`/`regenerate` fakes. No other test in the file passes overrides for these two keys (only `save` at line 814, `userId` at 1330/1431/1440/1457) — zero collision risk.
- `auth.test.ts:323-371` — the target test's closing brace is exactly where task 1.2 says it is. `mockSave`-style capture at line 813-814 is a real, applicable precedent.
- `beforeEach` (line 148-150) calls `vi.clearAllMocks()`, so the override is correctly scoped to the one test as tasks.md 2.3 claims.
- Spec delta file already reflects the corrected "Session fixation prevention" scenario plus the new mechanism-level scenario, matching main spec's current (stale) text at `openspec/specs/oidc-auth/spec.md:72-74`.

## Technical soundness

- `mockRegenerate = vi.fn()` (no implementation) is fine under `await request.session.regenerate()` — awaiting a plain `undefined` return resolves immediately. No need for `mockResolvedValue`.
- `mockDestroy` is never invoked on this path regardless of its implementation, so a bare `vi.fn()` (not the callback-invoking form the default fake uses) is safe here — it's only ever asserted `not.toHaveBeenCalled()`.
- Assertion placement (after the existing `successCall![2]` block, before the closing `});`) doesn't interact with any prior assertion in the test — pure addition.

## On the "assert both halves" decision

Agreed and correctly scoped. A destroy-only assertion would leave the regression this fix actually guards against (silent removal of `regenerate()`) uncaught. This costs one extra line and is squarely inside "test what the invariant means," not scope creep.

## Boundaries / coupling

None. This is a single-file test change with no production code touched, no new fixtures, no new describe block. The only future coupling risk — noted in design.md's own risk section — is `buildApp`'s override contract changing shape, which would already force a review of every override-based test in the file, not just this one. No action needed now.

## Nothing missing

I looked for gaps the design might have missed and didn't find any:
- No other test exercises the regenerate/destroy invariant that would need the same treatment (error-path tests don't reach line 261, confirmed by reading the callback's try/catch structure).
- No CI/tooling change needed — this is a plain addition to an existing Vitest suite already running in CI.
- Task 2.2's manual regression check (temporarily reintroduce `destroy()`, confirm test fails, revert) is good practice and costs nothing; I'd actually do this myself before considering the task done.

No blocking or non-blocking findings. Ready for implementation as specified in tasks.md.
