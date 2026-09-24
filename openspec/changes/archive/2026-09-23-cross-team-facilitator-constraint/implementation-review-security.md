# Security Implementation Review — cross-team-facilitator-constraint

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Scope reviewed:** `git diff HEAD -- packages/backend/src/routes/__tests__/facilitator-sessions.test.ts` and `git diff HEAD -- packages/backend/src/routes/facilitator-sessions.ts`, verified against the running test suite.

## Verdict: approve

## Production diff

`git diff HEAD -- packages/backend/src/routes/facilitator-sessions.ts` is empty. Confirmed directly — this is a test-only change as scoped. No production code, no behavior change, nothing new to threat-model.

## Test diff: three new tests, all verified against the actual handler code

### 1. `facilitator-state` test — does it prove absence of a `team_memberships` query, or could it pass vacuously?

I did not take the query-text assertion at face value; I mutated the handler to check. With the diff applied as-is, I temporarily inserted `await db.query("SELECT 1 FROM team_memberships WHERE user_id = $1", ...)` at the top of the `facilitator-state` handler (`facilitator-sessions.ts:1682`) and reran the single test:

- With no adjustment to the mock queue, the extra call exhausted the one queued `mockResolvedValueOnce` response, the handler crashed on the resulting `undefined`, and the test failed at `expect(res.statusCode).toBe(200)` (got 500).
- To isolate the query-text assertion itself from that incidental crash, I additionally queued a second mock response so the handler would complete normally. The test still failed — this time specifically at `expect(teamMembershipsCall).toBeUndefined()`, with the received value showing the exact injected query string. This is the assertion doing its job, not a crash masking as a pass.

I reverted both changes afterward (`git checkout --` restored `facilitator-sessions.ts`; the test file's working-tree diff, which that same command incidentally discarded, was reconstructed via `git apply` from the diff text and re-verified byte-for-byte against the original — full suite re-run confirms 68/68 passing and the production diff is still empty).

Conclusion: this test is not vacuous. It fails on the exact regression it claims to guard against, and it fails at the specific assertion designed to catch it, not just incidentally via a crash. `buildApp()` in this file injects `request.session` directly in an `onRequest` hook with no DB lookup, so the single mocked `db.query` response is guaranteed to correspond only to the handler's own session-row query — there's no other call in the stack that could produce a false negative here.

### 2. Actor-query test (`draft-session`, tasks 2.1/2.2) — `removed_at IS NULL`

Verified against `facilitator-sessions.ts:204-214`: the query text is `FROM users u LEFT JOIN team_memberships tm ON tm.user_id = u.id AND tm.team_id = $2 AND tm.removed_at IS NULL WHERE u.id = $1`. The test isolates this call via `.find(call => call[0].includes("FROM users u"))`, which is a unique substring not shared by the team-existence check (`FROM teams`) or the denial-path audit insert (`INSERT INTO audit_log`) mocked elsewhere in the same `describe` block. `removed_at IS NULL` in the join condition is the actual security-relevant predicate — it determines whether a former (removed) member is correctly treated as not-a-member for this constraint, which is the specific behavior the "previously removed member is eligible to facilitate again" spec scenario depends on. Not cosmetic.

### 3. Eligible-teams query test (task 1.1) — `LEFT JOIN team_memberships` / `WHERE tm.id IS NULL`

Verified against `facilitator-sessions.ts:1824-1836`. The handler issues three sequential `db.query` calls in this route (actor role lookup, eligible-teams list, membership-exists check); the test's `.find(call => call[0].includes("FROM teams"))` uniquely isolates the eligible-teams query, since it's the only one of the three containing that substring. `LEFT JOIN team_memberships` combined with `WHERE tm.id IS NULL` is the actual exclusion mechanism (a team the caller has an active membership row for is dropped from the list via the anti-join), not an incidental string. This is the same query-text-assertion pattern as test 3.7 and the actor-query test above, correctly and consistently applied — not re-invented per test.

## Scope: no overstatement found

I checked the new test comments and the delta spec scenario they back against the gap I flagged during design review (GitHub issue #154, filed today, tracking that a session's facilitator is not excluded from participating in or voting in their own session — a pre-existing, unguarded gap, correctly out of scope for this test-only PR).

- The `facilitator-state` test's comment states precisely: "demonstrates there is no mechanism that re-evaluates or invalidates an existing session record in response to a later team_memberships change" — scoped to session-record validity, no claim about participation or voting.
- `specs/session-creation/spec.md`'s corresponding scenario ("A facilitator joining the facilitated team after session creation does not invalidate the existing session record") now carries the exact disclaiming language I recommended in the design review: *"this scenario asserts only the session record's continued validity under the creation-time constraint; it makes no claim about the facilitator's eligibility to participate in or vote within that session, which is governed separately by `session-participation` and is unaffected by this change."* This closes the gap I flagged — the scenario can no longer be misread as a broader integrity guarantee.
- Issue #154 is filed, open, correctly scoped as a pre-existing gap not introduced by this change, and not something this PR needs to fix.

Nothing in the new tests, their comments, or the spec overstates what's proven. The two query-text assertions test real, security-relevant predicates (membership-removal handling and the anti-join exclusion mechanism), consistent with existing precedent (test 3.7), not cosmetic string matches.

## Other items checked, no findings

- No production code, secrets, environment configuration, dependency, authentication, or WebSocket-auth changes in this diff — nothing here calls for review under those headings.
- Full suite (`packages/backend/src/routes/__tests__/facilitator-sessions.test.ts`) passes: 68/68.

## Summary

Approve. Zero production diff confirmed. All three new tests were verified — including by empirical mutation of the handler for the `facilitator-state` case — to fail on the exact regression each claims to catch, not pass vacuously. The two query-text assertions test genuine security-relevant SQL predicates. The scope-overstatement risk I flagged in design review has been addressed: both the test comment and the spec scenario now explicitly disclaim any claim about participation/voting eligibility, and the adjacent gap is tracked separately as issue #154.
