# Design Review: Reorder Topics (Engineer)

**Reviewer:** Marcus Oyelaran, Senior Full Stack Engineer
**Artifacts reviewed:** `design.md`, `proposal.md` (read against `specs/*/spec.md` and `tasks.md` where the design defers to them)
**Code checked:** `packages/backend/src/routes/topics.ts`, `routes/content.ts`, `routes/facilitator-sessions.ts`, `auth/audit-logger.ts`, `auth/topic-lock-helper.ts`, `migrations/2_create_tables.sql`, `3_create_indexes.sql`, `7`, `8`, `10`, `11`, `12`, `16`, `17`, `migrations-manual/8_rollback.sql`, `node_modules/node-pg-migrate` (v7.9.1, `dist/sqlMigration.js`), `packages/shared/src/types/topic.ts`, `packages/frontend/src/pages/TopicManagementPage.tsx` and `__tests__/TopicManagementPage.test.tsx`
**Scope note:** Drag-and-drop is deferred to #181 with the owner's approval. I don't revisit it here.

## Verdict: **Approve with changes (1 blocking, 7 major)**

The backend design is sound. The partial unique index states the real invariant. The two-phase negate-then-flip renumber is correct. Doing the set-equality check inside the per-team advisory lock closes the concurrency gap, because every writer of active-topic status or order already takes that lock (TOPIC-003 `:546`, TOPIC-004 `:690`, TOPIC-005 `:892`). The only other `INSERT INTO topics` is team provisioning (`facilitator-sessions.ts:603`), and that only writes to a team that doesn't exist yet. The cascade reuses the shared pieces in the right order. What needs fixing is at the edges. The migration file format has a known footgun in this repo. A few error paths are unspecified. The frontend state model duplicates state the page already holds.

---

## Blocking

### B1. The migration's "Down section" will run as part of Up if it's written in the 16/17 style

The design says to write the rollback "in the migration 16/17 style". It also says "the Down section therefore first re-spreads archived rows … then drops the index and restores the constraint." Those two instructions conflict in this repo.

- node-pg-migrate 7.9.1 splits SQL files only on `^\s*--[\s-]*up\s+migration` / `down\s+migration` (`dist/sqlMigration.js`). Plain `-- Up` / `-- Down` markers are **not recognised**, so the whole file runs as Up. Migrations 16 and 17 are safe only because their Down statements are commented out.
- If migration 18 has runnable SQL under `-- Down`, then `npm run db:migrate` creates the partial index and immediately re-spreads, drops it, and re-adds `topics_team_order`. The fix would silently undo itself on every deploy. This is the same failure class as issue #39, where `8_rollback.sql` was auto-executed.

**Required:** pick one of the following and state it in design.md Decision 1 and task group 1:
1. **Preferred:** use the real `-- Up Migration` / `-- Down Migration` markers, as migrations 4, 11 and 12 already do. `npm run db:migrate:down` then works. Task group 1 should include one manual check: up, then down (on a DB with two archived rows colliding at the same position), then up again.
2. Comment out the Down SQL, as 16/17 do, and put the executable rollback in `migrations-manual/18_rollback.sql`, following the migration 8 precedent.

Either way, the design must stop describing the rollback as a "Down section" that simply exists. It has to say how the rollback is run.

---

## Major

### M1. The new unique index duplicates an existing index

`3_create_indexes.sql:19` already has `idx_topics_team_active ON topics (team_id, display_order) WHERE status = 'active'`, which is non-unique and has the same columns and predicate. Migration 18 would leave two identical btrees. Every active-topic write would maintain both, and the planner would pick one arbitrarily. Drop `idx_topics_team_active` in the same Up and recreate it in the Down. The unique index serves every read the old one did (`content.ts:489`, `:575`).

The index build itself is safe. The old `(team_id, display_order, status)` key already guaranteed uniqueness among active rows, so `CREATE UNIQUE INDEX` cannot fail on existing data. A migration-10-style `DO $$ … RAISE` precheck is optional.

### M2. Normalise UUID case before the duplicate and set checks

Postgres returns lowercase UUIDs. A UUID regex that accepts either case, followed by a JS `Set` comparison, has two problems:
- An uppercase ID gets a false `409 TOPIC_ORDER_STALE`, which is the wrong code for a valid request.
- `"ABC…"` and `"abc…"` pass the duplicate check and only fail later at the set check, with the wrong code.

**Fix:** lowercase every entry right after the type check and before the duplicate check. Alternatively, accept lowercase only and return `422` for anything else. Pick one and add one test for it. A non-UUID entry must also be rejected before any DB call, because `$1::uuid[]` raises `22P02`, which surfaces as a 500. The design already puts UUID validation before the DB, so keep it there.

### M3. The frontend state model duplicates `data.active`, and the save response can't replace it

Decision 8 adds `savedOrder` and `draftOrder` next to the page's existing `data: GetAllTopicsResponse`. Two copies of "saved order" will drift. After any `loadTopics()` call (Remove, Restore, Reload), someone has to remember to re-sync `savedOrder`.

The save response is `{ topics: [{ topicId, name, displayOrder }] }` (tasks 2.1). It doesn't carry `prompt`, `voteType`, `firstSessionDescription` or the other fields the rows render. "On 200, sets both from the response" therefore can't update `data.active`. The list would keep showing the pre-save order until the next fetch.

**Recommend:**
- Derive `savedOrder` from `data.active` (`useMemo`, ids only). Don't store it.
- Make the draft `draftOrder: string[] | null`, with `null` meaning clean. Then `isDirty = draftOrder !== null && !arraysEqual(draftOrder, savedOrder)`, and clearing or discarding is just `setDraftOrder(null)`.
- On `200`, rebuild `data.active` in response order and patch in the new `displayOrder`, then `setDraftOrder(null)`. Calling `loadTopics()` instead also works, but it costs a round trip and brings back the full-page error path (M4).
- Render position numbers as `index + 1` of the rendered array, **never** `topic.displayOrder`. Archive gaps make stored values non-dense, and the existing test fixtures use 0-based `displayOrder`.

### M4. There is no existing inline error treatment for list-level errors

Decision 8 says non-stale failures render "in the screen's existing inline `role="alert"` treatment". There are only two treatments on the page today:
- The page-level `error` state, which is a **full-page replacement** (`if (error) return …` at `:353`). Using it for a save error would unmount the draft.
- Per-row `remove-error-*` / `last-active-blocked-*` alerts.

This change needs a new save-error alert next to the Save bar (same visual style, new `data-testid`). Say so, so the implementer doesn't reach for `setError`.

The same problem affects stale recovery. Reload and Discard call `loadTopics()`, which on failure calls `setError` and replaces the whole page. Specify what happens when the stale-recovery refetch fails. My suggestion: stay in `stale`, show "Unable to reload topics." in the save-error alert, and keep Reload enabled.

### M5. Interaction locking has to cover both directions and the in-flight window

`disabled={isDirty}` on Remove and Restore only covers "dirty → can't archive". Three gaps remain:
- **Dialog already open:** the Remove or Restore dialog renders inline and isn't modal. A facilitator can open it while clean, make a move, and then confirm. The dialog's confirm button isn't covered, and the post-archive `loadTopics()` then leaves a draft that references an archived ID. Either hide or disable the reorder controls while `removeState` or `restoreState` is not `idle`, or disable the dialog confirm buttons while dirty.
- **While saving:** disable moves, Save and Discard while `saveState === 'saving'`. Otherwise a move made in flight is overwritten by the 200 handler, or the response gets applied on top of a newer draft.
- **Stale:** already specified correctly.

### M6. `404 TEAM_NOT_FOUND` is specified but not emitted

`checkTeamExists` sends `buildErrorEnvelope("not_found", "Team not found.")` with **no `code`**. The spec, tasks 2.5 and 9.1 (contract) all say `404 TEAM_NOT_FOUND`. Pick one:
- Pass the code in `checkTeamExists`. This is an additive change to the TOPIC-003/004/005 responses, so check their tests.
- Write the spec, contract and tests as "404, `category: not_found`, no code", matching today's behavior.

Leaving it as is guarantees that a cascade test fails, or that someone weakens the assertion to make it pass.

### M7. Body-shape edge cases and the 422 envelope

- `request.body` can be `null`, a bare array, or a string. Tasks 2.4 must use `request.body ?? {}` and check `typeof === "object" && !Array.isArray` before reading `orderedTopicIds`. The result must be `422`, never a TypeError that becomes a 500.
- TOPIC-003's 422 is `VALIDATION_FAILED` with a `field`. `INVALID_TOPIC_ORDER` is a reasonable deliberate divergence, but also set `field: "orderedTopicIds"` so the envelope has the same shape. Record the divergence in the contract (task 9.1).

### M8. The 500 path and the timing floor

Decision 2 says `applyTimingFloor` runs "on every exit". Decision 3 says a phase-1 row-count mismatch is "treated as a 500". In the existing handlers the thrown path (`catch { ROLLBACK; throw err }`) does **not** apply the floor. Either:
- state that the 500 path is exempt, as an inherited gap shared with TOPIC-003/004/005, or
- apply the floor before rethrowing.

Also assert that **phase 2** updates N rows, not only phase 1. Throw a named error rather than returning a hand-built 500, so the global error handler and logging stay consistent.

---

## Minor / notes for the implementer

1. **Density is not an invariant. Route this to #175.** Reorder writes dense 1..N, but the next archive creates gaps again. Existing session code assumes dense 1-based `session_topics` (`facilitator-sessions.ts:1190` `display_order = 1`, `:1853` `display_order + 1`). #175's snapshot must renumber with `row_number() OVER (ORDER BY display_order)`, not copy `topics.display_order`. Add this to the note routed by task 9.7, and make sure no design wording implies "active order is always dense".
2. **The deferrable alternative is incomplete.** It's true that a partial *unique index* can't be deferrable. A partial `EXCLUDE USING btree (team_id WITH =, display_order WITH =) WHERE (status = 'active') DEFERRABLE INITIALLY DEFERRED` can be. I'd still choose two-phase: violations would surface at `COMMIT` and be harder to map, and it adds a less familiar constraint type. Record the alternative so the rejection is complete.
3. **Phase-1 SQL details.** `WITH ORDINALITY` yields `bigint`. `-v.pos` casts to `integer` on assignment, which is fine. Pass IDs as a JS array bound to `$n::uuid[]`, since node-pg serialises it. The `display_order < 0` predicate in phase 2 depends on every active value being ≥ 0, which holds today: TOPIC-003 can produce 0, restore produces ≥ 1, and provisioning copies 1-based values. Add a one-line comment saying so.
4. **Rollback re-spread.** Archived rows get negative values while active rows stay positive, so both the re-added full constraint and a later reorder's phase 1 (active rows only) are safe. If you take M1, the Down must also recreate `idx_topics_team_active`.
5. **Sentinel team.** `00000000-…-0001` is in `teams`, and provisioning copies its `display_order` into every new team (`facilitator-sessions.ts:603`). Reordering it would silently change the defaults for every new team. Today only the lock protects it, because the sentinel team never has a completed session. Archive and restore have the same exposure. Add one integration test asserting `409 TOPIC_CUSTOMIZATION_LOCKED` for the sentinel, so a future lock change can't open this up unnoticed.
6. **Stale-check query.** Use `ORDER BY display_order, id`, for the no-op comparison as well. Under the unique index ties can't happen, but a deterministic order costs nothing.
7. **Structured-log payload.** `emitAuditEvent` with two 200-element UUID arrays is about 15 KB per log line in the worst case. That's acceptable. Consider logging counts plus arrays only at `info` if log volume becomes a concern. The `audit_log.metadata` row should keep the full arrays.
8. **`aria-live` region.** Mount it unconditionally on first render. A region inserted at the same moment as its first message is often not announced. Tests should assert its text content after each move.
9. **Focus after a move.** React moves keyed `<li>` nodes with `insertBefore`, and browsers blur a focused element that gets moved. The explicit refocus in Decision 8 is therefore required, not optional. Use a ref map keyed by `${topicId}:${action}` inside `useLayoutEffect`, and assert `document.activeElement` in tests.
10. **`beforeunload`.** Call `event.preventDefault()` **and** set `event.returnValue = ""`, because Chrome and Safari need both. Test by dispatching a cancelable `beforeunload` and asserting `defaultPrevented`. Assert that no listener exists when the draft is clean.
11. **Date format.** There's no date library in the frontend. Use `Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" })` to get "Sep 30, 2026". Use a mid-day UTC timestamp in fixtures so CI time zones can't shift the day.
12. **Sticky save bar.** The page has no scroll container of its own. The window scrolls, and no ancestor in `App.tsx` sets `overflow`, so `position: sticky; bottom: 0` works as intended. Reword "inside the page's scroll container" to avoid confusion. jsdom can't verify this, so task 7.5's manual check is the right gate.
13. **The `topics` element type in the response** should be a named shared type (for example `ReorderedTopic`), not an inline object literal in `ReorderTopicsResponse`. The frontend mapping in M3 then has something to import.

---

## Confirmed sound (no change needed)

- **Concurrency model.** The set check inside `pg_advisory_xact_lock(hashtext(teamId))` sees every committed add, archive and restore, because all three take the same lock before mutating. Last-writer-wins for pure reorders is honest and cheap. Forcing commit order in the task 3.8 test is the right approach: hold the advisory lock from a test client, then release it.
- **Two-phase renumber.** The reasoning is correct. A non-deferrable unique index is checked row by row, so a one-statement swap can raise `23505`. Negation avoids a magic ceiling.
- **Cascade order.** Lock before body validation matches TOPIC-003, and a locked team gets `409` regardless of the body. Admin is admitted from day one through `checkStandingFacilitatorOrAdminAuthorization`, wrapped like `checkRestoreTopicAuthorization`.
- **`openSessionCreatedAt`.** The status list `lobby, pre_session, active, wrap_up` matches migration 10's enum values minus `draft`. At most one row is guaranteed. Reading it inside the locked transaction is correct.
- **Audit.** Writing to the same transaction and then calling `emitAuditEvent` after `COMMIT` matches `topic.archived` / `topic.restored`. Silent no-ops are the right call.
- **No new dependencies.** Confirmed feasible. Everything in Decision 8 is plain React state plus a window listener.
