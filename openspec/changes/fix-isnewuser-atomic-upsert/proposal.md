## Why

Issue #8 was filed as a guardrail, not a defect: `resolveOrCreateAccount`'s `isNewUser` flag is derived from a SELECT executed before the upsert, so two concurrent authentication callbacks for the same brand-new identity can both observe zero rows and both report `isNewUser = true`. The upsert itself is correct — exactly one account row is ever created — only the derived flag can be wrong. The guardrail's condition was explicit: fix this before any feature that consumes `isNewUser` and triggers a non-idempotent side effect is merged. No such feature exists yet, and none is proposed here.

A guardrail that lives only in a code comment and two archived review documents survives exactly as long as every future engineer who touches this file remembers to go read them. That is institutional memory standing in for a structural constraint, and this codebase already has the fix pattern proven and shipped: `packages/backend/src/routes/teams.ts` (TEAM-006) derives an equivalent flag from `xmax` on its own upsert's `RETURNING` clause rather than a prior SELECT. Applying the same idiom to `account-resolver.ts` closes the class of bug entirely — it becomes structurally unrepresentable rather than merely documented. That is the case for doing this on its own terms: no future engineer needs to remember a comment, and no future PR reviewer needs to catch a violation, because the race the guardrail warns about can no longer occur.

## What Changes

- Replace the SELECT-then-upsert pattern in `resolveOrCreateAccount` (`packages/backend/src/auth/account-resolver.ts`) with a single upsert whose `RETURNING` clause includes `(xmax = 0) AS is_new_user`, mirroring the already-reviewed TEAM-006 pattern in `teams.ts`. The separate pre-upsert SELECT is deleted; `isNewUser` is sourced from the upsert's own result row.
- Rewrite the "handles simulated concurrent first access" test in `account-resolver.test.ts` so it proves the race is closed (each call's `isNewUser` is derived independently from what the DB says that call inserted or updated), not merely that fewer queries run.
- Update the remaining ~12 test cases in `account-resolver.test.ts` for the single-query mock shape, and extend the `makeUserRow()` helper with an `is_new_user` field.
- Replace the stale "HARD CONSTRAINT" comment block in `account-resolver.ts` with a short comment documenting the `xmax` idiom actually used, in the style of `teams.ts`.
- Update `openspec/specs/first-access/spec.md` in both places the race is documented: the Known Limitations entry and the Open Issues entry for #8.
- Close issue #8 as part of landing this change.

**Not in scope:** no schema change (the `users_oidc_unique` constraint already exists and is the ON CONFLICT target already in use), no new `isNewUser` consumer, no change to `ResolvedUser`'s public shape, no change to either existing consumer of the flag (`auth.first_access_created`, `auth.success`'s `isFirstAccess`), and no transaction wrapping (unlike TEAM-006, there is no second write this needs to stay atomic with).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `first-access`: The mechanism by which `isNewUser` is derived changes from a SELECT-before-upsert (with a documented concurrency race) to a single upsert with `xmax`-derived flag (race-free). This changes the "Automatic account creation on first authentication" and "Concurrent First Access handling" requirement text (both currently describe and caveat the SELECT-based mechanism). Separately, and outside the requirement delta itself, the Known Limitations entry and Open Issues line for #8 are removed as direct prose edits to `openspec/specs/first-access/spec.md`, tracked in tasks.md 3.2/3.3. No change to any consumer's interface or the audit event schema — `ResolvedUser`'s shape and both existing `isNewUser` consumers are untouched — though the race scenario's duplicate-firing behavior (today, both racing callbacks can emit `auth.first_access_created`) is eliminated by design: post-fix, exactly one racing callback observes `isNewUser = true` and emits the event. That is the fix's intended effect, not a side effect, and is called out explicitly rather than folded into a blanket no-behavior-change claim.

## Impact

- **Code:** `packages/backend/src/auth/account-resolver.ts` (mechanism swap, comment replacement) and `packages/backend/src/auth/__tests__/account-resolver.test.ts` (full pass — mock shape change touches nearly every test, one test rewritten to prove the new guarantee).
- **Callers:** None. `packages/backend/src/routes/auth.ts` is unchanged — `ResolvedUser`'s shape is identical, and both existing consumers of `isNewUser` are untouched. A non-empty diff to `auth.ts` would indicate scope creep.
- **Database:** No migration. No new dependency.
- **Docs:** `openspec/specs/first-access/spec.md` (Known Limitations and Open Issues sections) reflects the closed race.
- **Tracking:** Issue #8 closed on merge.
