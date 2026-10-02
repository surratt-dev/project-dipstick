# Implementation review (Solution Architect): session-topics-snapshot-at-creation (#175)

Reviewer: Ingrid Sollenberger, Principal Solution Architect
Scope: the uncommitted working tree on `agent-team/175-session-topics-snapshot-at-creation`, checked against `design.md`, `tasks.md`, `release-notes.md`, and the spec deltas.

## Overall

The core of the change matches the design well. The boundaries hold:

- **One write path.** `INSERT INTO session_topics` appears once outside tests, in `packages/backend/src/sessions/session-topic-snapshot.ts:44-53`. It takes a session id only, and the team comes from the session row inside the statement (Decision 2). The doc comment states the contract (lock held from an earlier statement, the single statement is load-bearing, other errors propagate).
- **One lock key.** `lockTeamTopics` and `TEAM_TOPICS_LOCK_KEY_SQL` are defined once (`session-topic-snapshot.ts:23-34`). All four `topics.ts` sites and both room-open paths call them, and the test gate `withTeamLockGate` reuses the production key (`routes/__tests__/helpers/real-db.ts:290`). `/advance` keys the lock on `sessionRow.team_id`, not the URL (`facilitator-sessions.ts:885`).
- **`/advance` ordering.** The checks run 404, 403 team, 403 creator, 403 live role, then 422. The lock is taken only after that, followed by the conditional `UPDATE` with an explicit `rowCount !== 1` check, the snapshot, the audit row, `COMMIT`, then emit and publish. This matches Decision 3 step for step.
- **Placement.** The domain helpers (`src/sessions/`) and the shared envelope (`src/routes/error-envelope.ts`) sit where the tasks put them. `DEFAULT_TOPICS_TEAM_ID` is now a single constant used by `POST /teams` and `content.ts`.
- **Audit and log content.** Room-open audit rows carry only `topic_count` and `topic_ids`, and the log events carry only `topicCount` (Decision 3b). The contracts are documented in `audit-logger.ts`.
- **R5 fix.** It is the single-reader change the design chose (`session-registration-snapshot.ts`). The join is now session-scoped, and a real-DB test covers it.
- **Migration 20.** Additive, nullable, with the correct markers and a down migration that is the exact inverse.
- **Real-DB lane.** The `REQUIRE_DB` guard is centralised in `helpers/real-db.ts` and used by every new real-DB file.

One new authorization regression needs fixing before merge (M1). The rest is spec and design text that needs to catch up with what was built, plus cleanup.

---

## Must-fix

### M1. A teamId spelled another way gets past the "facilitator is a team member" denial (deviation 2)

`packages/backend/src/auth/standing-facilitator-access-helper.ts:3,49`

`evaluateStandingFacilitatorAccess` now binds `teamId` as `NULL` unless it matches the strict hyphenated regex. A NULL makes `isMember` false. Postgres, however, accepts other spellings of a UUID as valid `uuid` input. Verified on the project's Postgres 16 container:

- `a0eebc999c0b4ef8bb6d6bb9bd380a11` (no hyphens)
- `{a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11}` (braces)

Both resolve to the same team. This coercion is safe on the topic routes, because `checkTeamExists` (`topics.ts:146-148`) applies the same regex and answers 404. Two other callers do **not** re-check the id. They pass the raw string to Postgres, which resolves it to the real team:

1. **`POST /api/v1/teams/:teamId/sessions/draft`** (`facilitator-sessions.ts` ~L289-361). With a hyphenless id, the helper reports `isMember = false`. The existence check at ~L313-316 then finds the team, the `is_member` 403 at ~L333 is skipped, and a draft is inserted for a team the facilitator belongs to. That bypasses the D1 membership-conflict control and its `session.draft_denied_membership_conflict` audit row. With this change, the same facilitator can then open the room and run the session.
2. **`GET /api/v1/teams/:teamId/topics/all`** (`content.ts:560-581`, via `checkStandingFacilitatorOrAdminAuthorization`). A member facilitator can read their own team's Topic Management list, which `FACILITATOR_IS_TEAM_MEMBER` is meant to deny.

Before this change, those spellings were cast correctly and the membership denial applied. A garbage id raised 22P02 and returned a 500, which leaked detail but failed closed. The new behavior fails open on a *deny* predicate.

The root architectural issue is that an authorization helper now silently rewrites its input. Its correctness depends on every caller re-validating the id with an identical predicate, and nothing states or enforces that.

**Fix (pick one, prefer the first):**

- Revert the coercion in the helper. Validate `teamId` at the route boundary instead: a Fastify params schema with `format: "uuid"`, or one exported `isCanonicalUuid` check that answers 404 before any query. Apply it on the topic routes, `POST /draft`, and `/topics/all`, so the id that is authorized is the same string that is used.
- Or canonicalise rather than reject: `$2::uuid` in the helper's join, with all callers validating the id first. The membership check then sees the same team Postgres resolves.

Add a regression test for each affected route: a member facilitator calling with the hyphenless spelling of their own team's id is denied with 403 or 404, and no row is written.

Also replace the duplicated `UUID_PATTERN` constants (`standing-facilitator-access-helper.ts:3`, `topics.ts:57`; a third string form at `routes/auth.ts:72`) with one exported definition. Two copies of a security predicate that must agree will eventually drift.

---

## Should-fix

### S1. Deviation 1, the local fixed 500 for snapshot errors: accept as an interim, but bring the spec and design in line, and bound it

`facilitator-sessions.ts:60-66, 664, 707-715, 933-941`

**Assessment: the right call on the facts.** The implementer's premise checks out. No `setErrorHandler` is registered anywhere in `src/`, and Fastify 5's default handler puts `err.message` into 5xx bodies. If the design had been followed literally ("rethrow to the global error handler's generic 500"), `pg` error text would reach the client. That would break the normative "SHALL NOT echo a database error message" in the spec. A local fixed body with a logged `correlationId` honours the intent.

What still needs doing:

1. **Spec text.** `specs/session-creation/spec.md:114` still says "SHALL produce the generic `500` of the global error handler". Reword it to describe what ships: a `500` with `internal_error`, a fixed message, and a `correlationId`, with the error logged and never returned. Also amend design.md Decision 2 ("propagates unchanged … to the global error handler"), Decision 4, and the Security notes table, so the record shows the decision. The REST contract already describes the new behavior (L~1123), so it is now ahead of the spec.
2. **Partial coverage, stated plainly.** Only snapshot failures are masked. A failure in `lockTeamTopics`, the conditional `UPDATE`, the audit `INSERT`, or `COMMIT` on `/advance` still goes through the outer `ROLLBACK; throw` (~L966-968) to Fastify's default and echoes the `pg` message. The same holds for the rest of `POST /teams` and every other handler in the file. So the threat-model line "Configuration and SQL disclosure … other errors rethrown to the generic handler" is not true of the system. Update the checklist item in `release-notes.md` to say the protection is snapshot-only.
3. **Make follow-up 6 a release gate, or land it.** The global handler (follow-up 6, `security`) is the structural fix. It would also make `SnapshotFailedSignal` and the wrapper `try/catch` at L661-665 removable. Give it an owner and target date in 10.6b. My preference is a minimal app-wide `setErrorHandler` that, for status ≥ 500, logs `err` with a `correlationId` and returns `internal_error` with a fixed message. It is about 15 lines, and the snapshot special case could then go. If that is judged out of scope for #175, record that explicitly.

### S2. Deviation 4, the three new UI and API strings: route them through Priya before the walkthrough

`DraftSessionHost.tsx:177, 422`; `facilitator-sessions.ts:66`

**Assessment: acceptable and necessary.** The spec defines a "pending" state and a "failed refetch" state but gives them no copy, and the S1 500 needs a body. The strings are calm and consistent with the house voice, and they are already listed in release-notes 10.4.

What still needs doing:

- Add them to the spec deltas, or say there that their wording is not normative. Otherwise the 10.5 copy-change loop has nothing to update.
- "Something went wrong while locking in this session's topics. Try again." is also returned by `POST /teams` (`facilitator-sessions.ts:709`), where the facilitator is creating a team, not "locking in" topics. Use path-appropriate copy, or a neutral line such as "Something went wrong opening the room. Try again.". Let Priya decide.

### S3. A 409 whose refetch fails leaves the button permanently disabled

`DraftSessionHost.tsx:229` together with the `disabled` expression (~L414-419)

After a `409 NO_ACTIVE_TOPICS` whose refetch fails, `retryable: false` disables "Open the room" until the page is reloaded. That follows the spec's "no retry action". But if the facilitator then fixes the topics in another tab, nothing on this page recovers. Either keep the button enabled with no retry affordance (the next click re-runs the confirm refetch, which is the authoritative check anyway), or add a line telling the facilitator to reload. This is a minor operability gap. Confirm the intended behavior with the BA.

---

## Nit

### N1. Deviation 3, keeping the retry in the annotation integration test: accept

`routes/__tests__/topic-annotation-integration.test.ts:774-781`

Under READ COMMITTED, the subquery can pick a row that a concurrent atomic swap deletes before the `UPDATE` reaches it, leaving zero rows updated. The atomic swap from 1.6 removes the "empty template" window, not that race. The updated comment explains this correctly. The underlying smell is that parallel test files mutate the shared template team. A per-file template, or serialising the files that touch the sentinel, would remove the need for the retry. That belongs in a test-infrastructure ticket, not here.

### N2. A second copy of the template team id in the test harness

`routes/__tests__/helpers/real-db.ts:37`

`SENTINEL_TEAM_ID` repeats `DEFAULT_TOPICS_TEAM_ID`. Import the production constant from `src/sessions/default-topics.ts`, so the harness cannot drift from the template the code reads.

### N3. The new 0-row 422 body is built by hand

`facilitator-sessions.ts` ~L905-912

The pre-transaction 422 builds its envelope inline, and the new 0-row 422 copies that pattern. This keeps both bodies byte-identical, which the spec requires. Now that `buildErrorEnvelope` is shared, both could call `buildErrorEnvelope("invalid_request", …)` to keep one envelope builder per file.

### N4. Extra `Number()` coercion on the count

`facilitator-sessions.ts:2383`

`count(*)::int` already makes node-postgres return a number. The extra `Number()` and `?? 0` are harmless, but the `?? 0` would hide a missing row as 0, which could trigger the disabled state. `count(*)` always returns a row, so this cannot happen today. Optionally drop the fallback so a drift fails loudly.

---

## The four reported deviations

| # | Deviation | Verdict |
|---|---|---|
| 1 | Local fixed `internal_error` 500 on snapshot errors | **Accept as interim.** Premise verified. Spec and design text must be updated, and the global handler tracked (S1). |
| 2 | Non-UUID `teamId` coerced to NULL in `evaluateStandingFacilitatorAccess` / `checkTeamExists` | **Reject in current form.** Safe in `checkTeamExists`, but the helper change fails open for `POST /draft` and `/topics/all` (M1). Validate at the boundary instead. |
| 3 | Kept the retry in `topic-annotation-integration.test.ts` | **Accept.** The reasoning is correct (N1). |
| 4 | Three new UI strings | **Accept.** Add them to the spec or mark them non-normative. Revisit the reused 500 copy on `POST /teams` (S2). |
