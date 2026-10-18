# Design Review: Full Stack Engineer (Marcus Oyelaran)

Change: bulk-restore-default-topics (#218). Reviewed `design.md` and `proposal.md` against `packages/backend`, `packages/shared`, `packages/frontend`.

## Verdict

Implementable as written, with no blocking issues. The design is small, reuses the existing lock/limiter/audit machinery, and its factual claims about the live code mostly check out. I have two substantive concerns (S1, S2) and several smaller ones. None require redesign; all are resolvable with a sentence in the design or a test.

## Claims verified against code

- **Single restore cascade (V6): confirmed.** `topics.ts` restore handler: `rejectNonCanonicalTeamId`, lowercase, `checkRestoreTopicAuthorization` (delegates to `checkStandingFacilitatorOrAdminAuthorization`), `enforceTopicWriteRateLimit`, `checkWritableTeam`, `checkCustomizationLockGate`, then transaction. The header comment (role, team, lock, topic) is indeed stale versus the body. The design's order is correct.
- **Single restore SQL (D16): confirmed.** `COALESCE(MAX(display_order),0)+1` over active, `restored_at = now(), restored_by`, `archived_at/by` untouched, audit insert inside the transaction, `emitAuditEvent` after COMMIT, thrown path does ROLLBACK and rethrow without `applyTimingFloor`. Bulk copying this is faithful.
- **Lock (V1/D17): confirmed.** `lockTeamTopics` is taken by add, archive, restore, reorder (topics.ts lines 1025, 1175, 1378, 1594, 1769) and by room-open (`facilitator-sessions.ts` 732, 1007). `snapshotSessionTopics` is a single `INSERT ... SELECT` from `status = 'active'`, renumbering with `row_number()`. The "never a mixture" claim holds.
- **Unique index (D17): confirmed.** Migration 18 makes `(team_id, display_order)` unique only `WHERE status='active'`. Positions above active max cannot collide. A single multi-row UPDATE with distinct new positions is safe (non-deferred index is checked per row, but the target positions are all unoccupied).
- **No name uniqueness anywhere (V2): confirmed.** No unique constraint on topic name; `findDuplicate` in `frontend/src/pages/addCustomTopic.ts` is a client hint matching name OR prompt.
- **`GET /topics/all` (V5): confirmed.** Reads `t.restored_at`, `t.restored_by` with a `users` join, not audit rows. The archived query currently selects no `display_order`; adding it is a one-column additive change.
- **Shared package: viable.** Backend and frontend already import runtime values from `@dipstick/shared` (e.g. `MAX_ANNOTATION_LENGTH`, `REAUTH_GRACE_EXPIRED_CLOSE_CODE`), so a pure function is not a new pattern. `unnest(...)` with a typed array param is already used in `topics.ts` (reorder, ~line 1814), so the bulk UPDATE is idiomatic.
- **Audit:** `audit_log.operation` is unconstrained `TEXT` (migration 8). The only code change is adding `topic.defaults_restored` to the event-name union in `audit-logger.ts` (the file lists `topic.restored` and `topic.defaults_assigned` there).
- **Route collision (V4): agree.** No collision. Keep the routing regression test.

## Substantive concerns

### S1. Archived `display_order` is a weaker sort key than the design admits
Migration 18's own comment says an archived topic's `display_order` "is not meaningful and not maintained", and the archive handler only sets `status/archived_at/archived_by` (never touches `display_order`). Reorder renumbers only active rows. So after a few archive/reorder/restore cycles, archived positions are stale snapshots from different historical orderings and can tie or invert relative to what the facilitator last saw. The design acknowledges "relative sort key with id tie-break" (D19), but:
- the dialog sentence "in this order" and the proposal's "prior-relative order" promise more than the data supports; the order is "roughly where each used to sit". Ties fall to `id`, which is a random UUID order, so the tie-break is deterministic but arbitrary.
- This is also the sole thing that decides which same-named duplicate wins (D1). That is acceptable, but the copy should not imply the order is meaningful.
Recommendation: soften dialog/spec wording to avoid promising prior order beyond "same relative order they had when removed, where known", or keep the sentence but add a test with stale/tied archived positions asserting determinism only. The usability item (task 7.1) should watch for this. Not blocking.

### S2. Two definitions of "restorable" will coexist
`GET /topics/all` already computes `defaultTopicsNotActive` with an exact (`name = dt.name`, case-sensitive) lateral join against the template, which the screen is documented not to read (#197). Bulk introduces a second, normalized (trim + lowercase) notion of "same name", and single restore has a third (none). That is intentional per the design, but it means three rules for one concept live in the codebase. The design should say explicitly in the shared module comment that `planDefaultRestore` is the only rule the UI may use for bulk availability, and that `defaultTopicsNotActive` must not be reused for it. Also note the server compares against names of *active* rows only: a custom active topic with a default's name suppresses restore (intended), but the frontend `canBulkRestore` uses `data.active` which `GET /topics/all` returns in full, so no new data is needed. Good.

## Boundaries and coupling

- **Planner in `@dipstick/shared`: practical.** Cost is a rebuild of `dist` (shared is consumed from `dist`, `main` points there). Existing practice, but the task list should include "build shared before backend/frontend tests" so CI is not order-fragile. If preview slips, keeping it server-side is a clean fallback.
- **`addCustomTopic.ts` switching to the shared normalizer** is optional and carries regression risk for no benefit to this change. I would not do it here; leave `normalizeForDuplicate` and add the shared function. Duplicate-but-identical one-liners are cheaper than coupling an unrelated screen's tests to this change. (Or do it, but only if `addCustomTopic.test.ts` is untouched, as the design says.)
- **Handler in `topics.ts`:** fine, but the file is already ~2100 lines with large duplicated cascade code. Do not extract a shared "cascade" helper in this change; copy the restore pattern. A later refactor can unify.
- **Hidden coupling to the limiter:** the design correctly keeps the limiter out of session/voting/WS code. The extended identifier-hygiene test is worthwhile.

## Missing or underspecified error paths

1. **Step 2 query text is not a single query.** D16 step 2 reads as "`SELECT name, ... MAX(display_order)`" which cannot be one aggregate select with names. Specify two statements (or `SELECT name, display_order FROM topics WHERE status='active'` and compute max in JS, which also makes the planner input the same shape). Trivial, but make it explicit so nobody writes an invalid GROUP BY.
2. **Empty result path commits vs rolls back:** D16 says "COMMIT (or ROLLBACK)". Pick one (ROLLBACK is simpler and releases the lock immediately; nothing was written).
3. **UPDATE row-count mismatch.** D17 says throw and 500 on mismatch. Because the UPDATE runs under the lock after an in-transaction read, this is unreachable except for an ordering bug or a hand-edited DB. Fine as a guard, but add one unit test that forces it (mock client) so the rollback path is covered, since it is otherwise dead code.
4. **Pre-lock reads.** Unlike single restore, there is no pre-lock topic pre-check, which is correct. Confirm the handler does not read topic rows before `lockTeamTopics` (the lock-gate check reads only session/lock state).
5. **Audit-insert failure** is fail-closed (500, rolled back); `emitAuditEvent` failure after COMMIT is swallowed. Specified. Make sure the swallow does not use a bare `catch {}` that also eats `applyTimingFloor`/`reply.send` errors (the same lesson recorded in `topics.ts` for the TOPIC-002 denial audit).
6. **Large-N parameter shape.** `unnest($ids::uuid[], $positions::int[])` with two arrays is fine in pg; both arrays must be built from the same ordered list. A short invariant test (ids[i] gets position base+1+i) is cheap.
7. **Response size / `skipped` unbounded:** bounded by archived defaults; fine.
8. **Client double-submit.** Not stated: the dialog should disable submit while the request is in flight (the existing `assigning` pattern). Server idempotence makes it safe, but a double-click would spend two limiter units and show an "Nothing to restore." line over the success line. Add to D20.
9. **Stale preview after 403.** If a facilitator joins the team between load and submit, bulk returns 403 `FACILITATOR_IS_TEAM_MEMBER`; D20's error mapping says "as for single restore", which is right, but the dialog must close and refetch rather than strand the user.

## Technology choices

- All practical: one UPDATE via `unnest`, one audit INSERT, advisory lock reuse, no migration, no new dependencies.
- JS `trim().toLowerCase()` in application code versus SQL is the right call given the `btrim` difference, and avoids a locale/collation dependency. Document that it is intentionally not NFC-normalized (design already does).
- Statement count independent of N is true (lock, two reads, one update, one insert).

## Test notes (to add to tasks if absent)

- Real-DB concurrency: two simultaneous bulk requests (union equals set, intersection empty, one audit row); bulk racing room open (snapshot is all-or-nothing); bulk racing add of a same-named custom topic (the loser either way is deterministic under the lock).
- Archived rows with identical and negative `display_order` (the legacy migration-18 down shape) still produce a deterministic, collision-free result.
- Template team and non-canonical-id parity with single restore, as listed.
- Shared planner unit tests: same-name within batch, whitespace/case variants, blank names, tie-break by id.

## Summary

Approve to proceed. Address before build: S1 wording (do not over-promise prior order), the explicit step-2 query shape, the ROLLBACK-vs-COMMIT choice on the empty path, double-submit disabling in the dialog, and the decision to leave `addCustomTopic.ts` alone (recommended).
