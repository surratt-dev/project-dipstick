# Design Review — Full Stack Engineer (Marcus Oyelaran)

## Verdict: Approve, with one correction to tasks.md before implementation starts

This is implementable as written, the boundaries are clean, and the core technical claim — that this mirrors TEAM-006 — checks out against the actual code, not just the description of it. I have one real gap to flag in the test-migration plan (Decision 3 / Task 2.2) that will bite whoever implements this if it isn't called out explicitly, plus two minor wording notes. Nothing here should block moving to implementation once tasks.md is tightened.

## What I verified against the actual code

**The `xmax` idiom is copied correctly, not just referenced.** I read `teams.ts:746-766` directly. The pattern is `RETURNING id, (xmax = 0) AS is_new_row` inside an `INSERT ... ON CONFLICT ... DO UPDATE`. Design.md's Decision 1 proposes the identical shape (`RETURNING ..., (xmax = 0) AS is_new_user`) against `account-resolver.ts`'s own upsert. This is a faithful reuse of a reviewed pattern, not a superficial resemblance — same idiom, same mechanism, applied to a structurally identical upsert.

**The ON CONFLICT target is real and matches.** `users_oidc_unique UNIQUE (oidc_subject, oidc_issuer)` exists as a plain table-level constraint in `packages/backend/migrations/2_create_tables.sql:13`. The design's ON CONFLICT clause targets exactly this. No schema change is needed, confirming the Non-Goals section.

**The "no transaction needed" call is correct.** TEAM-006 wraps its upsert in `BEGIN`/`COMMIT` because it has a second write (the paired `audit_log` INSERT) that must be atomic with the membership write. `resolveOrCreateAccount` has no second write — `auth.first_access_created` is a structured log emitted by the caller (`routes/auth.ts:162-163`), not a DB write. `xmax` is evaluated server-side within the single statement's own snapshot, so it needs no transaction wrapper here. Design.md's Non-Goals section states this correctly and I'd have flagged it if it had reached for a transaction it doesn't need — it didn't.

**The "zero diff to auth.ts" claim holds.** I grepped `routes/auth.ts` for every `isNewUser` touchpoint: line 162 (`if (user.isNewUser)` gating `auth.first_access_created`) and line 224 (`isFirstAccess: user.isNewUser`). Both consume the boolean value only — neither depends on how it's derived. `ResolvedUser`'s shape is untouched by this change. Task 1.4's "confirm zero diff" gate is a real, checkable claim, not aspirational.

**No hidden coupling elsewhere in the test suite.** I checked the two other files that reference `resolveOrCreateAccount`:
- `routes/__tests__/auth.test.ts` mocks the entire `auth/account-resolver.js` module at the boundary (`vi.mock("../../auth/account-resolver.js", () => ({ resolveOrCreateAccount: ... }))`, line 44-46) — it never touches `db.query` for this path, so it's fully insulated from the internal SQL shape change.
- `routes/__tests__/e2e-verification.test.ts` doesn't exercise this path at all (its own comment at line 88 notes the IdP-claim → `resolveOrCreateAccount` mechanism is tested elsewhere).

So the impact statement in proposal.md ("Callers: None... A non-empty diff to `auth.ts` would indicate scope creep") is accurate, and the test-migration scope really is confined to `account-resolver.test.ts` as claimed. Good — this is the kind of claim I'd normally have to go verify myself before trusting a design doc, and it holds up.

## The real gap: Decision 3's "mechanical" migration undersells one test

Decision 3 says every test other than the concurrency test "collapse[s] to one mocked call at `calls[0]`" and Task 2.4's safety net is to grep for leftover `mockQuery.mock.calls[1]` references. I read the actual test file. That grep will not catch everything.

Look at `"creates separate accounts for two identities with the same email but different sub values (AC-2)"` (`account-resolver.test.ts:122-154`). It calls `resolveOrCreateAccount` **twice** in one test, each currently consuming two queued mock responses (SELECT then upsert), for four `mockQuery` calls total. It then asserts:

```js
const selectCallA = mockQuery.mock.calls[0];
const selectCallB = mockQuery.mock.calls[2];
expect(selectCallA[1]).toEqual(["sub-A", "https://idp.example.com"]);
expect(selectCallB[1]).toEqual(["sub-B", "https://idp.example.com"]);
```

Two problems here that "update `calls[1]` to `calls[0]`" does not fix:

1. **The index that needs to change is `calls[2]`, not `calls[1]`.** A grep for `mock.calls[1]` (Task 2.4) will not find this line. Post-fix, the second invocation's single upsert call lands at `calls[1]`, not `calls[2]`.
2. **The assertion itself is checking SELECT params, and the SELECT is gone.** `selectCallA[1]` is a 2-element array (`[sub, iss]`) because that's what the old SELECT took. The new upsert call's params array has 5 elements (`sub, iss, displayName, email, globalRole`). `toEqual(["sub-A", "https://idp.example.com"])` will fail against a 5-element array — this isn't an index bump, it's a content rewrite (e.g., `expect(upsertCallA[1].slice(0, 2)).toEqual([...])`).

This is the same category of risk the design already anticipated for the concurrency test (Decision 2) — a "fix" that changes the index but doesn't re-derive the assertion from the new data shape would either fail loudly (good, if someone actually runs it) or, worse, could be patched into passing without re-verifying it proves the same thing (identity resolution keys strictly on sub/iss, not email). Given Decision 3 explicitly frames the rest of the file as mechanical and only carves out the concurrency test as special, I'd bet on this one getting the "just bump the index" treatment and silently losing its actual assertion, or breaking in a confusing way that costs implementation time to diagnose.

**Recommendation:** Add this test as an explicit third special case in tasks.md 2.2 (alongside 2.3's concurrency-test carve-out), spelling out that the assertions must be rewritten to check upsert params (not SELECT params) at `calls[0]` and `calls[1]`. Widen Task 2.4's grep beyond `calls[1]` — grep for any `mock.calls[` with a non-zero numeric index in this file, or simpler: grep for `mockResolvedValueOnce(` appearing more than once per `it()` block, which would catch every test still queuing two responses for one invocation.

## Minor notes (not blocking)

**Proposal wording vs. delta spec content is slightly in tension.** Proposal.md's Modified Capabilities section states "No scenario's observable behavior changes — the fix is internal to how `isNewUser` is computed, not what it means or who consumes it." But the delta spec's rewritten "Duplicate subject claim race condition" scenario adds a genuinely new assertion that wasn't in the original spec at all: "exactly one of the two callbacks observes `isNewUser = true` and the other observes `isNewUser = false`." The original scenario (`openspec/specs/first-access/spec.md:46-48`) says nothing about `isNewUser` values under concurrency — it only asserts both callbacks get a valid session. The new scenario text is a strictly stronger, new observable guarantee (which is the whole point of the fix). I don't think this is a design defect — the delta spec itself is written correctly — but "no scenario's observable behavior changes" undersells what's actually shipping and could confuse someone reconciling the two docs later. Consider a one-line tweak to the proposal's wording (something like "no *consumer-facing* behavior changes — both existing audit-event paths still fire under the same conditions").

**Comment style consistency.** Task 1.3 asks for a short comment "in the style of `teams.ts:746-766`." I'd keep it to the same length/format teams.ts uses (a single delimiter-boxed block naming the idiom and why it's chosen over SELECT-before-INSERT) — not longer than what's being replaced. The current "HARD CONSTRAINT" block is 19 lines; the teams.ts equivalent is 20 lines but covers more ground (partial index requirement, atomicity note). This one has less to say, so it should be shorter, not equal length. Not worth a task line, just flagging so the implementer doesn't feel obligated to match teams.ts's line count.

## Summary

The core mechanism swap is sound, faithfully reuses a shipped pattern, and correctly scopes what needs a transaction and what doesn't. The one thing I want fixed before implementation starts is tightening Task 2.2/2.4 to explicitly handle the two-invocation `calls[2]` test — as written, "mechanical migration" plus a `calls[1]` grep will miss it, and that's exactly the kind of partial-migration risk Decision 3's own Risks section warns about for the rest of the file.
