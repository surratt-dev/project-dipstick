# Architect Implementation Review — session-lifecycle-transitions

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Scope:** `agent-team/session-lifecycle-transitions` working-tree changes vs. `main` (b09881f), reviewed against `design.md`'s Decisions D1–D6.
**Verdict: Approved.** The implementation matches the design faithfully. I found no boundary violations, no id-space defects, and no publish-before-commit ordering bugs. One residual gap is worth naming (below), but it is inherited from this codebase's existing test architecture, not introduced by this change, and does not block sign-off.

---

## What I checked, and how

This is a narrower review than my usual architecture checkpoint — there's no new external dependency, no new persistent/ephemeral boundary, no new authentication surface. The architectural risk here is entirely internal: two UUID spaces that look interchangeable but aren't, a concurrency mechanism that has to be right, and an authorization-ordering rule that's easy to invert by accident under refactoring pressure. I verified all three directly against the committed code, not against design.md's prose.

### 1. The topicId / sessionTopicId id-space rule

I grepped every read and write of `current_topic_id`, and every `WHERE id = ...` against `session_topics`, across `facilitator-sessions.ts` and `sessions.ts`:

- Every write to `sessions.current_topic_id` uses a `topics.id`-space variable (`firstTopicId` in SESSION-005, `nextTopicId` in SESSION-012's next-topic branch, or `NULL`). None ever receives a `session_topics.id`.
- Every `session_topics ... WHERE id = ...` uses a `session_topics.id`-space variable (`firstSessionTopicId`, `nextSessionTopicId`). None ever receives a `topics.id`.
- Every `session_topics ... WHERE session_id = $1 AND topic_id = $2` (the reveal and advance preconditions) correctly binds `$2` to the `topics.id`-space `topicId` read off `sessions.current_topic_id`.
- The one sanctioned join to `topics` (`BeginVotingResponse.currentTopic.firstSessionDescription`, `facilitator-sessions.ts:626`) is the *only* `JOIN topics` in either file — confirmed by grep. Decision D4a's "no join to `topics`" rule for the denormalized `topic_name`/`topic_prompt`/`vote_type` fields is respected everywhere else; the SESSION-012 next-topic lookup reads those columns straight off `session_topics`, exactly as specified. This is the correctness property the two prior design reviews were most worried about (post-snapshot topic edits leaking into a running session), and it holds.

This is the cleanest execution of a two-id-space rule I've reviewed — the variable naming discipline (`firstTopicId` vs. `firstSessionTopicId`, `nextTopicId` vs. `nextSessionTopicId`) is carried through consistently, including in the inline comments at each write site.

### 2. Publish-after-commit ordering

Six new/re-wired `publish*` call sites: `SESSION-004`, `SESSION-005`, reveal (success path), and `SESSION-012`'s two branches (topic-to-topic publishes one event; wrap-up-entry publishes two). In every case, the call sits after the `try { ... BEGIN ... COMMIT ... } catch { ROLLBACK } finally { client.release() }` block closes — never inside the `try`, never before `client.connect()`. The failure paths (409s) all `return` from inside the `try` before reaching the publish statements, so no event is ever published on a rolled-back transaction. I traced all six by line number against the transaction boundaries; none violates the ordering.

### 3. Vote lock-in / reveal race (Decision D5) — no deadlock

The lock-in transaction takes `SELECT status FROM session_topics WHERE id = $1 FOR UPDATE` (`sessions.ts`); the reveal transaction takes its lock implicitly via the conditional `UPDATE ... WHERE session_id = $1 AND topic_id = $2 AND status = 'voting'` (`facilitator-sessions.ts`). Both predicates resolve to the same single physical row for a given topic. Neither transaction acquires a second lock on any other row shared with the other transaction (the `votes` INSERT and the `audit_log` INSERT don't contend with each other's rows). Since each transaction takes at most one lock on the contested resource, there's no lock-ordering inversion possible — no deadlock. This matches D5's rationale exactly, and I don't have a different read on it.

### 4. The four documented deviations

- **`StartSessionResponse` missing fields** (`updatedAt`, `hasOpenItems`) — present in both the shared type and the handler's response construction.
- **`BeginVotingResponse`'s `topics` join** — present, scoped to exactly the one field design.md sanctions, and doesn't leak into any other query (see §1).
- **SESSION-012's extended `RETURNING` clauses** — `RETURNING id, topic_name, completed_at` on the precondition write, `RETURNING wrap_up_started_at` on the wrap-up branch — both present, both used only to avoid a second round-trip, no behavioral change to the `WHERE` clause or locking.
- **`TopicAdvanceBlockedResponse`'s follow-up `SELECT`** — present (`facilitator-sessions.ts:1241`), correctly scoped to `db.query` (not the rolled-back `client`), matching the `already_revealed` follow-up read's pattern.

None of these reintroduce a `topics` join for content that should stay denormalized on `session_topics`.

### 5. Authorization-before-precondition ordering (Decision D3/D4's ordering requirement)

Reveal: facilitator check at line 773, precondition `rowCount` check at line 1057 — auth strictly first. SESSION-012: team-id check, then facilitator check, both before the precondition check at line 1232 — same ordering. Tests 3.13 and 4.12 exercise this behaviorally (non-facilitator against an already-revealed/not-yet-revealed topic still gets the generic 403), and I confirmed the tests actually assert this rather than just existing.

### 6. tasks.md — done vs. unchecked

All tasks in Groups 1–4 and 6–8 are checked, and I spot-checked a sample (1.6, 3.3–3.6, 4.1–4.4, 4.7–4.8, 6.2, 7.1–7.3) directly against the code and diffs — all genuinely done, not just marked done. Four items are correctly left unchecked:
- **3.12 / 4.15** — running the *other* change's (`websocket-delivery-time-authorization`) previously-blocked end-to-end tasks against this implementation. These are legitimate follow-up verification steps that belong to that change's task list, not fabricated gaps in this one — but they're still open, and someone should close them out before calling issue #26 fully resolved end-to-end.
- **5.1 / 5.2** — frontend-scoped, correctly deferred, not this change's responsibility.

### 7. Test suite — independently run

I ran `npm test` in `packages/backend` myself (not from the report): **31 files, 418 passed, 1 skipped, 0 failed** — the skip is `ws-pubsub-integration.test.ts`, gated on a reachable Redis/Postgres via `docker compose up`, which wasn't available in my review environment either. This matches the implementer's reported numbers exactly.

I also ran `tsc --noEmit` before and after this branch's changes and diffed the output: 103 pre-existing errors on `main`, 104 on this branch. Diffing the two error lists line-by-line shows the delta is the *same* pre-existing test-file strict-mode errors (the `Pick<PoolClient, "query">` mock-shape mismatch, the `session` decorator `null` mismatch) shifted to new line numbers because code was inserted above them — no new error category was introduced. Not a regression; not something I'm asking this implementer to fix, since it's ambient noise across files this change doesn't touch (`teams.test.ts`, `em-views.test.ts`, etc.) and doesn't affect `npm run build` (which uses `tsconfig.build.json`, not this stricter config).

---

## One thing worth naming, not blocking

Decision D5's rationale, and tasks.md's task 3.10, describe the concurrent-reveal and lock-in/reveal race tests as verifying the row lock "against the real row lock — not asserted from code inspection alone." Tests 3.10 and 3.11 as written are **mocked-pg-client unit tests** (`makeMockClient`, sequenced canned responses) — they assert that the code *calls* the right SQL in the right order and handles both branches of a `rowCount` check correctly, but they don't exercise Postgres's actual row-locking behavior, because there's no live Postgres in the test run.

I want to be precise about whose gap this is: it isn't one this implementer introduced. I checked — there is no real-database integration test infrastructure anywhere in this repository (no testcontainers, no pg-mem, nothing beyond the one pre-existing `ws-pubsub-integration.test.ts`, which itself skips without a live Redis/Postgres). Every existing test file in `packages/backend` — `teams.test.ts`, `sessions.test.ts`, the WebSocket change's own tests — uses this same mocked-client convention. The new `session-lifecycle-e2e.test.ts` says so explicitly in its own header comment. This implementer built to the codebase's established pattern correctly and consistently; they didn't invent a weaker verification method for this change specifically.

What I'd flag is the gap between what design.md/tasks.md *claim* was verified ("against the real row lock") and what the test suite as it exists *can* verify (that the code issues the right conditional `UPDATE`/`FOR UPDATE` and branches correctly on the result). The row-locking argument itself is sound by inspection — I re-derived it independently in §3 above and agree with it — but "verified by a passing test" and "verified by inspection, with a test that would pass either way the lock behaved" are different confidence levels, and the task list's language overstates which one this is. This is a pre-existing gap in this codebase's test architecture, not a defect in this change, and I'm not blocking on it — but it belongs on the list the team keeps for "things to fix before this matters," alongside GitHub issue #27, which design.md's own Risks section already flags for the same reason (real content now flows through a previously-inert path). If a live-DB integration test lane is ever built for this repo, the reveal/lock-in race is exactly the kind of test that most needs one.

---

## Summary

Boundaries respected, patterns consistent with `teams.ts`'s established transaction shape, no id-space defects, no publish-ordering defects, no deadlock risk in the new locking, and the two prior design reviews' concerns (denormalized-topic leakage, transcription gaps) stayed fixed through implementation. Test suite independently confirmed at 418/1/0. Approved.
