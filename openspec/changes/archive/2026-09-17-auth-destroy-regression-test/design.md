## Context

`packages/backend/src/routes/auth.ts` (OIDC callback success path, ~line 261) calls `await request.session.regenerate();` alone, deliberately, to fix a session fixation bug: the prior `destroy()` + `regenerate()` pattern silently swallowed Redis errors inside `destroy()`, leaving a stale session live. This is documented in a code comment, but nothing executable enforces it. `openspec/specs/oidc-auth/spec.md`'s "Session fixation prevention" scenario had gone stale and still described the pre-fix `destroy()`+`regenerate()` pattern, contradicting current behavior — this change corrects that scenario's THEN clause in addition to adding the new mechanism-level scenario. `packages/backend/src/routes/__tests__/auth.test.ts` already mocks both `destroy` and `regenerate` on every session (`buildApp`, line 93) but the happy-path sign-in test at line 323 never captures or asserts on either mock.

## Goals / Non-Goals

**Goals:**
- Make the `regenerate()`-alone invariant test-enforced, so a future edit that reintroduces `destroy()` on this path, or removes `regenerate()`, fails a test instead of merging silently.
- Reuse the existing `buildApp(sessionOverrides)` override mechanism and the `mockSave`-style capture pattern already established in the same file (line ~813), rather than introducing a new test-authoring convention.

**Non-Goals:**
- No production code changes — `auth.ts` is already correct.
- No new test file, no new `describe` block, no new fixtures — the assertion is added to the existing happy-path test.
- No coverage of the logout flow's `destroy()` call (line ~421) — that call is correct and out of scope; this change only guards the post-auth callback path.

## Decisions

**Decision: assert both halves of the invariant, not just the negative half.**

The original ask (and the architect's original recommendation) was `expect(mockDestroy).not.toHaveBeenCalled()` alone. Exploration surfaced a gap in that: asserting only "destroy was not called" leaves the positive half of the invariant — "regenerate was called" — unguarded. A future change that deleted the `regenerate()` call entirely (arguably the worse regression, since it would silently reopen the exact session-fixation hole the original fix closed) would still pass a destroy-only test.

Alternative considered: ship the negative-only assertion now (matches the letter of the original architect recommendation and the GitHub issue) and file a follow-up for the positive half. Rejected — the whole point of this change is converting a comment-only invariant into a test-enforced one; shipping half the guard costs nothing extra to complete now (one extra line) and would otherwise look done while leaving a real gap.

**Decision: assert `regenerate()` was called exactly once, not merely called.**

Security review flagged that the spec scenario states `regenerate()` is "invoked exactly once," but a bare `toHaveBeenCalled()` assertion would also pass on 2+ calls, understating what the scenario claims to enforce. A double-invocation isn't itself a fixation vulnerability (each call still rotates the ID), but it would indicate an unexpected mid-request session mutation worth investigating, and a test claiming to enforce "exactly once" should actually fail if that's violated. Tightened to `expect(mockRegenerate).toHaveBeenCalledTimes(1)` so the test matches its own scenario text.

**Decision: extend the existing happy-path test rather than add a new one.**

The "should complete sign-in flow and redirect to team page for user with memberships" test (line 323) already exercises the full account-resolution and session-establishment path that this invariant lives in. Adding a second test would duplicate setup for no benefit. This follows the same precedent as the `mockSave` capture at line ~813, which extends an existing test rather than forking a new one.

## Risks / Trade-offs

- **[Risk] Mock capture could mask a real behavioral difference if `buildApp`'s override wiring changes later.** → Mitigation: none needed beyond normal test maintenance; this mirrors the existing `mockSave` pattern, so any future change to `buildApp`'s override contract will already need to touch this style of test.
- **[Trade-off] Only the happy-path callback test gets the assertion, not every test that exercises the callback.** → Acceptable: this is the canonical "successful sign-in" test; other callback tests (error paths, missing claims, etc.) don't reach the `regenerate()` call and asserting there would be spurious.
