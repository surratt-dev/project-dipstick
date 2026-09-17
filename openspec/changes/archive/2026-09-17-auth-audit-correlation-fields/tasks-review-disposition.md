# Tasks Review Disposition — auth-audit-correlation-fields

Incorporated by: Marcus Oyelaran (Full Stack Engineer)

## Summary

Both task reviews are addressed:

- **Ingrid Sollenberger (architect):** Approved, no changes requested. Nothing to incorporate here beyond noting the approval stands.
- **Marcus Delgado (BA):** Flagged that proposal.md's AC1 names both `auth.first_access_created` and `auth.role_claim_mapped` as branches requiring cross-event `correlationId` identity coverage, but tasks.md's task 2.2 only tests the `first_access_created` branch. `auth.role_claim_mapped` (auth.ts:242) has zero test coverage today.

## Decision: option (a) — add a task, don't narrow AC1

Marcus Delgado offered two ways to resolve this: extend test coverage to the untested branch, or narrow AC1's wording to disclose the gap as accepted-by-construction. I chose the former.

**Why:** I checked `packages/backend/src/routes/__tests__/auth.test.ts` directly before deciding, specifically to see how much work option (a) would actually cost, since proportionality matters for a change this size.

- There is no existing `role_claim_mapped` fixture to extend — confirmed via grep, matching what Marcus Delgado found.
- But there's a directly analogous test to model it on: `auth.test.ts:408`, "should emit first_access_created with all required fields for new users (Task 21)". That test doesn't use the shared `setupValidCallbackMocks` helper — it inlines its own `mockHandleCallback`/`mockResolveOrCreateAccount`/`mockBuildSessionData` mocks and then greps `mockEmitAuditEvent.mock.calls` for the event it cares about.
- A `role_claim_mapped` test is the same shape: inline mocks with `isNewUser: false` and a non-default `globalRole` (e.g. `"admin"`) on the resolved account, then assert cross-event `correlationId` identity the same way task 2.2 does for the `first_access_created` branch.
- No new test infrastructure, no new mock plumbing, no shared fixture to build from scratch — just one new `it()` block following an established pattern already in the file. This is a small, mechanical addition, not a research task.

Given the cost is genuinely low and proposal.md's own AC1 text already commits to covering both branches, closing the gap is more proportionate than rewriting an already-approved, already-published proposal.md to retroactively disclose a gap that a ~20-minute test addition eliminates entirely. Narrowing AC1 would also weaken the invariant the change exists to establish: if a future refactor of `role_claim_mapped` fat-fingers a fresh `crypto.randomUUID()` call, this closes the only path by which that regression would go undetected (the same risk Marcus Delgado named).

This does not reopen the design-stage disposition (design-review-disposition.md), which correctly declined to touch the `role_claim_mapped` *emit site* — that's still untouched, still out of scope per task 3.2's scope fence. This is purely a test-coverage addition; no production code beyond the three call sites in tasks.md section 1 is touched.

## Change made

Added task **2.2b** to `tasks.md`, directly after 2.2, in the same section (2. Tests):

> Add the equivalent cross-event identity assertion for the other success-path branch AC1 names: a returning user with a non-default `globalRole` (e.g. mock `resolveOrCreateAccount` to resolve `{ isNewUser: false, globalRole: "admin", ... }`), which triggers `auth.role_claim_mapped` (auth.ts:242) instead of `auth.first_access_created`. Model this on the existing "first_access_created for new users" test (auth.test.ts:408) — same inline-mock shape, no shared fixture to extend, since `role_claim_mapped` has no existing test today. Capture `correlationId` from `auth.callback_received`, `auth.session_created`, `auth.success`, and `auth.role_claim_mapped`, and assert `toBe()` identity across all four, same as 2.2.

No other tasks changed. Ordering is unaffected: 2.2b has the same dependency set as 2.2 (Group 1, tasks 1.1–1.3), and Group 2 still fully precedes Group 3 (verification), so Ingrid's dependency-ordering approval is unaffected by this addition.

## Traceability update

GitHub issue #4 → SEC-12 → `auth-error-handling` spec → proposal.md AC1 → tasks.md 1.1–1.3 (full), 2.1 (full), 2.2 (first_access_created branch, full), **2.2b (role_claim_mapped branch, full — new)**, 2.3 (full). AC1 is now fully operationalized for both branches it names; no accepted/disclosed gap remains in the acceptance-criteria-to-task chain.
