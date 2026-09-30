# Implementation Review: reorder-topics (Solution Architect)

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Scope:** Uncommitted working tree on `agent-team/52-reorder-topics` (GitHub #52): migration 18, `routes/topics.ts` (TOPIC-006 plus the `checkTeamExists` change), shared types, audit event name, timing-oracle note, `TopicManagementPage.tsx`, `topicOrder.ts`, tests, and requirement document edits. Checked against `design.md` (including the design review disposition) and the three delta specs.
**Verification run:** `packages/backend` `topics.test.ts` passed 141/141. `packages/frontend` `src/pages/__tests__/` passed 223/223 across 20 files. I did not run the DB-backed integration suite.

## Verdict

**Approve, with minor follow-ups.** There are no blocking or major findings. The implementation follows the design closely and stays within the boundaries the design set. It reuses the shared topic-write pieces, it writes to `topics` only, the admin boundary is enforced on the server, and nothing about authorization is left to the UI. The findings below are documentation drift and small UX and accessibility gaps. None of them changes the architecture.

## Conformance to the design (checked items)

| Area | Result | Where |
|---|---|---|
| Migration markers | Uses the real `-- Up Migration` / `-- Down Migration` markers. I checked every header line against node-pg-migrate's split regex `^\s*--[\s-]*(up|down)\s+migration` and none of them matches it (for example, "-- Rollback: npm run db:migrate:down (runs the section below the down" does not). The Up section drops the constraint, drops the superseded `idx_topics_team_active`, and creates the partial unique index. | `migrations/18_topics_active_order_partial_unique.sql:35-39` |
| Migration rollback | The Down section re-spreads archived rows per team to distinct negative values (`ORDER BY archived_at, id`), then drops the unique index, recreates `idx_topics_team_active`, and re-adds the three-column constraint. This matches Decision 1 exactly. The manual up → down → up check (task 1.3) is ticked in tasks.md. I have not re-run it myself. | `:41-50` |
| Check cascade | The order is 403 → 404 → 409 lock → 422 → lock-held stale → no-op → write, and it matches Decision 2. The authorization step uses `checkStandingFacilitatorOrAdminAuthorization`, not TEAM-003's facilitator-only helper. | `routes/topics.ts:483-504`, `:1132-1181` |
| Body validation | Checks run in this order: object check, then array, then length cap (before any per-entry work), then the strict UUID regex, then lowercasing, then the duplicate check. From that point on only the lowercased list is used. Messages never echo submitted values. | `routes/topics.ts:522-548` |
| Advisory lock and stale check | `pg_advisory_xact_lock(hashtext($1::text))` is taken immediately after `BEGIN`, the same way TOPIC-003/004/005 take it. The active set is read team-scoped (`ORDER BY display_order, id`) and compared in memory. A stale request returns a constant 409 body with no IDs. | `routes/topics.ts:1186-1208` |
| Two-phase renumber | Phase 1 is `unnest($2::uuid[]) WITH ORDINALITY` → `-pos`, filtered by `team_id` and `status='active'`. Phase 2 flips negative active rows. Each phase asserts `rowCount === N` and throws `ReorderRowCountMismatchError`, and the catch block runs ROLLBACK and rethrows to the global handler. The `≥ 0` precondition comment is present. The audit insert is in the same transaction. There are unit tests for a mismatch in each phase and for a phase-2 throw. | `routes/topics.ts:1223-1265`; `topics.test.ts:~2330-2375` |
| `openSessionCreatedAt` | `readOpenSessionCreatedAt` returns `null` **before** issuing any query unless `actorGlobalRole === "facilitator"`. This fails closed, so any future role also gets `null`. The status list excludes `draft`, and the query uses `ORDER BY created_at DESC LIMIT 1`. A unit test asserts that no `sessions` SQL runs for an admin on both the changed path and the no-op path, and integration test 5.8 covers the same case. | `routes/topics.ts:581-599`; `topics.test.ts:2305-2319` |
| Audit and log | The audit row carries lowercase ID arrays with no names. `emitAuditEvent` runs after COMMIT and carries `topicCount` only. The lock denial reuses the shared `topic.write_denied_locked` with `attempted_operation: "topic.reordered"`. No-op and stale requests write no audit row. | `routes/topics.ts:1250-1280`; `auth/audit-logger.ts:371-378` |
| `Cache-Control: no-store` | The header is set once at handler entry, so the global handler's 500 carries it too. There is a test for this. | `routes/topics.ts:1138` |
| Timing floor | Every handled exit applies the floor. The thrown path is exempt, as the design records it as an inherited gap. The TODO-GROUP6 note is added. | `content/timing-oracle.ts:53-58` |
| Session isolation | The handler contains no `session_topics` write. Integration test 5.9 asserts the rows are byte-identical before and after a save. | `topics-integration.test.ts` (5.9) |
| Frontend state model | The saved order is derived with `useMemo` from `data.active`, and `draftOrder: string[] \| null` holds the draft. A move that returns to the saved order stores `null`, which is stricter than the design and better. Position numbers are `index + 1`. The 200 handler patches `data.active` in response order with no refetch. Save failures never call `setError`. | `TopicManagementPage.tsx:263-275`, `:427-445`, `:507-560` |
| Interaction locking | All three rules from Decision 8 are implemented, and each has a comment at the point where it applies: Remove and Restore are disabled while the draft is dirty or saving; moves, Save, and Discard are disabled while a dialog is open; moves are disabled while saving or stale. | `TopicManagementPage.tsx:587-602` |
| Stale and error paths | A stale save keeps the draft, disables Save and all moves, and shows Reload. Reload and Discard both refetch through `reloadAfterStale`, which never calls `setError`, and a failed refetch stays stale and shows "Unable to reload topics." Any other failure shows `error.message` or the fallback text in the `role="alert"` region, keeps the draft, and leaves Save enabled. | `TopicManagementPage.tsx:478-496`, `:521-530`, `:790-825` |
| `beforeunload` | The listener is registered only while the draft is dirty, and it calls both `preventDefault()` and sets `returnValue = ""`. | `TopicManagementPage.tsx:463-472` |

### `checkTeamExists` → `TEAM_NOT_FOUND`: effect on endpoints that have already shipped

`routes/topics.ts:156` now includes `code: "TEAM_NOT_FOUND"` in the error envelope. The change is additive: the category, status, and message are unchanged. The frontend does not branch on this 404, and no test asserted the whole envelope with `toEqual`. The existing 404 tests for TOPIC-003/004/005 now assert the code (`topics.test.ts:166`, `:226`, `:957`, `:1532`). This closes the drift between the code and the shipped `remove-topic`/`restore-topic` specs, as Decision 2 step 2 intended. Clients of TOPIC-003/004/005 see one new field and no other change. **This is acceptable.** See m5 for the wider inconsistency, which is outside this change.

## Findings

### Blocking

None.

### Major

None.

### Minor

**m1. "Dense 1..N" is stated as an unconditional response guarantee, but a no-op returns the stored values, which may have gaps.**
`routes/topics.ts:1210-1221` returns the stored `display_order` values on a no-op. The engineer's deviation is correct behaviour. Decision 2 step 6 says a no-op writes nothing, and renumbering on a no-op would be a write without an audit row. However, three documents promise density unconditionally:
- `packages/shared/src/types/topic.ts:120`: "displayOrder is 1-based and dense."
- `REST API Contract.md:904`: `// 1-based and dense (1..N) in the new order`. The no-op note at `:911` does not qualify it.
- The first requirement of the `reorder-topics` spec says "On success, the team's active topics SHALL have `display_order` exactly `1..N`". Its "closes gaps 1, 2, 4, 7" scenario says "saves an order of those four topics", which, read literally, includes saving the current order, and that is a no-op that leaves the gaps.

There is no user-visible effect, because the UI numbers rows by index and never by `displayOrder`, and Save is disabled while the draft is clean. But this is a contract that says one thing while the code does another. **Recommendation:** keep the behaviour and fix the wording. Qualify the type comment and the contract comment ("dense on a changed save; on a no-op, the stored values, which may have gaps"). Qualify the spec requirement to "on a save that changes the order", and make the gap scenario say "a *different* order of those four topics". Integration test 5.1 already uses a changed order.

**m2. The design says the Save bar is always sticky; the implementation makes it sticky only while the draft is dirty.**
See `TopicManagementPage.tsx:780-789`. I judge this **consistent with the spec**. The spec requires the bar to be shown and kept within the viewport *while dirty*. It also requires "Save order SHALL be disabled while the draft is clean", which assumes the bar exists while clean. Always rendering the bar with Save disabled is therefore the reading that satisfies every clause. Making it sticky only while dirty is arguably better, because the bar comes into view (with a shadow) at the moment there is something to save, and the clean page is not cluttered. Discard is also disabled while clean, which is sensible. The gap is that Decision 8's "Save bar: `position: sticky; bottom: 0`" and its "always-visible Save bar" rationale now describe something slightly different from what shipped. **Recommendation:** add one line to design.md Decision 8 recording the refinement. The manual 768px check (task 8.7, which depends on 9.1) is still open and remains the gate for the sticky criterion.

**m3. The stale message is not announced to assistive technology.**
The stale message is a plain `<p>` inside the Save bar (`TopicManagementPage.tsx:792-796`). It is outside the `role="alert"` region, and the `role="status"` region is not updated. A screen-reader user who presses Save hears nothing: the Save button simply becomes disabled. Decision 8 treats stale as one of the save failure paths, and the other failure paths go through the alert. **Recommendation:** render the stale message with `role="alert"`, or route it through the `reorder-save-error` region. This is a one-line change.

**m4. A save error stays on screen after the user changes the draft, and Reload has no in-flight guard.**
- `moveTopic` clears the confirmation (`:438`) but not `saveError` or `saveState: 'error'`. After a failed save, further moves (including moving back to a clean draft, where Save becomes disabled) leave "Unable to save the topic order." on screen. The spec does not forbid this, but the message then describes an attempt that is no longer pending. Consider clearing the error on the next move, the same way the confirmation is cleared.
- The Reload button (`:813`) and the stale Discard path can fire overlapping `/topics/all` fetches if the user clicks twice. The requests are idempotent GETs, so the only risk is harmless extra requests. A small `reloading` flag would tidy this up. Optional.

**m5. `TEAM_NOT_FOUND` is still inconsistent across the codebase (outside this change).**
The topic endpoints now emit the code. `facilitator-sessions.ts:296-301` and `teams.ts:422-428` (and `:577`, `:1188`) still send a team-not-found 404 with no code, and `teams.ts` uses `category: "invalid_request"` on a 404. This change did not introduce that, and should not fix it. It is worth an issue so that the "team not found" error means the same thing on every endpoint.

### Observations (no action required in this change)

- **Inherited gaps are recorded, not fixed.** These are: the thrown-path timing-floor exemption, the lack of any rate limiter or `withTimeout` on topic writes (security F5, still needs an owner and an issue), and the non-UUID `:teamId` path parameter reaching `SELECT … WHERE id = $1` in the shared helpers. Reorder matches its siblings on all of these, which is what I asked for. They should be fixed together across all four topic writes, not only here.
- **Defensive rendering.** `displayedTopics` (`TopicManagementPage.tsx:604-607`) silently drops any draft ID that is missing from `data.active`, and would hide a row that is in `data.active` but not in the draft. The locking rules make this unreachable today. If someone later adds a background refetch, this is where the draft and the server copy would diverge without anyone noticing. The lock comments at `:587-602` are the protection against that, so they must stay.
- **Open tasks before merge:** 4.7 (the #175 comment about lobby-entry snapshot and the density requirement), 8.7 (the 768px sticky check), and 9.1/9.2 (the tablet session and the compact-layout decision). Task 4.7 in particular should not slip. It carries the only cross-change dependency that Decision 7's status list relies on.
