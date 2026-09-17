# Architect Review: tasks.md — auth-destroy-regression-test

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Verdict:** No architectural concerns. Ordering is sound; no task assumes unbuilt infrastructure.

## Dependency check

Verified against current repo state (not just the design doc's claims):

- `buildApp(sessionOverrides)` in `auth.test.ts` (line 83) already accepts an override object, and the default session's `destroy`/`regenerate` mocks (lines 93–94) are spread *before* `...sessionOverrides`, so overrides correctly win. Task 1.1's `buildApp({ destroy: mockDestroy, regenerate: mockRegenerate })` works against the mechanism as it exists today — nothing to build first.
- `auth.ts`'s callback success path already calls `regenerate()` alone (no `destroy()`), matching the invariant the test is meant to enforce. This is a test-only change; there is no "add the behavior, then add the task" ordering risk because the behavior predates the task.
- The `mockSave` capture precedent (test at ~line 813) that task 1 is modeled on already exists in the file.

Since every mechanism the tasks lean on is already present, sequencing within this change reduces to test-authoring order, not architectural dependency order.

## Task ordering

1. **Section 1 before Section 2** — correct. You can't run or red/green-verify an assertion that doesn't exist yet.
2. **Within Section 2: 2.1 (confirm green) → 2.2 (break it, confirm red, revert) → 2.3 (confirm no collateral regression)** — correct order. Verifying the test passes before deliberately breaking production code to check it fails is the right sequence to avoid confusing a pre-existing failure with the intended one.
3. No task should be split or reordered further; this is a two-line test change with a bounded verification loop, not a multi-component effort.

## Scope note (not a defect)

The spec delta (`specs/oidc-auth/spec.md`) correcting the stale "Session fixation prevention" scenario and adding the new mechanism-level scenario is already written as a design artifact and isn't a tasks.md line item. That's consistent with this project's OpenSpec convention — spec deltas are authored during proposal/design, not as an implementation task — and is outside my ordering concern here (no code depends on the spec text; the spec documents behavior the code already has).

## Out of scope for this review

No real-time layer, no auth provider abstraction change, no data store boundary, no deployment surface — this change touches one test file only. None of my standing review criteria (OIDC provider-agnosticism, session-state authority, access control enforcement, Redis/Postgres boundary, observability, deployment reproducibility) are implicated.
