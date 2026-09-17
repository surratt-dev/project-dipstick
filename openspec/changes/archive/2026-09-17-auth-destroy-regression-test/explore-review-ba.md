# BA Review: Exploration Notes — auth-destroy-regression-test (Issue #6)

**Reviewer:** Marcus Delgado (Business Analyst)
**Date:** 2026-09-17
**Reviewing:** `openspec/changes/auth-destroy-regression-test/exploration-notes.md`

## Overall

Close to buildable as-is. I read the target file directly (`packages/backend/src/routes/__tests__/auth.test.ts`) rather than taking the notes' description on faith, per my usual habit — the notes hold up on substance, but three points need tightening before this goes into a tasks list, and one gap in the proposed assertion is worth a deliberate decision rather than a silent omission.

This is backend session-handling plumbing, not Health Check ritual behavior — none of my usual load-bearing concerns (simultaneous reveal, facilitator control surface, outlier thresholds, action item continuity, topic history) apply here. Devon's notes say this plainly rather than manufacturing a connection, and I agree with that read.

## Clarifications needed

1. **`buildApp` mechanics are correct but loosely phrased.** Confirmed at `auth.test.ts:83`: `buildApp(sessionOverrides: Record<string, unknown> = {})` takes the overrides object as its sole positional argument — there's no nested `sessionOverrides:` key to set. The precedent at lines 813–814 (`resolveOrCreateAccount throws` test) is the right pattern to copy verbatim: `const mockSave = vi.fn(...); const app = await buildApp({ save: mockSave });`. The exploration notes describe this accurately but in prose ("captures it via `sessionOverrides`") that could read as if `sessionOverrides` were a key rather than the parameter name. **Rewrite:** the tasks entry should show the literal code to write, not a description of the mechanism.

2. **Insertion point is underspecified.** Notes say add the assertion "after the response assertions" — not precise enough to hand off. I read the full target test (lines 323–371): the last existing assertion is the `successCall![2]` `toMatchObject` block ending at line 370, then the test closes at line 371. **Rewrite:** "Insert `expect(mockDestroy).not.toHaveBeenCalled();` immediately before the test's closing `});` at line 371, after the existing sourceIp/correlationId assertions."

3. **Missing the positive half of the invariant.** I read the target test in full — it does not currently assert that `session.regenerate()` was called at all. The architect's original fix and comment describe the invariant as "regenerate() alone," i.e., regenerate happens *and* destroy doesn't. Asserting only `destroy` was not called leaves a gap: a future change that removed `regenerate()` too (a different, worse regression) would still pass this test. This needs an explicit decision, not a silent choice either way — recommend the proposal state:
   - `expect(mockRegenerate).toHaveBeenCalled();` (new capture of the default `regenerate` mock, or override it the same way as `destroy`)
   - `expect(mockDestroy).not.toHaveBeenCalled();`
   and record in tasks.md whether both were added or only the second, and why.

## Vague areas

- **"or an equivalently named captured mock"** (Recommendation section) — pick one name and use it. `mockDestroy`, matching the `mockSave` precedent at line 813, is the obvious choice. Leaving synonym room in a one-line fix invites needless back-and-forth in review.
- **"No design changes, no spec deltas... needed"** — agreed on substance, but tasks.md should still name the exact file, test, and expected diff size (one captured mock + one or two assertion lines) so a reviewer can confirm scope didn't creep without re-reading the exploration doc.

## Suggested acceptance criteria (Given/When/Then)

**Given** the OIDC callback success path (`GET /auth/callback`) for a returning user with team memberships — existing test: "should complete sign-in flow and redirect to team page for user with memberships" (`auth.test.ts:323`)
**When** the callback completes and the response is returned
**Then**
- `session.regenerate()` was called
- `session.destroy()` was NOT called

## Suggested implementation steps

1. Replace `const app = await buildApp();` (line 327) with:
   ```ts
   const mockDestroy = vi.fn();
   const app = await buildApp({ destroy: mockDestroy });
   ```
2. Immediately before the test's closing `});` (currently line 371), add:
   ```ts
   expect(mockDestroy).not.toHaveBeenCalled();
   ```
3. Decide (per Clarification 3) whether to also capture and assert `regenerate` was called, for symmetry with the "regenerate() alone" invariant. If deferred, note the reason in tasks.md rather than dropping it silently.
4. No other tests or files change. Run the full `auth.test.ts` suite — `beforeEach` already calls `vi.clearAllMocks()` and each test builds a fresh app, so this override is isolated to the one test.

## Not in scope for this review

Ritual-mechanics concerns don't apply to this change; no action needed on that front.
