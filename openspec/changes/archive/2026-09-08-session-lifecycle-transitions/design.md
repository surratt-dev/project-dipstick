## Context

`websocket-delivery-time-authorization` (archived 2026-09-07) built the entire delivery-time authorization and fan-out layer for four WebSocket content-access events, and named — without building — the state-transition writes those events depend on. Two of the four hooks it left uncalled are this change's responsibility: `publishVoteRevealed`/`recordRevealTriggeredAudit` (reveal) and `publishTopicHistoryUpdate` (topic advance). The dispatch logic that consumes them (`dispatchVoteRevealed`, `dispatchTopicHistoryUpdate` in `ws-event-dispatcher.ts`), the payload construction (`buildVoteRevealedPayload` in `vote-revealed-payload.ts`), and the authorization helpers (`evaluateSessionSubscriberAccess`, `evaluateTeamAccess`) are complete, unit-tested, and out of scope for this change to modify — this document is bound by their existing contracts, not free to redesign them.

**What already exists in the schema (verified, not assumed):** `sessions.status` (`lobby`/`pre_session`/`active`/`wrap_up`/`complete`/`abandoned`), `sessions.current_topic_id`, `sessions.wrap_up_started_at`, `sessions.voting_started_at` all already exist (`migrations/2_create_tables.sql`). `session_topics.status` (`waiting`/`voting`/`revealed`/`complete`), `session_topics.revealed_at`, `session_topics.completed_at`, `session_topics.display_order` all already exist. Every transition this change implements writes to columns that already exist — this is a genuine state-machine implementation gap, not a schema gap.

**What already exists in code (verified against `packages/backend/src`):** the `teams.ts` transaction pattern (`db.connect()` → `BEGIN` → queries → `COMMIT`/`ROLLBACK` → `client.release()`), used at `teams.ts` lines ~494–577 and already replicated in this codebase for the lobby-advance, session-close, and vote-lock-in handlers by the WebSocket change. `errorState`-keyed response shapes (`packages/shared/src/types/team-content-access.ts`) already exist for the reveal endpoint's current precondition failures (`RevealFailureResponse`). `AuditEventName` (`audit-logger.ts`) already includes `session.reveal_triggered`, `session.state_changed`, and `session.vote_submitted`.

**Stakeholders:** Devon Calloway (this document; ritual integrity — the reveal is a one-way gate or it is nothing), Priya Nair (Facilitator SME; named the topic-skip scenario and the 409-as-calm-state UX requirement), Marcus Delgado (BA; verified the action-item-finalization non-gap and the Appendix D contradiction), the engineer(s) who implement this change's tasks.

---

## Goals / Non-Goals

**Goals:**
- Make `session_topics.status: voting → revealed` a real, atomic, precondition-guarded write, and wire it to the already-built `publishVoteRevealed`/`recordRevealTriggeredAudit` hooks.
- Implement the two session-phase entry points (`SESSION-004`, `SESSION-005`) so a session can legally reach `active`, where a reveal is even possible.
- Implement topic-to-topic advance and `active → wrap_up` entry as a single new endpoint (`SESSION-012`), guarded by a hard reveal-before-advance precondition, wired to `publishTopicHistoryUpdate` (topic-to-topic) and `publishSessionStateChange` (wrap-up entry).
- Close the vote-lock-in/reveal race that only becomes exploitable once the reveal write is real.
- Specify the client-facing behavior of both new hard-precondition 409s as calm, non-alarming states — not just their HTTP contract.
- Correct Appendix D of the REST API Contract and add the missing `SESSION-012` entry.

**Non-Goals:**
- **Redesigning any part of the WebSocket delivery-time authorization, dispatch, or payload-construction layer.** `evaluateSessionSubscriberAccess`, `evaluateTeamAccess`, `dispatchVoteRevealed`, `dispatchTopicHistoryUpdate`, `buildVoteRevealedPayload` are complete and are called, not modified.
- **Team membership removal**, and any authorization model for it. Separate change (proposal.md, Out of Scope).
- **Facilitator-initiated topic-skipping.** Ruled out for this change (proposal.md, "Topic-Skip Decision").
- **Action item finalization as a new write.** Confirmed satisfied by the existing session-complete write; this document does not add a finalization column or endpoint.
- **Frontend implementation of the two new 409 UX states.** This document specifies the required behavior (Decision D3) as a contract the frontend must satisfy; it does not implement the frontend.
- **Mid-session membership-removal effects** (connection handling, readiness-grid consistency if a removal lands mid-session). Named but not designed here — belongs to the deferred membership-removal change.

---

## Decisions

### Note: two distinct id spaces govern every write in this document, and they must never share a variable

This note applies to every SQL statement in Decisions D1, D2, and D4, and is stated here once rather than repeated three times.

`sessions.current_topic_id` has a foreign key to `topics(id)` (`migrations/2_create_tables.sql:82-84`) — the team's reusable topic catalog. `session_topics` is a separate table with its own primary key (`session_topics.id`, its own `gen_random_uuid()` default) and its own FK column back to the catalog (`session_topics.topic_id → topics.id`). These are two different UUID spaces populated independently; a `session_topics.id` value is never a valid `topics.id` value and vice versa (this is not merely unlikely — `sessions_current_topic_fk` will reject a `session_topics.id` at commit time, and a `WHERE id = <topics.id>` filter against `session_topics` will always match zero rows).

**The binding rule, used consistently for the rest of this document:**
- Any value written to `sessions.current_topic_id`, or used to look up "the current topic" starting from a `sessions` row, is a **`topics.id`** — named `topicId` below.
- Any value used in `WHERE id = ...` against `session_topics`, or returned as `sessionTopicId` in an API response (Decision D3, D4a), is a **`session_topics.id`** — named `sessionTopicId` below.
- The two are related only via `session_topics.topic_id = topics.id` for a given row. Every transition below that touches both tables reads or joins to get both values explicitly — never derives one from the other by assumption, and never reuses one variable name for both.

This also fixes a gap Decision D2 previously left open: the reveal endpoint's existing precondition `SELECT` (`facilitator-sessions.ts:498-501`) does not currently select `current_topic_id`, so there was no `topicId` in scope to identify which `session_topics` row to transition at all. D2 below now specifies that read explicitly.

### Decision D1: Session-phase entry points reuse the existing state-transition + audit + publish pattern verbatim

**Choice:** `SESSION-004` (`POST /api/v1/sessions/:sessionId/start`) and `SESSION-005` (`POST /api/v1/sessions/:sessionId/begin-voting`) are implemented in `facilitator-sessions.ts`, following the exact structural pattern already used by the `draft → lobby` (`/advance`) and `wrap_up → complete` (`/complete`) handlers in the same file: fetch-and-validate the session row, authorize (`sessions.facilitator_id = userSession.userId`), open a transaction (`teams.ts` pattern), write the state transition plus an `audit_log` row with `operation = 'session.state_changed'` and `metadata = { session_id, prior_status, new_status }`, commit, then `publishSessionStateChange` after commit succeeds.

`SESSION-004` writes `sessions.status = 'pre_session'`, `sessions.started_at = NOW()`. No `session_topics` write — the pre-session action item review does not touch topics.

**Implementation-time addition, not a change to the id-space rule:** `BeginVotingResponse.currentTopic.firstSessionDescription` (below) requires `topics.first_session_description`, which is not denormalized onto `session_topics` (unlike `topic_name`/`topic_prompt`/`vote_type`, which are — see Decision D4a's "Query cost" note on why those specifically must not be re-joined). This field has no snapshotted equivalent, so the first-topic read below joins to `topics` for this one column: `SELECT st.id, st.topic_id, st.topic_name, st.topic_prompt, st.vote_type, t.first_session_description FROM session_topics st JOIN topics t ON t.id = st.topic_id WHERE st.session_id = $1 AND st.display_order = 1`. The initial session fetch also adds `is_first_session` to its column list. `firstSessionDescription` is `null` unless `sessions.is_first_session` is true.

`SESSION-005` first reads the session's first topic row (see the join above). This returns two distinct values per the id-space note above — `id` (call it `firstSessionTopicId`) and `topic_id` (call it `firstTopicId`) — plus the denormalized topic fields the response needs. `SESSION-005` then writes, in the same transaction: `UPDATE sessions SET status = 'active', voting_started_at = NOW(), current_topic_id = $firstTopicId WHERE id = $sessionId` and `UPDATE session_topics SET status = 'voting' WHERE id = $firstSessionTopicId`. Note precisely which value goes where: `current_topic_id` gets `firstTopicId` (a `topics.id`); the `session_topics` update's `WHERE id = ...` gets `firstSessionTopicId` (a `session_topics.id`). This is the one session-phase entry point that touches both tables — both writes commit together or neither does.

**Rationale:** Both transitions are structurally identical to the two transitions the WebSocket change already wired (`draft→lobby`, `wrap_up→complete`) — same authorization shape, same audit operation, same publish call. Building a new pattern for these two would be introducing variance with no benefit. `SESSION-005`'s dual-table write is the only complication, and it is exactly what the `BEGIN`/`COMMIT` transaction wrapper exists to make safe.

**409 precondition:** `SESSION-004` requires `sessions.status = 'lobby'`; `SESSION-005` requires `sessions.status = 'pre_session'`. Both already match the REST API Contract's documented error responses (`409 Conflict | Session is not in 'lobby'/'pre_session' status`) — this document does not change that contract, only implements it.

**Response shapes — new shared types, not existing precedent:** the REST API Contract already fully specifies `StartSessionResponse` (SESSION-004, lines ~1223-1236) and `BeginVotingResponse` (SESSION-005, lines ~1286-1299) as documentation, but neither exists as a TypeScript type anywhere in `packages/shared/src/types/` today (`grep -rn "StartSessionResponse\|BeginVotingResponse" packages/shared/src/types/` returns no hits). This change is what creates them, following the existing convention in `packages/shared/src/types/session.ts` (plain exported interfaces, e.g. `Session`, `SessionTopic`) and exported from `packages/shared/src/index.ts` alongside the other `session.ts` exports:

**Implementation-time correction:** this block originally omitted `updatedAt` (on each action item) and `hasOpenItems` (top-level) — both present in the REST API Contract's actual `SESSION-004` entry (lines ~1223-1240) this block claims to transcribe. Corrected below to match the contract, which remains the source of truth; this was a transcription gap in this document, not a contract change.

```typescript
export interface StartSessionResponse {
  sessionId: string;
  status: 'pre_session';
  startedAt: string;
  actionItems: Array<{
    actionItemId: string;
    description: string;
    ownerUserId: string;
    ownerDisplayName: string;
    status: 'open' | 'in_progress';
    originatingSessionId: string;
    originatingSessionNumber: number;
    stalenessLevel: 'none' | 'yellow' | 'orange' | 'red';
    createdAt: string;
    updatedAt: string;
  }>;
  hasOpenItems: boolean;
}

export interface BeginVotingResponse {
  sessionId: string;
  status: 'active';
  votingStartedAt: string;
  currentTopic: {
    sessionTopicId: string;   // firstSessionTopicId — session_topics.id, per the id-space note above
    topicName: string;
    topicPrompt: string;
    voteType: 'finger' | 'roman' | 'modified_roman';
    phase: 'voting';
    firstSessionDescription: string | null;
  };
}
```

Field values are transcribed from the REST API Contract, not invented here. `currentTopic.sessionTopicId` is `firstSessionTopicId` specifically — the same value written to `session_topics`'s `WHERE id = ...` clause above, not `firstTopicId`. Decision D4a's `TopicAdvanceResponse.currentTopic` mirrors this shape once it exists; D4a does not stand on prior precedent for it, this decision creates the precedent.

### Decision D2: Reveal precondition — conditional `UPDATE`, not a separate lock statement

**Choice:** The reveal endpoint has no `sessionTopicId` in its URL (`POST /api/v1/teams/:teamId/sessions/:sessionId/reveal` — only `teamId`/`sessionId`); "the current topic" is identified via `sessions.current_topic_id`. The endpoint's existing precondition `SELECT` (`facilitator-sessions.ts:498-501`) must therefore add `current_topic_id` to its column list, giving the handler `topicId = sr.current_topic_id` (a `topics.id`, per the id-space note above) before the transaction opens.

Inside the `teams.ts` transaction pattern, the reveal write uses `sessionId` and `topicId` directly — not a `session_topics.id` — so no separate lookup query is needed to resolve one:

```sql
UPDATE session_topics
SET status = 'revealed', revealed_at = NOW()
WHERE session_id = $1 AND topic_id = $2 AND status = 'voting'
RETURNING id, revealed_at
-- $1 = sessionId, $2 = topicId (sessions.current_topic_id, read above)
```

immediately followed by a `SELECT ... FOR UPDATE`-free row-count check: if `rowCount === 1`, the `RETURNING` row's `id` is `sessionTopicId` (a `session_topics.id`) — proceed to the `recordRevealTriggeredAudit` insert and `COMMIT`. If `rowCount === 0`, the topic was not `voting` (already revealed, or a stale request) — `ROLLBACK`, and run a follow-up, non-locking `SELECT id, revealed_at FROM session_topics WHERE session_id = $1 AND topic_id = $2` to populate the `already_revealed` response's `sessionTopicId`/`revealedAt` fields (Decision D3). This follow-up read is only for response-body content on the failure path; it is not part of the concurrency mechanism, which remains the single conditional `UPDATE` above.

**Rationale:** This is the cheaper of the two concurrency mechanisms the exploration notes named (conditional `UPDATE ... WHERE` vs. `SELECT ... FOR UPDATE` before a separate `UPDATE`). Postgres takes the row lock as part of evaluating the `UPDATE`'s own `WHERE` clause — a second, concurrent reveal attempt for the same topic blocks on that lock until the first transaction commits or rolls back, then re-evaluates its own `WHERE status = 'voting'` against the now-committed row and affects zero rows. No separate `SELECT ... FOR UPDATE` statement, no separate round-trip, and no window between a read and a write for a second request to slip through. This differs from the `teams.ts` role-change pattern (which uses an explicit `SELECT ... FOR UPDATE` because it needs to lock a *set* of rows — every active membership — before evaluating an aggregate count) — this decision is scoped to locking a single row, which the conditional `UPDATE` does natively.

**Alternative considered:** `SELECT id FROM session_topics WHERE id = $1 FOR UPDATE`, then a separate status check in application code, then an unconditional `UPDATE`. Rejected: functionally equivalent, but adds a statement and a round-trip for no additional safety — the conditional `UPDATE`'s `WHERE` clause already provides the same atomicity.

### Decision D3: Two new precondition error states, reusing the existing `errorState`-keyed shape

**Choice:** Two new discriminated variants are added to `packages/shared/src/types/team-content-access.ts`, alongside the existing `RevealFailureResponse`:

```typescript
export interface RevealAlreadyRevealedResponse {
  errorState: "already_revealed";
  sessionId: string;
  teamId: string;
  sessionTopicId: string;
  revealedAt: string; // ISO 8601 — from session_topics.revealed_at, so the
                       // frontend can render the SAME revealed state a
                       // successful reveal would have shown, not an error.
}

export interface TopicAdvanceBlockedResponse {
  errorState: "advance_blocked";
  sessionId: string;
  teamId: string;
  sessionTopicId: string;    // the CURRENT (unrevealed) topic
  requiresReveal: true;      // tells the frontend to offer the reveal action inline
}
```

Both return HTTP `409`. Neither is a bare `409` with an ad hoc body — both follow the same `errorState`-keyed pattern the reveal endpoint already uses for `RevealFailureResponse` (`facilitator-sessions.ts` lines 509, 554, 564, 579).

**Client-facing behavior, specified as a requirement of this design (delegated to frontend implementation, not designed here):**
- `already_revealed`: the facilitator's screen must render **indistinguishably from a successful reveal** — the revealed state is shown (it already is revealed), with no error chrome, toast, or banner implying something went wrong. The response's `revealedAt` field exists specifically so the frontend can render this state without a second round-trip.
- `advance_blocked`: the facilitator must land somewhere actionable, not a dead end. The minimum acceptable frontend behavior is that the blocked-advance UI offers the reveal action directly (the `requiresReveal: true` flag signals this), rather than requiring the facilitator to back out and locate the reveal control themselves.

**Rationale:** This is the direct implementation of the exploration notes' UX requirement (Section 4.1): a facilitator who double-clicks Reveal, or clicks "next topic" out of habit before revealing, did nothing wrong, and a red-banner error state at the exact moment they're supposed to be watching the room is a cost this application would introduce that the paper-and-spreadsheet ritual never had.

**Ordering requirement, stated as a safety condition on both new error states:** `already_revealed` and `advance_blocked` are only safe to return to a caller who has already passed the facilitator (and, for `SESSION-012`, team-id) authorization check — both bodies disclose `sessionTopicId`, and `already_revealed` additionally discloses `revealedAt`. The existing reveal handler already orders these correctly (facilitator check at `facilitator-sessions.ts:543`, precondition check at line ~577 — auth strictly first), and D2/D4 above preserve that order for both endpoints. This is easy to invert by accident during implementation — e.g., an implementer who runs the cheap `rowCount`/precondition check first as a "fast path" before the costlier facilitator lookup — so it is named here as a requirement, not left implicit: **authorization must run to completion, and pass, before either precondition check executes.** tasks.md 3.13 and 4.12 each add an explicit test: a non-facilitator's reveal/advance attempt against an already-revealed or not-yet-revealed topic still returns the existing generic 403, never `already_revealed`/`advance_blocked`.

### Decision D4: Topic advance and wrap-up entry are one endpoint, not two

**Choice:** `SESSION-012` (`POST /api/v1/teams/:teamId/sessions/:sessionId/topics/advance`) handles both topic-to-topic advance and entry into `wrap_up`, branching on whether a next topic exists in `display_order`, all inside one transaction. As with D2, the endpoint's initial session fetch (task 4.1) must select `current_topic_id` so the handler has `topicId = sr.current_topic_id` (a `topics.id`) in scope before the transaction opens — this endpoint has the identical "which row does `$1` identify" hazard D2 had, and is fixed the same way: locate the row by `session_id` + `topic_id`, never by an assumed `session_topics.id`.

**Implementation-time additions, not changes to the WHERE clause or locking behavior:**
- The precondition UPDATE's `RETURNING` clause below is extended to `RETURNING id, topic_name, completed_at` (from the literal `RETURNING id`) — `TopicAdvanceResponse.completedTopic` needs `topicName`/`completedAt` on both branches, and this avoids a second round-trip for them.
- The wrap-up-entry branch's `UPDATE sessions ... SET status = 'wrap_up', wrap_up_started_at = NOW(), current_topic_id = NULL` gains `RETURNING wrap_up_started_at`, needed to populate `TopicAdvanceResponse.wrapUpStartedAt`.
- The `rowCount === 0` (blocked) path performs one additional non-locking follow-up read — `SELECT id FROM session_topics WHERE session_id = $1 AND topic_id = $2` — mirroring Decision D2's `already_revealed` follow-up read. `TopicAdvanceBlockedResponse.sessionTopicId` requires the current (unrevealed) topic's `session_topics.id`, which a failed conditional UPDATE does not return; this document's SQL block below did not originally spell this out.

```sql
-- Precondition (same conditional-UPDATE pattern as Decision D2):
UPDATE session_topics
SET status = 'complete', completed_at = NOW()
WHERE session_id = $1 AND topic_id = $2 AND status = 'revealed'
RETURNING id, topic_name, completed_at
-- $1 = sessionId, $2 = topicId (sessions.current_topic_id, read above)
-- rowCount === 0 → ROLLBACK, follow-up SELECT id FROM session_topics WHERE
--   session_id = $1 AND topic_id = $2, return TopicAdvanceBlockedResponse (409)
-- rowCount === 1 → the RETURNING row's `id` is completedSessionTopicId (session_topics.id)

-- Then, look up whether a next topic exists, by display_order, for this session.
-- This query returns a session_topics row directly — both id spaces come off
-- it explicitly, and the denormalized topic_name/topic_prompt/vote_type
-- columns (see Decision D4a) come off the same row, no join to `topics`:
SELECT id, topic_id, topic_name, topic_prompt, vote_type
FROM session_topics
WHERE session_id = $1 AND display_order = (
  SELECT display_order + 1 FROM session_topics WHERE session_id = $1 AND topic_id = $2
)
-- Next topic exists → nextSessionTopicId = id, nextTopicId = topic_id

--   Next topic exists:
UPDATE session_topics SET status = 'voting' WHERE id = $nextSessionTopicId;
UPDATE sessions SET current_topic_id = $nextTopicId WHERE id = $sessionId;
--   No next topic — current_topic_id has no session_topics-row ambiguity here,
--   it is simply cleared:
UPDATE sessions SET status = 'wrap_up', wrap_up_started_at = NOW(),
                     current_topic_id = NULL WHERE id = $sessionId;
```

Note precisely which value goes where, mirroring D1's SESSION-005 rule: `sessions.current_topic_id` gets `nextTopicId` (a `topics.id`); the `session_topics` update's `WHERE id = ...` gets `nextSessionTopicId` (a `session_topics.id`). The two are read off the same row in the lookup query above and must be kept as two separate variables from that point forward — never collapsed into one `$nextTopicId` used against both tables, which is the exact defect this note exists to prevent.

Audit: the topic-to-topic branch writes `operation = 'session.topic_advanced'` (new `AuditEventName` value) with `metadata = { session_id, completed_session_topic_id, new_session_topic_id }` (both `session_topics.id` values — `completedSessionTopicId` and `nextSessionTopicId`). The wrap-up-entry branch writes `operation = 'session.state_changed'` (existing value, since `sessions.status` changes here exactly as it does for every other transition already using that operation) with `metadata = { session_id, prior_status: 'active', new_status: 'wrap_up', completed_session_topic_id }` — the completed topic's `session_topics.id` is included here too, matching the topic-to-topic branch, so an audit-log reviewer can identify which topic was in progress at wrap-up entry without cross-referencing `session_topics.completed_at` timestamps.

Publish, after commit: the topic-to-topic branch calls `publishTopicHistoryUpdate(teamId, { teamId, updateType: 'topic_advanced', sessionId, topicId: nextTopicId, updatedAt })` — the shared type's `updateType: 'topic_advanced'` value exists specifically for this and was otherwise unused. The wrap-up-entry branch calls `publishSessionStateChange(sessionId, { sessionId, teamId, previousStatus: 'active', newStatus: 'wrap_up', changedAt })` **and** `publishTopicHistoryUpdate` for the just-completed last topic — the topic's completion is team-content-relevant on its own, independent of the session-phase change.

**Rationale for one endpoint, not two:** a facilitator does not choose "advance to next topic" vs. "enter wrap-up" as two different actions — they click the same "next" control on the last topic that they clicked on every prior topic. The branching belongs in the server, which is the only side that knows whether a next topic exists, not in the client. Splitting this into two endpoints would push that knowledge to the frontend and create a window where the frontend's belief about "is this the last topic" could be stale relative to the server's.

**Rationale for reusing `publishTopicHistoryUpdate` rather than inventing a fifth `WsEventType`:** `TopicHistoryUpdatePayload.updateType` already includes `"topic_advanced"` as a value in the shared type (`packages/shared/src/types/realtime.ts`), added by the WebSocket change specifically in anticipation of this trigger. Inventing a new event type would mean extending the closed `WsEventEnvelope`/`WsClientMessage` unions, adding a new dispatch case to `ws-event-dispatcher.ts`, and re-deriving delivery-time authorization for it — all surface the WebSocket change already built the exact right-sized hook to avoid.

**Known integration gap, named rather than silently absorbed:** `topic_history_update` is delivered to connections registered under the **team**-scoped local registry (`registry.candidates("team", teamId)`), not the session-scoped one. A participant connected only to their session's channel (for `vote_readiness_update`/`session_state_change`/`vote_revealed`) will not receive a topic-to-topic advance notification unless the client also subscribes to the team channel. This is a frontend WebSocket-subscription concern, not a backend authorization or fan-out gap — `evaluateTeamAccess` already correctly grants `member`/`facilitator` access to an in-session participant, since they hold an active team membership. This document names the gap explicitly (rather than let it surface as a confusing bug report later) and defers its resolution to the frontend implementation task that wires up the topic-advance UI; it does not require backend changes.

**Authorization, named explicitly (not left as "facilitator only"):** `SESSION-012`'s URL (`/api/v1/teams/:teamId/sessions/:sessionId/topics/advance`) takes both `:teamId` and `:sessionId`, the same shape as the existing `advance`/`complete` handlers in `facilitator-sessions.ts`, and must perform the same two checks those handlers perform, not one: (1) `sessionRow.team_id !== teamId → 403` ("Session does not belong to this team"), and (2) `sessionRow.facilitator_id !== userSession.userId → 403`. Because `facilitator_id` is already scoped to a specific session, a facilitator who is not this session's facilitator is rejected by check (2) alone even without check (1) — so omitting the team-id cross-check is not an exploitable bypass today — but it is a departure from this file's established defense-in-depth pattern, and the existing `advance`/`complete` test suites assert the team-mismatch 403 as its own scenario. `SESSION-012` must do the same: both checks named explicitly in the handler, both covered by their own test case (tasks.md 4.1, 4.12).

**Ordering, restated for this endpoint (see Decision D3's equivalent note for reveal):** the two authorization checks above must run, and must both pass, before the `advance_blocked` precondition check runs. A non-facilitator (or a facilitator of a different team's session) must never reach the branch that returns `TopicAdvanceBlockedResponse` — that response's fields (`sessionTopicId`, `requiresReveal`) are only safe to disclose to an already-authorized caller. tasks.md 4.12 adds an explicit test for this ordering, mirroring the equivalent reveal-endpoint test (tasks.md 3.13).

### Decision D4a: `SESSION-012`'s success response is discriminated by `status`, matching the two branches of Decision D4

**Choice:** `SESSION-012`'s `200 OK` response reuses the discriminant already present on every other session-phase response in this contract — `status`, reflecting `sessions.status` after the write — rather than inventing a separate flag. Because the two branches leave `sessions.status` at different values (`active` for topic-to-topic advance, `wrap_up` for wrap-up entry), `status` alone is enough for the client to distinguish them, exactly as `StartSessionResponse.status` and `BeginVotingResponse.status` are specified to do for `SESSION-004`/`SESSION-005` in Decision D1 above. Note the tense: D1 is what defines these two types in this change (they don't exist yet — see D1's "Response shapes" note) — `TopicAdvanceResponse` is being built to the same pattern D1 establishes, not mirroring settled prior art:

```typescript
interface TopicAdvanceResponse {
  sessionId: string;
  teamId: string;
  status: 'active' | 'wrap_up';   // sessions.status after this transition — the discriminant
  completedTopic: {
    sessionTopicId: string;
    topicName: string;
    completedAt: string;
  };
  // Present only when status === 'active' (a next topic exists):
  currentTopic?: {
    sessionTopicId: string;
    topicName: string;
    topicPrompt: string;
    voteType: 'finger' | 'roman' | 'modified_roman';
    phase: 'voting';
  };
  // Present only when status === 'wrap_up' (no next topic remained):
  wrapUpStartedAt?: string;
}
```

`completedTopic.sessionTopicId` is `completedSessionTopicId` (the `RETURNING id` value from D4's precondition write, a `session_topics.id`) — present on both branches, since it identifies the topic that just transitioned to `complete`, which the client needs regardless of what happens next (e.g., to update a topic-history list without a second round-trip). `currentTopic` mirrors the shape D1's `BeginVotingResponse.currentTopic` uses for a topic entering `voting` (`sessionTopicId`, `topicName`, `topicPrompt`, `voteType`, `phase`), minus `firstSessionDescription`, which is specific to a session's very first topic and does not apply to a topic reached by advance; `currentTopic.sessionTopicId` here is `nextSessionTopicId` (the `id` column from D4's next-topic lookup), not `nextTopicId`. `wrapUpStartedAt` echoes `sessions.wrap_up_started_at`, matching how `StartSessionResponse.startedAt` and `BeginVotingResponse.votingStartedAt` each echo their own transition's timestamp column.

**Rationale:** This is the same pattern the contract already specifies twice (`SESSION-004`, `SESSION-005`, per Decision D1) for a response whose shape depends on which of two states a transition landed in — reusing `status` as the discriminant means a client that already knows how to read `sessions.status` off any other session response doesn't need a second parsing convention for this one. An optional-field pair gated by the same `status` value a client checks anyway is lower-friction than a separate boolean flag (e.g., `advanced: boolean`) that would just restate what `status` already says.

**Query cost:** the topic-to-topic branch already knows `nextTopicId` and `nextSessionTopicId` from Decision D4's `display_order` lookup (tasks.md 4.4) — and that lookup already selects `topic_name`/`topic_prompt`/`vote_type` directly off the `session_topics` row, because those columns are denormalized onto `session_topics` at `SESSION-001` creation time (`migrations/2_create_tables.sql:86-101`), not stored only on `topics`. No join to `topics` is needed, and none should be added: `topics.name`/`topics.prompt` reflect the team's current, possibly since-edited catalog entry, while `session_topics.topic_name`/`topic_prompt` are the point-in-time snapshot the Topic-Skip Decision (proposal.md) depends on. Joining to `topics` here would leak a post-snapshot topic edit into a running session's UI — a correctness bug, not just a wasted round-trip. `vote-revealed-payload.ts`'s existing query confirms this is the established pattern: it selects `st.topic_name` straight off `session_topics` with no join to `topics`.

### Decision D5: The vote lock-in / reveal race — closed with a row lock in the lock-in transaction

**Choice:** `POST /api/v1/sessions/:sessionId/topics/:sessionTopicId/lock-in` (`sessions.ts`), inside its existing transaction (already refactored to the `teams.ts` pattern by the WebSocket change for the vote-submission audit write), adds:

```sql
SELECT status FROM session_topics WHERE id = $1 FOR UPDATE
```

immediately before the `INSERT INTO votes ... ON CONFLICT ... DO UPDATE`. If the selected `status !== 'voting'`, `ROLLBACK` and return **`422`** (reusing the existing `invalid_request` error category already used elsewhere in this handler, with a message distinguishing "voting has closed for this topic" from the handler's existing EM-rejection and non-participant 403s).

**Status code, made explicit:** `sessions.ts` already has a non-transactional, pre-transaction check for this identical condition (`topic_status !== 'voting'`, lines ~213-221), and it returns `422`, not `409` — "invalid request" against `invalid_request`'s existing category, for a request that was never valid to begin with given the topic's state at read time. This decision's in-transaction check guards the genuine race window that check can't see (the topic was `voting` when the pre-check ran but became `revealed` before the lock-in's own transaction committed), but it is the *same substantive failure* — "voting is not open for this topic" — so it must return the same code the existing check already returns, or a client/test cannot rely on one status code meaning one thing regardless of which code path caught it. This design originally specified `409` for the new check; that was inconsistent with the pre-existing check in the same handler and has been corrected to `422` here to conform to existing precedent in this file, not the other way around.

**Rationale:** Before this change, `session_topics.status` never reached `revealed`, so a vote submitted "after reveal" was structurally impossible — there was no reveal for it to race. Once Decision D2 makes the reveal write real, this race becomes real: a lock-in request and a reveal request for the same topic, arriving within milliseconds of each other, could both read `status = 'voting'` before either commits, and the lock-in's `INSERT` would succeed after the reveal's `UPDATE` — producing a vote in the `votes` table for a topic whose `status` is already `revealed`, which `vote-revealed-payload.ts`'s query (`fetchFacilitatorVoteRevealedRows`/`fetchParticipantVoteRevealedRows`, both unconditional `LEFT JOIN votes`) would include in the revealed set. This directly violates FR-4.7 ("votes that have been revealed shall be immutable") in its more fundamental form — a vote must not be **admitted** into a revealed topic's result at all, not merely be immutable once it's there.

The `SELECT ... FOR UPDATE` on `session_topics` in the lock-in transaction takes the same row lock the reveal's conditional `UPDATE` (Decision D2) takes. Whichever transaction reaches the row first forces the other to wait; the loser re-evaluates against post-commit state and correctly fails (the lock-in sees `status = 'revealed'` and rejects; or, symmetrically, a reveal that started first commits, and a lock-in that started a moment later and had to wait now correctly sees `revealed` and is rejected). This is the same row-locking discipline `teams.ts` already established, applied to a table this change is the first to make lockable in a meaningful way.

**Required test case (named explicitly, not assumed safe by resemblance to Decision D2):** a reveal request and a lock-in request for the same `session_topic_id`, issued concurrently, must produce exactly one committed outcome consistent with real-world ordering — either the vote is rejected because the topic was already revealed, or the vote commits and the reveal (issued a moment earlier in wall-clock terms but concurrent at the database level) still only reveals the votes that existed at its own commit point. This is a different failure mode than Decision D2's duplicate-reveal race (a vote silently entering the revealed set, not a duplicate write to the same row) and needs its own integration test, not a re-run of D2's test with different table names.

### Decision D6: `errorState` categorization stays inside the reveal/advance endpoints — no shared "precondition failure" middleware

**Choice:** The `already_revealed` and `advance_blocked` checks are implemented as inline row-count checks inside their respective endpoint handlers (`facilitator-sessions.ts` for reveal, the new `SESSION-012` handler for advance), not factored into a shared "session-topic precondition" helper.

**Rationale:** The two checks are structurally similar (conditional `UPDATE`, check `rowCount`, translate to a specific `errorState`) but semantically distinct — one gates entry to `revealed`, the other gates entry to `complete`/`wrap_up` — and each is a single `if (rowCount === 0)` block. Factoring two three-line checks into a shared helper would trade a small amount of duplication for an abstraction that has to be generic enough to name both cases, which is not a good trade at this size. If a third precondition-guarded topic-status transition is added in a future change, that is the point to revisit this decision, not before.

---

## Risks / Trade-offs

**[Risk: An implementer treats `SESSION-012`'s wrap-up branch as "just set status to wrap_up" and misses that `current_topic_id` must be cleared] → Mitigation:** Decision D4's SQL is stated explicitly, including `current_topic_id = NULL`, and tasks.md names this as a distinct sub-step with its own test (a session in `wrap_up` has no current topic).

**[Risk: The lock-in/reveal race fix (Decision D5) is treated as optional hardening rather than a required part of this change, since it touches a file the reveal write doesn't otherwise need to touch] → Mitigation:** proposal.md's What Changes section names this as a required correctness fix, not an optional improvement, and design.md states the FR-4.7 violation explicitly. tasks.md gates the reveal-write task group on this fix being present, not the other way around.

**[Risk: `topic_history_update`'s team-scoped delivery (Decision D4's named integration gap) is discovered as a "bug" during frontend implementation rather than understood as an already-named design trade-off] → Mitigation:** named explicitly in Decision D4 with the reasoning for why it is not a backend gap, so a frontend implementer's fix is "subscribe to the team channel too," not "change the backend's delivery scope" (which would reopen `websocket-delivery-time-authorization`'s already-closed Decision D2/D3).

**[Risk: A reviewer expects `SESSION-004`/`SESSION-005` to already exist because the REST API Contract documents them, and doesn't realize this change is what makes them real] → Mitigation:** proposal.md's Why section states this explicitly, with the verification method (grep against `packages/backend/src/routes/`) named rather than asserted.

**[Risk: The two new `errorState` variants drift from the frontend's actual rendering if the "calm, no error chrome" requirement in Decision D3 is treated as documentation rather than an acceptance condition] → Mitigation:** tasks.md includes an explicit acceptance task for both states' rendering behavior, not just their HTTP contract, mirroring how the archived `team-content-access` spec's existing Error State 1–4 scenarios are written as behavioral scenarios, not just status codes.

**Note, not a risk to this change — flagged for reprioritization elsewhere:** before this change ships, `vote_revealed` and `topic_history_update` never fired in production (Decisions D2/D4 are what wire their first real triggers), so the idle-connection re-authorization gap tracked in GitHub issue #27 (SEC-25/SEC-26) was real but operationally inert for these two event types — there was no actual vote or topic content for a stale-but-not-yet-expired idle connection to receive. Once this change ships, that stops being true: a connection idle for, say, 85 minutes (inside the 90-minute absolute cutoff `isConnectionExpired` enforces) will now actually receive real vote values or topic-advance content the moment a reveal or advance fires. This change does not create a new authorization gap — `dispatchVoteRevealed`/`dispatchTopicHistoryUpdate` still evaluate access fresh, per-message, against live DB state, so a revoked membership is still caught — but it gives issue #27's existing gap something real to expose for the first time. This is not something to build in this change; it is a recommendation to reprioritize issue #27 (currently placeholder-targeted for Q4 2026) alongside this change's rollout, made here so it isn't rediscovered cold during a later security review.

## Migration Plan

No schema changes — every column this change writes to already exists. No data migration required.

**Sequencing:**
1. `SESSION-004`/`SESSION-005` (Decision D1) — these must exist before a session can ever reach `active`, which every other transition in this change depends on for testability.
2. The vote lock-in row-lock fix (Decision D5) — sequenced before the reveal write becomes callable in a real end-to-end test, so no test run can observe the race it closes.
3. The reveal write itself (Decision D2/D3).
4. `SESSION-012` (Decision D4), which requires a topic to already be `revealed` to test its precondition.
5. REST API Contract corrections (Appendix D, `VOTE-003`, new `SESSION-012` entry) — documentation-only, can proceed in parallel with 1–4 once the endpoint shapes are settled.

**Rollback:** Each new/modified endpoint can be reverted independently by removing its route registration; none introduces a schema change or a data migration to unwind. The lock-in row-lock fix (Decision D5) is additive-only (a stricter precondition, not a changed success-path behavior) and safe to leave in place even if the reveal write is rolled back — it simply becomes unreachable dead-code protection until the reveal write returns.
