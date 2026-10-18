# Implementation review: Solution Architect (Ingrid Sollenberger)

Change: bulk-restore-default-topics (#218), uncommitted working tree on agent-team/218-bulk-restore-default-topics.
Scope reviewed: design.md conformance, boundaries and patterns, tasks.md claims versus reality, the unrun real-DB tests (4.8/4.9), and the 7.1 `addCustomTopic.ts` deviation. No source files were modified.

## Verdict

Approve with conditions. The architecture matches the design closely and the boundaries are respected. Two things stop me calling it clean: several tasks are ticked `[x]` on the strength of tests that do not exist, and 4.8/4.9 are only partly written. The latter is less alarming than the task notes suggest, because the real-DB tests do run in a Postgres-equipped environment (see below).

## 1. Design conformance

Verified against the diff in `packages/backend/src/routes/topics.ts`, `packages/shared/src/types/topic.ts`, `content.ts` and `audit-logger.ts`.

Matches design:
- Cascade order (D16, V6): `Cache-Control: no-store` set first, then `rejectNonCanonicalTeamId`, role check, `enforceTopicWriteRateLimit`, `checkWritableTeam`, `checkCustomizationLockGate`. The limiter is called through the existing helper with its own `TopicWriteDenialContext`; `TOPIC_WRITE_LIMITS` is untouched.
- Lock-before-read: `lockTeamTopics` is the first statement after `BEGIN`. The two reads are separate statements, and the base position is computed in JS from the same rows the planner sees.
- One `UPDATE ... FROM unnest(...)` with a row-count guard, one audit insert in the same transaction, `COMMIT`, then `emitAuditEvent` in its own narrow `try/catch`. The empty plan rolls back with no audit row.
- D22 thrown-path floor: the catch does `ROLLBACK` (guarded), `applyTimingFloor`, rethrow, and `client.release()` stays in `finally`. This diverges deliberately from single restore, which is the stated intent.
- Audit metadata is ids and positions only; `skipped` is capped at 100 with `skipped_count` carrying the true total. `AuditEventName` and its doc comment are updated, including the union-with-`topic.restored` provenance note.
- Shared planner (D15): `normalizeTopicNameForMatch`, `planDefaultRestore` and the response types live in `@dipstick/shared`. The server and the dialog preview both call the planner, so there is one implementation of the rule. `reason` is an open type. The module comment forbids reuse of `defaultTopicsNotActive` and `findDuplicate`.
- D19: `displayOrder` is added additively to archived items in `GET /topics/all`, with the type in shared.
- 2.1: the root `test` script now builds shared first. `ci.yml` and `integration.yml` already did. The dist-consumption fragility is closed.

Observations (none blocking):
- The handler is about 190 lines of copied cascade. The design accepts this and defers a shared cascade helper. I agree, but a fifth hand-copied cascade is now technical debt worth a follow-up line in section 9.
- `BulkRestoreRowCountMismatchError` is exported from `topics.ts` for tests. Acceptable, but it makes a route module export an error class; a small `errors` home would be tidier later.
- Frontend: the "caller can act" predicate (D20) is `canShowRestoreControls(isCanonicalDefaults)`, i.e. `!isCanonicalDefaults`. That is the same condition single Restore uses (extracted, per 5.1), so the pattern is consistent. Whether participants and member-facilitators are excluded depends on the page not rendering for them or on the server 403 path. The server enforces the role regardless, which is the property that matters to me. The 403 path closes the dialog and refetches, as designed.

Boundaries: the limiter stays out of session, voting and WebSocket code. No migration. Server authority is intact: the handler ignores the body and recomputes under the lock, and the client preview is advisory only. Session state is untouched (snapshot at room open, V1).

## 2. tasks.md claims versus reality

I ran `topics-bulk-restore*.test.ts`: 24 unit tests and 7 integration tests passed. I also ran the full frontend suite (844 passed). The integration tests were NOT skipped in this environment; Postgres was reachable and the `unnest` UPDATE and audit INSERT executed against a real database for the first time here. That is the largest residual risk in the change, and it is retired for the cases that were written.

Honestly marked open (correct): 4.8, 4.9, 4.12, 4.14, 4.15, 7.1, 7.2 and section 8.

Marked `[x]` but not fully evidenced. The test lists below were read from the test files; I did not find these cases in them.
- 4.1 is overclaimed. The unit file has no 401, no 503 fail-closed, no template-team 404, no byte-identical comparison with single restore or assign-defaults, no "locked team with nothing archived" 409, no N=12-consumes-one-unit assertion and no shared-counter assertion. The non-canonical-id 404 is covered only for one caller class, not the four the task names. The hygiene test does cover the template-team path for the new route (one added row), which partly covers one item.
- 4.3 is overclaimed. Missing: two same-named archived defaults, renamed default, blank-name legacy rows, case/NFC-NFD distinction (the planner unit tests may cover some; the route-level ones do not). The single-restore regression is covered in the integration file.
- 4.4 is partly covered (archived custom topic stays archived). Annotations, votes and `session_topics` untouched are not asserted beyond the room-open case.
- 4.5 lacks the 50-row fixture. The statement-count test exists.
- 4.6 lacks the malformed JSON case; it covers text/plain, form-urlencoded and the over-1 MiB body, but the "no body content in logs" assertion needs confirming.
- 4.7 lacks the `actor_ip` / `actor_global_role` assertions I could find.
- 4.2 and 4.13 are evidenced only by the integration file, which only runs where Postgres exists. CI's `integration.yml` sets `REQUIRE_DB=1` and runs the full test script, so they will run there. Acceptable.
- 4.11: the hygiene row is added. I did not verify the "no names in logs" seeding for the new route.

Recommendation: either add the missing cases or uncheck and annotate 4.1, 4.3, 4.4, 4.5, 4.6 and 4.7 with what is covered. Do not let the PR description claim the full lists.

## 3. Judgement on 4.8 and 4.9 (real-DB tests)

The notes say "not run: no Postgres in the unattended environment". That was environment-specific; here they ran green. The remaining issue is coverage, not execution.

Written and green: two concurrent bulk requests (partition, one audit row, collision-free orders), room-open-then-restore isolation, cross-team isolation, ordering equivalence with sequential single restores, 409 and idempotent empty.

Still missing, and these are the design's named concurrency risks (D17):
- bulk racing room open (snapshot all-or-nothing);
- bulk racing an Add of a same-named custom topic;
- bulk racing a single restore of one of the same topics;
- 4.9 states: draft (included at room open), in-progress, and the next-session snapshot including the restored topics. The existing test covers only "room open then restore, session unchanged".

My judgement: the advisory-lock design makes these races deterministic by construction, since every writer takes the same `lockTeamTopics`, so the risk is low. But they are the exact claims the design makes under V1/D17 and the only evidence for lock-sharing with room open is reading code. I would require the room-open race and the same-name Add race before merge, and accept the rest as follow-up with an explicit note. Do not tick 4.8/4.9 until the rest exist or the task text is reduced to what was built.

The Architect-level point: tests that silently skip when infra is down are fine only because `integration.yml` forces `REQUIRE_DB`. Confirm that lane actually runs this file before relying on it.

## 4. The 7.1 `addCustomTopic.ts` deviation

Accept. The design contradicts itself: D1/V2 says leave `addCustomTopic.ts` alone, while D20 and task 5.7 require `activeEmptyStateVariant` to gain an input, and that function lives in that file. The diff touches only `activeEmptyStateVariant` and its union type (a fourth optional positional boolean, a new `unlocked_restorable` variant); `findDuplicate` and the hint logic are unchanged. The coupling cost the Engineer worried about (bulk coupling to the duplicate-hint rule) did not occur.

Actions: record the reason in design.md and the PR description so the 7.1 diff check reads "absent except `activeEmptyStateVariant`", then tick 7.1 on that basis once the full suites and lint are rerun. A fourth positional optional boolean is getting unwieldy; if the function grows again it should take an options object, but not in this PR. Also note the frontend test for the variant was added in `addCustomTopic.test.ts`, which is the right place.

## 5. Other points

- `docs/deployment.md`, BRD and use case 08 updates are present and consistent with the design.
- The 4.14 production gate (TODO-GROUP6 floor measurement) is correctly left open and recorded. It must appear in the PR as a deployment blocker with a named owner; I will not sign off production readiness on the 150 ms placeholder.
- `tsc --noEmit` on the backend still shows type errors in pre-existing test files (`topics.test.ts`, `topics-integration.test.ts`). I did not confirm whether they predate this change; the build excludes tests, so this is a hygiene note, not a finding against this change.

## Conditions for merge

1. Add the room-open race and same-name Add race tests (4.8), and the draft, in-progress and next-snapshot cases (4.9); or narrow the task text to what exists and file the rest.
2. Correct the `[x]` marks on 4.1, 4.3, 4.4, 4.5, 4.6 and 4.7, or add the missing cases.
3. Document the 7.1 deviation in design.md and the PR.
4. Carry the 4.14 timing-floor gate and the section 9 follow-ups (add a cascade-helper refactor) into the PR description.
