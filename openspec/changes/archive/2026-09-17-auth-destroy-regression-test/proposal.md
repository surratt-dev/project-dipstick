# Proposal: Auth Destroy Regression Test

**Change:** auth-destroy-regression-test
**Author:** Devon Calloway, Internal Champion
**Date:** 2026-09-17
**Status:** Proposed

---

## Why

The session fixation fix in `first-access` (archived 2026-07-05) replaced `session.destroy()` followed by `session.regenerate()` with `session.regenerate()` alone in the OIDC callback success path, because a Redis error inside `destroy()` was silently swallowed and could leave a stale session live in the store. The invariant this fix depends on — `regenerate()` runs, `destroy()` does not — is documented today only in a code comment (`packages/backend/src/routes/auth.ts` lines 252–261). The `oidc-auth` spec's "Session fixation prevention" scenario still described the pre-fix `destroy()`+`regenerate()` pattern — it went stale when `first-access` was archived and was never updated to reflect the fix it describes, so the spec itself contradicted current behavior. Nothing executable enforced the correct invariant.

The architect's implementation review for `first-access` (Finding 3) flagged this exact gap and recommended a test asserting `destroy` is not called on the successful callback path. That recommendation was never actioned. GitHub issue #6 is the follow-through: a comment can be read by someone who already knows to look; a failing test is read by someone who doesn't. Without the test, a future refactor of the callback (or a well-intentioned "cleanup" re-adding `destroy()`) can silently reopen the session fixation hole with nothing to catch it.

## What Changes

- Add two assertions to the existing "should complete sign-in flow and redirect to team page for user with memberships" test in `packages/backend/src/routes/__tests__/auth.test.ts`:
  - `mockRegenerate` was called (the fix's positive half — `regenerate()` still runs).
  - `mockDestroy` was not called (the fix's negative half — `destroy()` does not reappear on this path).
- Capture both mocks via `buildApp({ destroy: mockDestroy, regenerate: mockRegenerate })`, following the existing `mockSave` capture precedent already used elsewhere in the same file.
- No production code changes. `packages/backend/src/routes/auth.ts` already implements the correct behavior; this change closes a test-coverage gap only.
- Correct the existing "Session fixation prevention" scenario in the `oidc-auth` spec, whose THEN clause still described the pre-fix `destroy()`+`regenerate()` pattern and contradicted current behavior (and the new scenario below). The correction preserves the scenario's intent (fixation prevention) without asserting a `destroy()` call that no longer happens.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `oidc-auth`: Corrects the existing "Session fixation prevention" scenario's THEN clause, which had gone stale and still asserted the pre-fix `destroy()`+`regenerate()` behavior, and adds one new scenario to the same "Session cookie management" requirement making the `regenerate()`-alone / no-`destroy()` invariant an explicit, independently testable scenario at the mechanism level. This is not purely additive: the existing scenario's text changes to remove a factual conflict with current behavior, in addition to the new scenario being added.

## Impact

- **Test file only:** `packages/backend/src/routes/__tests__/auth.test.ts`.
- **No affected APIs, schemas, or dependencies.**
- **Risk:** Effectively none — this is an additive assertion in an existing, isolated test (`beforeEach` already calls `vi.clearAllMocks()`, and each test builds a fresh app via `buildApp`).
- **Regression value:** Converts a comment-only invariant into a test-enforced one. A future change that reintroduces `session.destroy()` on this path, or removes `session.regenerate()`, will fail this test instead of passing silently.
