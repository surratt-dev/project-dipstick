## 1. Implementation

- [ ] 1.1 In `packages/backend/src/auth/account-resolver.ts`, delete the pre-upsert SELECT (lines 123-129) and add `(xmax = 0) AS is_new_user` to the upsert's `RETURNING` clause, per design.md Decision 1
- [ ] 1.2 Update the `row` destructuring and `ResolvedUser` construction to source `isNewUser` from `row.is_new_user` instead of the removed local boolean
- [ ] 1.3 Replace the stale "HARD CONSTRAINT" comment block (lines 104-122) with a short comment documenting the `xmax` idiom actually used, in the style of `teams.ts:746-766` — do not leave the old comment in place describing a race that no longer exists; this comment covers less ground than `teams.ts`'s (no partial-index requirement, no atomicity note) so it should be shorter than the 19-line block it replaces, not matched to it in length
- [ ] 1.4 Confirm `packages/backend/src/routes/auth.ts` has zero diff — `ResolvedUser`'s public shape is unchanged and neither `auth.first_access_created` nor `auth.success`'s `isFirstAccess` field is touched; a non-empty diff here means scope has crept

## 2. Test Suite Migration

- [ ] 2.1 Extend the `makeUserRow()` helper (`account-resolver.test.ts:22-39`) with an `is_new_user` field
- [ ] 2.2 Migrate all existing test cases (except the concurrency test, handled in 2.3, and the two-invocation test, handled in 2.3a) from the two-call mock shape (`mockResolvedValueOnce` SELECT + upsert) to a single mocked upsert call; update any `mockQuery.mock.calls[1]` index reference to `calls[0]`
- [ ] 2.3 Rewrite "handles simulated concurrent first access" to mock two independent single-query upsert calls — one returning `is_new_user: true`, the other `is_new_user: false` — and assert `mockQuery` is called exactly 2 times (not 4); the assertion must show each call's `isNewUser` tracking its own mocked `is_new_user` value, proving derivation from the DB response rather than merely a reduced call count (design.md Decision 2)
- [ ] 2.3a Rewrite `"creates separate accounts for two identities with the same email but different sub values (AC-2)"` (`account-resolver.test.ts:122-154`) — this test calls `resolveOrCreateAccount` twice per `it()` and is not a mechanical index bump (design.md Decision 3, third special case). Move the two assertions from `mockQuery.mock.calls[0]`/`calls[2]` to `calls[0]`/`calls[1]`, and rewrite their content from 2-element SELECT params (`[sub, iss]`) to the corresponding slice of the 5-element upsert params (`sub, iss, displayName, email, globalRole`) — do not leave the assertion checking SELECT-shaped data against the new upsert call
- [ ] 2.4 Grep the test file for any remaining `mockQuery.mock.calls[1]` (or higher) index reference, or any `it()` block still queuing more than one `mockResolvedValueOnce` per `resolveOrCreateAccount` invocation; confirm none remain — a plain `calls[1]` grep alone will not catch 2.3a's `calls[2]` reference
- [ ] 2.5 Run the full `account-resolver.test.ts` suite and confirm all tests pass

## 3. Documentation

- [ ] 3.1 Apply the MODIFIED requirements in `specs/first-access/spec.md` (this change) to `openspec/specs/first-access/spec.md` — "Automatic account creation on first authentication" and "Concurrent First Access handling"
- [ ] 3.2 Replace the Known Limitations entry in `openspec/specs/first-access/spec.md` (currently describing the SELECT-before-upsert race) with a short closed-status note naming this change and the `xmax`-derived mechanism
- [ ] 3.3 Remove the Open Issues line for `#8 — [Architecture] isNewUser SELECT-before-upsert race` in `openspec/specs/first-access/spec.md` — no Resolved/Closed list exists in that section and this change does not introduce one

## 4. Closeout

- [ ] 4.1 Close GitHub issue #8 via a closing keyword (`Closes #8`) in the PR description or commit message; if this repo does not use that convention, add a named-owner manual "close #8 post-merge" step instead — leaving the closure unstated is not acceptable
