# Design Review: session-topics-snapshot-at-creation (#175)

**Reviewer:** Marcus Oyelaran (Senior Full Stack Engineer)
**Date:** 2026-10-01
**Reviewed:** `design.md`, `proposal.md` (with `tasks.md` and the spec deltas for cross-checks)
**Checked against:** `packages/backend/src/routes/facilitator-sessions.ts`, `routes/topics.ts`, `realtime/session-registration-snapshot.ts`, `migrations/` (1, 2, 3, 9, 10, 18, 19), `migrations-manual/`, the route and realtime `__tests__/`, `.github/workflows/ci.yml` and `integration.yml`, `packages/shared/src/types/`, `packages/frontend/src/pages/DraftSessionHost.tsx`, `TopicManagementPage.tsx`, `App.tsx`

## Verdict: Approve with changes

The core is right, and I'd build it this way: a single `INSERT ... SELECT` under the team lock, a conditional `UPDATE` as the real guard, publishing only after commit, and a fix to R5 with one reader query. I checked the parts that could have sunk it, and they hold (see "Verified" at the end). There are four blocking issues. Two are boundary mismatches with existing code (the error vocabulary and the frontend refetch). Two are test-harness problems that would make CI either red or flaky on day one. None of them changes the architecture.

---

## Blocking

### B1. `category: "conflict"` and `category: "server_error"` don't exist in this codebase, and there's no shared envelope to add `code` to

Decision 3 says to return `409 { category: "conflict", code: "NO_ACTIVE_TOPICS" }`. Decision 4 and the `session-creation` spec delta (L110, L139) pin `500` / `category: "server_error"`. Here are the categories the backend actually emits:

```
37 invalid_request   28 forbidden   16 not_found   8 session_expired
 6 precondition_failed   1 rate_limited   1 service_unavailable
```

Plus `internal_error` (`auth/error-handler.ts`) for our own infrastructure failures. Every coded 409 in `topics.ts` (`TOPIC_LAST_ACTIVE`, `TOPIC_ORDER_STALE`, `TOPIC_CUSTOMIZATION_LOCKED`) uses `precondition_failed`, and the REST contract documents them that way (L937). Adding two new category strings because of one change means the frontend and contract readers have one more vocabulary to reconcile.

Also, `@dipstick/shared` has no HTTP error envelope type at all, only `AuthErrorCategory`. Task 1.3's "follow the `TEAM006_*` precedent" points at rate-limit constants in `teams.ts`, not at error codes. The real precedent is `buildErrorEnvelope(category, message, code?, field?)` in `topics.ts` L62. It's local to that file and builds `{ error: { category, code?, field?, message, correlationId } }`.

**Change:** use `precondition_failed` for `NO_ACTIVE_TOPICS`, and `internal_error` for the empty-template 500. Update both normative spec lines. Move `buildErrorEnvelope` and its `ErrorCategory` union into a shared backend module (for example `src/routes/error-envelope.ts`) and use it from `facilitator-sessions.ts`. Rewrite task 1.3 to say that, or drop it. The frontend reads `body.error.code` ad hoc today, the same way it reads `message`, and that's enough here.

### B2. "Never conditional on the environment" conflicts with `ci.yml`

Task 8.1 and the design's Verification section say the full-ritual e2e must never be `skip` or conditional on the environment. But `ci.yml` runs `npm run test:coverage -w packages/backend` with **no Postgres service**. Every real-DB suite in the repo (`topics-integration`, `e2e-join-link-redemption`, `restore-topic-integration`, ...) uses the house probe, `describe.skipIf(!dbUp)`, so it skips cleanly there. A test that can never skip fails `ci.yml` on every PR.

The `e2e-*` filename doesn't route anything either. `integration.yml` runs the whole `npm run test`, so the name is only cosmetic.

**Change:** keep the house `skipIf(!dbUp)` probe, and make it fail hard when Postgres is required. Set `REQUIRE_DB=1` in `integration.yml`'s `env:`, and in the test do `if (!dbUp && process.env.REQUIRE_DB) throw new Error(...)`. That makes "never skipped in the integration lane" mechanically true without breaking the unit lane. Apply the same rule to the two concurrency tests (3.4, 3.5), since the spec makes them normative.

### B3. Template-swap tests become a source of parallel 500s

`default-topic-provisioning-integration.test.ts` (L146 and L191) runs `DELETE FROM topics WHERE team_id = <sentinel> AND is_default = true` and then re-inserts row by row, as separate autocommit statements. Vitest runs test files in parallel against the same database. Today, a concurrent `POST /teams` from another file that lands in that window quietly creates a team with zero topics. `topic-annotation-integration.test.ts` L770 already has a retry loop "in case that suite is mid-swap", so this has been seen before. After this change, the same race returns **500**, which turns it into a flaky red build. That affects `topic-annotation-integration`, e2e (b) (task 8.2), and 4.4. Task 4.4's new "empty template returns 500" test would widen the window further.

**Change:**
1. Make the existing swap atomic: run `BEGIN; DELETE ...; INSERT ...; COMMIT` on one checked-out client, for both the swap and the restore. MVCC then means concurrent readers see either the old set or the new set, never an empty one.
2. Test the empty-template 500 at the **mock level** in `facilitator-sessions.test.ts` (the copy returns, the snapshot `RETURNING` returns no rows, and the test asserts the 500 body, the `log.error` call with `templateTeamId`, and `ROLLBACK`). Don't empty the shared template in real Postgres. If a real-DB check is wanted, do it inside a single transaction that the test controls and rolls back.
3. Pull the hard-coded `'00000000-0000-0000-0000-000000000001'` literal in the `POST /teams` copy into a named constant, so the log line and the SQL can't drift.

### B4. Reusing `loadFacilitatorState` for the confirm refetch would tear down the page

`DraftSessionHost.loadFacilitatorState()` starts with `setLoadState({ status: "loading" })`. That replaces the whole view with "Loading session…" and resets the copy-link banner state. On failure it sets `status: "error"`, which replaces the page with a full-page alert instead of an "inline retryable error". Decision 7's outcomes (pending button, inline error, no flash) can't be met by calling it.

**Change:** add a silent `refetchFacilitatorState(): Promise<FacilitatorSessionStateResponse | null>` that never touches `loadState` on failure. On success it replaces `loadState.data` in place, which mounts `LiveReadinessView` when the status is no longer `draft`. Add a `{ phase: "checking" }` to `AdvanceState` for the pending button. Use the same function for the post-422 and post-409 refetches. Session expiry still goes through `detectSessionExpiry` and then `setReauthRequired`.

---

## Should fix

### S1. How to make the two transactions genuinely concurrent

`Promise.all([app.inject(...), app.inject(...)])` is the house pattern (`restore-topic-integration.test.ts` L332), but it doesn't guarantee the transactions overlap. With two short requests, the second often starts after the first commits. The design's "first transaction held open just after it takes the advisory lock" has no seam in the route to hold it open. Don't add a test-only hook to production code. Use the lock itself as the gate:

1. On a dedicated test client: `BEGIN; SELECT pg_advisory_xact_lock(hashtext($teamId))`.
2. Fire both requests without awaiting them.
3. Poll `pg_locks` / `pg_stat_activity` until both backends are waiting on that advisory lock (`granted = false`).
4. `COMMIT` the test client, then await both responses.

Both requests have passed the pre-transaction `status = 'draft'` check by then, so the second really exercises the conditional `UPDATE`. For reorder versus open (3.5), the acquisition order is not deterministic, so assert "full before order **or** full after order", which is what the spec says. Put this gate in a small helper so 3.4 and 3.5 share it.

### S2. The annotation edit doesn't take the advisory lock, so correct the Context

Context says "Topic writes serialize on `pg_advisory_xact_lock`", and Decision 4 calls this a house invariant. TOPIC-007 (`topics.ts` L1421) deliberately does **not** take it: it's a single-row `FOR UPDATE OF t` with last-writer-wins. Correctness is still fine. The `INSERT ... SELECT` reads one statement-level MVCC snapshot, so a concurrent annotation edit lands entirely before or entirely after it, row by row. But the reason is the single statement, not the lock, and the design should say so. That way nobody later "optimises" the helper into a count followed by an insert, or into a two-statement insert, on the assumption that the lock covers annotations. The edit-isolation test (8.3) is unaffected.

Also state the READ COMMITTED detail explicitly. The lock must be taken in an **earlier statement** than the `INSERT ... SELECT`, so the insert's snapshot is taken after the lock is granted and sees a reorder that committed while it waited. The design's ordering already does this. Make it a stated invariant of the helper's contract ("the caller must already hold the team lock").

### S3. Extract the lock call and canonicalise its key

Every site does `pg_advisory_xact_lock(hashtext($1::text))` on the **raw route parameter**. Postgres accepts an upper-case UUID in `WHERE id = $1`, but `hashtext('ABC...')` and `hashtext('abc...')` are different locks. `/advance` is protected by accident, because `sessionRow.team_id !== teamId` 403s a non-canonical id. The topic routes are not. This is latent and only reachable with hand-crafted URLs, but this change adds two more call sites. Add `lockTeamTopics(client, teamId)` using `hashtext($1::uuid::text)`, use it everywhere (including the existing five sites in `topics.ts`), and in `/advance` pass `sessionRow.team_id`.

### S4. Mock-test churn and the 90% coverage gate

`ci.yml`'s coverage run, with `thresholds: { lines: 90 }`, has no Postgres, so integration-only tests add **zero** coverage. The new branches (0-row 422, 409 `NO_ACTIVE_TOPICS`, empty-template 500, `activeTopicCount`) each need a mock-level test in `facilitator-sessions.test.ts`. The tasks list only integration tests for 3.x and 4.x. Add mock-level counterparts.

Existing mock tests will also break. `makeMockClient` returns `{ rows: [] }` with `rowCount` undefined by default. So the current `/advance` and `POST /teams` happy-path tests will now hit the 0-row 422 or `NoActiveTopicsError`. Check `rowCount === 1` explicitly, not truthiness, and budget time to update the positional mock sequences in `facilitator-sessions.test.ts`, `http-session-expiry-no-partial-execution.test.ts` and `facilitator-error-state-2-restricted-role.test.ts`. Note this in tasks so the diff isn't a surprise.

### S5. R5 needs a real-Postgres test

Both `session-registration-snapshot.test.ts` and `websocket-routes-registration-snapshot.test.ts` mock `db.query`. That's why the id-space bug shipped: a mock returns whatever id you give it. Task 6.2 says to "update the unit and integration tests", but there is no integration test today. Add one against real Postgres: seed a session through the real snapshot, run begin-voting, insert a vote, then call `buildSessionRegistrationSnapshot` directly and assert `sessionTopicId === beginVoting.currentTopic.sessionTopicId` and `hasLockedInVote`. The alias rename (`current_topic_id` to `session_topic_id`) means the mock fixtures change too.

The same approach fits e2e (a)'s "mid-topic reconnect" (8.1). There's no real-socket-plus-real-DB harness, so call `buildSessionRegistrationSnapshot` directly rather than building one.

### S6. `count(*)` is a bigint, which node-postgres returns as a string

`activeTopicCount` from `SELECT count(*)` arrives as `"3"`. Use `Number(...)` or `count(*)::int`. Otherwise `activeTopicCount === 0` is never true in the frontend, and the disabled state silently never shows.

### S7. The 0-row 422 can't reproduce today's message

Today's 422 message interpolates the status (`Session cannot be advanced from status '${status}'.`). The conditional-`UPDATE` path doesn't know the current status. Either re-read `status` inside the transaction before `ROLLBACK`, which is cheap since we hold the lock, or say that this path uses the pre-check's status. Decide in the design. Otherwise implementers will invent different messages for the two paths that the spec says are "the same 422".

### S8. Zero active topics can't be reached through the API

`TOPIC_LAST_ACTIVE` (`topics.ts` L944) blocks archiving the last active topic. `TOPIC_CUSTOMIZATION_LOCKED` blocks all edits before the first session completes. So no API sequence produces a team with zero active topics, which means:

- the `session-creation` scenario "the team's last active topic is then archived in another tab" (spec L66) can't happen as written. Reword it to something like "the team has zero active topics by the time the advance runs", and seed that state with SQL;
- the 409 and the disabled state are defence in depth for data drift (legacy dev teams, manual SQL). That's worth keeping, since the server guard is cheap, but say so in the design, so nobody spends time on a polished UI for an unreachable state;
- the "link to Topic Management" would lead to a dead end for a team under the customization lock, because it can't add or restore anything. That's moot given the point above, but it's another reason to keep that UI minimal.

---

## Minor

- **M1. Migration markers.** `20_sessions_room_opened_at.sql` must use node-pg-migrate's `-- Up Migration` / `-- Down Migration` markers. Migrations 18 and 19 both note that the bare markers aren't recognised. The number 20 is correct (the latest is 19).
- **M2. Backfill script location.** `packages/backend/scripts/` doesn't exist, and `tsconfig.build.json` wouldn't cover it. The operator precedent is `migrations-manual/` (psql-run SQL with a "NOT AUTO-RUN" header). Since this only happens on "Yes", either use a `migrations-manual/20_backfill_session_topics.sql` that inlines the same statement in a `DO` block per session with the lock, or use a `tsx` entry under `src/scripts/` that imports the helper. Also: make it skip sessions that already have rows, or the second run hits `session_topics_session_topic` with a 23505.
- **M3. Helper placement.** `routes/` holds only Fastify route plugins. Shared non-route helpers live in `auth/` (`join-link-creation.ts`, `open-action-items-helper.ts`). `routes/session-topic-snapshot.ts` works, but "next to the other route helpers" isn't accurate. Pick a home on purpose, for example `src/sessions/session-topic-snapshot.ts`.
- **M4. The 409 UI shows two messages.** It shows the server message inline, and then the disabled state's own copy appears after the refetch. Show one of them, preferably the disabled-state copy, and drop the transient one.
- **M5. Audit event parity.** Add `topicCount` to the `emitAuditEvent` payload as well as the `audit_log` metadata, so the log line and the row agree. Leave out the full `topicIds` list there if log size matters.
- **M6. Lock on the new team in `POST /teams`.** The new team row is uncommitted and invisible to everyone else, so the lock is a no-op. Keeping it for uniformity is fine. Say "for uniformity" rather than implying it prevents a race.
- **M7. `getOrCreateJoinLink` on every facilitator-state fetch.** The extra refetches (on confirm, 422 and 409) each call it. On the hit path it's a read, so that's fine, but keep it in mind if the facilitator-state fetch ever becomes a poll.

---

## Verified (no action)

- **Schema fit.** The helper's column list matches `session_topics` (migration 2, plus `topic_annotation` from 19). `row_number()` 1..N satisfies `session_topics_session_order UNIQUE (session_id, display_order)`, and `(session_id, topic_id)` uniqueness holds because each topic appears once. `status` defaults to `'waiting'` anyway, and writing it explicitly is fine.
- **The copy feeds the snapshot.** `POST /teams` copied rows default to `status = 'active'`, so the helper's `status = 'active'` filter picks them all up in template `display_order`.
- **Lock ordering.** No path takes a `sessions` row lock and then the team advisory lock. Begin-voting, start and topics-advance don't take the advisory lock, and topic writes only read `sessions`. Lock-first in `/advance` introduces no inversion.
- **422-before-409.** Both the pre-check and the conditional-`UPDATE` 422 run before the snapshot, so a non-draft session can never get `NO_ACTIVE_TOPICS`, even when the status changes between the pre-check and the lock.
- **R5 query.** Joining `votes` on `st.id` is correct, and `votes_session_topic_voter UNIQUE (session_topic_id, voter_id)` guarantees at most one row, so there's no fan-out. The `sessions_current_topic_fk` FK to `topics(id)` confirms which id-space the column is in.
- **Test cleanup.** The existing integration cleanups delete `sessions` before `topics`, and `session_topics` cascades on session delete. So the new rows that `POST /teams` writes won't break teardown with FK errors.
- **Frontend reach.** `DraftSessionHost` is the only caller of `/advance`. `/team/:teamId/topics` exists (`App.tsx` L107). `activeTopicCount?: number` on `FacilitatorSessionStateResponse` is additive, and an older frontend ignores it.
- **Migration safety.** A nullable `ADD COLUMN` with no default is a metadata-only change under `--no-single-transaction`, so it's safe to deploy ahead of the code.
