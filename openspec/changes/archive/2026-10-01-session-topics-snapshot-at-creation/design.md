# Design: session-topics-snapshot-at-creation (#175)

## Context

`session_topics` is the topic list a session runs on. Begin-voting, reveal, advance, vote lock-in, history, EM views, the reveal payload, and the WebSocket registration snapshot all read it. Nothing in `src/` writes it, so every real session fails at `SESSION-005` with a clean 409.

Two code paths make a session reach `lobby`:

- `POST /api/v1/teams/:teamId/sessions/:sessionId/advance` (`facilitator-sessions.ts` ~L690–805). Today it checks the status outside the transaction, then runs an unconditional `UPDATE sessions SET status = 'lobby'` plus an audit row inside `BEGIN/COMMIT`. A non-draft session gets a 422. It reads `users.global_role` only for the audit row and never enforces it.
- `POST /api/v1/teams` (~L470–680). One transaction inserts the team, copies the default topics from the template team, inserts the session directly in `lobby`, and writes the audit row.

Facts the design must respect:

- Active `topics.display_order` is not dense. Archive leaves gaps, and add and restore append at `MAX+1`.
- Readers expect `session_topics.display_order` to run 1..N with no gaps. Advance reads `display_order + 1`.
- **Structural** topic writes (add, archive, restore, reorder: `topics.ts` L780/925/1127/1288) serialize on `pg_advisory_xact_lock(hashtext(teamId))`, keyed on the raw route parameter. The annotation edit (TOPIC-007, L1421) deliberately does **not** take the lock: it is a single-row `FOR UPDATE` with last-writer-wins.
- No schema constraint ties `session_topics.topic_id` to the session's team.
- `sessions.current_topic_id` is written as a `topics.id`, but `session-registration-snapshot.ts` joins it as a `session_topics.id` (R5).
- `readOpenSessionCreatedAt` reports `created_at`, which is the draft's time for a draft-advanced session (R7).
- The house error envelope is `buildErrorEnvelope(category, message, code?, field?)`, local to `topics.ts` L55–80. Coded 409s (`TOPIC_LAST_ACTIVE`, `TOPIC_ORDER_STALE`, `TOPIC_CUSTOMIZATION_LOCKED`) use `precondition_failed`. Server-side failures use `internal_error`. There is no `conflict` or `server_error` category.
- `ci.yml` runs backend tests with coverage and **no Postgres**; real-DB suites use `describe.skipIf(!dbUp)`. `integration.yml` runs the whole suite against Postgres 16.
- Zero active topics is not reachable through the API: `TOPIC_LAST_ACTIVE` blocks archiving the last active topic, and `TOPIC_CUSTOMIZATION_LOCKED` blocks edits before a team's first completed session. It is reachable only through data drift (legacy dev teams, manual SQL).

The decisions D1–D13 in `exploration-notes.md` were reviewed by the Facilitator (Priya Nair) and the BA (Marcus Delgado). This design records how to implement them.

## Goals / Non-Goals

**Goals**
- Write a correct, atomic snapshot at room open on both paths, so the full ritual runs end to end.
- Make the lock-in moment visible to the facilitator (confirm copy with the count, zero-topic state).
- Close the two defects this change makes reachable: R5 (reconnect readiness) and R7 (hint date).
- Enforce the live facilitator role on `/advance`, since opening the room now also fixes the team's voting list (Decision 3a).
- Leave the system with a single, named term, "room open", used across specs and requirements.

**Non-Goals**
- Expired-draft handling at `/advance`. This is filed separately as a security-labelled follow-up (see Follow-ups).
- `topics[]` in the `/advance` or `POST /teams` responses.
- Redis session state.
- In-session rendering of the annotation or topic list (#56/#57), a "last look" list (`topic-skip-and-creation-time-confirmation`), "won't apply to today" hints on other topic edits, and new begin-voting backstop copy.
- Snapshotting `first_session_description`.
- A shared error-envelope type in `@dipstick/shared`. The frontend reads `body.error.code` ad hoc, as it already reads `message`.

## Decisions

### 1. Snapshot moment: room open (D1)

The snapshot happens when the status first becomes `lobby`. Two alternatives were rejected:

- **At draft creation.** This would silently throw away the facilitator's draft-window preparation, and it contradicts the shipped `reorder-topics` spec.
- **At start or begin-voting.** The spec forbids it, and the list could change while participants wait in the lobby.

`POST /teams` creates a session directly in `lobby`, so that creation is its room open. This is intended.

### 2. One shared snapshot helper, one statement, team derived from the session (D2)

Add `snapshotSessionTopics(client, sessionId): Promise<{ topicIds: string[] }>` and `NoActiveTopicsError` in a new module, `packages/backend/src/sessions/session-topic-snapshot.ts`. `routes/` holds only Fastify route plugins, so a non-route domain helper gets its own directory rather than sitting among them. Every caller passes its open transaction client. It runs:

```sql
INSERT INTO session_topics
  (session_id, topic_id, display_order, topic_name, topic_prompt, vote_type, topic_annotation, status)
SELECT s.id, t.id,
       row_number() OVER (ORDER BY t.display_order, t.id),
       t.name, t.prompt, t.vote_type, t.team_annotation, 'waiting'
FROM sessions s
JOIN topics t ON t.team_id = s.team_id AND t.status = 'active'
WHERE s.id = $1
RETURNING topic_id, display_order
```

The helper sorts the returned rows by `display_order` to build `topicIds`. It throws `NoActiveTopicsError` when zero rows are inserted.

**Contract (stated in the module's doc comment):**
- The helper takes a `sessionId` only. The source team is the session row's `team_id`, joined inside the statement, so no caller can copy one team's topic names, prompts, or annotations into another team's session. This holds by construction, not by caller validation.
- **The caller must already hold the team lock** (`lockTeamTopics`, Decision 2a) for the session's team, taken in an **earlier statement** of the same transaction. Under READ COMMITTED, the `INSERT ... SELECT` takes its snapshot when the statement starts. Taking the lock earlier means a structural write that committed while this transaction waited is visible to the insert.
- The insert must stay a **single statement**. Per-row consistency with annotation edits, which do not take the lock, comes from the single statement-level MVCC snapshot, not from the lock. A concurrent annotation edit lands entirely before or entirely after the snapshot for that row (last-writer-wins relative to room open). Splitting the helper into a count plus an insert, or into several inserts, breaks that guarantee.
- Any error other than zero rows (for example a 23505 from constraint drift) propagates unchanged to the caller. No caller formats a `DatabaseError` message into a response. *(Implementation note: the app registers no global error handler, and Fastify's default one echoes `err.message` in 5xx bodies. So each caller catches the error itself, logs it with a `correlationId`, and answers a fixed `500 internal_error` body. `/advance` does this for every failure inside the room-open transaction, and `POST /teams` for every failure inside its transaction. A global handler that does this app-wide is follow-up 6; once it lands, these local catches can go.)*

- **Why `row_number()` with `id` as tie-breaker:** this renumbers gaps (R1). The partial unique index makes ties among active rows impossible. The `id` tie-breaker keeps the order deterministic even if that invariant ever drifts.
- **Alternative rejected:** per-row inserts in application code. That means more round trips and more ways to drift.
- **Alternative rejected:** `(sessionId, teamId)` with the caller vouching for the pair. It is safe for today's two route callers, but not for the backfill script or a future "reopen" path.

### 2a. `lockTeamTopics(client, teamId)`: one lock call, one canonical key

Add `lockTeamTopics(client, teamId)` beside the helper. It runs `SELECT pg_advisory_xact_lock(hashtext($1::uuid::text))`. The `::uuid` cast canonicalises the key, because Postgres accepts an upper-case UUID in `WHERE id = $1`, but `hashtext('ABC…')` and `hashtext('abc…')` are different locks. All four existing call sites in `topics.ts` move to it in this change. That is not optional cleanup: if the new sites canonicalise and the old ones do not, a hand-crafted upper-case URL on a topic route would take a different lock from `/advance`, and the reorder-versus-open guarantee would silently fail. Each call site already validates the team (existence or session-row match) before locking, so the cast never raises a 22P02 on user input. `/advance` passes `sessionRow.team_id`, not the URL parameter.

### 2b. Canonical path ids at the route boundary (implementation review M1/MF1, SF1)

*Added after implementation review.* Postgres canonicalises non-canonical UUID spellings, so an authorization query and a later query could resolve the same string differently. One shared validator, `isCanonicalUuid` (`src/routes/uuid.ts`, also used by `auth.ts`'s returnTo allow-list), rejects a non-canonical `teamId` with `404 not_found` before any query on `POST /draft`, `GET /topics/all`, and the five topic write routes, and a non-canonical `sessionId` on `/advance`. Authorization helpers never rewrite their input. Normative in `session-topic-lifecycle`.

### 3. `/advance`: authorize, lock, guard, conditional update, snapshot, audit (D4–D7, D9, D12)

**Before the transaction**, in this order, all unchanged except steps (0) and (d):

0. 404 if `sessionId` is not a canonical UUID, before any query (implementation review SF1; see Decision 2b).
a. 404 if the session does not exist.
b. 403 if `sessionRow.team_id !== teamId`.
c. 403 if the caller is not `facilitator_id`.
d. **403 if the caller's live `users.global_role` is not `facilitator`** (Decision 3a).
e. 422 if the status is not `draft`.

The team lock is taken only after every authorization check has passed, so an unauthorized caller can never hold a team's lock. The spec makes this ordering normative.

**Inside one transaction:**

1. `BEGIN`
2. `lockTeamTopics(client, sessionRow.team_id)`. The team lock is always taken first, which matches every structural topic write and avoids lock-order inversion with the session row (no path takes a `sessions` row lock and then the team lock).
3. `UPDATE sessions SET status = 'lobby', room_opened_at = now() WHERE id = $1 AND team_id = $2 AND facilitator_id = $3 AND status = 'draft'` (as built, with no `RETURNING`; nothing reads the timestamp back). The `team_id` and `facilitator_id` predicates are defence in depth: the guarantee lives in the statement that commits, not only in the pre-transaction read. The code checks `rowCount === 1` explicitly, not truthiness.
   - **0 rows:** re-read `SELECT status FROM sessions WHERE id = $1` (cheap, the lock is held), `ROLLBACK`, and return the existing 422 body with the existing message, `Session cannot be advanced from status '${status}'.` Both 422 paths therefore return the same message. This is the double-click case (D6).
4. `snapshotSessionTopics(client, sessionId)`
   - **`NoActiveTopicsError`:** `ROLLBACK` and return `409 buildErrorEnvelope("precondition_failed", "This team has no active topics. Add or restore a topic on Topic Management before opening the room.", "NO_ACTIVE_TOPICS")`. No audit row: this is not a security event, and it is reachable only by the draft's own, live facilitator.
   - **Any other error:** `ROLLBACK`, log the error with a `correlationId`, and answer a fixed `500 internal_error` body (as built; see the Decision 2 implementation note). The same applies to a failure of the lock, the conditional `UPDATE`, the audit write, or `COMMIT`.
5. Audit row `session.state_changed`, with its metadata extended by `topic_count` and `topic_ids` (Decision 3b).
6. `COMMIT`, then `emitAuditEvent` (with `topicCount`) and publish `session_state_change` (publish after commit, unchanged; the payload carries no topic data).

The pre-transaction checks exist for fast, readable rejections. The conditional `UPDATE` is what actually guarantees correctness. Both 422 paths run before the snapshot, so a non-draft session always gets 422 and never `409 NO_ACTIVE_TOPICS`.

**Why the zero-topic check is not a separate pre-count:** the insert's row count, taken under the team lock, is the authoritative answer. A pre-count outside the lock could disagree with it.

**The 409 is defence in depth.** Zero active topics is unreachable through the API (see Context). The server guard is cheap and stays, but the UI for it (Decision 7) is kept minimal.

**Error envelope.** Move `buildErrorEnvelope` and its `ErrorCategory` union out of `topics.ts` into `src/routes/error-envelope.ts`, add `internal_error` to the union, and use it from both `topics.ts` and `facilitator-sessions.ts`. No new categories are introduced.

### 3a. `/advance` enforces the live facilitator role

Today `/advance` authorizes only on `facilitator_id === session.userId`. A user whose facilitator role was revoked after creating a draft can still open the room. With this change, that also fixes the team's voting list, and it grants that user Path 3 team-content access with no time limit (`team-content-access-helper.ts`). The handler already reads `global_role`. Move that read ahead of the status check, reject with `403` (`forbidden`) when it is not `facilitator` (including a missing user row), and write a denial audit row `session.advance_denied_role` (actor, actor global role, IP, team id, session id), following the `team.creation_denied_role` precedent. Register the operation in `audit-logger.ts`.

This is pre-existing, but it is about five lines on a handler this change already restructures, and the consequence grows with this change. It is taken in scope. Whether the other session-phase endpoints (start, begin-voting, topics-advance) should also enforce the live role is a broader question and goes to Follow-ups.

### 3b. Audit metadata: content boundary and sinks (D12)

- **Content.** The audit metadata for room open (`session.state_changed`, `team.created_with_session`) carries `topic_count` and `topic_ids` (`topics.id` values in snapshot `display_order`) and nothing else from the snapshot. It **never** carries `topic_name`, `topic_prompt`, or `topic_annotation`. The annotation is team free text and is kept out of the application log on purpose (topic-annotation design Decision 7). This rule is normative in the spec, not only a code comment.
- **Sinks.** The `audit_log` row (the durable record) gets `topic_count` and `topic_ids`. The `emitAuditEvent` structured-log line gets `topicCount` only, so the log line and the row agree on the count without carrying the id list into the log. Both are tested.
- **Docs.** The metadata contracts for both operations in `auth/audit-logger.ts` (L187–192, L292–298) are updated, along with the new `session.advance_denied_role`. The conditional `session.topics_backfilled` (Migration Plan step 3) is registered only if the backfill script is built (as built: not registered, pending the 10.3a gate answer).
- **Failure paths.** No audit row is written on `409 NO_ACTIVE_TOPICS` or on the `POST /teams` empty-template `500`, because it would roll back with the transaction. The 500 is covered by the error log line, which carries the `correlationId`.

### 4. `POST /teams`: snapshot after the session insert (D1, D4)

Pull the hard-coded template id at L612 into a named, exported constant `DEFAULT_TOPICS_TEAM_ID` (shared with the existing local constant in `content.ts` L529), so the SQL and the log line cannot drift.

Inside the existing transaction, after the topic copy and `INSERT INTO sessions (..., status = 'lobby', room_opened_at = now())`:

1. `lockTeamTopics(client, newTeamId)`. The new team row is uncommitted and invisible to everyone else, so this lock prevents no race. It is taken **for uniformity**, so the helper's "caller holds the lock" contract has no exception.
2. `snapshotSessionTopics(client, sessionId)`. The join sees the uncommitted session and topic rows because they are in the same transaction.
   - **`NoActiveTopicsError`:** `request.log.error({ templateTeamId: DEFAULT_TOPICS_TEAM_ID, correlationId }, "default topic template is empty")`, `ROLLBACK`, and `500 buildErrorEnvelope("internal_error", "Team creation is unavailable because the default topic set is not configured. Contact an administrator.")` carrying the same `correlationId`. The body never includes the template team id or any SQL or constraint detail. The copy is subject to Priya's review in the walkthrough. No audit row.
   - **Any other error:** `ROLLBACK`, log the error with a `correlationId`, and answer a fixed `500 internal_error` body (as built; see the Decision 2 implementation note). The same applies to any other failure in the `POST /teams` transaction.
3. Extend the `team.created_with_session` audit metadata with `topic_count` and `topic_ids` (Decision 3b).

### 5. `sessions.room_opened_at` and `openSessionCreatedAt` (D9)

- Migration `20_sessions_room_opened_at.sql`, using node-pg-migrate's `-- Up Migration` / `-- Down Migration` markers (migrations 18 and 19 record that bare markers are not recognised): `ALTER TABLE sessions ADD COLUMN room_opened_at timestamptz NULL;`. Down: `DROP COLUMN room_opened_at`. There is no backfill and no default. A nullable `ADD COLUMN` with no default is metadata-only.
- `readOpenSessionCreatedAt` selects `COALESCE(room_opened_at, created_at)` and orders by the same expression. The status list (`lobby, pre_session, active, wrap_up`) and the admin short-circuit are unchanged.
- The field name stays `openSessionCreatedAt`, and its meaning becomes the room-open time. Renaming it would be churn across shared, backend, and frontend for no behavior gain.
- Alternative considered: name the column `topics_snapshotted_at`. Rejected because the column should carry the D1 term, and the snapshot and the open are the same instant by construction.

### 6. Draft facilitator state: `activeTopicCount` (D3)

`GET .../facilitator-state` adds `activeTopicCount` when `status = 'draft'`, computed with `SELECT count(*)::int FROM topics WHERE team_id = $1 AND status = 'active'`, with `$1` taken from the session row's `team_id` (`sr.team_id`), not the URL. The `::int` cast matters: node-postgres returns a `bigint` count as a string, and `"0" === 0` is false, so the disabled state would silently never show. Add the field to the shared response type as `activeTopicCount?: number`, present only for drafts. Other statuses omit the field (normative in the spec). The frontend must not default an absent field to 0. The count discloses nothing beyond what Topic Management shows, and the endpoint is already scoped by session, team, and facilitator.

### 7. Draft host UI (D3, D4, D6)

In `DraftSessionHost.tsx`:

- **A silent refetch.** The existing `loadFacilitatorState()` sets `loadState` to `loading` (replacing the page with "Loading session…" and resetting the copy-link banner) and, on failure, to a full-page error. It cannot be used for these refetches. Add `refetchFacilitatorState(): Promise<RefetchResult>` (as built: `{ kind: "ok", data } | { kind: "failed" } | { kind: "expired" }`), which never touches `loadState` on failure and, on success, replaces `loadState.data` in place (which mounts `LiveReadinessView` when the status is no longer `draft`). Session expiry still goes through `detectSessionExpiry` and then `setReauthRequired`. The confirm, post-422, and post-409 refetches all use it. Add `{ phase: "checking" }` to `AdvanceState` for the pending button.
- **Opening the confirm** calls the silent refetch. The button shows the `checking` state while it is in flight and ignores further clicks, and the confirm renders only after it returns, so N is never stale. Outcomes: `draft` with N ≥ 1 shows the confirm with N ("1 topic" in the singular); N = 0 shows the disabled state instead; a non-draft status goes to the live-readiness view with no error; a failed refetch shows the inline retryable error and no confirm. Styling stays calm, with no warning icon.
- **`activeTopicCount === 0`:** "Open the room" is disabled, and the copy plus a link to `/team/:teamId/topics` appears next to it. Because the state is defence in depth (Decision 3), this is a plain line of text and a link, nothing more.
- **On a `422` from `/advance`:** refetch, and if the status is not `draft`, transition to the live-readiness view with no error. Otherwise (still `draft`, or the refetch failed) show the existing inline retry.
- **On a `409 NO_ACTIVE_TOPICS`:** refetch, and let the disabled state's copy take over, with no retry button. The server message is not shown as well, so the facilitator sees one message, not two. Only if the refetch fails is the server message shown inline, still with no retry button; "Open the room" stays enabled, so the next click re-runs the confirm refetch and the page recovers without a reload (implementation review S3).

The extra refetches each call `getOrCreateJoinLink`, which is a read on the hit path. That is fine for click-driven refetches, and worth revisiting if facilitator state ever becomes a poll.

### 8. R5: registration snapshot id-space (D8)

Rewrite the query in `session-registration-snapshot.ts`:

```sql
SELECT s.status AS session_status, st.id AS session_topic_id, st.status AS topic_status,
       (v.id IS NOT NULL) AS has_locked_in
FROM sessions s
LEFT JOIN session_topics st ON st.session_id = s.id AND st.topic_id = s.current_topic_id
LEFT JOIN votes v ON v.session_topic_id = st.id AND v.voter_id = $2
WHERE s.id = $1
```

`currentTopic` is `null` when `session_topic_id` is null. Otherwise it is `{ sessionTopicId: session_topic_id, status }`. This matches the `sessionTopicId` that begin-voting and advance return, which is what `voteDraft.ts` keys on. The new join is session-scoped (the old one was not) and, with `UNIQUE (session_id, topic_id)` and `UNIQUE (session_topic_id, voter_id)`, returns at most one row. The `voter_id = $2` self-disclosure and the call-site discipline comment on `userId` are kept intact. Update `redis-session-model.md` to say `current_topic_id` is a `topics.id`.

The existing tests mock `db.query`, which is why the bug shipped. Add a real-Postgres test: seed a session through the real snapshot, run begin-voting, insert a vote, call `buildSessionRegistrationSnapshot` directly, and assert `sessionTopicId === beginVoting.currentTopic.sessionTopicId` and `hasLockedInVote`. The mock fixtures change with the alias rename.

**Alternative rejected:** switching `current_topic_id` to a `session_topics.id` everywhere. That touches begin-voting, advance, reveal, and their tests. The single-reader fix is smaller and matches how the column is already written.

### 9. Document reconciliation

Adopt "room open" in the docs listed in proposal.md's Impact section. The spec deltas carry the normative changes. The requirement-document edits are wording only, plus checkbox notes. The REST contract documents `NO_ACTIVE_TOPICS` as `precondition_failed`, matching the other coded 409s (contract L937).

## Security notes

**Asset added to the threat model: integrity of `session_topics` at room open.** It defines what a team votes on and is stored permanently in that team's history. The threats and their controls:

| Threat | Control |
|---|---|
| Cross-team contamination (one team's topics, prompts, annotations copied into another team's session) | Team derived from the session row inside the snapshot statement (Decision 2); `/advance` conditional `UPDATE` also predicates on `team_id` and `facilitator_id` (Decision 3) |
| Out-of-band writes | Writes only at room open; the single exception is the operator backfill, with the controls in Migration Plan step 3, and never an endpoint |
| Unauthorized lock-in | Live facilitator role enforced on `/advance` (Decision 3a); lock taken only after authorization |
| Probing topic state without authorization | 404/403 always precede 409; an ordering test asserts a non-creator gets 403 on a zero-topic team |
| Free-text leakage into logs | Audit and log content boundary (Decision 3b) |
| Configuration and SQL disclosure | Fixed 500 message with `correlationId` only, for every failure inside the `/advance` and `POST /teams` transactions. Other handlers still reach Fastify's default error handler, which echoes `err.message`; the app-wide fix is follow-up 6 |

The threat model is revisited against the implementation before release, alongside the Priya walkthrough (task 10.4).

## Risks / Trade-offs

- **[Risk] A future path reaches `lobby` without the helper** (for example, a new "reopen" flow). → **Mitigation:** the `session-topic-lifecycle` requirement names the only two paths. The helper is the single place the insert lives, and it cannot be called with a mismatched team. An integration test asserts that every `lobby` session created through either route has at least one row.
- **[Risk] The advisory lock makes `/advance` wait behind a long topic write.** → **Mitigation:** topic writes are short single-transaction operations. The wait is bounded by the same few milliseconds every topic write already accepts.
- **[Risk] `activeTopicCount` goes stale between the confirm and the click.** → **Mitigation:** it is refetched when the confirm opens. The server guard is authoritative, and the 409 path refetches and shows the disabled state.
- **[Risk] Existing mock-level tests break.** `makeMockClient` returns `{ rows: [] }` with `rowCount` undefined, so the current `/advance` and `POST /teams` happy-path tests will hit the 0-row 422 or `NoActiveTopicsError`. → **Mitigation:** explicit `rowCount === 1`, and budgeted updates to the positional mock sequences in `facilitator-sessions.test.ts`, `http-session-expiry-no-partial-execution.test.ts`, and `facilitator-error-state-2-restricted-role.test.ts` (tasks 3.1–3.4).
- **[Risk] Parallel test files race the shared default-topic template.** `default-topic-provisioning-integration.test.ts` swaps the template with separate autocommit `DELETE` and `INSERT` statements. After this change, a concurrent `POST /teams` that lands in that window returns 500 instead of quietly creating an empty team, which would make CI flaky. → **Mitigation:** make the swap and restore atomic on one client (`BEGIN; DELETE; INSERT; COMMIT`), so MVCC readers see the old set or the new set, never an empty one; test the empty-template 500 at mock level, never by emptying the shared template in real Postgres (tasks 1.6, 4.2).
- **[Trade-off] Opening the room early freezes the list early.** That is the facilitator's choice: the join link already works in `draft` (DraftSessionHost badge), and the confirm copy says the list locks.
- **[Trade-off] `first_session_description` stays a live read.** It is stable under the first-session lock and is administrator copy. This is documented as the single exception.
- **[Trade-off] Annotation edits are last-writer-wins relative to room open.** They do not take the team lock. The single-statement snapshot makes each row consistent; an edit that commits a moment before the open is in, one a moment after is not.
- **[Risk] Sessions in `lobby` or `pre_session` from before this change have zero rows.** → **Mitigation:** the begin-voting backstop 409 remains. See the Migration Plan backfill note.
- **[Trade-off] Pre-change sessions report their creation date in the reorder hint.** `room_opened_at` is NULL for them, so the hint falls back to `created_at`. This is accepted and transitional (`reorder-topics`).

## Verification approach

- **Unit lane (`ci.yml`, no Postgres, 90% line gate).** Integration-only tests add no coverage there. Every new branch has a mock-level test in `facilitator-sessions.test.ts`: the 0-row 422 (with the re-read status in the message), `409 NO_ACTIVE_TOPICS`, the live-role 403 and its audit row, the empty-template 500 (the copy returns rows, the snapshot `RETURNING` returns none; assert the 500 body, the `log.error` call with `templateTeamId` and `correlationId`, and `ROLLBACK`), `activeTopicCount` present and absent, and the audit sinks.
- **Integration lane (`integration.yml`, Postgres 16).** Real-DB tests keep the house `describe.skipIf(!dbUp)` probe so they skip cleanly in `ci.yml`, and **fail hard when Postgres is required**: `integration.yml` sets `REQUIRE_DB: "1"` in its `env:`, and each such test file starts with `if (!dbUp && process.env.REQUIRE_DB) throw new Error("Postgres required in the integration lane")`. That makes "never skipped in the integration lane" mechanically true for the full-ritual e2e (8.1), the two concurrency tests (3.4, 3.5), and the R5 test (6.3), without breaking the unit lane. The `e2e-*` file name is cosmetic; `integration.yml` runs the whole suite.
- **Genuine concurrency, using the lock as the gate.** `Promise.all` of two short requests does not guarantee overlap, and no test-only hook is added to production code. A shared test helper:
  1. On a dedicated test client: `BEGIN; SELECT pg_advisory_xact_lock(hashtext($teamId::uuid::text))`.
  2. Fire both requests without awaiting them.
  3. Poll `pg_locks` until two other backends are waiting on that advisory lock (`granted = false`), with a timeout.
  4. `COMMIT` the test client, then await both responses.

  For the double `/advance` (3.4), both requests have passed the pre-transaction `draft` check by step 3, so the second really exercises the conditional `UPDATE`. For reorder versus open (3.5), acquisition order is not deterministic, so the test asserts "full before order **or** full after order", as the spec says. This closes the gap the live `session-topic-lifecycle` Purpose records for earlier concurrency scenarios, which were verified only by inspection.
- **Zero active topics** is seeded with SQL, since no API sequence produces it.
- **Standing full-ritual gate.** The e2e (a) test (task 8.1) lives with the existing backend `e2e-*` tests under `packages/backend/src/routes/__tests__/`. Its mid-topic reconnect calls `buildSessionRegistrationSnapshot` directly, since there is no real-socket-plus-real-DB harness. It must not be marked `skip` or `todo`; its only skip is the `skipIf(!dbUp)` probe, which cannot fire in the integration lane.

## Migration Plan

1. **Deploy migration 20** (an additive nullable column). It is safe to run before the code: old code ignores the column.
2. **Deploy the backend and frontend together.** The shared type change is additive, so an older frontend ignores `activeTopicCount`.
3. **Operator backfill check (D11): a yes/no deploy gate, not engineering work.** Before release, the operator runs the detection query **with a read-only database role** and answers: *"Does any environment other than dev/CI hold `lobby` or `pre_session` sessions with zero `session_topics` rows that a team still needs?"* Detection query:
   ```sql
   SELECT s.id, s.team_id, s.status, s.created_at FROM sessions s
   WHERE s.status IN ('lobby','pre_session')
     AND NOT EXISTS (SELECT 1 FROM session_topics st WHERE st.session_id = s.id);
   ```
   - **No (expected):** release notes tell facilitators to abandon and re-create any such session.
   - **Yes:** only then is the script written. The engineering is deferred; its **controls are not**. The script is a privileged write path into the voting record that skips every route-level check, so it SHALL:
     1. **Take session ids only.** The team is derived from the session row (by `lockTeamTopics` on `sessions.team_id`, and by the helper's join). It is never an argument.
     2. **Re-check under the lock.** Per session, in its own transaction, after `lockTeamTopics`: confirm `status IN ('lobby','pre_session')` and `NOT EXISTS (SELECT 1 FROM session_topics WHERE session_id = $1)`, and skip the session (reported, not failed) if either check fails. The detection result is stale by the time the script runs, and a re-run would otherwise hit `UNIQUE (session_id, topic_id)` halfway through the batch.
     3. **Call the same `snapshotSessionTopics` helper.** Leave `room_opened_at` NULL; the reader falls back to `created_at`.
     4. **Write an audit row per session** in the same transaction: operation `session.topics_backfilled`, `actor_user_id` and `actor_global_role` set to an operator/system marker (`operator-backfill`), the session and team ids, `topic_count`, and `topic_ids`, under the same content boundary as Decision 3b. This is what distinguishes a backfilled session from a normally opened one with `room_opened_at` NULL.
     5. **Dry-run by default.** Without an explicit `--write` flag it prints the session ids it would touch and the per-session re-check result, and writes nothing.
     6. **Credentials and packaging.** It lives at `packages/backend/src/scripts/backfill-session-topics.ts` and is run with `tsx`, so it imports the helper rather than duplicating the statement. Nothing under `src/` outside `src/scripts/` may import from it (checked by a lint rule or a grep in CI), it is never registered as a route, and it is not the runtime image's entry point (`node dist/index.js`). It runs with operator credentials from the secret store, never from a checked-in env file.

     The release notes record who ran it, when, and the session ids it wrote. This script is the single exception that `session-topic-lifecycle` allows to the "room open and at no other time" rule.
4. **Rollback:** revert the code, then drop the column. Any `session_topics` rows written in the meantime are valid data, and older code reads them correctly. Begin-voting simply starts working for those sessions.

## Open Questions

None that block implementation. The operator backfill answer (Migration Plan step 3) is recorded at release time.

## Follow-ups

To be filed (task 10.6); not filed by this design.

1. **Expired-draft refusal or auto-abandon at `/advance` (D10). Label: security.** The issue must state the access consequence, not only the history framing: `team-content-access-helper.ts` gives draft-path (Path 3) access only within 24h, but `lobby` and later statuses get it with no time limit, so advancing an expired draft **re-establishes** a facilitator's team-content access after it lapsed. It is pre-existing (`/advance` already transitions today). It must be filed with a named owner and a target date; it is not filed without one.
2. **Live-role enforcement on the other session-phase endpoints** (start, begin-voting, topics-advance, reveal, complete). Decision 3a covers `/advance` only. Label: security.
3. "Won't apply to today's session" hints on archive, add, restore, and annotate.
4. Actionable copy for begin-voting's backstop `409` (Priya, O4).
5. **Shared error-envelope type in `@dipstick/shared`** if the frontend starts branching on `error.code` in more than a handful of places.
6. **Global Fastify error handler that hides 5xx messages** (added during implementation; referenced as "follow-up 6" in Decision 2 and the Security notes). Label: security. Once it lands, the local fixed-500 catches in `/advance` and `POST /teams` and `SnapshotFailedSignal` can go.

## Design feedback disposition

Reviews: `design-review-engineer.md` (Marcus Oyelaran) and `design-review-security.md` (Tomás Ferreira). Every claim acted on below was checked against the code at `c4585cc`. All held.

### Engineer: blocking

| Item | Disposition | Where |
|---|---|---|
| B1 `conflict` / `server_error` categories do not exist; no shared envelope | **Accepted.** `precondition_failed` for `NO_ACTIVE_TOPICS`, `internal_error` for the empty-template 500. `buildErrorEnvelope` moves to `src/routes/error-envelope.ts`. No shared type (Non-Goals, Follow-up 5). | Decisions 3, 4, 9; `session-creation`; proposal; tasks 1.3, 3.3, 4.2 |
| B2 "never conditional on the environment" breaks `ci.yml` | **Accepted.** Keep `skipIf(!dbUp)`; `REQUIRE_DB=1` in `integration.yml` makes a missing DB a hard failure there. Applied to every new real-DB test file. | Verification approach; tasks 1.4, 3.5, 3.6, 6.3, 8.1 |
| B3 Template-swap tests become parallel 500s | **Accepted** in all three parts: atomic swap/restore, mock-level empty-template test, named `DEFAULT_TOPICS_TEAM_ID`. | Decision 4; Risks; tasks 1.5, 1.6, 4.2 |
| B4 `loadFacilitatorState` tears down the page | **Accepted.** Silent `refetchFacilitatorState()` and `{ phase: "checking" }`. The spec now says the refetch never replaces the view with a loading or full-page error state. | Decision 7; `session-creation`; tasks 7.2, 7.3 |

### Engineer: should fix and minor

| Item | Disposition |
|---|---|
| S1 How to make transactions genuinely concurrent | **Accepted.** Lock-as-gate helper with `pg_locks` polling; reorder-vs-open asserts before-or-after. Verification approach; tasks 2.4, 3.5, 3.6. |
| S2 Annotation edit does not take the lock; READ COMMITTED detail | **Accepted** (same as Security S5). Context corrected; helper contract states "caller holds the lock, taken in an earlier statement" and "single statement is load-bearing". Decision 2; `session-topic-lifecycle`. |
| S3 Canonicalise the lock key | **Accepted, including the four existing `topics.ts` sites.** Migrating only the new sites would make the keys disagree and break the reorder-vs-open guarantee for non-canonical URLs. Decision 2a; task 2.3. |
| S4 Coverage gate and mock churn | **Accepted.** Mock-level counterparts for every new branch; explicit `rowCount === 1`; mock-sequence updates budgeted. Verification approach; Risks; tasks 3.1–3.4, 3.7, 4.1, 4.2, 5.1. |
| S5 R5 needs a real-Postgres test | **Accepted.** Task 6.3; 8.1 calls `buildSessionRegistrationSnapshot` directly. |
| S6 `count(*)` is a string | **Accepted.** `count(*)::int`. Decision 6; task 5.1. |
| S7 0-row 422 message | **Decided:** re-read `status` under the lock, so both 422 paths return today's message. Decision 3; `session-creation`. |
| S8 Zero active topics unreachable via API | **Accepted.** Spec scenario reworded to "has zero active topics by the time the advance runs", seeded with SQL. Design says the 409 and disabled state are defence in depth and keeps the UI minimal. |
| M1 Migration markers | **Accepted.** Decision 5; task 1.1. |
| M2 Backfill script location; idempotence | **Accepted, with a location choice that also satisfies Security M3:** `src/scripts/` run by `tsx`, importing the helper, with an import-boundary check; skip-if-rows re-check under the lock. Not `migrations-manual/`, because a SQL `DO` block would duplicate the snapshot statement and make dry-run and per-session audit awkward. Migration Plan step 3. |
| M3 Helper placement | **Accepted.** `src/sessions/session-topic-snapshot.ts`. Decision 2; task 2.1. |
| M4 409 UI shows two messages | **Accepted.** Disabled-state copy only; server message shown only if the refetch fails. Decision 7; `session-creation`. |
| M5 Audit event parity | **Accepted.** `topicCount` in both sinks, `topic_ids` in `audit_log` only. Decision 3b. |
| M6 Lock on the new team is a no-op | **Accepted.** Reworded to "for uniformity". Decision 4. |
| M7 `getOrCreateJoinLink` on every refetch | **Noted**, no change. Decision 7. |

### Security: must-fix

| Item | Disposition | Where |
|---|---|---|
| M1 Helper must not trust a caller-supplied `teamId` | **Accepted.** Helper takes `sessionId` only; team joined from the session row inside the statement. `/advance`'s conditional `UPDATE` adds `team_id` and `facilitator_id`. Cross-team test added. | Decisions 2, 3; `session-topic-lifecycle`, `session-creation`; tasks 2.1, 2.2, 3.2 |
| M2 Audit metadata content boundary and sinks | **Accepted.** Normative "ids and count only, never name/prompt/annotation" in the spec; sinks explicit and tested; `audit-logger.ts` contracts updated; `correlationId` in the 500 log line. | Decision 3b; `session-creation`; tasks 1.7, 3.4, 4.3 |
| M3 Backfill controls specified now | **Accepted** in full: session-id input, re-check under the lock, audit row per session (`session.topics_backfilled`), dry-run default, read-only detection role, secret-store credentials, import boundary, release-note record. | Migration Plan step 3; `session-topic-lifecycle`; tasks 10.3a–10.3c |

### Security: should-fix and notes

| Item | Disposition |
|---|---|
| S1 `/advance` does not enforce live `global_role` | **Accepted in scope.** About five lines on a handler this change already restructures, and the change raises the consequence (lock-in plus untimed Path 3 access). 403 plus `session.advance_denied_role` audit row. The same question for other session-phase endpoints is Follow-up 2. Decision 3a; `session-creation`; task 3.1. |
| S2 Expired-draft deferral is an access-control deferral | **Accepted as a deferral with the stated conditions.** Follow-up 1 is security-labelled, states the access consequence, and is filed only with a named owner and target date. Task 10.6. |
| S3 Error disclosure | **Accepted.** Ordering test (non-creator gets 403, not 409, on a zero-topic team); `correlationId` in body and log; no template id or SQL in the body; non-`NoActiveTopicsError` failures answered with a local fixed 500 (no global handler exists; see the Decision 2 implementation note). Decisions 2, 3, 4; tasks 3.3, 4.2. |
| S4 Use house helper and categories | **Accepted** (same as Engineer B1). |
| S5 Correct the lock claim; accept the annotation race | **Accepted** (same as Engineer S2). Context, Decision 2, Risks/Trade-offs. |
| Note: compute `activeTopicCount` from `sr.team_id` | **Accepted.** Decision 6. |
| Note: lock after authz, normative | **Accepted.** Decision 3; `session-creation`. |
| Note: threat-model asset | **Accepted.** Security notes; revisit before release in task 10.4. |
| Notes: publish payload, `room_opened_at`, R5 | No change needed; R5 keeps the `userId` discipline comment (Decision 8). |

### Reviewer conflicts

One apparent conflict, resolved by judgment: the engineer suggested `migrations-manual/` SQL or a `tsx` entry under `src/scripts/`; security required that the script not be importable from `src/`, not be a route, and not be in the runtime entry path. `src/scripts/` with a one-way import boundary (scripts may import `src/`; nothing in `src/` may import scripts) satisfies both: it reuses the helper (engineer) and is unreachable from the running app (security). Both reviewers recommended the same audit sink split (M5 / Security M2) and the same error categories (B1 / S4). No conflict remains unresolved.
