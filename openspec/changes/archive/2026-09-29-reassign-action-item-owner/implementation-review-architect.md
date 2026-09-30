# Implementation Review — Solution Architect

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Change:** `reassign-action-item-owner` (VOTE-004, GitHub issue #108)
**Branch:** `agent-team/reassign-action-item-owner`
**Scope:** Verifying the shipped implementation against `design.md`'s Decisions D1-D11, and independently checking the two process claims (migration renumbering, pre-existing test failure) rather than taking them at face value.

This is an implementation-conformance review, not a re-litigation of the design. I did not find anything here that reopens a decision I already signed off on in design review. My read of the diff (`git diff` against `HEAD`, since all implementation files are uncommitted working-tree changes on top of `8551dd9`) and of the test run output below.

## Summary

The implementation matches the design closely and precisely on every point I consider load-bearing: check ordering, the D11 concurrency guard, the no-op audit-but-not-history split, `applyTimingFloor` coverage, and the soft-removed-member query shape. Both process claims in the engineer's handoff check out under independent verification — the migration renumbering is correct and necessary, and the test failures are a genuine, pre-existing environment/migration-drift issue, not a shipped defect. I found one minor documentation staleness item (stale "migration 10" comments left in the integration test after the renumbering to migration 15) and one scope note worth naming explicitly, neither of which blocks this change. No architectural concerns.

## Check-ordering sequence — verified exact match

Traced `packages/backend/src/routes/action-items.ts`'s new `PATCH /api/v1/action-items/:actionItemId/owner` handler line by line against design.md's stated sequence:

1. Item load by ID alone → `404` if missing (task 2.2)
2. Relationship check (`evaluateTeamAccess` OR ever-facilitated) → `404` if none (task 2.3, D2)
3. `sessionId` required + valid-active-session check → `422` (task 2.4, D4)
4. Facilitator authorization (`ACTIVELY_FACILITATING_STATUSES` EXISTS query, reused verbatim from VOTE-002) → `403` (task 2.5, D1)
5. Resolved-item precondition → `409` (task 2.6, D3)
6. New-owner cascade: self-check (no DB) → existence `404` → membership-exists `404` → active-participant-non-EM `422` (task 2.7, D5)
7. Same-owner no-op → `200`, audit-only (task 2.8, D6)
8. Real reassignment: guarded `UPDATE` → history insert → audit insert, one transaction (tasks 2.9-2.11)

This is exactly the order specified. Two ordering scenarios I specifically checked against the code and the tests confirm the right precedence:

- A resolved item with an also-invalid `newOwnerUserId` returns `409` (resolved wins), not the cascade's `404`/`422` — verified in `action-items.test.ts` describe block "4.5 — resolved-item precondition," and confirmed in the handler: the `item.status === "resolved"` check (2.6) runs and returns before the cascade (2.7) is ever reached.
- A resolved item with a missing `sessionId` returns `422` (session reason), not `409` — because `sessionId` validation (2.4) runs before the resolved check (2.6). Also has a dedicated test.

## D11 concurrency guard — verified correct

The final `UPDATE` is:

```sql
UPDATE action_items SET owner_id = $1, updated_at = NOW() WHERE id = $2 AND status != 'resolved'
RETURNING updated_at
```

with an explicit `rowCount === 0` check immediately after, rolling back and returning the same `409` shape as the early resolved-check on a zero-count result. This is exactly D11's decision: no new lock primitive, a one-clause guard on the statement that was already being written, and a late-discovered conflict treated identically to the already-known-resolved case (same status code, same "write neither history nor audit_log" behavior). Test `4.13` exercises this directly by mocking a zero-`rowCount` response and asserting the rollback, the `409`, and that neither `action_item_history` nor `audit_log` receive a row. This is the correct way to unit-test a guard whose real trigger condition is a genuine two-connection race — the codebase has no existing "two real interleaved DB connections" integration pattern to reuse, and simulating the guard's observable outcome directly is consistent with this file's own established testing convention (`facilitator-sessions.test.ts` does the same for its conditional-UPDATE guards).

## No-op audit-but-not-history — verified correct

Confirmed the no-op branch (`newOwnerUserId === item.owner_id`):
- Opens its own transaction (`BEGIN`/`COMMIT`), consistent with D10's requirement that the staleness-clock reset and its audit record can't diverge.
- Writes `UPDATE action_items SET updated_at = NOW()` only — no `action_item_history` insert.
- Writes an `audit_log` row with `metadata.no_op = true`, and calls `emitAuditEvent` with `noOp: true`.
- Is exercised twice in a row by test `4.6`'s second case, asserting each no-op call writes its own, non-deduplicated `audit_log` row — this is the right test for D6/D9's "repeatable, on-demand staleness-clock reset" concern.

This is the one place I'd flag as worth double-checking again at the next review pass, not because it's wrong, but because it's the newest and most subtly-motivated decision in this design (an audit write for a request that changes nothing about the record's substantive state). The implementation matches the decision precisely.

## `applyTimingFloor` coverage — verified at all four stated branch points, matching VOTE-002's own shipped pattern exactly

I diffed the new handler against VOTE-002's existing handler in the same file line-for-line for this specific property. VOTE-002 calls `applyTimingFloor` at exactly four points — item-not-found (line 80), no-relationship (line 114), invalid-`sessionId` (line 134), not-authorized-facilitator (line 165) — and does *not* call it at the resolved-item `409` check, because that check only runs after authorization has already succeeded (nothing left to time-oracle-protect past that point). VOTE-004's new handler reproduces this exactly: `applyTimingFloor` before the item-404, before the relationship-404, before the missing-`sessionId` 422, before the invalid-`sessionId` 422, and before the facilitator 403 — four conceptual branch points (the `sessionId` check has two sub-branches, both call it, which is more coverage than the minimum, not less). The resolved-`409` check has an explicit code comment noting the omission is deliberate and matches VOTE-002's precedent, not an oversight. This is correct and is the one property I'd have flagged hardest if it were missing, since a silently-omitted timing floor is exactly the kind of thing that doesn't show up in a normal test failure.

## Soft-removed-member query — verified it does NOT reuse `evaluateTeamAccess`'s shape

This was my sharpest concern going in, since D5's implementation note calls this out explicitly as an "implementation pitfall, not a design alternative." Confirmed:

- `evaluateTeamAccess` (`packages/backend/src/auth/team-content-access-helper.ts`, line 85) bakes `AND tm.removed_at IS NULL` into its `LEFT JOIN` condition — a soft-removed member would silently disappear into "no grant" under that shape.
- The new handler's membership lookup is its own standalone query: `SELECT role, removed_at FROM team_memberships WHERE user_id = $1 AND team_id = $2`, with no `removed_at` filter anywhere in the `WHERE` clause. The 404-vs-422 distinction is made in application code afterward (`membershipRow === undefined` → `404`; `removed_at !== null || role !== "participant"` → `422`).

This is exactly right, and it's independently pinned down by two tests: "a new owner with no team_memberships row at all... returns 404" and "a soft-removed member (removed_at IS NOT NULL) is rejected 422" — both asserting `mockDbConnect` was never called, confirming the distinction is actually reachable and not accidentally collapsed.

Also verified the `role = 'participant'` check is exact (`membershipRow.role !== "participant"`), not "any membership" — this is the no-manager-participation enforcement point (BRD FR-9.5) the design calls out as load-bearing, and it has its own dedicated test ("an Engineering Manager cannot be reassigned an item").

## Consistency with VOTE-002 and existing patterns

- `ACTIVELY_FACILITATING_STATUSES` and the facilitator-authorization `EXISTS` query are the literal same file-local constant and query shape from VOTE-002, not a re-derived copy — confirmed by reading both handlers side by side in the same file.
- Transaction shape (`db.connect()` → `BEGIN` → writes → `COMMIT`/`ROLLBACK` in `finally`) matches VOTE-002's established pattern exactly, including `emitAuditEvent` being called *after* commit, never inside the transaction.
- `audit_log` row shape (`actor_user_id`, `actor_global_role`, `actor_ip`, `operation`, `team_id`, `metadata`) matches VOTE-002's `action_item.status_changed` dual-write shape verbatim, per D10.
- No new shared request/response types were added to `packages/shared`; the Body type stays route-local (inline generic on `app.patch<{...}>`), matching VOTE-002's own style. This is consistent with the design's explicit non-goal (backfilling shared types for both endpoints together is a named, deferred follow-up, not silently skipped).
- No WebSocket event, dispatcher case, or publish call was added anywhere in the new handler — confirmed by both reading the code and by test `4.11` asserting `publishActionItemStatusUpdated` is never called for either a no-op or a real reassignment. D8 is correctly a hard no, not a partial build.

## Documentation corrections — both verified against design.md's Migration Plan

- `requirements/design/REST API Contract.md`'s VOTE-004 section: the three corrections (403→409 for resolved, sessionId optional→required, and the full `Authorization` line rewrite away from the never-checked `global_role = 'facilitator'` phrasing) are all present, dated, and match the design's stated corrections exactly, including the response/error table being updated to reflect the actual 404/403/409/422 shape the code implements (not just the three named corrections — the table was also updated for the new 404 "zero relationship" case and the no-op/no-broadcast notes, which is more complete than the Migration Plan strictly required, and correctly so).
- `openspec/changes/team-membership-removal/README.md`: both bullets referencing GitHub issue #23 as an open dependency are corrected to forward-pointers noting VOTE-004 now designs and ships that constraint. Matches the design's stated risk mitigation.

## Migration renumbering claim — VERIFIED ACCURATE

Checked directly: `main` currently has migrations 1-9 plus 10-14 (`10_sessions_team_active_unique.sql` through `14_sessions_drop_join_token.sql`), none of which exist on this feature branch (`git ls-tree main -- packages/backend/migrations` vs. `ls packages/backend/migrations/` on this branch — the branch has only 1-9). The branch was cut before those five migrations merged. Numbering this change's migration `15` (next after main's actual head) rather than `10` (next after this branch's own stale head) is the correct call — using `10` would collide with `10_sessions_team_active_unique.sql` once this branch rebases onto or merges with main. The migration file's own header comment explains this reasoning accurately and in appropriate detail. No decision in design.md depended on the literal number 10, only on it being the next additive migration — confirmed by rereading D7's Migration Plan language, which says exactly that. This is not a case of a real problem being explained away; it's the correct resolution of an artifact of branch timing, well-documented for the next person who wonders why there's a gap.

One loose end from the renumbering: `packages/backend/src/routes/__tests__/action-items-integration.test.ts` still refers to the constraint's migration as "migration 10" in two places (a `describe` block name and a comment), left over from before the renumbering to 15. This doesn't affect correctness — the CHECK constraint's existence and behavior don't depend on the migration number — but it's a stale cross-reference that should be fixed for anyone `grep`ing for "migration 10" later. Minor, not blocking.

## Pre-existing test failure claim — VERIFIED ACCURATE, WITH ONE CLARIFICATION

I ran the full backend test suite twice: once against the branch as delivered, and once with all uncommitted changes stashed (`git stash -u`) to see the unmodified branch's baseline.

**With the implementation:** 4 test files fail, 13 individual tests fail, 546 pass.
**Stashed (unmodified branch):** 4 test files fail, 12 individual tests fail, 521 pass.

Every one of the 12 baseline failures, and the 1 additional failure introduced by this change's own new integration test, share the *exact same* root cause: `error: column "join_token" of relation "sessions" does not exist`. This is because the local dev Postgres instance already has `main`'s migration 14 (`14_sessions_drop_join_token.sql`) applied — which drops the `join_token` column — while this feature branch's code and test fixtures (both pre-existing ones like `facilitator-error-states-integration.test.ts` and the new `action-items-integration.test.ts` CHECK-constraint test, which follows the same existing `insertSession`-style fixture pattern) still insert into a `sessions.join_token` column that, on this branch, hasn't been removed yet. This is squarely a migration-drift artifact between the branch's code and the shared local dev database's actual schema state, unrelated to the correctness of this change's own logic.

**Clarification on scope:** the engineer's report characterized this as "one pre-existing, unrelated test failure." The root cause is singular and the characterization of it as pre-existing and unrelated is accurate and independently confirmed. But the count is understated: it's 12 pre-existing failing tests across 3 files on the unmodified branch (not 1), plus this change's own new CHECK-constraint integration test failing for the identical reason once added (13 total on the modified branch). I'd ask the engineer to restate this more precisely in the PR description — "one root cause, twelve pre-existing failures, plus our own new integration test hitting the same environment issue" — rather than "one test failure," since a reviewer skimming CI output and seeing 13 red tests should not have to independently rediscover that they're all the same issue. The underlying claim is not being used to paper over a real defect in this change's logic; I verified that with the stash. All of this change's new **unit** tests (the mocked ones in `action-items.test.ts`, which don't depend on a live Postgres) pass cleanly, and a full non-DB-dependent unit-test run against the implementation shows only the one pre-existing environment-dependent failure that also isn't related to this change's code path (`facilitator-error-state-2-restricted-role.test.ts`, same join_token root cause).

I also confirmed `tsc -p tsconfig.build.json --noEmit` (the actual build config) is clean with zero errors. The separate, stricter `tsconfig.json` produces a large number of pre-existing errors across many unrelated test files in this repo (none in the new owner-reassignment code itself beyond the same `buildApp` helper pattern every other route test file already has) — this is a repo-wide pre-existing condition, not something this change introduces or should be asked to fix.

## Minor items (non-blocking)

1. Stale "migration 10" references in `action-items-integration.test.ts` (describe block title and a comment) should be updated to "migration 15" for consistency with the actual file name, now that the renumbering happened.
2. The PR/handoff description should state the pre-existing-failure count precisely (12 baseline + 1 from this change's own new integration test, one shared root cause) rather than "one test failure," so a reviewer doesn't have to re-derive that 13 red tests are actually a single known issue.

## Verdict

Both the migration-renumbering claim and the pre-existing-failure claim check out under independent verification. I found no architectural deviations from design.md — check ordering, the D11 concurrency guard, the no-op audit-but-not-history split, applyTimingFloor coverage, and the soft-removed-member query shape are all implemented exactly as designed, and each has direct test coverage pinning it down. This change is consistent with VOTE-002's established patterns throughout, which was the primary property I was watching for given D1/D2/D4's explicit "reuse, don't re-derive" mandate. No blocking findings.
