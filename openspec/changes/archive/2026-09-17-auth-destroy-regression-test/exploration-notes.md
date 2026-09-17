# Exploration Notes: GitHub Issue #6 — Missing regression test for session.destroy() removal

**Explored by:** Devon Calloway (Internal Champion / Principal Software Engineer persona)
**Date:** 2026-09-17

## What the issue actually is

This is a test-durability gap, not a live defect. The `first-access` change (archived at
`openspec/changes/archive/2026-07-05-first-access/`) fixed a session fixation bug by replacing
`session.destroy()` + `session.regenerate()` with `session.regenerate()` alone in the OIDC
callback success path. The old pattern was unsafe because a Redis error inside `destroy()` was
silently swallowed (see the comment at `packages/backend/src/routes/auth.ts` around line 252-261
— "Task 3: Session fixation prevention via regenerate() alone"), leaving a stale session in the
store while a new one was created.

The implementation is correct today. I confirmed the single `await request.session.regenerate();`
call at line 261, with no preceding `destroy()` in that code path. `session.destroy()` is still
called elsewhere in the file (line 421, inside the logout flow) — that's expected and correct;
it's a different route with a different purpose (explicit logout, not post-auth session
establishment).

The architect's implementation review (`implementation-review-architect.md`, Finding 3 and the
"`regenerate()` called alone" check) flagged exactly this gap when the change was reviewed and
recommended `expect(sessionMock.destroy).not.toHaveBeenCalled()` in a successful callback test.
That recommendation was never actioned — this issue is the follow-through.

## Confirmed in the test file

`packages/backend/src/routes/__tests__/auth.test.ts`:
- `buildApp(sessionOverrides: Record<string, unknown> = {})` (line 83) takes the overrides as its
  sole positional argument and wires `destroy: vi.fn(...)` into every session mock (line 93), but
  the reference is discarded — no callback test captures it the way the "resolveOrCreateAccount
  throws" test does with `const mockSave = vi.fn(...); const app = await buildApp({ save: mockSave });`
  (line 813-814). That's the precedent to copy verbatim, with `destroy` in place of `save`.
- The clear target happy-path test is "should complete sign-in flow and redirect to team page for
  user with memberships" (line 323) — it already exercises full account resolution, session
  creation, and audit events for a successful login. Adding a captured `destroy` mock and
  asserting it's never called fits naturally here without inventing a new test.
- The fix per the issue, stated as literal code rather than description:

  Replace line 327:
  ```ts
  const app = await buildApp();
  ```
  with:
  ```ts
  const mockDestroy = vi.fn();
  const app = await buildApp({ destroy: mockDestroy });
  ```

  Then, immediately before the test's closing `});` at line 371 — after the existing
  `successCall![2]` sourceIp/correlationId `toMatchObject` assertions — add:
  ```ts
  expect(mockDestroy).not.toHaveBeenCalled();
  ```

  Mock name is settled: `mockDestroy`, matching the `mockSave` precedent. No synonyms.

## Devon's read on this

From my seat, this is a narrow, well-scoped fix and I don't see any of the load-bearing ritual
constraints I usually watch for in play here — no-manager participation, facilitator-from-another-
team, simultaneous reveal, topic-guardrails. This code isn't part of the Health Check ritual
mechanics at all; it's plumbing (OIDC callback session handling) that sits underneath the whole
application. So most of my usual concerns don't apply, and I'll say that plainly rather than
manufacture a connection that isn't there.

The one place my usual instincts *do* transfer, even though it's a different domain: this is
exactly the pattern I worry about elsewhere — a correct, deliberate fix to a security-relevant
behavior with no structural guardrail keeping it correct. The architect already did the hard part
(diagnosing the fixation bug, writing the fix, documenting the invariant in a code comment). What's
missing is the one thing that survives a careless future merge: an assertion, not a comment. A
comment is read by someone who already knows to look. A failing test is read by someone who
doesn't. This is the same principle behind why I want the no-manager rule structural rather than
configurable — comments and conventions degrade under time and turnover; tests don't (as long as
someone doesn't delete them, which is a much louder, more reviewable act than quietly reintroducing
a line of code during a merge).

I'd also note this is a good instance of "the requirements documentation should be thorough enough
that the team doesn't need me" — the architect's review already spelled out the exact assertion to
add and where. There's nothing here that needs my judgment call; it needs someone to type the line.

## Decision: assert `regenerate()` was called, not just that `destroy()` wasn't

The BA's review caught a real gap, and it's exactly the kind of gap my own "comment vs. assertion"
argument above should have caught me: the invariant the architect's fix establishes is "regenerate()
alone" — both that regenerate happens *and* that destroy doesn't. The target test today asserts
neither half. My original recommendation only added the negative half
(`destroy` not called), which leaves the positive half unguarded — a future change that deleted
`regenerate()` entirely (arguably the worse regression, since it would silently reopen the session
fixation hole the original fix closed) would still pass.

Deciding explicitly rather than letting this get silently dropped at the tasks stage: **add both
assertions.** Capture a `mockRegenerate` the same way as `mockDestroy` (override it via `buildApp`),
and add:
```ts
expect(mockRegenerate).toHaveBeenCalled();
expect(mockDestroy).not.toHaveBeenCalled();
```
before the closing `});` at line 371. Asserting only the negative half is a half-guarded invariant,
and a half-guarded invariant is the same failure mode I don't tolerate elsewhere in this project —
a rule that looks enforced but has a gap nobody will notice until something walks through it. The
whole point of this issue is to convert a comment-only invariant into a test-enforced one; enforcing
only half of it would defeat that purpose while looking done. The extra line costs nothing and
closes the gap completely.

## Facilitator review — addressed

Priya's review (facilitator persona) raised no objections and confirmed no ritual-constraint
concerns apply to this change — correctly: this is HTTP session-lifecycle plumbing, not Health
Check ritual mechanics (no reveal simultaneity, no facilitator control surface, nothing a
participant would ever perceive). Nothing to change in response; noting it here so the review
trail shows it was read and agreed with, not skipped.

## Recommendation

Proceed as scoped in the issue, with the BA's precision fixes and the regenerate() decision above
folded in:

1. Replace `const app = await buildApp();` (line 327) with a `mockDestroy` (and, per the decision
   above, `mockRegenerate`) passed via `buildApp({ destroy: mockDestroy, regenerate: mockRegenerate })`.
2. Immediately before the closing `});` at line 371, add:
   ```ts
   expect(mockRegenerate).toHaveBeenCalled();
   expect(mockDestroy).not.toHaveBeenCalled();
   ```
3. No other tests or files change. `beforeEach` already calls `vi.clearAllMocks()` and each test
   builds a fresh app, so this override is isolated to the one test.

No design changes, no spec deltas, no new architectural review needed — this is a same-day,
low-risk addition. I don't have concerns that would slow this down.
