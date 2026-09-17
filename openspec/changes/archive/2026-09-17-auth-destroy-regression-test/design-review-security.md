# Security Review: auth-destroy-regression-test

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Scope reviewed:** design.md, proposal.md, specs/oidc-auth/spec.md (delta)
**Verified against:** `packages/backend/src/routes/auth.ts`, `packages/backend/src/routes/__tests__/auth.test.ts`, `openspec/specs/oidc-auth/spec.md` (current archived spec), `tasks.md`

## Summary

No objection. This change adds test coverage only; it does not alter authentication flow, session handling, data access, or audit logging. I verified the underlying claims against the actual code rather than taking the design's description at face value, and they hold up.

## Verification performed

- Confirmed `auth.ts` (~line 261) calls `request.session.regenerate()` alone on the OIDC callback success path, with no `destroy()` call — matches the design's description.
- Confirmed the logout path (~line 421) still uses `session.destroy()`, correctly out of scope: it is not a fixation-prevention control and is unaffected by this change.
- Confirmed `regenerate()`-alone, without a preceding `destroy()`, is the correct and idiomatic session-fixation defense for express-session/connect-redis. `regenerate()` atomically rotates the session identifier; a separate `destroy()` beforehand is redundant and, as the code comment and this design note, introduces a real hazard if its errors are swallowed (stale session surviving in the store). I have seen this exact failure mode before — an error-swallowing cleanup call masking a session that should have been invalidated. The fix being regression-tested is correct.
- Confirmed the current archived spec (`openspec/specs/oidc-auth/spec.md` line 72–74) still reads "any pre-authentication session is destroyed and a new session is regenerated" — this does contradict actual behavior today, exactly as the proposal states. Documentation that describes a security control incorrectly is itself a finding-worthy gap (an auditor or new engineer reading the spec would believe a `destroy()` call is part of the invariant, and could reintroduce it "for spec compliance"). The delta's corrected THEN clause is accurate and closes that gap.
- Confirmed `buildApp`'s override mechanism and the `mockSave` precedent (~line 813) support the planned `buildApp({ destroy: mockDestroy, regenerate: mockRegenerate })` pattern without new test infrastructure.

## Findings

**No security decisions are deferred or implicit in this design.** The invariant being enforced was already implemented correctly in production code; this change closes a test-coverage gap, not a control gap. I concur with the design's rejection of the negative-only (`destroy` not called) assertion in favor of asserting both halves — the positive half (`regenerate()` called) guards against a silent regression that would be strictly worse than the one the test was originally scoped to catch, since a future refactor that quietly dropped `regenerate()` entirely would reopen the fixation hole with a green test suite under the negative-only design.

**Minor, non-blocking: assertion strength doesn't fully match the new scenario's wording.** The spec delta's new scenario states `regenerate()` is "invoked exactly once," but `tasks.md` (1.2) specifies `expect(mockRegenerate).toHaveBeenCalled()`, which also passes if `regenerate()` fires two or more times. The security-critical property — `destroy()` is never called on this path — is asserted precisely and is unaffected by this gap. A double-invocation of `regenerate()` is not itself a fixation vulnerability (each call still rotates the ID), so I am not blocking on this, but recommend tightening to `toHaveBeenCalledTimes(1)` (or `toHaveBeenCalledOnce()`) so the test matches the scenario text it's supposed to enforce, and a future double-call bug (which would suggest an unexpected mid-request session mutation worth investigating) doesn't pass silently.

**Confirmed no new gap opened.** No new endpoint, no new data path, no change to what's logged or how tokens/sessions are handled. Audit logging for this path (`auth.session_created`, etc.) is untouched and out of scope, correctly.

## Disposition

Approve, with the one non-blocking recommendation above (assertion precision). No re-review needed before merge; happy to confirm the tightened assertion in passing if it's picked up.
