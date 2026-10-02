# Release notes: session-topics-snapshot-at-creation (#175)

Prepared by the implementing agent. Items marked **[HUMAN]** need a person and are not done.

## What ships

- Opening the room (`POST .../advance`, draft to lobby) now snapshots the team's active topics into `session_topics`, renumbered 1..N, with annotations. The same happens when `POST /api/v1/teams` creates a new team's first session directly in `lobby`. Begin-voting (`SESSION-005`) works for every session opened after deploy.
- New column `sessions.room_opened_at` (migration 20).
- `/advance` now requires the caller's live `facilitator` role (`403`, audited as `session.advance_denied_role`), and returns `409 NO_ACTIVE_TOPICS` when the team has no active topics.
- Draft facilitator state carries `activeTopicCount`. The "Open the room" confirm states the count and the lock-in. A zero-topic team sees a disabled button and a link to Topic Management.
- The reorder hint (`openSessionCreatedAt`) now reports the room-open time.
- The reconnect registration snapshot resolves the current topic correctly (R5), so `hasLockedInVote` survives a reconnect.

## 10.2 [HUMAN] Deploy to dev, in this order

1. Apply migration 20 first (additive, nullable; old code ignores it):
   `npm run db:migrate --workspace=packages/backend` (with the environment's `DATABASE_URL`)
2. Deploy backend and frontend together, from the same commit. The shared type change is additive.
3. Record the deployed commit here: `________`

Rollback: revert the code, then `npm run db:migrate:down --workspace=packages/backend` (drops only `room_opened_at`). `session_topics` rows written in the meantime are valid data.

## 10.3a [HUMAN] Operator backfill gate (D11)

Run with a **read-only** database role in every non-dev/CI environment:

```sql
SELECT s.id, s.team_id, s.status, s.created_at FROM sessions s
WHERE s.status IN ('lobby','pre_session')
  AND NOT EXISTS (SELECT 1 FROM session_topics st WHERE st.session_id = s.id);
```

| Environment | Run by | Date | Rows returned | Needed by a team? (Yes/No) |
|---|---|---|---|---|
| | | | | |

- **No (expected):** facilitators should abandon and re-create any such session; begin-voting keeps returning its existing `409` for it. 10.3b and 10.3c are N/A.
- **Yes:** build 10.3b (the backfill script, with every control in design.md Migration Plan step 3) before release.

## 10.4 [HUMAN] Strings for Priya's review (send before the walkthrough)

- Confirm: "Opening the room lets participants join immediately and locks in this session's {N} topics in their current order. Topic changes after this apply to your next session. This cannot be undone." (singular: "1 topic")
- Disabled state: "This team has no active topics. Add or restore a topic on Topic Management before opening the room." plus a "Go to Topic Management" link.
- `POST /teams` empty template: "Team creation is unavailable because the default topic set is not configured. Contact an administrator."
- Reorder pinned copy: "Order changes apply to sessions opened after you save. Sessions already open keep their order."
- Reorder confirmation: "Order saved. The session opened on {date} keeps its original order."
- Non-normative (the spec says their wording is not normative; Priya's call): the pending button label "Checking…"; the failed-refetch error "Couldn't check this session's topics. Please try again."; the `/advance` snapshot-failure `500` "Something went wrong while locking in this session's topics. Try again."; the `/advance` `500` for any other failure in the room-open transaction "Something went wrong opening the room. Try again."; and the `POST /teams` `500` for a snapshot or other transaction failure "Something went wrong creating this team. Try again." (the frontend shows its own copy on that page today).

### Threat-model checklist draft (integrity of `session_topics` at room open), for human review

- [ ] Cross-team contamination: the snapshot takes only a session id and joins the team from the session row (`src/sessions/session-topic-snapshot.ts`). The `/advance` conditional `UPDATE` also checks `team_id` and `facilitator_id`. Covered by the real-DB test "never gives team A's session team B's active topics".
- [ ] Out-of-band writes: `INSERT INTO session_topics` appears only in `snapshotSessionTopics`. Grep `src/` (excluding tests) to confirm.
- [ ] Unauthorized lock-in: the live-role `403` and its audit row; the lock is taken only after every authorization check.
- [ ] Probing: `404`/`403` come before `409`, and `422` comes before `409`. Both orderings are covered by integration tests.
- [ ] Free-text leakage: audit metadata and the log event carry ids and counts only. Covered by mock and real-DB tests.
- [ ] Configuration and SQL disclosure: the empty-template `500` has a fixed body. Every other failure inside the `/advance` and `POST /teams` transactions also returns a fixed `500` body with a `correlationId`, the error logged, never echoed. **Scope:** this is local to those two handlers. Every other handler still reaches Fastify's default error handler, which echoes `err.message` (follow-up 6).
- [ ] Canonical lock key: all four topic write sites and room open use `hashtext($1::uuid::text)`.
- [ ] Path id shape: `POST /draft`, `GET /topics/all`, and the five topic write routes reject any non-canonical `teamId` (hyphenless, braced, regrouped, malformed) with `404` before the authorization query, and `/advance` does the same for `sessionId`. Real-DB test: a member facilitator using another spelling of their own team id is denied on every one of those routes, and nothing is written (`session-topic-snapshot-integration.test.ts`). `isCanonicalUuid` (`src/routes/uuid.ts`) is the only definition of the shape.

## 10.6a Follow-up issues (drafts; 10.6b [HUMAN] assigns owners and dates, then files them)

1. **Refuse or auto-abandon an expired draft at `/advance` (D10).** Labels: `security`. `team-content-access-helper.ts` grants draft-path (Path 3) access only within 24h, but `lobby` and later statuses get it with no time limit. Advancing an expired draft therefore **re-establishes** a facilitator's team-content access after it lapsed. This is pre-existing (`/advance` already transitioned before #175). Do not file without a named owner and a target date. Owner: ____ Target: ____
2. **Enforce the live facilitator role on the other session-phase endpoints** (start, begin-voting, topics/advance, reveal, complete). Labels: `security`. #175 covers `/advance` only (design Decision 3a). Owner: ____ Target: ____
3. **"Won't apply to today's session" hints** on archive, add, restore, and annotate while a session's room is open. Labels: `enhancement`, `ux`. Owner: ____ Target: ____
4. **Actionable copy for begin-voting's backstop `409`** ("This session has no topics configured…"), per Priya (O4). Labels: `ux`. Owner: ____ Target: ____
5. **Shared error-envelope type in `@dipstick/shared`**, if the frontend starts branching on `error.code` in more than a handful of places. Labels: `tech-debt`. Owner: ____ Target: ____
6. **(New, from implementation) Add a global Fastify error handler that hides 5xx messages.** The app registers none, so Fastify's default handler returns `err.message` (including `pg` error text) in every unhandled `500` body. #175 avoids this locally inside the `/advance` and `POST /teams` transactions only; once this lands, those local catches and `SnapshotFailedSignal` can go. Architect and security implementation reviews ask that this be a dated, owned release gate, or explicitly deferred. Labels: `security`. Owner: ____ Target: ____

## Implementation review fixes (architect M1/S1–S3, security MF1/SF1/SF2)

- **M1/MF1 (reverted deviation 2).** The non-UUID → `NULL` coercion in `evaluateStandingFacilitatorAccess` and `checkTeamExists` is gone; the helper again passes the id through unchanged. Ids are validated at the route boundary instead (one shared `isCanonicalUuid`, also used by `auth.ts`'s returnTo allow-list). A non-canonical `teamId` answers `404` before any query on `POST /draft`, `GET /topics/all`, and the five topic write routes.
- **SF1.** `/advance` rejects a non-canonical `sessionId` with `404` before any query, and its transaction catch answers a fixed `500` instead of rethrowing. `POST /teams` does the same for its fall-through. No global handler was added (follow-up 6).
- **SF2.** The `/advance` audit rows and log events take `team_id` from the session row.
- **S2.** The `POST /teams` `500` copy names team creation, not locking in topics.
- **S3 (behavior change; confirm with the BA).** After a `409 NO_ACTIVE_TOPICS` whose refetch fails, "Open the room" now stays enabled. Its next click re-runs the confirm refetch, so the page recovers without a reload. The spec scenario was amended to match.
- **Not changed.** Pre-existing, out of scope: archive and restore still send a malformed `topicId` to Postgres (`22P02` → `500`), as do other `:teamId`/`:sessionId` routes this change does not touch.

