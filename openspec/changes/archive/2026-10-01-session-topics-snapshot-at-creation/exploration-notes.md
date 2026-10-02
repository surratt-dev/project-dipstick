# Exploration notes: session-topics-snapshot-at-creation (#175)

**Explored by:** Devon Calloway (Internal Champion), via `opsx:explore`
**Date:** 2026-10-01
**Status:** Exploration complete, revised after Facilitator (Priya Nair) and BA (Marcus Delgado) review. No code written. Sections 3-4 record the decisions for the proposal to carry. One gate remains open: the operator backfill question (D11).

---

## 1. The problem in one paragraph

No shipped route writes `session_topics`. The table is the topic list a session runs on. Every phase after the lobby reads it: begin-voting, reveal, advance, vote lock-in, history, the EM views, the reveal payload, and the reconnect snapshot. Today only integration-test fixtures insert rows, so every real session stops at `SESSION-005` with the clean 409 "This session has no topics configured and cannot begin voting" that `remove-topic` Decision 8 put in place of the old crash. The ritual cannot complete for any team. This is not an edge case. It is the main path.

From where I sit, this is the most serious open gap in the product. Teams can create, customize and annotate topics, open a room and run the action-item review, then hit a wall at the moment they should start voting. A team that hits that wall once will stop trusting the tool.

---

## 2. What exists today (grounded in code)

### Session creation paths (there are two, plus one transition)

```
 POST /api/v1/teams/:teamId/sessions/draft     -> sessions.status = 'draft'   (facilitator-sessions.ts ~L254-445)
        |
        |  POST /api/v1/teams/:teamId/sessions/:sessionId/advance   (draft -> lobby, ~L690-805)
        v
     'lobby'  <---------------------------------  POST /api/v1/teams  (new team + default topics + first session,
        |                                          inserted straight into 'lobby', ~L470-680)
        |  POST /sessions/:id/start      SESSION-004   lobby -> pre_session
        v
   'pre_session'
        |  POST /sessions/:id/begin-voting   SESSION-005   reads session_topics WHERE display_order = 1
        v
     'active'  -- reveal / advance (SESSION-012 reads display_order + 1) --> 'wrap_up' --> 'complete'
```

- The contract's `SESSION-001` (`POST /api/v1/sessions`, straight to `lobby`, with a bulk `session_topics` insert in the same transaction) **was never built in that shape**. The `draft` status came later (migration 9, `enforce-access-control-on-team-content` Decision 3) as the facilitator's 24-hour window to review history before opening the room.
- `POST /draft` and `POST /teams` are the only `INSERT INTO sessions` in `src/` (grep confirms). `/advance` is the only `draft -> lobby` path.
- Both inserts already run inside a `BEGIN/COMMIT` with their audit row, so a snapshot insert has an obvious transactional home in each one.

### `topics` (source)

`id, team_id, name, prompt, vote_type, display_order, status ('active'|'archived'), is_default, first_session_description, archived_at/by, restored_by, team_annotation, annotation_updated_by/at`.

- Partial unique index `topics_team_active_order (team_id, display_order) WHERE status='active'` (migration 18).
- **Active `display_order` is not dense.** Archive (TOPIC-004) leaves gaps. Add (TOPIC-003) appends at `COALESCE(MAX,-1)+1`. Restore (TOPIC-005) appends at `MAX+1`. Reorder (TOPIC-006) writes a dense 1..N. Seeded defaults are 1-based. `reorder-topics` design.md:121 says plainly that nothing may assume density.
- Custom topics are ordinary `topics` rows (`is_default = false`). Nothing about them needs special handling in the snapshot.

### `session_topics` (target)

`id, session_id (FK, ON DELETE CASCADE), topic_id (FK topics), display_order, topic_name, topic_prompt, vote_type, status (default 'waiting'), revealed_at, completed_at, flagged_for_discussion, discussion_note, topic_annotation (migration 19)`. Unique `(session_id, display_order)` and `(session_id, topic_id)`.

- There is no `first_session_description` column. Begin-voting `JOIN`s `topics` live for it. That is fine in practice, because the first session's topics are locked by the customization lock, but it is a live read sitting next to snapshot reads.

### What readers expect of `session_topics`

| Reader | Expectation |
|---|---|
| begin-voting (`facilitator-sessions.ts` ~L1196) | a row at `display_order = 1` exactly |
| advance (~L1866) | the next row at `display_order + 1`, so **dense, 1-based** |
| reveal (~L1641) | `(session_id, topic_id)` lookup; `current_topic_id` is a **topics.id** |
| vote lock-in (`sessions.ts` ~L281, ~L433) | `session_topics.id`, `FOR UPDATE` on status |
| history / trends (`content.ts`), EM views (`em-views.ts`) | ordering by `st.display_order`, `topic_name` from the snapshot |
| `vote-revealed-payload.ts`, `open-action-items-helper.ts` | `session_topics.id` joins |
| `session-registration-snapshot.ts` L51-52 | joins `st.id = s.current_topic_id`, which is a **session_topics.id**. See risk R5. |

### Spec and design constraints already pinned

- `session-topic-lifecycle` "Mid-session topic-skipping is not supported": the list "is snapshotted into `session_topics` at session **creation** (`SESSION-001`), not at session start (`SESSION-004`)... an edit made after a session already exists has no effect on that session's topic list, however long it remains in `lobby`."
- `session-topic-lifecycle` pending requirement (from `topic-annotation`): one write for the whole row (`topic_name`, `topic_prompt`, `vote_type`, `display_order`, `topic_annotation`), completed before the first `SESSION-005` can succeed. "Whether that write happens at session creation or when a session leaves `draft` is decided once, for the whole row, by #175." (H2)
- `reorder-topics` design Decision 7 and spec: **"the snapshot must be taken on entry to `lobby` (both the draft-advance path and direct-to-lobby creation), not on draft creation."** `openSessionCreatedAt` deliberately excludes `draft`. A spec scenario asserts that a draft-only team gets `null`. "If #175 decides otherwise, this status list must change with it."
- `reorder-topics` design.md:121 / task 4.7: the snapshot must renumber with `row_number() OVER (ORDER BY display_order)`.
- BRD FR-2.7: "The order in effect when a session is created is the order that session uses." It says nothing about drafts.
- `persistence-layer-mapping.md` "Session Created" and the contract's `SESSION-001` notes: same transaction as the session insert, one row per active topic in display order, `status='waiting'`.

---

## 3. The central question: when is "creation"? (DECIDED: room open)

The documents use "creation" for two different moments. UC 02 step 6 creates the session record in `draft`. The contract's `SESSION-001` and `persistence-layer-mapping.md` ("Session Created ... enters the `lobby` state") create it into `lobby`. Rewording one spec will not settle this. We need a term of its own.

```
            draft created ----- facilitator reviews trends, may reorder/remove/annotate ----- ROOM OPEN (lobby)
                 ^                                                                              ^
   Option A (rejected)                                                           Option B (chosen)
```

**Decision D1: the snapshot is taken at "room open".**

- **Definition (normative, used verbatim in every document):** *Room open* is the moment a session's status first becomes `lobby`. That happens by `POST /teams/:teamId/sessions/:sessionId/advance` (draft to lobby) or by `POST /teams` (new team, first session created directly in `lobby`). Nothing else.
- Every document that says "at session creation" for topic-list purposes is changed to "at room open". Section 8 lists them.
- **Why B.** Marcus (BA) and Priya (Facilitator) both confirmed it.
  - *Ritual.* The list freezes when the room becomes shared. Before that point the facilitator is preparing. After it, nobody changes what the team is about to be asked. Priya's real prep loop (look at trends, move a heavy topic up, then open the room) only works under B. Under A that prep is thrown away without any signal, which is the worst failure a facilitator tool can have.
  - *Traceability.* FR-2.7 (the order can change before use) and the draft window (UC 02 Addendum step 9) only agree under B. The shipped `reorder-topics` spec already says the snapshot "belongs at the point the session reaches `lobby`".
- **Option A (at draft creation)** is rejected. It defeats the draft window and contradicts a shipped spec.
- **Option C (at start, or lazily at begin-voting)** is rejected. The spec forbids it, and it would let the list change while participants sit in the lobby.
- **The join link already works in `draft`.** `DraftSessionHost.tsx:273` says: "This link works already — anyone who opens it before you open the room won't see a waiting screen yet." A facilitator who wants to send the link early can do so without opening the room. That means the early-freeze case Priya raised (O2) is something the facilitator chooses, not something forced on them. The confirm copy (D3) makes the choice visible.
- **`POST /teams` locks the list immediately, and that is intended.** A new team's first session gets the canonical defaults with no draft window. That fits the first-session customization lock and is how a team learns the standard set. Nobody should "fix" this by adding a draft step to team creation.
- **The snapshot is not configurable.** "Snapshot or live" never becomes a setting. One sentence goes into `session-topic-lifecycle`'s Purpose.

---

## 4. Decisions (for the proposal to carry as requirements)

### D2. What the snapshot writes
At room open, the application SHALL insert exactly one `session_topics` row for each of the team's topics with `status = 'active'`, and no others, **in a single statement**. Column mapping:

- `topic_id`
- `topic_name` ← `name`
- `topic_prompt` ← `prompt`
- `vote_type`
- `topic_annotation` ← `team_annotation`
- `display_order` ← `row_number() OVER (ORDER BY display_order, id)`
- `status = 'waiting'`

The remaining columns (`revealed_at`, `completed_at`, `flagged_for_discussion`, `discussion_note`) keep their defaults.

- The `display_order` values SHALL be exactly 1..N in the team's active order, whatever gaps exist in `topics.display_order`. Active orders {1,3,4} become {1,2,3}. Active orders {2,3} (position 1 archived) become {1,2}.
- `first_session_description` is the one topic field not snapshotted. It is read live from `topics` because it is administrator-maintained default copy, and the customization lock keeps it stable for a team's first session. No other in-session topic field SHALL be read from `topics`. This goes into `session-topic-lifecycle`, so nobody "fixes" the annotation read by moving it back to a live join.
- The pending annotation requirement in `session-topic-lifecycle` becomes normative. The row is written by one statement, `topic_annotation` included.

### D3. "Open the room" confirm copy: in scope, with the topic count
This is Priya's version, not the shorter BA sentence. The count is the part a facilitator will actually check, and it catches "I meant to archive that one." The wording is calm and factual: no warning icon, no red text.

> Opening the room lets participants join immediately and locks in this session's **9 topics** in their current order. Topic changes after this apply to your next session. This cannot be undone.

- Use "1 topic" in the singular. I dropped "today's" from Priya's draft, because a draft can be opened on a later day than the one it was created.
- Source: the facilitator state response for a `draft` session gains one field, `activeTopicCount`. The draft host refetches it when the confirm opens, so the count is fresh at the moment of decision. The server stays authoritative (D4).
- The full "last look" list stays in `topic-skip-and-creation-time-confirmation`. That stub's "last look" signal moves to this confirm, not to draft creation.

### D4. Zero active topics
- **`/advance`:** a hard guard at room open. Return `409` with `error.code: "NO_ACTIVE_TOPICS"` and the message *"This team has no active topics. Add or restore a topic on Topic Management before opening the room."* The session stays in `draft`.
- **Draft host, before the click:** when `activeTopicCount === 0`, the "Open the room" button is disabled. The same copy shows next to it, with a link to Topic Management. A dead end after the confirm is worse than a clear state up front.
- **`POST /teams`:** zero topics here means the template team has no defaults. That is an operator fault the user cannot act on. The whole team-plus-session transaction rolls back and returns a 500-class configuration error, logged at error level. (Correction to C7: the audit row would roll back with the transaction, so "audited" is not possible. This is a log line, not an audit row.)
- **No minimum above 1.** A one-topic session is valid.
- The begin-voting `409` guard stays as a backstop. Its copy is unchanged in this change (see Deferred).
- The guard is defense in depth. TOPIC-004 already refuses to archive the last active topic.

### D5. Atomicity
The snapshot runs in the same transaction as the `lobby` transition (`/advance`) or the session insert (`POST /teams`). If the snapshot fails or inserts zero rows, `sessions.status` SHALL remain `draft` (or, for `POST /teams`, nothing commits). No `session.state_changed` audit row and no `session_state_change` event SHALL be produced.

### D6. Concurrent / double advance: idempotent from the facilitator's point of view
- **Server:** the transition becomes conditional, `UPDATE sessions SET status='lobby', room_opened_at=now() WHERE id=$1 AND status='draft' RETURNING ...`. The snapshot and audit row are gated on that statement updating exactly one row. A second concurrent `/advance` gets the **same `422`** the route returns today for a non-draft session (the BA confirmed it is 422, not 409). It writes no audit row and no `session_topics` rows, and never returns a 5xx.
- **Frontend (Priya's S5, accepted):** double-clicks happen, especially on a slow connection with the team watching. On a `422` from `/advance`, the draft host refetches facilitator state. If the session is now `lobby`, it moves to the lobby view as if the open succeeded, with no error banner. It decides from the refetched state, not by matching the error message.

### D7. Advisory lock: take it
The snapshot transaction takes `pg_advisory_xact_lock(hashtext(teamId))` before the `INSERT ... SELECT`. This is the same lock every topic write uses.

- **Required behavior:** the snapshot reflects the team's committed active list at a single instant. It never mixes a reorder's before and after states and never contains negative `display_order` values.
- Under READ COMMITTED a single statement probably meets that without the lock. But the lock is cheap and matches the house pattern, and it removes the need for the next engineer to repeat that reasoning. It also serializes room open against a concurrent archive or restore, so the count shown in D3 and the rows written cannot disagree with a write that was in flight.
- design.md fixes the lock order (team lock first, then the session row).

### D8. R5 (`current_topic_id` id-space mismatch): fixed in this change
Both reviewers asked for this, and I agree. This change is what makes the defect reachable for the first time. Shipping #175 without the fix would trade a session that cannot start for one whose readiness grid is wrong on every reconnect. The grid is how the facilitator knows when to call the reveal.

- **One id-space: `sessions.current_topic_id` is a `topics.id`.** That is how begin-voting and advance write it today and how reveal reads it. `session-registration-snapshot.ts` resolves the current row through `(session_id, topic_id)` and joins `votes.session_topic_id` to that row's `id`.
- Update `redis-session-model.md`, which defines the field as `session_topics.id`, to match.
- The fix is scoped to the registration snapshot plus the doc. No other reader changes.
- e2e step: a participant locks in, reconnects, and the facilitator's readiness grid still shows them locked in.

### D9. R7 (`openSessionCreatedAt` and the room-open timestamp): in scope
The hint is a promise the tool makes to the facilitator. Today it shows the draft's `created_at` date, which is wrong for any draft opened on a later day. A small inaccuracy like that teaches people not to trust the tool.

- New column **`sessions.room_opened_at timestamptz NULL`**, named after the D1 term. `/advance` sets it in the same conditional `UPDATE` (D6). `POST /teams` sets it at insert. It stays `NULL` for drafts.
- `readOpenSessionCreatedAt` returns `room_opened_at`. The response field name `openSessionCreatedAt` is kept for compatibility, and its definition in the `reorder-topics` spec changes to "the room-open time of the team's open session". The draft exclusion stays. **This is a `reorder-topics` spec delta.** My earlier "no change needed under B" was wrong.
- Topic Management copy: "Order saved. The session opened on {date} keeps its original order."
- No backfill of the column for existing lobby-or-later rows. If any such rows exist (see D11), the reader falls back to `created_at` when `room_opened_at` is null.

### D10. Expired drafts at `/advance`: out of scope, filed
The BA confirmed that `/advance` does not enforce the 24h expiry today. The 24h window controls *history access* (`team-content-access-helper.ts`). It does not control topic freshness. Under D1 the snapshot is taken at room open from the live active list, so opening an old draft runs the right topics.

Refusing at `/advance` has a cost. The partial unique index counts an expired draft as non-terminal, so the facilitator would have a draft they can neither open nor replace. Fixing that properly means auto-abandoning, which is a session-lifecycle change with its own copy ("This draft expired; start a new one"). It is not part of #175. File it as a follow-up and state it as a non-goal here.

### D11. Backfill: no migration. One closed question to the operator gates the proposal
- **Default:** no backfill migration. `draft` sessions need nothing, because they get snapshotted at room open. Any `active`/`wrap_up`/`complete` session cannot hold real votes, because begin-voting has always failed, so those rows are dev or test data.
- **Gate (must be answered and recorded in proposal.md, not assumed):** "Does any environment other than dev/CI hold `lobby` or `pre_session` sessions with zero `session_topics` rows that a team still needs?"
  - **If no:** the default stands. Release notes say that such sessions cannot begin voting and should be abandoned and re-created.
  - **If yes:** ship a one-off, operator-run script, not a schema migration, that snapshots those sessions from current active topics with D2's statement. Nobody has voted, and today's list is almost certainly what the facilitator meant. That is the lesser evil compared with a facilitator finding out live (Priya, O7).

### D12. Audit metadata: yes
The `session.state_changed` (draft to lobby) and `team.created_with_session` audit metadata SHALL include `topic_count` and `topic_ids` (in snapshot order). There is no schema cost, and it answers "why did this session have 9 topics?" during support.

### D13. Non-goals (stated in the proposal)
- The `/advance` and `POST /teams` response shapes are unchanged. The contract's `SESSION-001 topics[]` remains unimplemented. The only response change is `activeTopicCount` on the draft facilitator state (D3).
- Redis session state is out of scope. No Redis session code exists in `src/`. Nobody should add it "to match the mapping doc".
- Expired-draft handling (D10).
- Any in-session display of the topic list or annotation. The begin-voting and advance payloads already carry `topicAnnotation` from the snapshot (`facilitator-sessions.ts` ~L1275, ~L1937). On-screen rendering is #56/#57.

---

## 5. Risks if the design drifts

- **R1: Copying `topics.display_order` verbatim.** Prevented by D2 renumbering. Covered by the {1,3,4} and {2,3} scenarios.
- **R2: Snapshotting at start, or reading live `topics` during the session.** Prevented by D1 and D2's single live-read exception.
- **R3: Annotation snapshotted separately.** Prevented by D2's single statement.
- **R4: Archived topics included.** Prevented by the `status = 'active'` filter. FR-8.3 history scenario in Section 7.
- **R5: `current_topic_id` mismatch.** Fixed here (D8).
- **R6: Double advance producing a 500.** Fixed here (D6).
- **R7: The hint showing the draft time.** Fixed here (D9).
- **R8: Treating the snapshot as configurable.** Ruled out (D1).

---

## 6. Ritual lens (why this matters beyond the 409)

- The fixed list is the agreement the team walks into. It is what lets the trend dashboard compare session N with session N+1.
- The draft window is preparation, and preparation should stay flexible. Freezing at draft creation would punish the facilitator who does their homework.
- "Topic flexibility within guardrails": teams adapt between sessions, never during one. Room open is where that line sits. The confirm (D3) now says so in plain words, with the count.
- This is the first change that lets the full ritual run end to end. A facilitator walkthrough on dev (Priya's offer) is a verification step before archive. Draft → reorder → open the room → begin voting → wrap_up.

---

## 7. Scope for the proposal

**In scope**
1. Snapshot at room open in `/advance` and `POST /teams`: one statement, in the same transaction, under the team advisory lock (D2, D5, D7).
2. Conditional `draft → lobby` transition. A double advance is a clean `422`, and the frontend absorbs it (D6).
3. Zero-active-topic guard: `409 NO_ACTIVE_TOPICS` on `/advance`, disabled button with a link on the draft host, rollback on `POST /teams` (D4).
4. "Open the room" confirm copy with the topic count, plus `activeTopicCount` on the draft facilitator state (D3).
5. `sessions.room_opened_at` column. `openSessionCreatedAt` is redefined and the hint copy changes (D9).
6. R5 fix in `session-registration-snapshot.ts` and `redis-session-model.md` (D8).
7. Audit metadata `topic_count` and `topic_ids` (D12).
8. Document reconciliation to the term "room open" (Section 8).
9. Tests:
   - **e2e (a) existing team.** Uses a team that has completed a session, so the customization lock does not apply (G1). Draft → reorder, archive, restore, annotate → advance → start → begin-voting → advance through every topic → wrap_up. Asserts the topics run in the *new* order and the payload's `topicAnnotation` is the draft-window value (Priya S7). Includes a mid-topic reconnect with correct `has_locked_in` (D8).
   - **e2e (b) new team.** `POST /teams` → start → begin-voting → advance through all defaults in canonical order → wrap_up.
   - **Integration:**
     - gaps {1,3,4} → {1,2,3} and {2,3} → {1,2};
     - archive then restore during the draft lands the topic at its appended position (G2);
     - edits after room open (reorder, archive, add, restore, re-annotate) leave that session's rows unchanged and do reach the next session;
     - concurrent double `/advance` gives one success and one 422, with no 5xx and no duplicate rows;
     - zero-topic 409 leaves the session in `draft` with no audit row and no event;
     - `POST /teams` with an empty template rolls back;
     - FR-8.3: an archived topic's past rows still appear in history and trends and are absent from the new snapshot (G4);
     - `openSessionCreatedAt` equals `room_opened_at` for a draft-advanced session.
10. List every UC and spec checkbox this change unblocks so they can be ticked at archive (G3). From the grep, these are UC 08 L151, L292, L337, L420, L518, L526, L537, L539, and `restore-topic` spec L35-38. Several are also gated on #56/#57; tick only the parts #175 delivers.

**Deferred (filed or left to existing stubs, not in this change)**
- Expired-draft refusal or auto-abandon at `/advance`, with "This draft expired; start a new one" copy (D10). New issue.
- A "last look" list of the locked topics in the confirm, or a view of the locked list in lobby/pre_session (Priya Q3). Owned by `topic-skip-and-creation-time-confirmation`.
- "Won't apply to today's session" hints on archive/add/restore/annotate, matching the reorder hint (Priya Q4). New issue. The isolation is correct by construction and tested here. Only the messaging is missing.
- New copy for begin-voting's backstop 409 (Priya O4, "re-create the session"). After this change it can only fire for sessions created before it ships. Promising a recovery action needs a check that such an action exists from `pre_session`, which is not worth doing for a dead path.
- Rendering the annotation on screen during the session (#56/#57).
- Snapshotting `first_session_description` into a column (D2 explains why it stays live).
- Returning `topics[]` from `/advance` or `POST /teams` (D13).

---

## 8. Documents to reconcile (adopting the BA's corrected list)

| Document | Change |
|---|---|
| `openspec/specs/session-topic-lifecycle/spec.md` | "at session creation (`SESSION-001`)" becomes "at room open", with the D1 definition. Promote the annotation requirement to normative and delete its "decided by #175" sentence. Add D2, D5, the live-read exception, edit isolation, and the not-configurable sentence. |
| `openspec/specs/reorder-topics/spec.md` | **Changes.** `openSessionCreatedAt` is redefined to the room-open time. The draft exclusion stays. Hint copy changes (D9). |
| `openspec/specs/session-creation/spec.md` | `/advance`: snapshot, D4 guard, D6 conditional transition, `room_opened_at`, D12 audit. `POST /teams`: snapshot, `room_opened_at`, rollback on empty template. |
| `openspec/changes/topic-skip-and-creation-time-confirmation/README.md` | "at creation" becomes "at room open". The "last look" signal moves to the "Open the room" confirm. |
| `requirements/BRD.md` FR-2.7 | "...when a session is created" becomes "...when a session's room is opened". |
| `requirements/use cases/02 - Session Setup` | Step 9 / Addendum: the topic list is locked at room open. |
| `requirements/use cases/08 - Topic Management` | "at session creation" becomes "at room open". Update the #175 blockers per item 10. |
| `requirements/design/persistence-layer-mapping.md` "Session Created" | Add renumbered `display_order` and `topic_annotation`. Note that the draft-to-lobby transition also performs this insert. |
| `requirements/design/redis-session-model.md` | `current_topic_id` is a `topics.id` (D8). |
| Contract `SESSION-001` note | Same "room open" wording fix. |

---

## 9. Feedback disposition

| Item | Source | Disposition | Rationale |
|---|---|---|---|
| Option B | Priya O1, Marcus §0 | **Accepted** (D1) | All three of us agree. It protects the draft window and the frozen-list guardrail. |
| Name the moment "room open" | Marcus C1 | **Accepted** (D1) | One shared term keeps the next change from reopening the ambiguity. |
| UC 02 also uses "creation" for draft | Marcus §0 | **Accepted** | That is why a term is needed instead of a reworded spec. |
| Join link in draft? | Priya O2, Q1 | **Answered** | It already works in draft, so an early freeze is the facilitator's choice. D3 makes it visible. |
| Confirm copy with count | Priya O3/S1 | **Accepted** (D3) | Cheap, catches mistakes, and states the boundary. "Today's" dropped. |
| Shorter confirm sentence | Marcus C6 | **Superseded** by Priya's | The copy is the facilitator persona's call. The count adds real value. |
| Zero-topic guard before the click, with a link | Priya O4/S2 | **Accepted** (D4) | Comes for free with `activeTopicCount`. The server guard stays authoritative. |
| `NO_ACTIVE_TOPICS` 409 and copy | Marcus V5 | **Accepted** (D4) | Copy merged with Priya's "on Topic Management". |
| No minimum above 1 | Priya O4 | **Accepted** | A short session is still the ritual. |
| Begin-voting backstop copy | Priya O4 | **Deferred** | The path is dead after this change, and the recovery action is unverified. |
| `POST /teams` zero topics → rollback, 500-class | Marcus C7 | **Accepted, corrected** | Operator fault. Logged rather than audited, because the audit row rolls back with the transaction. |
| `POST /teams` locking immediately is intended | Priya O5/S6 | **Accepted** (D1) | Matches the first-session lock and teaches the standard set. |
| Fix R5 here | Priya O8/S4, Marcus C2 | **Accepted** (D8) | #175 makes it reachable. Otherwise the session still can't be run correctly. |
| R7 room-open timestamp in scope | Priya O6/S3, Marcus C4 | **Accepted** (D9) | The hint is a promise. `room_opened_at` is a small fix. Corrects my "no change to reorder-topics". |
| Expired drafts at `/advance` | Marcus C3, Priya Q2 | **Rejected for this change** (D10), filed | The expiry controls history access, not topics. Refusing would strand the facilitator. |
| Double advance: 422, no 5xx | Marcus V6 | **Accepted** (D6) | Matches existing behavior. |
| Frontend absorbs the second click | Priya O9/S5 | **Accepted** (D6) | Real facilitator behavior. Decided by refetched state, not by message matching. |
| Advisory lock (specify the behavior, leave the mechanism) | Marcus V3 | **Accepted, and mechanism decided** (D7) | Cheap insurance, matches the house pattern, and keeps the count and the rows consistent. |
| Backfill: default no, closed operator question | Marcus C5 | **Accepted** (D11) | Gate recorded in the proposal, not assumed. |
| Backfill if anything real exists | Priya O7/S8 | **Accepted, as a one-off script** (D11) | Better than a facilitator discovering it live. A script, not a migration, because it is product data. |
| Audit `topic_count` and `topic_ids` | Marcus V8 | **Accepted** (D12) | No schema cost, and useful in support. |
| Column-mapping wording (V1, V2, V4, V7, V10, V11) | Marcus | **Accepted** (D2, D5, Section 7) | Testable requirement language. |
| Response shapes unchanged | Marcus V9 | **Accepted, one exception** (D13) | `activeTopicCount` on the draft state only, for D3/D4. |
| Redis out of scope | Marcus §0 | **Accepted** (D13) | Prevents drift toward the mapping doc. |
| Two e2e flows | Marcus V12 | **Accepted** (Section 7) | `POST /teams` is the path every new team hits first. |
| Ritual acceptance e2e (new order and annotation) | Priya S7, Q5 | **Accepted, payload-level** | Asserts the payload's `topicAnnotation`. On-screen display is #56/#57. |
| G1 to G4 (locked first session, archive/restore in draft, unblocked checkboxes, FR-8.3) | Marcus §3 | **Accepted** (Section 7) | Each is a scenario a facilitator will hit, or archive bookkeeping. |
| Document list incl. `reorder-topics` delta | Marcus §4 | **Accepted** (Section 8), plus `redis-session-model.md` | Required by D8 and D9. |
| See the locked list in lobby | Priya Q3 | **Deferred** to the `topic-skip` stub | Feature creep for #175. The count covers the immediate need. |
| "Won't apply to today" hints on other topic edits | Priya Q4 | **Deferred**, new issue | Messaging only. The behavior is tested here. |
| Facilitator walkthrough on dev | Priya | **Accepted** as a pre-archive verification | First end-to-end run of the ritual. Worth a human look. |
