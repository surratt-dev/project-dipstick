# Tasks Review: session-topics-snapshot-at-creation (#175)

**Reviewer:** Marcus Delgado (Business Analyst)
**Date:** 2026-10-01
**Reviewed:** `tasks.md` against `proposal.md` and the six delta specs (`session-topic-lifecycle`, `session-creation`, `reorder-topics`, `topic-management-screen`, `vote-compose-recovery`, `restore-topic`), with `design.md` Migration Plan step 3 consulted for one discrepancy.
**Focus:** Do the tasks, taken together, cover every capability and scenario? Is anything lost in translation?

**Verdict: Approve with changes.** Coverage is strong. Every proposal bullet maps to a task. Every one of my earlier must-fixes (M1 to M4) and should-fixes (S1 to S6) made it into tasks. The frontend outcome matrix in 7.1, 7.3 and 7.5 matches the spec almost line for line. There is one real translation error (the backfill import boundary is backwards) and a handful of spec scenarios with no task that verifies them. All of the fixes are small and can be folded into tasks that already exist.

---

## Must-fix

### M1. Task 10.1 reverses the backfill import boundary, and as written it would break the spec

Task 10.1 says the backfill script has "no import from the rest of `src/`". The design (Migration Plan step 3, item 6, and the disposition note at L324) says the opposite. The boundary is one-way: the script imports the snapshot helper, and nothing in `src/` outside `src/scripts/` may import the script. The `session-topic-lifecycle` spec says the backfill uses "the same snapshot statement as room open" and that "no application module SHALL import it".

If someone builds 10.1 literally, they have to copy the `INSERT ... SELECT` into the script. That breaks the "same statement" requirement and brings back the drift risk the design was written to avoid. The spec's actual constraint, that no app module imports the script, would also go unenforced.

**Fix:** Reword 10.1 to say: "imports `snapshotSessionTopics` and `lockTeamTopics` from `src/sessions/session-topic-snapshot.ts`; nothing under `src/` outside `src/scripts/` may import the script, enforced by the lint rule or CI grep described in design.md". Add that check as an explicit deliverable of 10.1.

### M2. The backfill's two normative scenarios have no test task

`session-topic-lifecycle` has two scenarios for the backfill: "A backfill re-run skips sessions that already have rows" and "A backfill dry run writes nothing". Task 10.1 lists the controls but never says to test them. The script only gets written on a "Yes" answer, but if it is written it will run against a real environment's data. That is exactly where an untested dry-run default does harm.

**Fix:** In 10.1's "Yes" branch, add: "Tests: the dry run lists ids and writes no `session_topics` or `audit_log` rows; a write-mode re-run on a session that already has rows skips and reports it, with no uniqueness violation; a session that has left `lobby`/`pre_session` by the time the lock is taken is skipped; each written session gets one `session.topics_backfilled` audit row with `topic_count`/`topic_ids` and no topic text."

---

## Should-fix (spec scenarios with no verifying task)

Each of these is cheap and fits into a test task that already exists. I list them because a scenario with no test is a requirement we are trusting to inspection, and two of these are invariants we will want to point to later.

| # | Spec / scenario | Gap | Suggested home |
|---|---|---|---|
| S1 | `session-creation` "The room-open audit row records the snapshot": *Audit metadata lists the snapshotted topics* (`topic_ids: [A, B, C]` in order) and *Audit content never carries topic text* (both routes, row **and** emitted event, event carries `topicCount` equal to `topic_count`) | 3.3, 4.3 and 4.6 implement this. 3.4 only asserts "one audit row", and 3.6 says "audit sinks" without saying what to check. Nothing checks order, the content boundary, or that `topicCount` matches `topic_count`. This is a security-facing boundary. | Add to 3.4 (integration: order of `topic_ids`, and no name/prompt/annotation strings in the metadata) and to 3.6/4.4 (mock: event payload has `topicCount` only). |
| S2 | `session-creation` "Sessions record when their room opened": *Opening the room sets the room-open time once* (unchanged through start, complete) and *A draft has no room-open time* | No task asserts that `room_opened_at` never changes, or that it is NULL on a newly created draft. 5.3 covers only how the hint reads it. | 8.1: assert `room_opened_at` is unchanged at `wrap_up`. 3.4: assert NULL before advance. |
| S3 | `session-topic-lifecycle` "Room open is the single moment...": *A draft has no session topics* and *Later phases do not rewrite the snapshot* (ids, `topic_id`, `display_order`, name, prompt, vote type, annotation identical after `SESSION-004`/`SESSION-005`) | 8.1 implies this but does not assert it. This is the core "no other time" invariant. | 8.1: capture the rows after advance and compare the listed columns after start and after begin-voting. 3.4: zero rows before advance. |
| S4 | `session-topic-lifecycle` *Every session whose room opens through either route has a snapshot*, "with `display_order = 1` present" | 4.4 says "at least one row" but leaves out the `display_order = 1` clause, and that clause is the condition begin-voting's guard actually checks. | 4.4: add "and a row at `display_order = 1`". |
| S5 | `session-topic-lifecycle` "`first_session_description` is the only topic field read live": *Name and prompt come from the snapshot* | No task. Team topics have no name/prompt edit endpoint today, so the change has to be seeded with SQL. That makes the test cheap, and it guards the "no live reads in-session" constraint the proposal lists as must-preserve. | 8.3: after room open, `UPDATE topics SET name/prompt` via SQL, then assert that `SESSION-005`/`SESSION-012` return the snapshot values. |
| S6 | `session-topic-lifecycle` *An edit made after room open does not reach the session*: "...and the session still presents it" | 8.3 asserts the rows are unchanged but not what gets presented. An archived topic that is still in the snapshot must still come back from begin-voting/advance. | 8.3: run the lobby session through begin-voting and assert that the archived topic is presented at its position. |
| S7 | `session-creation` draft landing: "while the refetch is in flight, 'Open the room' SHALL show a pending state and SHALL NOT fire a second refetch" | 7.1 builds the pending state. 7.5's "double-click absorption" covers the `/advance` 422, not a double click during the count refetch. | 7.5: add "a second click during the `checking` phase fires no second refetch". |
| S8 | `session-topic-lifecycle` "Begin-voting's empty-snapshot guard remains as a backstop" | No task. Existing tests probably cover the 409, but the restructured code paths make it worth confirming the test still exists and still passes. | 10.4, or a note in 8.x: confirm that the existing begin-voting zero-rows test is retained. |

---

## Minor

- **N1.** For `vote-compose-recovery`, the reconnect scenario also requires `currentTopic.status` to be `voting`. Neither 6.2 nor 6.3 asserts the status. Add it to 6.3.
- **N2.** 3.7 does not name the `403` category. The spec requires `error.category: "forbidden"`. 1.3 says "no new categories", which is fine if `forbidden` already exists, but 3.7's tests should assert it.
- **N3.** 3.2 and 4.2 say "rethrow" for non-guard snapshot errors. The spec requires that a database error message is never echoed. One mock test per route (the snapshot throws a `pg` error, and the body has none of its text) would turn "never" into something we can check.
- **N4.** The non-configurable rule ("no setting, flag, or per-team option") has nothing to build, which is correct. 9.8 carries it into the Purpose text. No action needed. I mention it only so its lack of a task is not read as an omission.
- **N5.** Main-spec wording at `openspec/specs/topic-management-screen/spec.md` L200 and `reorder-topics` requirement titles keeps "created". The deltas deliberately keep the titles for continuity, and the bodies are corrected. That is acceptable, and 9.x does not need to touch it.
- **N6.** The section 9 preamble says code ships when "sections 1 to 8 and 10.1" are done. 10.3 (the Priya walkthrough) is a release gate according to the proposal. Name it in that sentence so nobody reads 10.3 as optional for release.

---

## Traceability check (proposal to tasks)

| Proposal item | Tasks |
|---|---|
| Room open defined; rows written only then (D1) | 2.1, 3.1, 4.1; verification gaps S3 |
| Snapshot statement, dense order, annotation, session-id-only (D2, D5, D7) | 2.1, 2.2 |
| Conditional transition, double-click (D6) | 3.1, 3.4, 7.3, 7.5 |
| `NO_ACTIVE_TOPICS` guard, 422-before-409, 403-before-409 (D4) | 3.2, 3.4, 3.6, 7.2, 7.3 |
| Empty template `500` / `internal_error` / `correlationId` | 1.3, 1.5, 4.2, 4.4, 4.5 |
| Confirm copy with fresh N, four refetch outcomes (D3) | 1.2, 5.1, 7.1, 7.5 |
| `room_opened_at`, `openSessionCreatedAt` redefinition, hint copy (D9) | 1.1, 5.2, 5.3, 7.4; gap S2 |
| R5 id-space fix (D8) | 6.1 to 6.3, 9.5 |
| Audit metadata (D12) | 3.3, 4.3, 4.6; gap S1 |
| Live facilitator role on `/advance` (S1 security) | 3.7 |
| Concurrency verified with two real transactions | 1.4, 3.4, 3.5 |
| Standing full-ritual CI gate | 1.4, 8.1, 8.2 |
| History preserved (FR-8.3), edit isolation | 8.3, 8.4; gaps S5, S6 |
| Restore during draft lands appended | 8.5 |
| Document reconciliation (does not gate release) | 9.1 to 9.8 |
| Backfill yes/no gate (D11) | 10.1; M1, M2 |
| Follow-ups, walkthrough, validation | 10.2, 10.3, 10.4 |

Nothing in the proposal lacks a task. The gaps listed above are in verification, not in scope.
