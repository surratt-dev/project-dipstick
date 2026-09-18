## 1. Code fix

- [x] 1.1 In `packages/backend/src/routes/auth.ts`, in the `/auth/callback` handler, change the null-claims branch from `throw new MissingClaimError("sub")` to `throw new MissingClaimError("id_token")`. The `if (!claims.sub) throw new MissingClaimError("sub")` and `if (!claims.iss) throw new MissingClaimError("iss")` branches are unchanged — do not touch them.
- [x] 1.2 Do not modify `mapAuthError` (`packages/backend/src/auth/error-handler.ts`). Confirm it still branches only on `err instanceof MissingClaimError` with no inspection of `err.claim`, and that the user-facing redirect message is unchanged.
- [x] 1.3 In `packages/backend/src/auth/errors.ts`, update the JSDoc comment on `MissingClaimError`'s `claim` field to add `"id_token"` as a third example, distinguishing it from `"sub"`/`"iss"` (it denotes "no claims object at all," not a specific absent claim).

## 2. Test update

- [x] 2.1 In `packages/backend/src/routes/__tests__/auth.test.ts`, locate the test `it("rejects authentication when claims() returns null", ...)` (reference it by this description string, not by line number). Change its assertion from `expect(auditFields.missingClaim).toBeDefined()` to `expect(auditFields.missingClaim).toBe("id_token")`.
- [x] 2.2 Confirm the two sibling tests in the same describe block — `sub` empty string asserting `missingClaim` is `"sub"`, and `iss` empty string asserting `missingClaim` is `"iss"` — are left unchanged. No other test in that describe block is modified.

## 3. Spec sync

- [x] 3.1 Sync the delta at `specs/first-access/spec.md` in this change into `openspec/specs/first-access/spec.md`: the "Missing sub claim" scenario is replaced by "Null claims object" and "Missing or empty sub claim" scenarios (exact text already drafted in the delta file); the "Missing iss claim" scenario is left as-is.
- [x] 3.2 In `openspec/specs/first-access/spec.md`'s `## Open Issues` section, remove the `#7` line (`- **#7** — [Clarity] MissingClaimError("sub") is misleading when the entire claims object is null`).
- [x] 3.3 In `openspec/specs/first-access/spec.md`'s `## Resolved` section, add: `- **#7** — closed (fix-missing-claim-error-precision) — [Clarity] MissingClaimError("sub") is misleading when the entire claims object is null` — matching the existing `#2`/`#3` format exactly. This is bookkeeping (closing out an already-tracked issue), not new requirement content, so it is a direct task-level edit rather than part of the requirements delta — consistent with how `#2`/`#3` were moved to `## Resolved` in the `audit-logger-transport-filtering` change.
- [x] 3.4 Do not touch the `#4` or `#6` lines in `## Open Issues` (or move them to `## Resolved`) as part of this change, even though they are already closed by other changes — that bookkeeping belongs to those changes, not this one.

## 4. Verification

- [x] 4.1 Run the backend test suite (at minimum `packages/backend/src/routes/__tests__/auth.test.ts`) and confirm all tests pass, including the updated assertion.
- [x] 4.2 Confirm no other file in the repository pattern-matches on the literal string `"sub"` as a `missingClaim` value in a way that would be affected by this change (re-run a grep for `missingClaim` outside `node_modules`/`dist` and diff against the exploration's findings).
- [x] 4.3 Confirm `error-handler.ts` has no diff, and that issues `#4` and `#6` are not reopened or referenced by this change's diff.
- [ ] 4.4 When this change ships, include a one-line note in the PR description flagging that any external SIEM/alert rule keyed on the literal `missingClaim` string `"sub"` should be checked, since the null-claims case now emits `"id_token"` instead.
