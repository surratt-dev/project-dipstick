## Why

Teams care about the order in which topics come up. A warm-up topic first, the heavy "how are we really doing" topics once people have loosened up, or the reverse if the heavy ones keep getting skipped at the end of the hour. The use case's own goal says it: *"progress through topics in the most effective order for the team."* Today a facilitator can add, remove, and restore topics, but the order they end up in is whatever the seed, the append rule, and the gaps left behind by archiving produce. `topics.display_order` exists, the Topic Management screen already renders the active list in that order, and TOPIC-006 has been drafted in the REST API Contract since before TOPIC-003 shipped. The endpoint and the control are the only pieces missing. Issue #52 predates the screen, so it describes more missing work than there really is.

This is the last piece of the "add, remove, and adapt within guardrails" promise I made when I argued for this tool. I want it done properly, and I want it done without opening a hole in the guardrails around it. Reorder is **flexibility, not a protective constraint.** I don't need it hardened the way the no-manager rule is. It needs to leave three things exactly as they are:

1. **The first-session lock covers reorder.** The first session runs the canonical set in the canonical order. The use case lists "reordering" among the operations the lock covers. There is no bypass and no separate lock path, and a denied attempt is audited the same way the other three topic writes are.
2. **Order never reaches into a session that already exists.** The topic list is snapshotted into `session_topics` at session *creation* (`session-topic-lifecycle`). Reorder writes to `topics` only. A lobby or in-progress session keeps its sequence, and history is never rewritten.
3. **No automatic ordering.** Not "lowest score first" and not "flagged topics first." Once the tool starts ranking topics by score, it has become a metric optimizer and stopped being a conversation tool. That is the drift I've spent years guarding against.

It also has to land now for a reason that has nothing to do with reorder's value. Exploration found a **latent bug that already exists and that reorder would make common.** `topics_team_order UNIQUE (team_id, display_order, status)` makes two *archived* topics on the same team collide when they share a position. Archive never renumbers, so a facilitator can already hit a 500 today with nothing more than archive, add, archive (exploration-notes.md §3b). Reorder renumbers the active topics to 1..N, onto the numbers archived rows already hold, and after that nearly any archive could fail. The fix ships in this change, before the endpoint.

## What Changes

- **Prerequisite: fix the archived-row `display_order` collision.** A new migration replaces `topics_team_order UNIQUE (team_id, display_order, status)` with a partial unique index on `(team_id, display_order) WHERE status = 'active'`. The new index states the actual intent: position is only meaningful among a team's active topics. Archived rows' `display_order` is formally *not meaningful and not maintained*, since the archived list sorts by `archived_at`. It also drops the now-redundant non-unique `idx_topics_team_active`. The migration uses node-pg-migrate's `-- Up Migration` / `-- Down Migration` markers so its rollback runs through `db:migrate:down` and never as part of Up (design.md Decision 1). This is the first task group, and the endpoint does not ship without it.
- **`PUT /api/v1/teams/:teamId/topics/order` (TOPIC-006), a new endpoint.** The request is a full ordered list of the team's active topic IDs. It reuses the TOPIC-003/004/005 conventions without changes: `checkStandingFacilitatorOrAdminAuthorization` (admin admitted from day one, per FR-8.2 `[HARD]`, so the drafted facilitator-only authorization is **not** repeated), `checkTeamExists` (amended to emit the `TEAM_NOT_FOUND` code its sibling specs already promise), `checkCustomizationLockGate` (`409 TOPIC_CUSTOMIZATION_LOCKED` plus a `topic.write_denied_locked` audit row with `attempted_operation: "topic.reordered"`), the standard error envelope, `applyTimingFloor` on every exit, and the per-team advisory lock. New behavior:
  - `422` for a structurally malformed body (not an object, not an array, non-UUID entries, duplicates after lowercasing, empty, over a fixed length cap of 200). UUIDs are accepted in any case and canonicalised to lowercase.
  - `409 TOPIC_ORDER_STALE` when a well-formed list does not equal the team's current active set. One code covers missing, extra, archived, other-team, and unknown IDs, so the endpoint cannot be used to test whether an ID exists. This doubles as detection of **set** changes made concurrently by add, archive, or restore.
  - Dense **1-based** renumbering (matching the seed), written in two phases inside one transaction so no partial order is ever persisted.
  - A no-op save returns `200` with the same `{ topics, openSessionCreatedAt }` shape and writes no audit row. A real change writes a `topic.reordered` audit row with `{ previous_order, new_order }` as ID arrays.
  - Concurrent *pure* reorders of the same set follow **last-writer-wins**, stated explicitly, and the audit row is the recovery path.
  - The response includes a single nullable `openSessionCreatedAt` so the UI can tell the facilitator plainly that an already-created session keeps its order (resolves exploration open item O-1 with no new endpoint). It counts sessions in `lobby` through `wrap_up`, not `draft`, because a draft is the pre-access window for reviewing history before the room opens (design.md Decision 7). It is returned to facilitators only. An `application_admin` always gets `null`, because admins are denied session content and this must not become an unaudited way around that (security review F1).
  - Every response carries `Cache-Control: no-store`.
- **Reorder controls on the existing Topic Management screen.** Each active row gets Move up, Move down, Move to top, and Move to bottom buttons, plus visible 1-based position numbers. These buttons are the non-pointer control the use case's tablet note asks for. Top and bottom make the long moves one tap. The order is kept as a local draft with a Save order / Discard bar that stays in the viewport at 768px and wider. The draft counts as dirty only when it differs from the saved order. Remove and Restore are disabled with a stated reason while the draft is dirty, and reordering is disabled while a Remove/Restore dialog is open or a save is in flight. Closing or refreshing the tab with unsaved changes triggers the browser's `beforeunload` prompt. In-app navigation is not intercepted and discards the draft, as the use case's alternate flow already says. Failures take two paths. A stale save explains itself and resolves by Reload. Every other failure shows the server's message in a save-error alert beside the Save bar (never the full-page load error) and keeps the draft for retry. Focus is retained after each move and every move is announced through `aria-live`. The pinned copy reads: *"Order changes apply to sessions created after you save. Sessions already created keep their order."* The save confirmation is "Order saved." or, when a session already exists, "Order saved. The session created on {date} keeps its original order." There is no drag-and-drop in this change (see the disposition below). The controls are hidden when the team is locked or has fewer than two active topics. Reorder never appears on the live-session facilitator surface.
- **Requirements documents corrected in the same PR:** the TOPIC-006 contract (authorization, `409` lock, `409` stale / `422` malformed, 404 for the team only, envelope, cascade, timing floor, 1-based numbering, length cap, response shape), the Reorder Topics use case ("start" → "creation", postcondition, #175 annotation, navigate-away decision, FR-2.7 link), the use case's Actor (adds Application Administrator per FR-8.2), the BRD's **FR-2.7 restated (not retired)** with its `[PREF]` tag kept and Marcus's explore-review wording used verbatim, including *"The order in effect when a session is created is the order that session uses"*, and the Validation Report row for FR-2.7. Each edit is limited to what this change makes true.

No **BREAKING** changes. The constraint swap only relaxes uniqueness for archived rows. Every row that was valid before is still valid.

## Capabilities

### New Capabilities
- `reorder-topics`: the `PUT /api/v1/teams/:teamId/topics/order` endpoint (TOPIC-006). Covers authorization (the shared standing-facilitator-or-admin check), the fixed check cascade, `422` malformed vs. `409 TOPIC_ORDER_STALE`, full-list set-equality inside the advisory lock, dense 1-based atomic renumbering, no-op handling, last-writer-wins for concurrent pure reorders, audit posture (`topic.reordered`, lock denials), the `openSessionCreatedAt` hint, and the guarantee that no `session_topics` row is touched.

### Modified Capabilities
- `topic-management-screen`: adds reorder controls, position numbers, draft/save/discard behavior, disabling Remove/Restore while dirty, the `beforeunload` prompt (and the explicit statement that in-app navigation is not intercepted), stale and general failure handling, accessibility, and the pinned copy strings. The existing active list, remove flow, restore flow, and locked treatment are unchanged apart from the controls being hidden when the team is locked.
- `remove-topic`: adds the requirement that archiving succeeds regardless of the `display_order` values archived rows already hold (the collision fix), and that `display_order` uniqueness applies only among a team's active topics.

## Impact

**Code:**
- `packages/backend/migrations/18_topics_active_order_partial_unique.sql`: new. Drops `topics_team_order` and creates the partial unique index.
- `packages/backend/src/routes/topics.ts`: new `PUT .../topics/order` handler next to TOPIC-003/004/005, reusing the shared checks verbatim.
- `packages/backend/src/auth/audit-logger.ts`: `"topic.reordered"` added to `AuditEventName`.
- `packages/shared/src/types/topic.ts`: `ReorderTopicsRequest` and `ReorderTopicsResponse`.
- `packages/frontend/src/pages/TopicManagementPage.tsx`: reorder controls, draft state, save bar, and a `beforeunload` listener. No new dependencies.

**Schema:** one migration, which swaps the table constraint for a partial unique index and drops the duplicate non-unique index. No data change and no backfill. Rollback requires re-spreading archived rows' `display_order` first, and the rollback note explains how.

**Known Limitations (inherited, not introduced here):**
- *"After saving, the new order is used in all subsequent sessions"* cannot be demonstrated end to end, because no shipped endpoint populates `session_topics` at session creation (#175, still open). This is the same inherited gap `restore-topic` documented. What this change proves: `topics.display_order` is persisted densely as 1..N, `GET /topics` and `GET /topics/all` return the new order, and the reorder transaction writes no `session_topics` row.
- Browser Back and in-app navigation with an unsaved draft discard it without a prompt. Only close/refresh prompts. This is a deliberate v1 scope decision, stated in the screen spec so it isn't filed as a defect.
- `openSessionCreatedAt` assumes #175 will snapshot `session_topics` on entry to `lobby`, not at draft creation. This is routed to #175 (task 4.7).
- Once a session is created (lobby), its order can't be changed. That belongs to the `topic-skip-and-creation-time-confirmation` work, and reorder must not reach into lobby sessions to "help."
- Add Custom Topic (TOPIC-003) is still facilitator-only (#176). With this change, TOPIC-003 is the only topic write that does not admit `application_admin`. This change does not reopen it.
- Topic writes (add, archive, restore, and now reorder) have no rate limit or timeout. Reorder is the heaviest of them. A shared per-actor limiter is a follow-up (design.md Decision 6, security review F5).
- Add (`COALESCE(MAX,-1)+1`) and Restore (`COALESCE(MAX,0)+1`) use different empty-set bases. This is harmless because the last-active guard means an active topic always exists. It is noted here and not changed.

**Not touched:** the no-manager-participation rule, the simultaneous reveal, the facilitator-from-another-team requirement, `session_topics` and the snapshot-at-creation rule, trend/EM views (they group by `topic_id` and sort by each session's own snapshot order), and TOPIC-007 (Annotate).

**Follow-ups (explicitly not this change):** drag-and-drop (#181; the owner accepted the deferral), a shared per-actor rate limiter across topic writes (security review F5), an in-app navigate-away prompt via a data-router migration that also covers Back/Forward, restoring the default *order* or a canonical-position hint, re-applying a stale draft's relative order onto a refreshed list, and an "Order last changed by <name> on <date>" line sourced from the `topic.reordered` audit row. The audit payload is already shaped to support that last one.

## Proposal review disposition

Reviews: Marcus Delgado, BA (`propose-review-ba.md`, approve with minor revisions), and Rachel Okonkwo, Executive (`propose-review-exec.md`, approve with conditions). Priya Nair's explore review (`explore-review-facilitator.md`) was re-read because three of Rachel's cuts touch items Priya asked for. My test for each contested item was the same one I apply to this whole feature. Reorder is flexibility, not a protective constraint, so it earns UI only where the UI prevents a facilitator from losing trust in the tool. I cut where the UI is ceremony.

### Contested items (Rachel vs. Priya)

| Item | Rachel | Priya | Decision | Rationale |
|---|---|---|---|---|
| Move to top / Move to bottom | Defer | Essential on tablet (O1, Q1) | **Rejected Rachel's cut, kept** | Issue #52 asks for drag-and-drop plus a non-pointer alternative. We are deferring drag-and-drop, and top/bottom is what keeps that deferral from being a downgrade: it is the one thing drag-and-drop does that up/down can't, which is a long move in one gesture. Those long moves are the real edits (warm-up first, heavy topic pulled forward). The cost is two pure array helpers and two buttons per row, reusing the same boundary, focus, and announcement rules. design.md Decision 11. |
| Navigate-away guard (in-app plus `beforeunload`) | Defer, or `beforeunload` only | Both, for v1 (Q5) | **Adapted: `beforeunload` only** | Without `useBlocker`, the in-app prompt is a hand-built global click interceptor that still misses browser Back. A guard that catches some exits and not others teaches people to trust it, then drops their work on Back. That is worse for trust than one plain rule. The use case's alternate flow already says in-app navigation discards. The loss is a handful of moves on an ~11-topic list, and the sticky Save bar makes an unsaved draft visible. This also settles BA G3 (the Back limitation), because the spec now says plainly that no in-app navigation is intercepted. The tablet session (8.1) asks Priya whether this felt like losing work. A complete guard waits for a data-router migration. design.md Decision 8. |
| Remove/Restore while the draft is dirty | Simplify: discard after confirm, or let them work and rely on the stale check | Disable, with a visible reason (O5) | **Kept (disable with reason). This meets Rachel's own criterion** | Rachel asked for the cheaper option to build and test. Disabling is one `disabled={isDirty}` plus one line of copy. "Discard after confirm" adds a dialog. "Just let it work" means the page's own post-Remove refetch overwrites the draft, or the next save fails with a stale error the facilitator caused on the same screen. A code comment will record why the rule exists (BA §3). |
| Distinct error handling | Stale gets its own path; everything else uses the existing pattern | Don't discard the draft before I've read the message (O6); keep lock feedback quiet (O7) | **Accepted Rachel's shape, with Priya's constraint and the BA's catch-all** | There are two paths. Stale shows its message, keeps the draft visible, disables Save and moves, and resolves by Reload or Discard to the server's order (BA G2). Everything else (locked, 403, 404, 422, 5xx, network) shows the server's `error.message` in an inline alert (at design review this became a new save-error alert beside the Save bar, because the page's only list-level error replaces the whole screen; design.md Decision 8), keeps the draft, and leaves Save enabled (BA G1). The bespoke locked copy is dropped, which also settles BA G7. |

**Drag-and-drop against the issue's text: flagged, not silently resolved.** Issue #52 says "drag-and-drop plus a non-pointer-friendly alternative." The use case is looser. Main Flow step 3 allows "an equivalent reorder control," and its tablet note treats move buttons as the alternative. I'm deferring drag-and-drop because it means a new dependency or a hand-built pointer, touch, and keyboard layer, which would be larger than the rest of this change, while the buttons already serve every input. The deferral departs from the issue's literal wording, so **the issue owner has to accept it** (or reopen it as a follow-up) before this change is archived. I'm not treating that as decided by me.

**Resolution (2026-09-30):** The issue owner accepted the buttons-only scope for this change. Drag-and-drop is tracked as follow-up issue #181.

### Rachel's other conditions

| Condition | Disposition |
|---|---|
| 1. Collision migration first, independently revertible and shippable, with the §3b repro as a regression test | **Accepted.** Shipping note added to tasks group 1. |
| 3. Requirements-doc edits surgical, with no drive-by rewrites | **Accepted.** Scope note added to tasks group 10. |
| 4. "No automatic ordering by score" recorded as a design decision | **Already met** (design.md Non-Goals). No change. |
| 5. `openSessionCreatedAt` stays a single nullable field | **Accepted.** Stated in design.md Decision 7. |
| Raise #175's priority | **Agreed, routed.** Outside this change. #175 now also carries the snapshot-point dependency (task 4.7). |

### Marcus's gaps

| # | Gap | Disposition |
|---|---|---|
| G1 | 403/404/422 save errors undefined | **Accepted.** A catch-all non-stale failure path with the server message or "Unable to save the topic order.", draft kept, no auto-retry, plus a `403` scenario. |
| G2 | Stale-state behavior of Save, moves, and Discard | **Accepted.** Save and moves are disabled while stale, and Discard and Reload both go to the server's order. Scenarios amended and added. |
| G3 | Back-button limitation only in design | **Accepted, and made simpler.** The spec now says no in-app navigation (links, controls, Back/Forward) is intercepted, with a scenario. |
| G4 | Open-session confirmation not pinned | **Accepted.** "Order saved. The session created on {date} keeps its original order." (local date, "Sep 30, 2026"). It replaces "Order saved." and is not stacked with it. |
| G5 | "Reachable" and "transient" untestable | **Accepted.** The bar is in the viewport at the last row at ≥768px (scenario plus task 8.7). The confirmation sits in `role="status"` and stays until the next move, save, or leaving, with no timer. |
| G6 | No-op response shape | **Accepted.** Same `{ topics, openSessionCreatedAt }` shape, in both spec and tasks. |
| G7 | Locked copy mismatches the existing notice | **Accepted by removal.** No bespoke locked copy. The server message is shown via the general failure path. |
| G8 | FR-2.7 must keep `[PREF]` and the "order in effect when a session is created" sentence | **Accepted.** Task 10.5 uses the explore wording verbatim. |
| G9 | Admin missing from the use case | **Accepted.** Actor and AC annotation added to task 10.3. |
| G10 | Does a `draft` session have the snapshot? | **Answered from the code and contract.** SESSION-001 creates in `lobby` and snapshots in that transaction. `draft` (migration 9) is a later pre-access state for reviewing history, advanced to `lobby` by its own route. Nothing snapshots today (#175). The snapshot belongs on entry to `lobby`, so `draft` is dropped from the `openSessionCreatedAt` status list, with a scenario. The dependency is recorded in design.md Decision 7 and routed to #175 (task 4.7). |
| §3 | Unknown body keys | **Decided in task 3.4.** Unknown top-level keys are ignored, as in TOPIC-003; tested in task 5.2 and documented in the contract (task 10.1). |
| §3 | Last-writer-wins test must force the order | **Accepted.** Task 5.7 now forces commit order instead of racing. |
| §3 | Comment explaining the Remove/Restore disable rule | **Accepted.** Task 6.7. |
