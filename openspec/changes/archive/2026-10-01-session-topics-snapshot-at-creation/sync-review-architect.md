# Sync review: Solution Architect (Ingrid Sollenberger)

**Date:** 2026-10-01
**Scope:** the main specs that `opsx:sync` updated (`session-creation`, `session-topic-lifecycle`, `reorder-topics`, `restore-topic`, `topic-management-screen`, `vote-compose-recovery`), plus `design.md`, `release-notes.md`, and the edited `requirements/` docs, checked against the working-tree code diff vs `main`. I changed no code.

## Verdict

**There is no code-versus-spec drift.** The sync matches the deltas exactly: every delta requirement block is byte-identical in its main spec, and nothing in the deltas is REMOVED or RENAMED. I found doc-side drift in seven places and fixed all of it directly in the docs (see below). I found no code that contradicts the agreed specs.

## Spec ↔ code checks (all hold)

- **Room-open snapshot.** `INSERT INTO session_topics` appears only in `src/sessions/session-topic-snapshot.ts`. It takes the session id only and joins the team from the session row. It is a single statement using `row_number() OVER (ORDER BY display_order, id)` and status `'waiting'`. Zero rows throws `NoActiveTopicsError`. Draft creation, `SESSION-004`, and `SESSION-005` write no rows. The begin-voting backstop `409` message is unchanged.
- **`/advance` ordering.**
  - The checks run in this order: canonical `sessionId` 404, session 404, team 403, creator 403, live-role 403 (with the `session.advance_denied_role` row, where a missing user row counts as `unknown`), then the 422 status check.
  - Only after those checks does the transaction start. It runs `lockTeamTopics(sessionRow.team_id)`, then the conditional `UPDATE ... AND status = 'draft'` with an explicit `rowCount !== 1` check. A losing request gets a 422 built from a status re-read inside the transaction.
  - Next come the snapshot (a zero-row snapshot returns `409 precondition_failed NO_ACTIVE_TOPICS`, and any other failure returns a fixed 500) and the audit row with `topic_count`/`topic_ids`.
  - A catch-all returns a fixed 500 with a `correlationId`. After commit, `emitAuditEvent` sends `topicCount` only, and the event is published after commit.
- **`POST /teams`.** The insert sets `room_opened_at = now()` and `'lobby'`. The lock is taken for uniformity, then the snapshot runs. An empty template returns a 500 with the spec's exact message; the log line carries `templateTeamId` and `correlationId`, and the response body carries neither. A snapshot failure or any other failure returns a fixed 500. The audit row carries `topic_count`/`topic_ids`.
- **Lock key.** All four structural topic writes use `hashtext($1::uuid::text)` via `lockTeamTopics`. The annotation edit does not take the lock, as the spec says.
- **Canonical ids.** `isCanonicalUuid` is the only definition. It is applied before any query on `POST /draft`, `GET /topics/all` (`content.ts`), the five topic write routes, and `sessionId` on `/advance`.
- **`room_opened_at`.** Migration 20 is additive and nullable, with no backfill. `readOpenSessionCreatedAt` uses `COALESCE(room_opened_at, created_at)` for both the value and the `ORDER BY`. The admin short-circuit and the status list are unchanged.
- **`activeTopicCount`.** It is computed with `count(*)::int` from `sr.team_id`, sent only for drafts, and typed as optional in the shared type.
- **R5.** The registration snapshot joins on `(session_id, topic_id = current_topic_id)` and returns `st.id` as `sessionTopicId`.
- **Frontend (`DraftSessionHost`).**
  - The silent refetch runs before the confirm, with a "Checking…" pending state that ignores repeat clicks.
  - The confirm copy and its singular form match the spec. When the refetch returns a status other than draft, the view goes live with no error. A count of 0 gives the disabled state and a link to `/team/:teamId/topics`, which matches the route in `App.tsx`.
  - On a 422, the view refetches and decides from the refetched status. On a 409 `NO_ACTIVE_TOPICS`, it refetches and shows no server message. If that refetch fails, the server message appears and "Open the room" stays enabled. In every failure case, retrying means clicking "Open the room" again; there is no separate retry button, which is consistent with the spec.
- **Topic Management.** The pinned copy and the "opened on {date}" confirmation match the spec.
- **Integration lane.** `REQUIRE_DB: "1"` is set in `integration.yml`. Every real-DB file calls `requireInfraOrThrow` (from `helpers/real-db.ts`), so the concurrency, R5, and e2e tests fail rather than skip there.
- **Release notes.** The strings in 10.4 match the code word for word. This includes the non-normative strings "Checking…", "Couldn't check this session's topics. Please try again.", and the three fixed 500 messages.

## Doc-side drift fixed

1. **`requirements/design/REST API Contract.md` (TOPIC-006).** The comment on the `openSessionCreatedAt` response field still said "Creation time". It now says it is the room-open time, with the `created_at` fallback. The Notes line "sessions already created keep their order" now says that sessions whose room has opened keep their order, and that a draft picks up the saved order at room open.
2. **`requirements/design/REST API Contract - Validation Report.md`, FR-2.7 row.** "before the session is created" now reads "before the session's room is opened". It now matches the BRD edit.
3. **`requirements/design/database-schema.md`, `session_topics` intro.** "at session creation time" now reads "at room open", with a note that #175 added `sessions.room_opened_at`. The doc's DDL does not track later migrations (it has no `draft` and no `team_annotation`), so I did not add the column to the DDL. That gap predates this change.
4. **`openspec/specs/topic-annotation/spec.md`, Purpose.** "the pending `session_topics` snapshot write" now reads "the `session_topics` snapshot write at room open". This is non-normative Purpose text, and the spec is not one this change's deltas touch.
5. **`design.md`, Decision 3.**
   - Added the pre-transaction step 0 (the non-canonical `sessionId` 404).
   - Removed the `RETURNING room_opened_at` claim, because the code has no `RETURNING`.
   - Added a short Decision 2b that records the canonical-id route-boundary rule from the implementation review. It was in the spec and the release notes but not in the design.
6. **`design.md`, Decision 7.** The `refetchFacilitatorState` signature now matches the code, which returns `RefetchResult` with the kinds `ok`, `failed`, and `expired`.
7. **`design.md`, Decision 3b and Follow-ups.**
   - Decision 3b claimed that `session.topics_backfilled` was registered in `audit-logger.ts`. It is not, and it should not be until the 10.3a gate answers "Yes". The text now says so.
   - The Follow-ups list lacked item 6 (the global 5xx error handler), even though Decision 2 and the Security notes already cite "follow-up 6". I added it.
   - Follow-up 2 now includes `complete`, to match the release notes.

## Observations (no action)

- The `POST /draft` and `/advance` 404 bodies for a non-canonical id have no `error.code`, while the topic routes send `TEAM_NOT_FOUND`. The spec requires only `category: "not_found"`, so this is not drift. It is worth aligning if the frontend ever branches on the code.
- For `POST /teams`, the spec requires a fixed 500 only for snapshot failures. The code also covers every other failure in the transaction. That is stricter than the spec and consistent with the security review's SF1 disposition.

## `openspec validate --all --strict` failures: pre-existing, untouched

The four failing specs are `manager-team-association`, `project-structure`, `role-assignment`, and `websocket-session-authorization`.

- `git diff --stat main -- openspec/specs/<name>` is empty for all four. This covers both the working tree and the WIP commit.
- `git log main..HEAD -- openspec/specs/<name>` lists no commits for any of them.
- I ran validation in a temporary `git worktree` of `main` (`c4585cc`) in the scratchpad, then removed the worktree. The same four specs fail there: 33 passed and 4 failed out of 37. For example, `manager-team-association` fails with "requirements.6.text: Requirement must contain SHALL or MUST keyword".
- On this branch the result is 34 passed and 4 failed out of 38. The extra passing item is this change. These failures are pre-existing and out of scope.
