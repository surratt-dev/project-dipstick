# BA Review: auth-destroy-regression-test

**Reviewer:** Marcus Delgado, Business Analyst
**Documents reviewed:** proposal.md, design.md, tasks.md, specs/oidc-auth/spec.md (this change); cross-checked against openspec/specs/oidc-auth/spec.md (main) and requirements/use cases/01 - Identity and Access - Use Cases.md

## Verdict

Tasks are buildable as written — genuinely some of the most explicit tasks I've reviewed (exact line numbers, exact variable names, exact assertions). But the spec delta has a real problem: it doesn't just add a scenario, it silently leaves the spec self-contradictory. That needs to be fixed before this merges, not filed as a follow-up.

## Finding 1 (Blocking): The "unchanged" existing scenario contradicts the new one

Proposal.md states: *"No existing requirement text or scenario changes — this is additive only."* That's not quite true in effect, even though no bytes of the existing scenario are touched.

Existing scenario (unchanged, `specs/oidc-auth/spec.md` lines 18-20):
> **WHEN** the OIDC callback creates an authenticated session
> **THEN** any pre-authentication session **is destroyed** and a new session is regenerated before populating user data

New scenario (this change, lines 22-24):
> **WHEN** the OIDC callback completes a successful authentication and establishes a new session
> **THEN** the session store's `regenerate()` operation is invoked exactly once on that path, and the session store's `destroy()` operation **is not invoked** on that path

These two WHEN clauses describe the same trigger (OIDC callback → authenticated session established). The THEN clauses directly contradict each other: one requires `destroy()` to run, the other forbids it. A reader hitting both scenarios in the same requirement has no way to know which one governs current behavior — and an implementer using the spec as a build reference (which is the whole point of it being executable/explicit rather than a comment) could legitimately re-add `destroy()` to satisfy the *first* scenario, which is exactly the regression this change exists to prevent.

This also means the proposal's Why section overstates the current state: it says the invariant is "documented today... in the oidc-auth spec's 'Session fixation prevention' scenario," but that scenario documents the *opposite* — the pre-fix `destroy()`+`regenerate()` pattern. This scenario appears to have gone stale when `first-access` was archived (2026-07-05) and was never updated to reflect the fix it describes. This change is the right place to fix it, since it's already touching this exact requirement.

**Recommended fix:** Update the existing "Session fixation prevention" scenario's THEN clause so it no longer asserts `destroy()` runs. Something like:

> **THEN** any pre-authentication session state is invalidated by regenerating the session identifier before populating user data, without relying on a separate destroy operation

This keeps the scenario's intent (fixation prevention) while removing the factual conflict, and lets the new scenario serve as the precise, mechanism-level companion. Framing both as strictly additive is what let this slip — worth calling out for future spec-delta reviews: "doesn't change existing scenario text" isn't the same test as "doesn't conflict with existing scenario text."

## Finding 2 (Non-blocking): Capability/AC specificity is otherwise strong

- tasks.md 1.1/1.2 name exact variables, exact call sites, and exact assertions (`expect(mockRegenerate).toHaveBeenCalled()`, `expect(mockDestroy).not.toHaveBeenCalled()`). No ambiguity for an implementer.
- design.md's "Decisions" section explicitly considered and rejected the weaker (negative-only) assertion, with a stated reason. That's the kind of traceable rationale I want to see — no need to come back and ask "why both halves?"
- tasks.md 2.2 (temporarily reintroduce `destroy()`, confirm the test fails, then revert) is a good practice but is unusually informal for an executable spec — it's a manual verification step with no artifact. Suggest noting in tasks.md that this is a one-time author verification, not a CI step, so nobody expects it to be automated later.

## Finding 3: No conflict with requirements/ use cases

Checked `requirements/use cases/01 - Identity and Access - Use Cases.md` (Sign In, Sign Out, Session Expiry) and `requirements/design/redis-session-model.md`. Neither specifies `destroy()`/`regenerate()` mechanics — the Sign In use case explicitly defers protocol-level session mechanics as "an implementation concern," which is consistent with keeping this level of detail in `oidc-auth` spec rather than in the use cases. No duplication, no conflict. (Note: these requirements docs are for a different application domain than this OIDC session-fixation fix touches operationally, but the Identity & Access use case is the right point of comparison and is silent on this mechanism by design — not a gap.)

## Recommendation

Before approval: amend the existing "Session fixation prevention" scenario's THEN clause per Finding 1. Everything else — capability scope, task specificity, verification plan — is ready to build against as-is.
