## Context

The pieces around reorder already exist. `topics.display_order` (`integer NOT NULL`) is in `2_create_tables.sql`. Seeded defaults are 1-based (migration 11). `packages/backend/src/routes/topics.ts` holds TOPIC-003 (add, appends at `MAX(active)+1`), TOPIC-004 (archive, which leaves `display_order` alone and so leaves gaps), and TOPIC-005 (restore, appends at `MAX(active)+1`). All three share `checkTeamExists`, `checkCustomizationLockGate`, `writeLockDenialAudit`, `buildErrorEnvelope`, `applyTimingFloor`, and a per-team `pg_advisory_xact_lock(hashtext(teamId))`. TOPIC-004/005 also use `checkStandingFacilitatorOrAdminAuthorization`. `GET /topics` and `GET /topics/all` already `ORDER BY display_order ASC` for active topics (`content.ts:489`, `:575`), and the archived list sorts by `archived_at DESC` (`:603`). `TopicManagementPage.tsx` renders both lists. The missing pieces are the write endpoint and the control. TOPIC-006 is drafted in `REST API Contract.md` but predates three corrections that TOPIC-004/005 have since made.

**Carried in from exploration** (`exploration-notes.md`, revised after Priya Nair's facilitator review and Marcus Delgado's BA review). These are stated here as decisions and not argued again:
- The lock covers reorder through the same gate, the same `409`, and the same denial audit.
- Order is fixed at session *creation* (snapshot into `session_topics`). Reorder writes `topics` only and is never blocked by session state.
- No automatic ordering. That is a non-goal, not a toggle.
- The archived-row collision bug (§3b) is fixed first, inside this change.
- Full-list request. Set mismatch → `409 TOPIC_ORDER_STALE`, malformed → `422`. Last-writer-wins for pure reorders.
- Buttons only, including top/bottom. Visible position numbers. Draft/save with a dirty-means-differs rule. Navigate-away protection is `beforeunload` only (narrowed at proposal review; see Decision 8).
- FR-2.7 is restated, not retired, and no endpoint accepts a session-scoped topic order.

**One finding from reading the code for design.** `App.tsx` uses `<BrowserRouter>`, not a data router, so React Router v7's `useBlocker` is **not available**. An in-app navigate-away prompt would have to be hand-built and would still miss browser Back. That is why the in-app prompt was deferred at proposal review (Decision 8).

## Goals / Non-Goals

**Goals:**
- Fix the archived-row `display_order` collision with a migration that states the intended invariant (uniqueness among active topics only).
- Ship `PUT /api/v1/teams/:teamId/topics/order` (TOPIC-006) as the fourth caller of the shared topic-write pieces, with admin authorization from day one.
- Add reorder controls and a save flow to the existing Topic Management screen that are usable by keyboard and on a tablet, with no new dependencies.
- Bring the TOPIC-006 contract, the Reorder Topics use case, BRD FR-2.7, and the Validation Report into line with what ships.

**Non-Goals:**
- **Automatic ordering of any kind** (by score, by flag, by recency). Ranking topics by score quietly turns a conversation tool into a metric-optimizing tool. Any future proposal needs a full design review, not a setting. Recorded here and not as a spec scenario, because "never happens" can't be meaningfully tested.
- **A per-session reorder path.** No endpoint accepts a topic order scoped to a session. For later sessions, FR-2.7's need is met by "reorder the team configuration, then create the session." For the first session, a per-session reorder would bypass the lock.
- **Changing a created (lobby) session's order.** That belongs to the `topic-skip-and-creation-time-confirmation` work.
- **An in-app navigate-away prompt.** Deferred until a data-router migration can cover link, control, and Back/Forward navigation with one mechanism (Decision 8).
- Populating `session_topics` at creation (#175), drag-and-drop (Decision 11, #181), restore-default-order or a canonical-position hint, re-applying a stale draft onto a refreshed list, and "order last changed by."
- Extending TOPIC-003 to admit `application_admin` (#176).
- Migrating `App.tsx` to a data router.

## Decisions

### Decision 1: Replace the table constraint with a partial unique index on active rows (migration 18)

```sql
-- Up Migration
ALTER TABLE topics DROP CONSTRAINT topics_team_order;
DROP INDEX idx_topics_team_active;                -- superseded; same columns and predicate (3_create_indexes.sql:19)
CREATE UNIQUE INDEX topics_team_active_order
    ON topics (team_id, display_order) WHERE status = 'active';

-- Down Migration
UPDATE topics t SET display_order = -r.rn         -- re-spread archived rows so the full key can be restored
  FROM (SELECT id, row_number() OVER (PARTITION BY team_id ORDER BY archived_at, id) AS rn
          FROM topics WHERE status = 'archived') r
 WHERE t.id = r.id;
DROP INDEX topics_team_active_order;
CREATE INDEX idx_topics_team_active ON topics (team_id, display_order) WHERE status = 'active';
ALTER TABLE topics ADD CONSTRAINT topics_team_order UNIQUE (team_id, display_order, status);
```

Position only has meaning among a team's active topics. The old key included `status`, which made archived rows compete with each other for positions they never use. The partial index removes that without weakening the active invariant.

**The file uses node-pg-migrate's real section markers, `-- Up Migration` / `-- Down Migration`, as migrations 4, 11, and 12 do (revised after engineer review B1).** I checked `node-pg-migrate` 7.9.1 (`dist/sqlMigration.js`): it splits a SQL file only on lines matching `^\s*--[\s-]*(up|down)\s+migration` (case-insensitive, multiline). The bare `-- Up` / `-- Down` markers used by migrations 16 and 17 are **not** recognised, so everything in those files runs as Up. They are safe only because their Down statements are commented out. The original wording here ("a Down section in the 16/17 style" with runnable SQL) would have made every `db:migrate` create the index and immediately undo it. That is the issue #39 failure class. With real markers:
- `npm run db:migrate` runs only the Up section, and `npm run db:migrate:down` runs the Down section. No `migrations-manual/` script is needed.
- No header-comment line may itself start with "-- up migration" or "-- down migration" (for example "-- Down migration re-spreads …"), because the regex would split there. The header goes above the `-- Up Migration` marker and is ignored by the runner.
- `db:migrate` runs with `--no-single-transaction`, which in node-pg-migrate means each migration runs in its own transaction, so Up is atomic.

**The existing non-unique `idx_topics_team_active` is dropped in the same Up (engineer review M1).** It has exactly the new index's columns and predicate. Keeping both would maintain two identical btrees on every active-topic write. The unique index serves every read the old one did (`content.ts:489`, `:575`). Down recreates it.

The index build cannot fail on existing data: the old `(team_id, display_order, status)` key already guaranteed uniqueness among active rows. No precheck is added.

*Alternatives considered:*
- **Archive moves the row to a guaranteed-unique value** (for example, a negative sequence). Rejected: it hides the intent and needs every future archive path to remember it.
- **Make the table constraint `DEFERRABLE INITIALLY DEFERRED`.** Rejected: status is still in the key, so it doesn't fix archived collisions.
- **A partial deferrable `EXCLUDE USING btree (team_id WITH =, display_order WITH =) WHERE (status = 'active') DEFERRABLE INITIALLY DEFERRED`.** This would let a one-statement renumber succeed. Rejected: violations would surface at `COMMIT`, where they are harder to map to a response, and it introduces a less familiar constraint type for a problem the two-phase write (Decision 3) solves plainly.
- **Commented-out Down plus `migrations-manual/18_rollback.sql`** (the migration 8 precedent). Rejected in favour of real markers: the manual-script route exists for rollbacks that must not be run casually, and this one is safe to run.

*Rollback:* re-adding `UNIQUE (team_id, display_order, status)` can fail once archived rows share positions. Down therefore re-spreads archived rows per team to distinct negative values first. Archived `display_order` is not meaningful, so this loses nothing, and negative archived values stay clear of both the restored full constraint and a later reorder's phase 1 (which touches active rows only). Task group 1 includes a manual up → down → up check on a database with two archived rows colliding at the same position.

### Decision 2: The check cascade matches TOPIC-003's order, with set equality evaluated inside the lock

1. `checkStandingFacilitatorOrAdminAuthorization(userId, teamId)` → `403 NOT_A_FACILITATOR | FACILITATOR_IS_TEAM_MEMBER`. The handler writes its own reorder-specific message and calls `applyTimingFloor` itself on both branches, as `checkRestoreTopicAuthorization` does. It must not be copied from TOPIC-003's facilitator-only `checkStandingFacilitatorAuthorization`, which would silently drop the admin branch.
2. `checkTeamExists` → `404`, `category: "not_found"`, `code: "TEAM_NOT_FOUND"`. **`checkTeamExists` is amended to pass the code (engineer review M6).** Today it sends `buildErrorEnvelope("not_found", "Team not found.")` with no code, while the shipped `remove-topic` and `restore-topic` specs and the contract (`REST API Contract.md:793`) already say `TEAM_NOT_FOUND`. Adding the code is additive: it brings TOPIC-004/005 into line with their own specs, and TOPIC-003 gains the same code. The existing 404 tests in `topics.test.ts` get a `code` assertion. Dropping the code from the reorder spec instead would have enshrined an existing spec/code drift.
3. `checkCustomizationLockGate({ endpoint: "PUT /api/v1/teams/:teamId/topics/order", attemptedOperation: "topic.reordered" })` → `409 TOPIC_CUSTOMIZATION_LOCKED` plus the shared denial audit.
4. Body structure → `422`, `category: "invalid_request"`, `code: "INVALID_TOPIC_ORDER"`, `field: "orderedTopicIds"`. Evaluated in this order, with no DB work beyond steps 1–3:
   1. `request.body ?? {}` must be a non-array object (a `null`, bare-array, or string body is a `422`, never a `TypeError` → `500`).
   2. `orderedTopicIds` must be an array.
   3. Length must be 1..`MAX_REORDER_TOPICS` (200). **This is checked before any per-element work** (security review F4), so pre-lock work is bounded by the cap, not by Fastify's 1 MiB body limit.
   4. Every entry must be a JSON string matching `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$` case-insensitively.
   5. **Every entry is then lowercased** (security review F2, engineer review M2), and the duplicate check runs on the lowercased values. From here on only the canonical lowercase list is used: in the set comparison, the no-op comparison, SQL binding, the audit row, and the response.

   Unknown top-level keys are ignored, matching TOPIC-003's typed destructuring of its body.

   The `422` message describes the rule and never echoes submitted values (security review F3). The code deliberately diverges from TOPIC-003's `VALIDATION_FAILED` because the failure is about the list as a whole; the envelope keeps the same shape by setting `field`. The divergence is recorded in the contract.
5. `BEGIN; SELECT pg_advisory_xact_lock(hashtext($teamId))`, then `SELECT id, display_order FROM topics WHERE team_id=$1 AND status='active' ORDER BY display_order, id`. Set equality is computed **in memory** against this team-scoped result. Submitted IDs are never looked up individually or without the `team_id` filter (security review F3). On mismatch → `ROLLBACK`, `409 TOPIC_ORDER_STALE` with a constant body: no diff, no echo, no current list.
6. No-op (submitted sequence equals current sequence) → read `openSessionCreatedAt` (Decision 7), `COMMIT`, `200` with the same `{ topics, openSessionCreatedAt }` shape as a changed save, no audit row.
7. Two-phase renumber (Decision 3).
8. `INSERT audit_log ('topic.reordered', {previous_order, new_order})`, read `openSessionCreatedAt`, `COMMIT`, `emitAuditEvent`, `200`.

`applyTimingFloor` runs on every handled exit (`403`×2, `404`, `409` lock, `422`, `409` stale, `200` no-op, `200`). Following TOPIC-003, the lock check comes before body validation, so a locked team always gets `409` whatever the body is. That is what makes the lock uniform across endpoints.

**The thrown path is exempt from the floor, as an inherited gap (engineer review M8, security review F7).** In TOPIC-003/004/005, `catch { ROLLBACK; throw err }` rethrows to the global error handler without applying the floor. Reorder does the same. After the F2 fix, nothing an attacker controls reaches that path, so it opens no oracle. Fixing it only here would make reorder the odd one out; if it is fixed, it should be fixed for all four topic writes at once.

**Every response from this handler, including errors, sets `Cache-Control: no-store`** (security review F6), matching `GET /topics/all`'s `noStore`. The header is set once at handler entry, not per branch, so the thrown-path `500` written by the global error handler on the same `reply` carries it too. The `200` body carries topic names and, for facilitators, session metadata. The existing topic write handlers don't set it. This change does not retrofit them.

*Alternative:* validate the body before the lock. Rejected because it would make lock behavior vary by endpoint.

### Decision 3: A two-phase renumber inside one transaction

The partial unique index is non-deferrable and is checked row by row, so a single `UPDATE ... FROM (VALUES ...)` that swaps two positions can fail with `23505` partway through. Instead:

```sql
-- phase 1: move every active row to its negated target (distinct, and never colliding with positives)
UPDATE topics t SET display_order = -v.pos, updated_at = now()
  FROM unnest($ids::uuid[]) WITH ORDINALITY AS v(id, pos)
 WHERE t.id = v.id AND t.team_id = $teamId AND t.status = 'active';
-- phase 2: flip to the final 1..N
UPDATE topics SET display_order = -display_order
 WHERE team_id = $teamId AND status = 'active' AND display_order < 0;
```

Phase 1's targets `-1..-N` are distinct from each other and from every existing active value (all ≥ 0). Phase 2's targets `1..N` are distinct from the remaining negatives. Both statements run in the same transaction as the audit insert, so any failure rolls back everything.

**Both phases must report exactly N updated rows** (engineer review M8). Any other count means the rows changed under us, which can't happen under the advisory lock. The handler throws a named error (`ReorderRowCountMismatchError`), the `catch` rolls back and rethrows, and the global error handler produces the `500` and logs it. No hand-built `500` body. This assertion is also the defense in depth the security review asked to keep: even if the set check were wrong, a foreign or archived ID could not be renumbered.

Phase 2's `display_order < 0` predicate depends on every active value being ≥ 0 before the request. That holds today (TOPIC-003 can produce 0, restore produces ≥ 1, provisioning copies 1-based values, and the migration 18 Down puts negative values only on archived rows). The code carries a one-line comment saying so. IDs are bound as a JS array to `$n::uuid[]`, and `WITH ORDINALITY`'s `bigint` casts to `integer` on assignment.

**Density is not an invariant.** Reorder writes 1..N, but the next archive creates gaps again. Nothing may assume the active order is dense; readers order by `display_order` and number by position. This is routed to #175 (task 4.7): the `session_topics` snapshot must renumber with `row_number() OVER (ORDER BY display_order)`, because existing session code assumes dense 1-based `session_topics` (`facilitator-sessions.ts:1190`, `:1853`).

*Alternative:* a `+100000` scratch offset. Rejected because it relies on a magic ceiling. Negation has no ceiling.

### Decision 4: `409 TOPIC_ORDER_STALE` for any set mismatch, `422` only for structure

A single code for missing, extra, archived, other-team, and unknown IDs keeps the endpoint from acting as an existence oracle for topic IDs, and it gives the UI one clear path ("the list changed; reload"). `404` is returned for the team only. The set check runs **inside** the advisory lock that add, archive, and restore also take, so a concurrent set change is always detected, never silently merged.

### Decision 5: Last-writer-wins for concurrent pure reorders

Full-list set equality detects **set** changes, not order changes. Two reorders of the same set both pass, and the advisory lock serializes them, so the later one wins. A version token would add a column and a client round trip to guard a rare case whose damage (an order that can be recovered from the audit row) is cheap. Stated in the spec so nobody mistakes it for a bug.

### Decision 6: Audit carries ID arrays only; no-ops are silent

`topic.reordered` with `metadata: { previous_order: uuid[], new_order: uuid[] }` is added to `AuditEventName`. `new_order` records the canonical lowercase form (Decision 2 step 4). `emitAuditEvent` is called after `COMMIT`, matching `topic.archived` and `topic.restored`. **The structured-log event carries `actorUserId`, `actorGlobalRole`, `actorIp`, `teamId`, and `topicCount` only** (security review F6, engineer minor 7). The ID arrays live in the durable `audit_log` row, which is where anyone investigating an order change looks; 400 UUIDs per log line add pipeline weight and no alerting value. Names are left out because they change and the topic record resolves them. No-op saves write nothing, so the log answers "who moved our warm-up topic to last" without noise. The payload already supports a future "order last changed by" line. As in the TOPIC-004/005 precedent, the write has no rate limiter or `withTimeout` guard. That is inherited, not decided again here. It is, however, now carried by the heaviest of the four topic writes (per-team advisory lock, up to 2×200 row updates, an audit row of up to ~15 KB), so it is listed as a follow-up needing an owner: a shared per-actor limiter across topic writes, with the TEAM-006 limiter as precedent (security review F5).

### Decision 7: `openSessionCreatedAt` on the reorder response, for facilitators only (resolves exploration O-1)

The signal the UI needs ("a session already created on <date> keeps its old order") is cheap to compute on the server in the transaction that already holds the team lock:

```sql
SELECT created_at FROM sessions
 WHERE team_id = $1 AND status IN ('lobby','pre_session','active','wrap_up')
 ORDER BY created_at DESC LIMIT 1
```

Migration 10 guarantees at most one such row, but the query does not rely on that: `ORDER BY … LIMIT 1` means a future drift in that invariant degrades to "the newest one" instead of a `500` (security review F1). It stays a single nullable field. If it ever needs to grow into a session-lookup payload, that is a separate change.

**Who may learn it (security review F1, decided here).** The field exposes one thing: whether the team has a live session, and when it was created. A no-op save writes no audit row, so it can be read silently by submitting the current order. The decision is split by actor:

- **`application_admin`: always `null`; the query is not run.** The codebase draws a firm line for admins. Session content is denied and the denial is audited (`denyAdminContentAccess`, `admin.session_content_denied`), and even the administrative reads admins *are* allowed are audited (`admin.team_detail_accessed`, `admin.membership_list_accessed`). Tomás's option (a) would classify this as administrative metadata, but under this codebase's own convention an admin read of administrative metadata is still an audited read, and a silent no-op probe would be the one unaudited admin read of session state in the system. I will not create that exception for a UX hint. An admin loses nothing functional: the reorder still succeeds, and the UI falls back to the pinned copy ("Sessions already created keep their order"), which Decision 8 always shows.
- **Standing facilitator (`global_role = 'facilitator'`, not a member, which is the only other actor who passes step 1): returned. Accepted with rationale.** This is the population that runs the team's sessions and the one for whom the hint exists. It learns nothing it can't already learn: `POST /api/v1/teams/:teamId/sessions/draft` returns `existingSessionId` and `existingSessionStatus` to exactly this population in its `409` (`facilitator-sessions.ts:395-410`), also without an audit row, and that reveals more (the ID and status) than a timestamp does. The reorder path is also narrower, because it is reachable only for unlocked teams.

No-op saves are still not audited. An audit row per idle Save click, for a signal this small, would be noise (the security review agrees). The spec carries a scenario for the admin case so the boundary is tested and cannot drift silently.

**Why `draft` is excluded (answers the proposal-stage BA question G10).** I checked the code and the contract. The contract's SESSION-001 (`POST /api/v1/sessions`) creates the session in `status: 'lobby'` and bulk-inserts `session_topics` in the same transaction. The `draft` status arrived later (migration 9, `enforce-access-control-on-team-content` Decision 3). A draft is the facilitator's pre-access window for reviewing team history before the room opens. It expires lazily after 24 hours and is advanced to `lobby` by the draft-advance route (`facilitator-sessions.ts`, `prior_status: "draft", new_status: "lobby"`). Brand-new teams are created straight into `lobby`. No shipped route snapshots at any status today (#175). The intended point is lobby entry, not draft creation. That matters for the ritual: the natural flow is "open a draft, look at the trends, notice the heavy topics keep getting skipped, reorder, then open the room." Snapshotting at draft would freeze the order before the facilitator has seen the reason to change it. So the hint counts `lobby` and later only. **Routed to #175:** the snapshot must be taken on entry to `lobby` (both the draft-advance path and direct-to-lobby creation), not on draft creation. If #175 decides otherwise, this status list must change with it. The session-isolation scenarios in the `reorder-topics` spec will not catch that drift on their own. Returning it on the reorder response needs no new endpoint and no extra client fetch, and it is accurate at the moment of save, which is when the facilitator reads it.

*Alternatives considered:*
- Add the field to `GET /topics/all`. Rejected: it can be stale by save time and widens a read contract for one message.
- Static copy only. Rejected as the ceiling, but kept as the floor: the pinned copy is always shown.

### Decision 8: Frontend draft state, interaction locking, `beforeunload`-only guard, and two failure paths

- **State (revised after engineer review M3).** The page already holds `data: GetAllTopicsResponse`. The saved order is **derived**, not stored: `savedOrder = useMemo(() => data.active.map(t => t.topicId))`. The draft is `draftOrder: string[] | null`, where `null` means clean. `isDirty = draftOrder !== null && !arraysEqual(draftOrder, savedOrder)`. Discard is `setDraftOrder(null)`. Rendering uses `draftOrder ?? savedOrder` mapped back to the `data.active` rows. Moves are pure array operations on that list. A `saveState: 'idle' | 'saving' | 'stale' | 'error'` plus a `saveMessage: string | null` covers the save lifecycle. With one copy of the saved order, a `loadTopics()` after Remove/Restore/Reload can't leave a second copy out of sync.
- **On `200`:** rebuild `data.active` in response order, patching each row's `displayOrder` from the response (the response carries only `{ topicId, name, displayOrder }`, so it cannot replace the rows on its own), then `setDraftOrder(null)`. No refetch: that would cost a round trip and bring back the full-page error path. The response element is a named shared type, `ReorderedTopic`, so this mapping has something to import.
- **Position numbers** are `index + 1` of the rendered list, **never** `topic.displayOrder`. Archive gaps make stored values non-dense, and existing test fixtures use 0-based values.
- **Interaction locking (engineer review M5).** Three rules, each stated at its disable site in a code comment:
  1. While dirty **or saving**, Remove (active rows) and Restore (archived rows) are disabled with the visible reason "Save or discard your order changes first." Kept at proposal review because it is the cheapest of the three options, and it is what stops the post-Remove/Restore `loadTopics()` from overwriting the draft. The comment must say so, so nobody "simplifies" it away.
  2. While a Remove or Restore dialog is open or submitting (the page's existing `dialogState` / restore-dialog state is non-null), every move button, Save, and Discard are disabled. The dialogs render inline and are not modal, so without this a facilitator could open Remove while clean, make a move, then confirm, and the post-archive refetch would leave a draft referencing an archived ID.
  3. While `saveState === 'saving'`, every move button, Save, and Discard are disabled, so a move made in flight can't be overwritten by the `200` handler.
- **Guard: `beforeunload` only.** While dirty, the page registers a `beforeunload` listener that calls `event.preventDefault()` **and** sets `event.returnValue = ""` (Chrome and Safari need both), and removes it when clean or on unmount. The in-app prompt planned at explore (a hand-built capture-phase click interceptor, since `BrowserRouter` has no `useBlocker`) is **not built**. It would cover links but not Back/Forward. A guard that works for some ways of leaving and not others teaches facilitators to trust it and then loses their work on Back. One plain rule is better: in-app navigation discards the draft, which is exactly the use case's "reorders but does not save before navigating away" alternate flow, and close/refresh gets the browser's native prompt. The cost of a lost draft is re-doing a handful of moves on an ~11-topic list, and the always-visible Save bar makes an unsaved draft hard to miss. A future data-router migration can add a complete guard (links, controls, and Back) in one mechanism.
- **Accessibility:** after a move, focus goes to the same button in the moved row (by `topicId`). If that button is now disabled at a boundary, focus goes to the nearest enabled one in the row. The refocus is required, not optional: React moves keyed `<li>` nodes with `insertBefore`, and browsers blur a focused element that gets moved. Use a ref map keyed by `${topicId}:${action}` inside `useLayoutEffect`. A single visually hidden `aria-live="polite"` region, **mounted unconditionally on first render** (a region inserted together with its first message is often not announced), receives "X moved to position n of N".
- **Save errors get their own alert (engineer review M4).** The page has no list-level inline error today. Its page-level `error` state is a **full-page replacement** (`if (error) return …`), which would unmount the draft, and the other alerts are per-row. This change adds one `role="alert"` region next to the Save bar (`data-testid="reorder-save-error"`, same visual style as the per-row alerts). Save failures never call `setError`.
- **Stale (`409 TOPIC_ORDER_STALE`):** `saveState = 'stale'`. The draft and message are shown together. Save and every move button are disabled, because resending is guaranteed to fail and further moves would be thrown away. Reload and Discard both refetch `/topics/all` and reset from the server (`setData`, `setDraftOrder(null)`). Discard must not revert to the pre-save order, because that is the list that no longer exists. **The recovery refetch does not go through `loadTopics()`'s `setError` path.** If it fails, the page stays in `stale`, shows "Unable to reload topics." in the save-error alert, and keeps Reload enabled.
- **Every other failure** (`409 TOPIC_CUSTOMIZATION_LOCKED`, `403`, `404`, `422`, `5xx`, network): `saveState = 'error'`, rendered in the save-error alert with the server's `error.message`, falling back to "Unable to save the topic order." The draft stays dirty and Save stays enabled, with no automatic retry. The locked case gets no bespoke copy. The server's lock message is shown, and the path is practically unreachable because the lock only ever releases.
- **Confirmation:** a `role="status"` region shows "Order saved." or, when `openSessionCreatedAt` is non-null, "Order saved. The session created on {date} keeps its original order." It clears on the next move, save, or unmount, with no timer. `{date}` uses `Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" })` in local time (no date library is added); test fixtures use a mid-day UTC timestamp so CI time zones can't shift the day. For an admin the field is always `null` (Decision 7), so the plain message plus the pinned copy is shown.
- **Save bar:** `position: sticky; bottom: 0`. The page has no scroll container of its own; the window scrolls, and no ancestor in `App.tsx` sets `overflow`, so the bar stays in the viewport when the list is scrolled to its last row at 768px and wider. jsdom can't verify this; the manual check in task 8.7 is the gate. **Implementation refinement (architect implementation review m2):** the bar is always rendered while reordering is available, but it is sticky (with a top shadow) only while the draft is dirty; while clean it sits statically below the list with Save order and Discard disabled. This satisfies both spec clauses (kept in the viewport while dirty; Save disabled while clean) and keeps the clean page uncluttered.

### Decision 9: Compact layout while reordering is decided at the tablet check, not up front (exploration O-2)

The v1 plan keeps full rows. The pre-merge tablet session with Priya (task group 9) decides whether a collapsed name-plus-position view is needed. If it is, it's a CSS-level change to the same component and no spec or API impact follows. Deciding on paper would be guessing.

### Decision 10: The length cap is 200 (exploration O-3)

The default set is 11 topics. 200 is well past any plausible team configuration and bounds the request's cost before the advisory lock is taken. The cap is a named constant (`MAX_REORDER_TOPICS`) documented in the contract.

### Decision 11: Move to top / Move to bottom stay in v1; drag-and-drop is deferred (proposal-review decision)

Issue #52 asks for "drag-and-drop plus a non-pointer-friendly alternative per the use case's tablet note." The use case itself is looser. Main Flow step 3 reads "drags a topic ... (or uses an equivalent reorder control)," and the tablet note says drag-and-drop alone may be insufficient and that move controls may be needed. This change ships the non-pointer control and defers drag-and-drop:
- Drag-and-drop needs either a new dependency or a hand-built pointer, touch, and keyboard implementation. Either one is a bigger frontend surface than the rest of this change put together, and buttons already serve every input type.
- The one thing drag-and-drop does that up/down alone does not is a **long move in one gesture**. Move to top and Move to bottom supply that, and they are the moves facilitators actually make (warm-up first, heavy topics pulled forward from the end). Without them, the last of 11 tall rows takes 10 taps to reach the top on a tablet. That is the friction that makes a flexible ritual feel rigid.
- The executive review asked for top/bottom to be deferred. I kept them because they are what lets deferring drag-and-drop stay honest rather than a downgrade. They are two pure array helpers and two more buttons per row that reuse the same disabled-at-boundary, focus, and announcement rules, so the extra test surface is small. The scope cut Rachel asked for is taken from the navigate-away guard instead (Decision 8).

Deferring drag-and-drop departs from the issue's literal text. The issue owner has accepted it, and it is tracked as #181. It is recorded in proposal.md's disposition section and the Follow-ups list.

## Risks / Trade-offs

- [The migration runs on a table read by every session page] → The `DROP CONSTRAINT`, `DROP INDEX`, and `CREATE UNIQUE INDEX` operate on a small table (≈11 × teams). A plain (non-concurrent) create is acceptable, and the migration runs in its own transaction (`--no-single-transaction` runs one transaction per migration).
- [The Down section runs as part of Up if the section markers are wrong] → Real `-- Up Migration` / `-- Down Migration` markers, no header line that matches the marker regex, and the manual up → down → up check in task group 1 (Decision 1).
- [Rollback is not a pure inverse] → Down re-spreads archived positions first (Decision 1). This is documented, and nothing meaningful is lost.
- [Last-writer-wins can silently overwrite a colleague's order] → The case is rare. The audit row holds both orders, and the "order last changed by" follow-up would make it visible.
- [In-app navigation or browser Back with a dirty draft discards it without a prompt] → Accepted for v1, and stated in the screen spec and the use case so testers don't file it as a defect. The loss is a handful of moves. The sticky Save bar makes the unsaved state visible. `beforeunload` still covers close and refresh. A future data-router migration can close this for every navigation type at once.
- [#175 means "next session uses the new order" cannot be shown end to end] → The executable form asserts that the transaction writes no `session_topics` row, plus dense persisted order and correct read endpoints. The limitation is recorded in the spec and the use case AC.
- [Someone "fixes" #175 by snapshotting at start, or reads `topics.display_order` at advance time] → The `reorder-topics` spec scenarios assert that a created session is unaffected, and they will fail if that happens.
- [Two-phase update touches `updated_at` for every active row] → Acceptable. `updated_at` has no consumer that treats it as a content-edit signal.
- [The sentinel `__default_topics__` team (`…0001`) is provisioning's source of default order (`facilitator-sessions.ts:603`)] → Reordering it would silently change the defaults for every new team. Today only the customization lock protects it, because it never has a completed session; archive and restore share the exposure. An integration test asserts `409 TOPIC_CUSTOMIZATION_LOCKED` for the sentinel so a future lock change can't open this up unnoticed.
- [No rate limit on a lock-holding, audit-writing write] → Inherited; recorded as a follow-up (Decision 6).
- [The timing floor is still `[PENDING]` measurement (`timing-oracle.ts`, TODO-GROUP6)] → Reorder at the 200 cap is plausibly the slowest topic write, so it must be included in that p95/p99 measurement; otherwise the floor could sit below reorder's success latency. A note is added next to TODO-GROUP6.

## Migration Plan

1. Deploy migration 18 (task group 1) first, on its own. It fixes today's latent archive 500 independently and is safe to ship ahead of the endpoint.
2. Deploy the backend endpoint and shared types (groups 2–4). The endpoint is inert until the UI calls it.
3. Deploy the frontend (groups 5–6).
4. Rollback: revert the frontend and backend normally. Revert migration 18 only if necessary, with `npm run db:migrate:down` (re-spread archived rows, drop the unique index, recreate `idx_topics_team_active`, re-add the constraint).

The `checkTeamExists` `TEAM_NOT_FOUND` change (Decision 2 step 2) ships with group 2, not group 1, so group 1 stays a pure schema fix. It is additive for TOPIC-003/004/005.

## Open Questions

- **Compact layout on tablet (O-2):** decided at the pre-merge tablet check (Decision 9).
- **Data-router migration:** would allow a complete in-app navigate-away guard (Decision 8). It is out of scope and worth its own issue if other screens need navigation blocking.
- **#175 snapshot point:** this change assumes the snapshot is taken on entry to `lobby`, not at draft creation (Decision 7). #175 must confirm this, or the `openSessionCreatedAt` status list must change with it.
- **Drag-and-drop vs. issue #52's text:** resolved. The owner accepted the deferral to #181 (Decision 11).
- **Rate limiting across topic writes:** follow-up, not this change (Decision 6, security review F5). Needs an owner and an issue; none is filed by this design.

## Design review disposition

Reviews: `design-review-engineer.md` (Marcus Oyelaran) and `design-review-security.md` (Tomás Ferreira). Every claim below that depends on the code was checked against it before deciding.

### Engineer review

| # | Finding | Disposition | Rationale / where |
|---|---|---|---|
| B1 | A runnable "Down section" in the 16/17 style would run as part of Up | **Accepted (option 1).** | Verified in `node-pg-migrate` 7.9.1 `sqlMigration.js`: only `-- Up Migration` / `-- Down Migration` split the file. Migration 18 uses the real markers, as 4/11/12 do; `db:migrate:down` runs the rollback; task 1.3 adds an up → down → up check with colliding archived rows. Decision 1. |
| M1 | New unique index duplicates `idx_topics_team_active` | **Accepted.** | Verified at `3_create_indexes.sql:19`: same columns and predicate. Up drops it, Down recreates it. Decision 1. |
| M2 | Normalise UUID case before duplicate and set checks | **Accepted** (lowercase, not reject). | Same as security F2. Lowercasing accepts every valid UUID; rejecting uppercase would turn a valid request into a `422`. Decision 2 step 4. |
| M3 | Frontend state duplicates `data.active`; response can't replace the rows | **Accepted.** | Saved order derived from `data.active`; `draftOrder: string[] \| null`; `200` patches `data.active` in response order; positions are `index + 1`; shared `ReorderedTopic` type. Decision 8. |
| M4 | No existing inline list-level error treatment | **Accepted.** | Verified: `if (error) return …` replaces the page, and the other alerts are per-row. New `reorder-save-error` alert; stale-recovery refetch failure stays `stale` with "Unable to reload topics." Decision 8, screen spec. |
| M5 | Interaction locking gaps (open dialog, in-flight save) | **Accepted.** | Moves/Save/Discard disabled while a Remove/Restore dialog is open or submitting, and while saving; Remove/Restore disabled while dirty or saving. Decision 8, screen spec. |
| M6 | `404 TEAM_NOT_FOUND` specified but not emitted | **Accepted (add the code).** | Verified: `checkTeamExists` omits the code, while the shipped remove/restore specs and the contract already say `TEAM_NOT_FOUND`. Adding it fixes that drift additively; existing 404 tests gain a code assertion. Decision 2 step 2. |
| M7 | Body-shape edge cases; 422 envelope shape | **Accepted.** | `request.body ?? {}` must be a non-array object; `field: "orderedTopicIds"`; `INVALID_TOPIC_ORDER` recorded in the contract as a deliberate divergence from `VALIDATION_FAILED`. Decision 2 step 4. |
| M8 | 500 path vs. timing floor; phase-2 count; named error | **Adapted.** | Both phases assert N rows and throw `ReorderRowCountMismatchError` to the global handler (accepted). The thrown path stays exempt from the floor as an inherited gap shared with TOPIC-003/004/005, not fixed only here. Decisions 2, 3. |
| m1 | Density is not an invariant; route to #175 | **Accepted.** | Decision 3; added to the #175 note (task 4.7). |
| m2 | Deferrable partial `EXCLUDE` alternative | **Accepted** (recorded, still rejected). | Decision 1 alternatives. |
| m3 | Phase-1 SQL details, `≥ 0` comment | **Accepted.** | Decision 3. |
| m4 | Down must recreate `idx_topics_team_active` | **Accepted.** | Decision 1. |
| m5 | Sentinel-team lock test | **Accepted.** | Risks; task 5.6. |
| m6 | `ORDER BY display_order, id` | **Accepted.** | Decision 2 step 5. |
| m7 | Structured-log payload size | **Accepted** (counts in the log, arrays in the DB row). | Decision 6, with security F6. |
| m8–m12 | `aria-live` mounted on first render; refocus via `useLayoutEffect`; `beforeunload` needs both `preventDefault` and `returnValue`; `Intl.DateTimeFormat`; sticky-bar wording | **Accepted.** | Decision 8. |
| m13 | Named `ReorderedTopic` type | **Accepted.** | Decision 8; task 2.1. |

### Security review

| # | Finding | Disposition | Rationale / where |
|---|---|---|---|
| F1 | `openSessionCreatedAt` exposure to admins and org-wide facilitators; silent via no-op | **Adapted: option (b) for admins, option (a) for facilitators.** | Admins always get `null` and the query is not run: the codebase denies-and-audits admin session-content reads and audits even admin administrative reads, so a silent admin probe would be a new, unaudited exception. Standing facilitators keep the field: `POST /draft`'s `409` already reveals more (session ID and status) to the same population without an audit row, and they are who the hint is for. No-ops stay unaudited. Query is `ORDER BY created_at DESC LIMIT 1`. Decision 7; spec scenario for the admin case. |
| F2 | UUID canonicalisation unspecified | **Accepted.** | Strict case-insensitive pattern, then lowercase before dedupe, set compare, no-op compare, SQL binding, audit, and response; mixed-case duplicates → `422`. Decision 2 step 4; spec scenario. |
| F3 | Keep the stale check non-distinguishing in practice | **Accepted.** | In-memory set compare against the team-scoped read; constant `409` body; `422` never echoes input. Decision 2. |
| F4 | Length cap before per-element validation | **Accepted.** | Decision 2 step 4.3. |
| F5 | No rate limit on a lock-holding, audit-writing write | **Accepted as a follow-up; not fixed here.** | Inherited from TOPIC-003/004/005. Recorded in Decision 6, Risks, Open Questions, and proposal Follow-ups: a shared per-actor limiter across topic writes (TEAM-006 precedent). No issue filed by this design. |
| F6 | Log payload fields; `Cache-Control: no-store` | **Accepted.** | Log event carries `actorUserId`, `actorGlobalRole`, `actorIp`, `teamId`, `topicCount`; every response from this handler sets `no-store`. Decisions 2, 6. |
| F7 | Include reorder in the timing-floor measurement; thrown path skips the floor | **Accepted.** | Reorder at the 200 cap is added to the TODO-GROUP6 measurement note (task 11.2); thrown-path exemption recorded as inherited (Decision 2). |

**Nothing is left unresolved.** The one boundary decision (F1) is made and recorded above. The only open risk is F5, which is inherited and needs an owner outside this change.

### Implementation review disposition

Architect (`implementation-review-architect.md`) and security (`implementation-review-security.md`) reviews both approved. Minor findings handled as follows:

| # | Finding | Disposition | Where |
|---|---|---|---|
| Arch m1 | "Dense 1..N" promised unconditionally, but a no-op returns stored (possibly gapped) values | **Fixed (wording only; behaviour kept).** Density is now promised only after a save that changes the order; a no-op returns stored values and does not renumber. | `packages/shared/src/types/topic.ts` (`ReorderedTopic`); REST API Contract TOPIC-006 response and no-op note; `specs/reorder-topics/spec.md` first requirement, gap scenario ("a different order"), and no-op requirement. |
| Arch m2 | Save bar sticky only while dirty | **Recorded.** Always rendered; sticky only while dirty; Save and Discard disabled while clean. Task 8.7 remains the gate. | Decision 8, Save bar bullet. |
| Arch m3 | Stale message not announced | **Fixed.** The stale message renders with `role="alert"`, matching the page's other failure announcements. Test added. | `TopicManagementPage.tsx`; `TopicManagementPage.reorder.test.tsx` (stale save). |
| Arch m4 | Save error persists after further moves; Reload has no in-flight guard | **Fixed (first part).** The next move clears the save-error alert and resets `saveState` from `error` to `idle`. Test added. The optional Reload `reloading` flag is not added (idempotent GETs). | `TopicManagementPage.tsx` `moveTopic`; `TopicManagementPage.reorder.test.tsx` (other save failures). |
| Arch m5 | `TEAM_NOT_FOUND` code missing on non-topic team 404s | **Deferred** to a follow-up issue; out of scope here. | `facilitator-sessions.ts`, `teams.ts`. |
| Sec L1, L2, F5 | Case-sensitive advisory-lock key on path `teamId`; non-UUID `teamId` → 500 before authorization; no rate limit on topic writes | **Deferred** to one follow-up hardening issue covering all topic write endpoints, per the security reviewer's request. | All topic routes. |
