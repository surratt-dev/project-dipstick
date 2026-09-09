# Engineering Review — `session-lifecycle-transitions` design.md

**Reviewer:** Marcus Oyelaran (Full Stack Engineer)
**Reviewed:** design.md, proposal.md, tasks.md, specs/session-topic-lifecycle/spec.md, specs/team-content-access/spec.md
**Checked against:** `packages/backend/src/routes/{facilitator-sessions,sessions,teams}.ts`, `packages/backend/src/realtime/{ws-event-dispatcher,ws-pubsub,vote-revealed-payload}.ts`, `packages/backend/src/content/team-content-serializers.ts`, `packages/backend/src/auth/audit-logger.ts`, `packages/backend/src/db.ts`, `packages/backend/migrations/2_create_tables.sql`, `packages/shared/src/types/{session,realtime,team-content-access}.ts`

**Verdict:** Not implementable as written. One schema-modeling error runs through Decisions D1, D2, and D4 and will produce a foreign-key violation or a silent no-op the first time SESSION-005 or the reveal write actually executes. It needs to be fixed in design.md before anyone starts Group 1. Everything else — the concurrency reasoning, the transaction pattern reuse, the publish-after-commit sequencing — is sound and I verified it against the real runtime configuration, not just the prose. Details below, ordered by whether they block implementation.

---

## Blocking

### 1. `sessions.current_topic_id` cannot hold what D1/D2/D4's SQL assumes it holds

This is the finding that matters most, so I'm putting it first and I'm going to be pedantic about it because the bug is easy to miss on a read-through of the design and will not surface until someone runs `SESSION-005` against a real database.

`sessions.current_topic_id` has a foreign key to `topics(id)`:

```sql
-- migrations/2_create_tables.sql:82-84
ALTER TABLE sessions ADD CONSTRAINT sessions_current_topic_fk
    FOREIGN KEY (current_topic_id) REFERENCES topics(id);
```

`session_topics` is a *separate* row with its own primary key, plus its own FK back to `topics`:

```sql
-- migrations/2_create_tables.sql:86-101
CREATE TABLE session_topics (
    id          uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id  uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    topic_id    uuid NOT NULL REFERENCES topics(id),
    ...
```

So there are two distinct id spaces in play — `topics.id` and `session_topics.id` — and `sessions.current_topic_id` is constrained to only ever hold the former. Nothing in `packages/backend/src` reads or writes `current_topic_id` today (`grep -rn current_topic_id packages/backend/src` returns zero hits) — this change is the first code to touch it, which is exactly why there's no existing pattern to catch this against.

Now look at Decision D2's write:

```sql
UPDATE session_topics
SET status = 'revealed', revealed_at = NOW()
WHERE id = $1 AND status = 'voting'
```

`id` here is `session_topics.id` (the table's PK). If `$1` is bound to `sessions.current_topic_id` — which is the only value the reveal endpoint has, and the only thing "the current topic" can sensibly mean — `$1` is a `topics.id`, and `WHERE id = $1` will match zero rows (a `session_topics.id` and an unrelated `topics.id` coinciding is a practical-impossibility UUID collision). Every reveal call fails as `already_revealed` on its very first attempt, never having revealed anything.

Decision D4's next-topic branch has the mirror-image version of the same bug, and it's worse because it's a write, not just a failed read:

```sql
UPDATE session_topics SET status = 'voting' WHERE id = $nextTopicId;
UPDATE sessions SET current_topic_id = $nextTopicId WHERE id = $sessionId;
```

The same variable, `$nextTopicId`, is used against `session_topics.id` in the first statement and against `sessions.current_topic_id` (FK'd to `topics.id`) in the second. Whichever id space `$nextTopicId` actually comes from, one of these two statements is wrong: either the first `UPDATE` silently affects zero rows (if `$nextTopicId` is a `topics.id`), or the second `UPDATE` throws a foreign-key-violation error at COMMIT time (if `$nextTopicId` is a `session_topics.id`, which is not a valid value for `sessions_current_topic_fk`). SESSION-005's write (`sessions.current_topic_id = <first topic's id>`) and tasks.md 1.4/4.5 have the identical ambiguity — "the first topic's id" / "$nextTopicId" is never disambiguated between the two id spaces anywhere in design.md or tasks.md.

**What actually needs to happen:** every one of these transitions needs to look up (or already have, from a `session_id + topic_id` join) the `session_topics.id` for the row it's transitioning, and keep that value separate from the `topics.id` that gets written into `sessions.current_topic_id`. Concretely, for the reveal write, the transaction needs something like:

```sql
UPDATE session_topics
SET status = 'revealed', revealed_at = NOW()
WHERE session_id = $1 AND topic_id = $2 AND status = 'voting'
-- $1 = sessionId, $2 = sessions.current_topic_id, read at the top of the handler
```

or a `SELECT id FROM session_topics WHERE session_id = $1 AND topic_id = $2` first, then use that `session_topics.id` for the `UPDATE ... WHERE id = $1` form the design already specifies. Either is fine — but design.md needs to say which, explicitly, with both id spaces named, or whoever implements Group 1/3/4 is going to write exactly the bug above and it won't be caught by anything short of an integration test that runs the full lobby→active→advance sequence (which is task 8.1, at the very end).

This same disambiguation is needed for D1's "first topic" lookup (`session_topics` row with `display_order = 1` for this session — fine, that query is unambiguous — but the value written to `sessions.current_topic_id` must be that row's `topic_id`, not its `id`) and for D4's "does a next topic exist in `display_order`" query (same: the query naturally returns a `session_topics` row; the design needs to say explicitly that `topic_id` goes into `sessions.current_topic_id` and `id` goes everywhere else).

**Recommendation:** design.md needs a short, explicit note — right at the top of Decision D1, since it's the first place `current_topic_id` gets written — stating the two id spaces and which column of `session_topics` maps to which. This is a two-sentence fix to the document, but it's load-bearing for every SQL statement in D1, D2, D4, and D5's `SELECT ... FOR UPDATE`, all of which currently read as if `session_topics.id` and `topics.id` are interchangeable.

### 2. The reveal endpoint's target topic is never sourced anywhere

This compounds finding 1: even setting aside which id space is correct, neither design.md nor tasks.md states *how* the reveal handler determines which `session_topics` row to transition. The existing endpoint's precondition query doesn't fetch it:

```sql
-- facilitator-sessions.ts:498-501, current reveal handler
SELECT id, team_id, facilitator_id, status
FROM sessions
WHERE id = $1 AND team_id = $2
```

No `current_topic_id` in that `SELECT`. Task 3.1 ("refactor from its current bare-validation-only body to the `teams.ts` transaction pattern") doesn't call out adding it either. This is a one-line fix (`current_topic_id` needs to join into that initial query, or a second read inside the transaction), but it needs to be a named step in tasks.md Group 3, not left implicit — it's exactly the kind of gap that's invisible in a design review and only surfaces when someone tries to write the handler and realizes they have no topic id to put in the `WHERE` clause.

### 3. `StartSessionResponse`/`BeginVotingResponse` are cited as existing precedent but don't exist

Decision D4a justifies `TopicAdvanceResponse`'s `status`-as-discriminant shape by analogy: "exactly as `StartSessionResponse.status` and `BeginVotingResponse.status` already do for `SESSION-004`/`SESSION-005`." I grepped `packages/shared/src/types/` for both names — neither exists anywhere in the codebase:

```
$ grep -rn "StartSessionResponse\|BeginVotingResponse" packages/shared/src/types/
(no output)
```

Nothing else in the shared types (`session.ts`, `realtime.ts`, `team-content-access.ts`) defines a response shape for SESSION-004 or SESSION-005 either. Tasks.md Group 1 (1.1–1.6) never lists a task to define these two response types — it only describes their field content in prose (task 1.2: "reuse the existing query shape the REST API Contract's `SESSION-004` response documents"). Group 3's task 3.6 explicitly calls out adding the two D3 error types to shared code; there's no equivalent task for the two D1 success types.

Sequencing makes this worse, not just incomplete: Group 1 lands *before* Group 4 (tasks.md's own sequencing note). So by the time D4a's author writes "`TopicAdvanceResponse` mirrors `BeginVotingResponse.currentTopic`'s shape," that shape doesn't exist yet to mirror — it will be invented by whoever implements Group 1, and D4a is presenting an assumption about that future implementer's choice (field names, whether `status` is even the discriminant they pick) as settled precedent. If Group 1's implementer makes a different call — say, a boolean `started: true` instead of `status: 'pre_session'` — D4a's rationale evaporates and nobody notices until Group 4 tries to reuse a shape that was never built the way D4a assumed.

**Recommendation:** add explicit tasks to Group 1 defining `StartSessionResponse` and `BeginVotingResponse` in `packages/shared/src/types/session.ts` (or wherever fits the existing convention), with the exact field list, `status` as the discriminant, and `currentTopic` on `BeginVotingResponse` using the same shape D4a already fully specifies for `TopicAdvanceResponse.currentTopic`. Design D4a's shape is good — it just needs to be the thing Group 1 is instructed to build, not a retroactive assumption about it.

---

## Should-fix (not blocking, but will cause a real bug or confusing behavior if shipped as-is)

### 4. The lock-in race fix introduces a status-code inconsistency for the same failure condition

The existing lock-in handler already rejects a lock-in against a non-`voting` topic — today, that's structurally impossible to hit for the `revealed` case (nothing ever sets `revealed`), but the check exists and returns **422**:

```typescript
// sessions.ts:213-221 (existing, pre-dates this change)
if (topic_status !== "voting") {
  return reply.code(422).send({
    error: { category: "invalid_request" as const, message: "Voting is not open for this topic.", ... }
  });
}
```

Decision D5 adds a second check for the identical substantive condition — topic not `voting` — but specifies **409**: "`ROLLBACK` and return `409 Conflict` with the handler's existing `invalid_request` error category" (design.md D5; tasks.md 2.2). Once Group 3 ships, both checks are live and reachable: the early, pre-transaction `SELECT` (line 172–184) will usually catch a stale request and return 422; the new in-transaction `FOR UPDATE` check only fires in the genuine race window and returns 409. A client — or a test — cannot rely on a single status code meaning "voting is closed for this topic"; it depends on request timing, which is exactly the kind of nondeterministic-from-the-outside behavior I'd flag in review regardless of whose design it is.

**Recommendation:** either make both checks return 409 (the early check is arguably also better described as a conflict than a validation error — "voting is not open" is state, not malformed input), or explicitly note in design.md why the two codes are allowed to differ and make sure the frontend task (5.x) and the integration tests (2.3, 2.4) account for both. Right now design.md doesn't acknowledge the pre-existing check exists at all.

### 5. D4a's join-to-`topics` rationale is wrong, and the correction matters for correctness, not just cost

D4a's "Query cost" paragraph says `currentTopic`'s `topicName`/`topicPrompt`/`voteType` "require joining that lookup to `topics` (via `session_topics`)." That's incorrect — `session_topics` already carries `topic_name`, `topic_prompt`, and `vote_type` denormalized directly on the row (migrations/2_create_tables.sql:86-101), snapshotted at `SESSION-001` creation time. `vote-revealed-payload.ts`'s existing query confirms this is the established pattern — it selects `st.topic_name` straight off `session_topics` with no join to `topics` at all.

This isn't just an inflated cost estimate — joining to `topics` for these fields would be a **correctness bug**, not merely a wasted round-trip: `topics.name`/`topics.prompt` reflect the team's *current, possibly since-edited* topic configuration, while `session_topics.topic_name`/`topic_prompt` are the point-in-time snapshot the whole Topic-Skip Decision section is built around ("a topic-list edit made after a session already exists has no effect on that session"). If an implementer reads D4a's "join to `topics`" language and does exactly that, `SESSION-012`'s response would leak a topic edit made mid-session into a running session's UI, which is precisely the behavior the rest of this document goes out of its way to rule out. This needs a one-line correction: no join, select the columns already on the `session_topics` row already being fetched for the `nextTopicId` lookup.

---

## Confirmed sound (verified against real configuration, not just the prose)

- **D2's race-safety claim, checked against actual isolation level:** `db.ts` constructs a plain `new Pool({ connectionString })` with no isolation-level or lock/statement-timeout override anywhere in `packages/backend/src` (grepped for `statement_timeout`, `lock_timeout`, `SET TRANSACTION`, `idle_in_transaction` — no hits). That means every transaction in this codebase runs at Postgres's default READ COMMITTED. Under READ COMMITTED, a second concurrent `UPDATE ... WHERE status = 'voting'` targeting the same row blocks on the first transaction's row lock, then re-evaluates its own `WHERE` clause against the now-committed row once unblocked (Postgres's EvalPlanQual mechanism) — so it correctly affects zero rows once the first reveal has committed. D2's claim holds against the actual runtime, not just in the abstract.
- **D5's deadlock analysis:** confirmed no deadlock risk. Both the reveal's conditional `UPDATE` and the lock-in's `SELECT ... FOR UPDATE` only ever contend for a lock on the single `session_topics` row for that topic; neither transaction subsequently touches a second *pre-existing* row the other transaction might also be waiting on in the opposite order (`votes` and `audit_log` inserts are new rows, not lock contention). A single shared lock, contended by two transactions, produces waiting, not deadlock. D5's reasoning is correct.
- **`TopicHistoryUpdatePayload.updateType` already including `"topic_advanced"`:** confirmed in `packages/shared/src/types/realtime.ts:94` — this part of D4's "reuse, don't invent a new event type" rationale is accurate.
- **The team-scoped vs. session-scoped delivery gap named in D4:** confirmed against `ws-event-dispatcher.ts` — `dispatchTopicHistoryUpdate` calls `registry.candidates("team", envelope.teamId)` (line 239), while the three session-scoped events use `registry.candidates("session", ...)`. D4's named integration gap is real and accurately described; it is a frontend subscription concern, not a backend fix, as stated.
- **D1's "verbatim" reuse of the `teams.ts` transaction pattern:** structurally accurate for the `BEGIN`/queries/`COMMIT`-or-`ROLLBACK`/`client.release()` shape, and correctly distinguished from the TEAM-005 role-change pattern's `SELECT ... FOR UPDATE` (which locks a *set* of rows for an aggregate count — not applicable here). The existing `draft→lobby` and `wrap_up→complete` handlers in `facilitator-sessions.ts` are a faithful precedent for SESSION-004/005's shape, modulo finding 1/2 above for SESSION-005's dual-table write specifically.
- **Publish-after-commit ordering:** every existing call site (`facilitator-sessions.ts`, `sessions.ts`) already places `publish*` calls after `client.release()`, outside the try/catch — the pattern this design extends is itself correct today, and D1/D2/D4's task breakdown (1.3/1.5, 3.5, 4.8/4.9) places the new publish calls in the same position.

---

## Summary for tasks.md

Before Group 1 starts:
1. Add an explicit note disambiguating `topics.id` vs. `session_topics.id` for every write to `sessions.current_topic_id` (Finding 1) — this affects tasks 1.4, 3.2, 4.2, 4.5.
2. Add a task to Group 1 defining `StartSessionResponse`/`BeginVotingResponse` in shared types (Finding 3), ahead of D4a's reuse of their shape in Group 4.
3. Add a task to Group 3 sourcing the reveal's target `session_topics.id` (Finding 2), likely as part of task 3.1's refactor.
4. Resolve the 409-vs-422 status code split for "voting is closed" (Finding 4) before task 2.2/2.3 are implemented, so the integration test asserts the intended behavior rather than whatever falls out of not deciding.
5. Correct D4a's join rationale (Finding 5) so the currentTopic fields are pulled from the already-fetched `session_topics` row, not joined to `topics`.

None of this is a rethink of the approach — D2's conditional-`UPDATE` pattern, D5's row-lock fix, and D4's single-endpoint branching are all the right calls, and the concurrency reasoning holds up against how this codebase's Postgres pool is actually configured. The id-space issue in Finding 1 is the one thing that will not compile-and-pass on the first honest attempt; everything else is missing detail that a careful implementer might paper over correctly by accident, but shouldn't have to.
