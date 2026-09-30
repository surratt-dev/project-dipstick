# Engineering Design Review — `reassign-action-item-owner` (VOTE-004 / issue #108)

Reviewer: Marcus Oyelaran (Full Stack Engineer)
Scope: `design.md`, `proposal.md`, `specs/action-item-owner-reassignment/spec.md`, `tasks.md`, cross-checked against `packages/backend/src/routes/action-items.ts` (VOTE-002, the sibling implementation this change reuses), `packages/backend/migrations/*.sql`, `packages/backend/src/auth/team-content-access-helper.ts`, `packages/backend/src/auth/audit-logger.ts`, and `requirements/design/REST API Contract.md`.

## Overall verdict

Implementable as written, and the mechanical parts of this design are genuinely well done — it reuses VOTE-002's authorization query, anti-enumeration ordering, no-op pattern, and dual-write (history + audit_log) pattern verbatim rather than approximating them, which is exactly the right call for a sibling endpoint on the same table. The backend-only scope is clean: no frontend, no WebSocket, one additive migration. I have one correctness concern I'd want addressed before merge (concurrent writers on the same row), one documentation gap that will mislead the next reader if left alone, and a couple of small tasks.md completeness gaps. Nothing here blocks starting implementation; the concurrency point is the one I'd want a decision on (fix now vs. explicitly accept and log) before calling this done.

## Findings

### 1. [Correctness / concurrency — recommend fixing before merge] No re-verification inside the transaction; this change makes action_items a two-writer table for the first time

`action-items.ts`'s existing pattern (and this design's task 2.2/2.6/2.9, which reuse it) reads the item's `status`/`owner_id` in a plain `SELECT` *before* opening the transaction, makes all business-rule decisions (resolved-check, new-owner cascade, no-op determination) against that snapshot, and then in the transaction runs `UPDATE action_items SET owner_id = $1, updated_at = NOW() WHERE id = $2` — unconditionally, with no `WHERE status != 'resolved'` guard and no check that `owner_id` still matches what was read at snapshot time.

Until now this was a self-race at worst (two concurrent `PATCH .../status` calls against the same item). This change adds a **second endpoint that writes to the same row's `owner_id` and reads/writes `status`**, so the interleaving that matters is now cross-endpoint:

- Facilitator A calls `PATCH .../status` to resolve an item; facilitator B (or A, from a second tab) calls `PATCH .../owner` against the same item at nearly the same time.
- B's `SELECT` at task 2.2 reads `status = 'open'` (A hasn't committed yet) and passes the resolved-item precondition (D3).
- A commits first: `status` is now `resolved`.
- B's transaction then commits anyway — `UPDATE action_items SET owner_id = ...` has no status guard, so it succeeds against a now-resolved item, violating the "resolved is terminal, unhedged" invariant this design otherwise treats as load-bearing (D3, spec scenario "A reassignment attempt against a resolved item is rejected").
- B's `action_item_history` row also writes `previous_owner_id` from the pre-transaction snapshot, which may no longer be accurate if a concurrent reassignment or the resolve interleaved differently — a business record that doesn't match what was actually true immediately before the write.

Design.md doesn't discuss row locking or optimistic concurrency anywhere, and tasks.md 2.6/2.9 don't mention re-checking state inside the transaction. Cheapest fix: add `AND status != 'resolved'` to the final `UPDATE` at task 2.9, check `rowCount`, and return `409` if the row didn't match (the race resolved against the caller, same code as the non-racy path would have produced) — or `SELECT ... FOR UPDATE` at task 2.2. Either is a small, additive change to the transaction block; I'd rather see it in this change than filed as a follow-up, since this change is what turns the single-writer assumption into a two-writer reality.

### 2. [Documentation gap — will mislead a future reader] The contract's stale `global_role`-based Authorization line for VOTE-004 is not on the correction list

`requirements/design/REST API Contract.md` line 2028 currently reads: *"Authorization: `global_role = 'facilitator'` only. The facilitator must have an active session for the team this action item belongs to."* That first sentence is wrong against the actual mechanism this design reuses (D1): the authorization query is `EXISTS (SELECT 1 FROM sessions WHERE facilitator_id = $1 AND team_id = $2 AND status = ANY(...))` — it never checks `users.global_role` at all. Compare VOTE-002's own contract entry (line 1884-1887), which correctly describes the session-scoped mechanism without any `global_role` gate. VOTE-004's entry reads like a draft written before VOTE-002's actual implementation existed, and it was never brought in line.

Design.md's D3 asserts this correction already exists ("matches this codebase's existing house style for this exact situation (the `global_role` correction on this same issue's contract entry, ...)") — I checked, and it doesn't; there's no "Corrected by" note anywhere in the document for VOTE-004's Authorization line, and tasks.md's task 3.1 only plans two corrections (403→409, sessionId optional→required). The `global_role` line is left untouched. Recommend adding a third correction bullet to task 3.1 rewriting the Authorization line to match VOTE-002's phrasing style (session-scoped, no `global_role` gate), so `#68`'s eventual implementer isn't reading a contract that says something the code doesn't do.

### 3. [Minor — tasks.md completeness] `applyTimingFloor` coverage is explicit for two of the four pre-authorization exit branches, silent on the third

VOTE-002's shipped code calls `applyTimingFloor` at all four of its early-exit branches that precede a mutation: item-not-found 404, no-relationship 404, invalid-sessionId 422, and not-an-authorized-facilitator 403 (`action-items.ts` lines 80, 114, 134, 165). Tasks.md 2.3 explicitly calls this out for the relationship-404 branch and "2.4's denial branch" (sessionId 422), but task 2.5 (the facilitator-403 branch) doesn't mention it at all, and design.md's prose doesn't either. This is exactly the kind of easy-to-drop detail that survives code review only if it's spelled out — recommend adding the same explicit call-out to task 2.5, matching the sibling's actual shipped behavior rather than leaving it to be inferred by whoever implements this.

### 4. [Minor — tasks.md completeness] The no-op response path needs `ownerDisplayName`, and tasks.md doesn't say where it comes from

`ReassignActionItemResponse` (per the contract) always includes `ownerDisplayName`. Task 2.8's no-op path only updates `action_items.updated_at` and returns `200` — it doesn't mention fetching the display name, and the initial item load at task 2.2 (`SELECT id, team_id, owner_id, status FROM action_items ...`) doesn't join `users`. Whoever implements this will need to either add a join to 2.2, reuse the user row already fetched by the new-owner-cascade's existence check (task 2.7 step (b)), or add a small follow-up query in the no-op branch. Not a design flaw, just a gap worth naming explicitly so the no-op path doesn't ship a response missing a contractually-required field.

### 5. [Note, not blocking] No shared-types addition for this endpoint's request/response shapes — consistent with sibling precedent, but worth naming

Neither `ReassignActionItemRequest` nor `ReassignActionItemResponse` are added to `packages/shared/src/types/action-item.ts` anywhere in design.md/tasks.md. That's consistent with VOTE-002's own precedent — its `Body` type is inlined directly in the Fastify route generic, and its response is an ad hoc object literal, not a shared type — so this isn't a regression this change introduces. But it's a second data point on the same gap: this codebase's shared-types principle (which I hold as one of the two or three things that actually keeps frontend/backend from drifting) isn't being applied to mutation endpoint bodies/responses, only to domain entities like `ActionItem`. Not something to fix inside this change — matching the sibling's shape is the right call here — but worth a follow-up ticket to backfill shared types for both `VOTE-002` and `VOTE-004` together rather than let a third endpoint repeat the inline pattern.

### 6. [Verified, no concerns] Migration is safe and additive as designed

`previous_owner_id uuid NULL REFERENCES users(id)`, `new_owner_id uuid NULL REFERENCES users(id)`, plus `CHECK ((previous_owner_id IS NULL) = (new_owner_id IS NULL))` — every existing `action_item_history` row has both columns `NULL`, which trivially satisfies the CHECK. No backfill needed, no existing column/constraint touched, ordinary rollback (drop two columns + constraint) suffices — this doesn't need the migrations-manual treatment migration 8 required, and design.md correctly says so. `action_item_history`'s `resolution_note` has no `DEFAULT` but is nullable, so omitting it from the reassignment-row `INSERT` (task 2.10) is fine as-is.

### 7. [Verified, no concerns] Authorization/enumeration/cascade reuse is faithful to VOTE-002

I traced D1/D2/D5/D6/D9/D10 against the actual `action-items.ts` code line-for-line: the relationship check (`evaluateTeamAccess` OR ever-facilitated `EXISTS`, no status filter), the narrower `ACTIVELY_FACILITATING_STATUSES` facilitator gate, the `sessionId` validation query (D11, reused exactly), the same-value no-op shape (skip history/audit, still bump `updated_at`), and the audit dual-write shape all match the shipped pattern exactly, with the one stated and correct divergence (no owner-path fork, since this endpoint has no owner-authorized path — confirmed against `evaluateTeamAccess`'s grant shape, which has no `isOwner` field of its own to misuse). `membership_role` is a two-value enum (`participant`, `engineering_manager` — migration 1), so D5's "role = 'participant' exactly" check is trivially exhaustive once the soft-removed and no-membership-row cases are handled first; no third value can slip through.

## Summary for the team

This is implementable and the boundaries are clean — one file, one migration, no new WebSocket surface, no frontend. My one ask before calling it done is #1 (the two-writer race on `action_items`), since this change is what actually introduces the second concurrent writer to that row; #2 is a real but cheap documentation fix; #3 and #4 are small tasks.md additions that cost a sentence each. #5 and #6/#7 are informational — #6/#7 because I did trace the reuse claims against the actual code and want that on record, not just the design's own assertion of it.
