## Implementation Security Review — VOTE-004 / `reassign-action-item-owner` (GitHub issue #108)

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Scope reviewed:** `packages/backend/src/routes/action-items.ts` (the new `PATCH /api/v1/action-items/:actionItemId/owner` handler), `packages/backend/src/auth/audit-logger.ts` (`AuditEventName` addition, `audit_log` writes), `packages/backend/migrations/15_action_item_history_owner_columns.sql`, cross-checked against `design.md`, `design-review-security.md` (my own design-stage review), `packages/backend/src/auth/team-content-access-helper.ts` (`evaluateTeamAccess`), and the corresponding test suites (`action-items.test.ts`, `action-items-integration.test.ts`).

**Overall assessment:** All five design-stage findings from my review were carried into `design.md` as stated decisions, and all five are correctly implemented in the shipped code — not just referenced in comments, but actually present at the call sites I checked line-by-line. This is a clean close-out of a design review, which is not something I get to write often. I did find one new gap during implementation review: the same-owner no-op path's `UPDATE` is missing the `status != 'resolved'` guard that Decision D11 added to the real-reassignment path, leaving an asymmetric, narrow race window. Details below.

---

### Design Finding 1 (timing floor at all early-return branches) — CONFIRMED FIXED

Checked every early-return branch in the new handler (`action-items.ts:376-724`) for an `applyTimingFloor(startTime)` call preceding the response:

| Branch | Line | `applyTimingFloor` called? |
|---|---|---|
| Item not found (2.2) | 396-399 | Yes (397) |
| No relationship to team (2.3) | 425-430 | Yes (428) |
| `sessionId` missing (2.4) | 438-447 | Yes (439) |
| `sessionId` invalid/inactive-session (2.4) | 449-463 | Yes (455) |
| Not an authorized facilitator (2.5) | 471-488 | Yes (482) |

All five branches — the four I named in the design review plus the missing-`sessionId` sub-case, which is a distinct early return from the invalid-`sessionId` case and correctly also floored — call the real `applyTimingFloor` from `content/timing-oracle.ts`, not a stub. The resolved-item `409` (2.6) and the new-owner cascade's `404`/`422` responses (2.7) correctly do *not* call it, consistent with `VOTE-002`'s own shipped behavior (these run only after authorization has already succeeded, so there's no pre-authorization oracle to close there) and consistent with the inline comment at line 494 that says so explicitly.

Test coverage confirms this at the unit level: `action-items.test.ts` asserts `mockApplyTimingFloor` call counts for the nonexistent-item 404 (line 953), the zero-relationship 404 (984, expecting 2 total calls across both requests in that scenario), the not-authorized-facilitator 403 for both a facilitator-in-draft-grace-window (911) and a plain-member caller (934), and the missing-`sessionId` 422 (1327). I did not find an equivalent explicit assertion for the *invalid* (wrong-status) `sessionId` branch (`action-items.test.ts` "a sessionId referencing an inactive-status session is rejected 422" only asserts the status code and that `mockDbConnect` wasn't called) — the source code is correct at line 455 regardless, so this is a test-coverage gap, not a code gap. Low priority; worth a one-line addition to that test for completeness.

### Design Finding 2 (no-op audit blind spot) — CONFIRMED FIXED, with one new gap found alongside it (see "New Finding" below)

The same-owner no-op branch (`action-items.ts:574-632`) opens a transaction, bumps `updated_at`, and writes an `audit_log` row with `metadata.no_op: true` before committing, then calls `emitAuditEvent(..., "action_item.owner_reassigned", { ..., noOp: true })`. This matches D6/D10's amended decision exactly: `action_item_history` is correctly skipped (nothing about ownership changed), but the privileged-action record now exists where before it wouldn't have. `audit-logger.ts`'s `action_item.owner_reassigned` doc comment (lines 136-149) correctly documents the no-op path's inclusion and the `no_op` metadata field.

Test coverage is thorough: `action-items.test.ts` §4.6 verifies the no-op path returns 200, skips `action_item_history`, writes `audit_log` with the exact expected metadata shape including `no_op: true`, calls `emitAuditEvent` with `noOp: true`, does not publish a WebSocket event, and — importantly — that a *second, repeated* no-op call writes its own separate audit row rather than being deduplicated (this is exactly the "reconstruct a suspicious repeated pattern" property the design amendment was for).

### Design Finding 3 (contract's stale `Authorization` line) — CONFIRMED FIXED

`requirements/design/REST API Contract.md`'s VOTE-004 section (lines 2016-2050) now carries a dated correction note (2026-09-29) rewriting all three items I flagged in combination with the engineer review: the `403`→`409` resolved-item fix, `sessionId` optional→required, and — the one I specifically flagged — a full rewrite of the `Authorization` line. It now states the session-scoped `EXISTS` mechanism precisely, notes the absence of an owner-authorized fork (unlike `VOTE-002`), and cites Decision D1 by name. The stale `global_role = 'facilitator'` line is gone, not just annotated around.

### Design Finding 4 (new-owner membership lookup must not reuse `evaluateTeamAccess`'s `removed_at`-filtered shape) — CONFIRMED FIXED

`action-items.ts:540-543`:
```sql
SELECT role, removed_at FROM team_memberships WHERE user_id = $1 AND team_id = $2
```
This is its own, unfiltered query — no `removed_at IS NULL` in the `WHERE` clause, and it is not routed through `evaluateTeamAccess` at all (the `evaluateTeamAccess` import in this file is used only for the relationship check in step 2.3, on the *caller*, not the new owner). I confirmed `evaluateTeamAccess` (`team-content-access-helper.ts:73-83`) does bake `AND tm.removed_at IS NULL` into its `LEFT JOIN` condition, which is exactly the shape that would have silently misclassified a soft-removed member as "never a member" if reused here. The handler correctly distinguishes: no row at all → `404` (line 545-547); a row with `removed_at IS NOT NULL` OR `role != 'participant'` → `422` (line 548-559). Since `membership_role` is a two-value enum (`participant`, `engineering_manager` — confirmed in `migrations/1_create_enums.sql:46-49`), the `role !== "participant"` check is exhaustive and correctly excludes Engineering Managers with no gap for a third role value to slip through unnoticed later.

Test coverage confirms both branches independently: a soft-removed member is rejected 422 (`action-items.test.ts:1044`), and a member with `role: "engineering_manager"` is separately rejected 422 (line 1061) — not conflated into one test case.

### Design Finding 5 (unhandled DB exception on malformed input, no global error handler) — unchanged, as expected

I flagged this at design stage as a pre-existing, non-blocking gap and recommended a follow-up ticket rather than a fix within this change's scope. Confirmed at implementation: no `setErrorHandler` was added to `app.ts`, and this endpoint has the same exposure `VOTE-002` already has for malformed UUIDs. Nothing to report here beyond reconfirming the gap is exactly as wide as it was at design time — no new exposure was introduced by this change, and it wasn't supposed to fix the codebase-wide gap. The follow-up ticket recommendation stands.

### Session-scoped facilitator authorization — CONFIRMED, no `global_role` fork

`action-items.ts:471-480` reuses `VOTE-002`'s exact query shape: `EXISTS (SELECT 1 FROM sessions WHERE facilitator_id = $1 AND team_id = $2 AND status = ANY($3::text[]))` against `ACTIVELY_FACILITATING_STATUSES`. No reference to `users.global_role` appears anywhere in this handler for the authorization decision (it's read once, at line 561-564, but only for `actorGlobalRole` metadata on the audit row — an audit-trail field, not a gate). No owner-authorized fork exists in this handler at all, matching D1: the branching is authorized-facilitator-or-nothing, as designed.

---

### New Finding (Medium) — the same-owner no-op `UPDATE` is missing the `status != 'resolved'` guard D11 added to the real-reassignment path

D11 (a concurrency finding from the engineer's design review, not mine, but squarely in my authorization-invariant territory) added `AND status != 'resolved'` to the real-reassignment `UPDATE` (`action-items.ts:647`, `WHERE id = $2 AND status != 'resolved'`) specifically to close a race where facilitator A resolves the item via `VOTE-002` while facilitator B's reassignment is in flight, which would otherwise commit an owner change against a since-resolved item — a violation of D3's "resolved is terminal, unhedged" invariant.

The same-owner no-op branch has the identical TOCTOU shape — its item snapshot is read once, at line 2.2, before the resolved-item precondition check (2.6) is even evaluated against it — but its own `UPDATE` (line 581) has no such guard:

```sql
UPDATE action_items SET updated_at = NOW() WHERE id = $1 RETURNING updated_at
```

If a concurrent `VOTE-002` resolve commits between this handler's 2.2 snapshot read and this `UPDATE`'s commit, the no-op path will still succeed: it bumps `updated_at` on an item that is, by commit time, actually resolved, and it writes an `audit_log`/`emitAuditEvent` record for a reassignment-shaped privileged action against an item the caller's own snapshot said was open but that had, in fact, already reached its terminal state. This doesn't change `owner_id` (no data-integrity corruption of the kind D11 was principally worried about), but it does let a mutation succeed against a resolved item through this endpoint — which is exactly the invariant D3 states as unhedged, and D11 explicitly generalized to "any commit against a since-resolved item," not only ones that change `owner_id`.

This is a narrow window (same order of likelihood as the race D11 already accepted as "materially rarer, lower-consequence" for the reassignment-vs-reassignment case), and the blast radius is limited to a spurious `updated_at` bump and an audit row that slightly mischaracterizes timing — not an authorization bypass or a data-corrupting write. I'd class it Medium rather than the Low/informational tier of my original Finding 4/5, because it's an asymmetric application of a guard the design already decided was necessary for this exact table, in this exact file, for this exact race — the no-op branch simply wasn't in scope when D11 was written (D11's text speaks only of "the final `UPDATE`... (task 2.9)," which is the real-reassignment write, not the no-op write at task 2.8).

**Recommendation:** Add `AND status != 'resolved'` to the no-op path's `UPDATE` (line 581) and check `rowCount`; on `rowCount === 0`, roll back and return the same `409` the real-reassignment path returns for this case (line 654-660), rather than silently succeeding. This is a one-clause fix consistent with D11's own reasoning, not a new design question — I'd suggest routing it back to Ingrid as a D11 follow-up rather than treating it as a new decision.

---

### Minor observations (not security findings, noted for completeness)

- **Generic 404 message reused for a different resource.** The new-owner-doesn't-exist branch (`action-items.ts:530-532`) and the new-owner-has-no-membership branch (545-547) both call the shared `notFound()` helper, whose hardcoded message is `"Action item not found."` — technically inaccurate here, since the action item does exist; it's the *new owner* that doesn't exist or isn't a member. This is harmless for the anti-enumeration property D5 cares about (both branches correctly return the identical generic body, preventing a cross-team user-existence oracle, which is the actual security property at stake), but the wording could confuse whoever's reading logs or support tickets during an incident. Cosmetic; not blocking.
- **Migration file's own header correctly explains the 15-vs-10 numbering discrepancy** (branch cut before `main`'s migrations 10-14 merged), but the integration test's `describe` block title at `action-items-integration.test.ts:147` still says "(migration 10)" — a stale comment, not a functional issue, since the test itself operates on the live schema regardless of which migration number introduced it.
- **`evaluateTeamAccess`'s Path 2/3 EM dual-check and Path 3's draft/complete grace windows are correctly *not* reused for this endpoint's authorization gate** — the design's deliberate narrowing (session-scoped facilitator, not `evaluateTeamAccess`'s broader grant) is preserved intact in the implementation, same as `VOTE-002`.

---

### Summary for the record

Findings 1-4 from my design review are correctly and completely implemented, not merely gestured at in comments — I checked line numbers, not just doc-comment claims. Finding 5 remains an accepted, unchanged, pre-existing gap, as expected. The one new item is the no-op path's missing `status != 'resolved'` guard, which I'd like fixed before this ships since it's a one-line, low-cost fix for an invariant this exact design has already decided matters (D11), just not yet applied to both of the two `UPDATE` statements that needed it. Nothing else changes my "authorization model is sound" assessment from design review.
