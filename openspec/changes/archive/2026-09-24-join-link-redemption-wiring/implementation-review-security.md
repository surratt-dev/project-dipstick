# Implementation Review — `join-link-redemption-wiring`

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Reviewed:** commits `10e7170` (Commit 1: behavior change + Migration A) and `3578ee0` (Commit 2: Migration B), against `design.md` and my own prior `design-review-security.md` on this same change.
**Scope:** verifying that the two findings I raised at design time were actually closed in code, and spot-checking the security-sensitive surfaces of the implementation directly against the diff — not re-reviewing decisions I already signed off on at design time.

---

## Finding 1 (was Blocking at design time): resolved, verified in code

My design review flagged that `facilitator-state`'s get-or-create call site had no sourcing story for `actor_global_role`, a required parameter of the audited creation function.

Confirmed in `packages/backend/src/routes/facilitator-sessions.ts`:
- `getOrCreateJoinLink` (lines ~162-206) takes `resolveActorGlobalRole` as a callback, invoked only on the miss branch — paid only when a new row is actually being created, not on every poll.
- `POST /draft`'s call site passes `resolveActorGlobalRole: async () => global_role`, reusing the value already resolved and confirmed `"facilitator"` earlier in the same handler. No new lookup, no gap.
- `facilitator-state`'s call site (lines ~2052-2073) passes a closure that issues `SELECT global_role FROM users WHERE id = $1` against `userSession.userId` — exactly the fresh-lookup pattern I asked for, matching the file's own established convention at the other eight call sites `design.md` cited.

Both paths are exercised by real tests, not just present in code: `facilitator-sessions.test.ts`'s new `getOrCreateJoinLink` describe block asserts `resolveActorGlobalRole` is *not* called on reuse, and *is* called exactly once on miss, with the resulting value landing in the `audit_log` INSERT's bound parameters (`expect((auditInsertCall![1] as unknown[])[1]).toBe("facilitator")`). The `facilitator-state`-specific miss-path test additionally asserts no `SELECT global_role` fires on the reuse path and that it does fire, with the right value flowing through, on the miss path. This is closed, not just claimed closed.

## Finding 2 (was Non-blocking): resolved, verified in code

I'd flagged that `http-session-expiry-no-partial-execution.test.ts`'s single staged `mockDbQuery` resolution would either fail loudly or — worse — silently stop exercising get-or-create once `facilitator-state` issued a second query.

Confirmed: the test now stages two resolutions — the sessions SELECT (with `join_token` removed from both the query and the fixture row), followed by `{ rows: [{ token: "tok" }] }` for get-or-create's reuse SELECT. This keeps the test on the reuse path and genuinely exercises get-or-create rather than silently degrading to a no-op. Comment in the diff correctly explains why (falling through to the file's default empty-rows mock would have driven the miss branch unintentionally). Closed as I asked.

---

## Spot-checks of the security-sensitive surfaces

### 1. Audit-transaction atomicity in the shared `createJoinLink` helper

Confirmed atomic. `packages/backend/src/auth/join-link-creation.ts`'s `createJoinLink` calls `withAuditTransaction`, whose implementation (`audit-write-transaction.ts`) runs the domain write (`join_links` INSERT) and the audit write (`audit_log` INSERT) inside one BEGIN/COMMIT, with a failed audit INSERT rolling back the domain write too (`SET LOCAL statement_timeout` bounds this at 400ms, enforced server-side by Postgres, not a racing client timer). `emitAuditEvent` (the structured-log emission) correctly fires only after this transaction has already committed, matching the pre-existing contract. This is the same helper both `POST /api/teams/:teamId/join-links` and get-or-create's miss branch call — one implementation, not two independently-maintained copies, which was the whole point of the extraction.

Get-or-create's reuse path (`getOrCreateJoinLink`'s early return when an active row exists) never calls `createJoinLink` at all, so it correctly produces no `join_links` row and no audit row — verified directly in the diff and in the new unit test asserting `mockEmitAuditEvent` is not called with `"join.link_created"` on reuse. Matches the spec's stated behavior.

### 2. `GET /api/join/:token`'s reconciled active check

Confirmed the revoked-vs-expired distinction survived reconciliation. `join-links.ts` now selects `(${JOIN_LINK_ACTIVE_SQL}) AS is_active` alongside `revoked_at` and `expires_at`, and gates rejection on `!link.is_active` — a single shared pass/fail definition, consumed identically by get-or-create's SQL `WHERE` clause. But the reason-selection logic for the audit/redirect path was preserved, not collapsed: `const reason = link.revoked_at ? "revoked" : "expired"` still derives the *specific* reason from the same two columns as before, independent of the unified gate. `emitAuditEvent`'s `reason` field and the redirect target are unaffected by the refactor. No security-relevant granularity was lost — this is exactly what `design.md`'s addendum described, and I verified it rather than took the description on faith.

### 3. `sessions.join_token` residual exposure

Grepped the full tree post-`3578ee0`. No code path reads or returns the column anywhere: both INSERT sites (`facilitator-sessions.ts`) dropped their `join_token` value and generation line in Commit 1; `facilitator-state`'s SELECT and response were repointed to the real `join_links` value in the same commit; `POST /api/v1/teams`'s response field was removed outright (confirmed unconsumed by `SessionCreationPage.tsx`, which reads only `{ teamId, sessionId }`). The remaining `join_token` string hits in the tree are: the original `CREATE TABLE`/`CREATE INDEX` migrations (historical, correctly untouched — migrations are append-only), Migration 13/14 themselves (the removal), and comments/mock fixtures in test files documenting the removal. Migration B (`3578ee0`) drops the column plus its unique constraint and index in one statement, and the five backend test files that would otherwise break on invalid SQL were updated in the same commit, closing the gap I hadn't originally been asked to check but confirmed anyway. Clean.

### 4. E2E test — real database, not mocks

Confirmed. `e2e-join-link-redemption.test.ts` self-skips when Postgres is unreachable (no `db.js` mocking), obtains `joinToken` via a real `GET .../facilitator-state` call against a real Fastify app (exercising a genuine get-or-create miss branch, a real `join_links` INSERT, and a real `audit_log` row — verified directly by the test's own follow-up `SELECT team_id FROM join_links WHERE token = $1` assertion), builds the path with the same `buildJoinLinkPath` function the frontend imports, and redeems it as a second, real user against the real registered route, asserting a real `team_memberships` row lands with `role = 'participant'`. This is exactly the "technically complete, functionally invisible" gap closure Decision 7 called for — a token-and-path test that would have caught the original bug, and per the commit message was verified to actually fail against the pre-fix code, not just reasoned to. The two supplementary tests (wrong-path 404, unbacked-token rejection) are correctly scoped as structural guards rather than claimed as pre-fix regression demonstrations in their own right.

---

## Recommendation

Both findings from my design review are closed in the implementation, with tests that verify the closure rather than merely asserting it in comments. The audit-transaction atomicity, the reconciled active-check's preserved reason granularity, the `join_token` removal's completeness, and the e2e test's use of a real database all check out under direct inspection of the diff. No new findings. I have no objection to this shipping as implemented.
